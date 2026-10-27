import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { afterEach, describe, test } from 'node:test';
import {
  createServiceMetrics,
  isLoopbackAddress,
  requestTimingsPath,
  startMetricsServer,
  type ServiceOperationalMetrics,
} from '../server/observability.ts';
import {
  aggregateByRoute,
  createRequestFlightRecorder,
  parseRequestTimingQuery,
  type FlightRecorderSnapshot,
  type RequestFlightRecorder,
} from '../server/request-flight-recorder.ts';
import type { RequestTimingSummary } from '../server/request-timing.ts';

const quietHistogram = { enable() {}, disable() {}, reset() {}, percentile: () => 0, max: 0 };

function summary(overrides: Partial<RequestTimingSummary> & { at: string }): RequestTimingSummary {
  return {
    method: 'GET',
    route: '/api/status',
    status: '200',
    outcome: 'completed',
    durationMs: 10,
    localMs: 10,
    phasesMs: { sqlite: 4, provider: 0, auth: 1, response: 1, other: 4 },
    sqlite: { statements: 5, transactions: 0, maxTransactionMs: 0, topStatements: [] },
    otherSqliteMs: 0,
    concurrentRequestsAtStart: 0,
    learnerId: 'learner-1',
    responseBytes: 100,
    ...overrides,
  };
}

function recorder(options: Parameters<typeof createRequestFlightRecorder>[0] = {}): RequestFlightRecorder {
  const created = createRequestFlightRecorder({ sampleIntervalMs: null, eventLoopHistogram: quietHistogram, ...options });
  recorders.push(created);
  return created;
}

const recorders: RequestFlightRecorder[] = [];

describe('request flight recorder', () => {
  const servers: Server[] = [];

  afterEach(async () => {
    for (const created of recorders.splice(0)) created.stop();
    for (const server of servers.splice(0)) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test('retains only the newest requests, newest first, and filters by route, local time, and start time', () => {
    const flight = recorder({ requestCapacity: 3 });
    for (let index = 1; index <= 5; index += 1) {
      flight.record(summary({
        at: `2026-10-27T21:00:0${index}.000Z`,
        route: index % 2 === 0 ? '/api/session-payload' : '/api/status',
        localMs: index * 100,
      }));
    }

    const all = flight.snapshot();
    assert.equal(all.recordedRequestsTotal, 5);
    assert.equal(all.retainedRequests, 3);
    assert.equal(all.oldestRetainedAt, '2026-10-27T21:00:03.000Z');
    assert.deepEqual(all.requests.map((request) => request.localMs), [500, 400, 300]);

    assert.deepEqual(flight.snapshot({ route: '/api/session-payload' }).requests.map((request) => request.localMs), [400]);
    assert.deepEqual(flight.snapshot({ minLocalMs: 400 }).requests.map((request) => request.localMs), [500, 400]);
    assert.deepEqual(flight.snapshot({ since: '2026-10-27T21:00:05.000Z' }).requests.map((request) => request.localMs), [500]);
    const limited = flight.snapshot({ limit: 1 });
    assert.equal(limited.matchedRequests, 3);
    assert.equal(limited.requests.length, 1);
    assert.equal(limited.routes.reduce((sum, route) => sum + route.count, 0), 3);
  });

  test('aggregates routes by percentile, mean phase time, and statement counts, slowest first', () => {
    const routes = aggregateByRoute([
      ...[10, 20, 30, 40].map((localMs) => summary({ at: '2026-10-27T21:00:00.000Z', localMs, durationMs: localMs })),
      summary({
        at: '2026-10-27T21:00:00.000Z',
        method: 'POST',
        route: '/api/session-payload',
        localMs: 90,
        durationMs: 90,
        phasesMs: { sqlite: 60, provider: 0, auth: 0, response: 10, other: 20 },
        sqlite: { statements: 1_116, transactions: 3, maxTransactionMs: 2.5, topStatements: [] },
      }),
    ]);
    assert.deepEqual(routes.map((route) => route.route), ['/api/session-payload', '/api/status']);
    const status = routes[1]!;
    assert.equal(status.count, 4);
    assert.deepEqual(status.localMs, { p50: 20, p95: 40, max: 40 });
    assert.equal(status.meanPhasesMs.sqlite, 4);
    assert.deepEqual(status.statements, { mean: 5, max: 5 });
    assert.equal(routes[0]!.statements.max, 1_116);
    assert.equal(routes[0]!.maxTransactionMs, 2.5);
  });

  test('samples process load as deltas over the sampling interval', () => {
    let nowMs = 0;
    let cpuMicros = 0;
    const flight = recorder({
      sampleCapacity: 2,
      clockMs: () => nowMs,
      now: () => new Date('2026-10-27T21:00:00.000Z'),
      eventLoopHistogram: { ...quietHistogram, percentile: () => 12_000_000, max: 80_000_000 },
      readProcess: () => ({ cpuMicros, rssBytes: 1_000, heapUsedBytes: 500 }),
    });
    flight.record(summary({ at: '2026-10-27T21:00:00.000Z' }));
    nowMs = 10_000;
    cpuMicros = 2_500_000;
    flight.sample();

    const [sample] = flight.snapshot().samples;
    assert.equal(sample?.intervalMs, 10_000);
    assert.equal(sample?.requestsCompleted, 1);
    assert.equal(sample?.cpuPercent, 25);
    assert.equal(sample?.eventLoopDelayP95Ms, 12);
    assert.equal(sample?.eventLoopDelayMaxMs, 80);
    nowMs = 20_000;
    flight.sample();
    nowMs = 30_000;
    flight.sample();
    assert.equal(flight.snapshot().samples.length, 2);
    assert.equal(flight.snapshot().samples[0]?.requestsCompleted, 0);
  });

  test('validates query parameters', () => {
    assert.deepEqual(parseRequestTimingQuery(new URLSearchParams('limit=5&route=/api/status&minLocalMs=250')), {
      limit: 5,
      route: '/api/status',
      minLocalMs: 250,
    });
    assert.throws(() => parseRequestTimingQuery(new URLSearchParams('limit=0')), /limit/);
    assert.throws(() => parseRequestTimingQuery(new URLSearchParams('minLocalMs=-1')), /minLocalMs/);
    assert.throws(() => parseRequestTimingQuery(new URLSearchParams('since=yesterday')), /since/);
  });

  test('serves recent timings on the private listener only to loopback callers', async () => {
    const flight = recorder();
    flight.record(summary({ at: '2026-10-27T21:00:00.000Z', localMs: 900 }));
    const metrics = createServiceMetrics({ eventLoopHistogram: quietHistogram });
    const server = startMetricsServer({
      metrics,
      port: 0,
      host: '127.0.0.1',
      readOperationalMetrics: async () => operationalMetrics,
      flightRecorder: flight,
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const response = await fetch(`${baseUrl}${requestTimingsPath}?minLocalMs=500`);
    assert.equal(response.status, 200);
    const snapshot = await response.json() as FlightRecorderSnapshot;
    assert.equal(snapshot.schemaVersion, 'request_flight_recorder.v1');
    assert.equal(snapshot.requests[0]?.localMs, 900);
    assert.equal((await fetch(`${baseUrl}${requestTimingsPath}?limit=none`)).status, 400);
    assert.equal((await fetch(`${baseUrl}/metrics`)).status, 200);
    metrics.dispose();

    assert.equal(isLoopbackAddress('127.0.0.1'), true);
    assert.equal(isLoopbackAddress('::1'), true);
    assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true);
    assert.equal(isLoopbackAddress('fdaa:0:1::3'), false);
    assert.equal(isLoopbackAddress(undefined), false);
  });

  test('does not expose the endpoint without a recorder', async () => {
    const metrics = createServiceMetrics({ eventLoopHistogram: quietHistogram });
    const server = startMetricsServer({
      metrics,
      port: 0,
      host: '127.0.0.1',
      readOperationalMetrics: async () => operationalMetrics,
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    assert.equal((await fetch(`http://127.0.0.1:${address.port}${requestTimingsPath}`)).status, 404);
    metrics.dispose();
  });
});

const operationalMetrics: ServiceOperationalMetrics = {
  databaseBytes: 1,
  walBytes: 1,
  backupReplicationAgeSeconds: 1,
  maintenanceMode: false,
  providerWorkEnabled: true,
  activeProviderWorkCount: 0,
};
