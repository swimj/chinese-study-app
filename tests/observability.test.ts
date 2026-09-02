import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import type { Server } from 'node:http';
import { afterEach, describe, test } from 'node:test';
import type { Request, Response } from 'express';
import {
  createServiceMetrics,
  readMetricsPort,
  startMetricsServer,
  type ServiceMetrics,
  type ServiceOperationalMetrics,
} from '../server/observability.ts';

const operationalMetrics: ServiceOperationalMetrics = {
  databaseBytes: 12_345,
  walBytes: 678,
  backupReplicationAgeSeconds: 9,
  maintenanceMode: false,
  providerWorkEnabled: true,
  activeProviderWorkCount: 2,
};

describe('hosted observability', () => {
  const servers: Server[] = [];
  const metricsInstances: ServiceMetrics[] = [];

  afterEach(async () => {
    for (const server of servers.splice(0)) {
      if (!server.listening) continue;
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
    for (const metrics of metricsInstances.splice(0)) metrics.dispose();
  });

  test('records bounded route labels without request or learner identifiers', async () => {
    let nowMs = 0;
    const metrics = createTestMetrics(() => {
      nowMs += 25;
      return nowMs;
    });
    const app = express();
    app.use(metrics.requestMiddleware);
    app.get('/api/items/:itemId', (_request, response) => response.json({ ok: true }));
    app.use('/api', (_request, response) => response.status(404).json({ error: 'not found' }));
    const server = app.listen(0, '127.0.0.1');
    servers.push(server);
    const baseUrl = await serverBaseUrl(server);

    const secretItemId = 'private-item-id-that-must-not-be-a-label';
    assert.equal((await fetch(`${baseUrl}/api/items/${secretItemId}`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/not-a-real-route/private-learner-id`)).status, 404);

    const rendered = metrics.render(operationalMetrics);
    assert.match(
      rendered,
      /chinese_study_http_requests_total\{method="GET",route="\/api\/items\/:itemId",status="200",outcome="completed"\} 1/,
    );
    assert.match(
      rendered,
      /chinese_study_http_requests_total\{method="GET",route="\/api\/\*",status="404",outcome="completed"\} 1/,
    );
    assert.match(
      rendered,
      /chinese_study_http_request_duration_seconds_count\{method="GET",route="\/api\/items\/:itemId",status="200",outcome="completed"\} 1/,
    );
    assert.match(
      rendered,
      /chinese_study_http_response_size_bytes_count\{method="GET",route="\/api\/items\/:itemId",status="200",outcome="completed"\} 1/,
    );
    assert.doesNotMatch(rendered, new RegExp(secretItemId));
    assert.doesNotMatch(rendered, /private-learner-id/);
  });

  test('renders runtime and operational metrics on a separate listener', async () => {
    const metrics = createTestMetrics(undefined, { version: '2.3.0', deployment: 'abc123' });
    const loggedErrors: Array<{ message: string; metadata: Record<string, string> }> = [];
    const server = startMetricsServer({
      metrics,
      port: 0,
      host: '127.0.0.1',
      readOperationalMetrics: async () => operationalMetrics,
      logError(message, metadata) {
        loggedErrors.push({ message, metadata });
      },
    });
    servers.push(server);
    const baseUrl = await serverBaseUrl(server);

    const response = await fetch(`${baseUrl}/metrics`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /version=0\.0\.4/);
    const rendered = await response.text();
    assert.match(rendered, /chinese_study_process_cpu_seconds_total [0-9.]+/);
    assert.match(rendered, /chinese_study_build_info\{version="2.3.0",deployment="abc123"\} 1/);
    assert.match(rendered, /chinese_study_nodejs_event_loop_delay_p95_seconds 2e-7/);
    assert.match(rendered, /chinese_study_database_bytes 12345/);
    assert.match(rendered, /chinese_study_wal_bytes 678/);
    assert.match(rendered, /chinese_study_backup_replication_age_seconds 9/);
    assert.match(rendered, /chinese_study_active_provider_work 2/);
    assert.equal(loggedErrors.length, 0);

    const missing = await fetch(`${baseUrl}/not-metrics`);
    assert.equal(missing.status, 404);
  });

  test('keeps process metrics available when operational collection fails', async () => {
    const metrics = createTestMetrics();
    const loggedErrors: Array<{ message: string; metadata: Record<string, string> }> = [];
    const server = startMetricsServer({
      metrics,
      port: 0,
      host: '127.0.0.1',
      readOperationalMetrics: async () => {
        throw new Error('private database detail');
      },
      logError(message, metadata) {
        loggedErrors.push({ message, metadata });
      },
    });
    servers.push(server);
    const response = await fetch(`${await serverBaseUrl(server)}/metrics`);
    assert.equal(response.status, 200);
    const rendered = await response.text();
    assert.match(rendered, /chinese_study_process_uptime_seconds [0-9.]+/);
    assert.match(rendered, /chinese_study_database_storage_available 0/);
    assert.match(rendered, /chinese_study_service_controls_available 0/);
    assert.match(rendered, /chinese_study_backup_replication_available 0/);
    assert.equal(JSON.stringify(loggedErrors).includes('private database detail'), false);
    assert.deepEqual(loggedErrors, [{
      message: 'Failed to read service operational metrics',
      metadata: { errorName: 'Error' },
    }]);
  });

  test('records client disconnects as aborted without a response size', () => {
    let nowMs = 0;
    const metrics = createTestMetrics(() => {
      nowMs += 50;
      return nowMs;
    });
    const response = Object.assign(new EventEmitter(), {
      statusCode: 200,
      writableFinished: false,
      getHeader: () => '999',
    });
    let nextCalled = false;
    metrics.requestMiddleware(
      {
        method: 'GET',
        originalUrl: '/api/items/private-item-id',
        route: { path: '/api/items/:itemId' },
      } as Request,
      response as unknown as Response,
      () => {
        nextCalled = true;
      },
    );
    response.emit('close');

    const rendered = metrics.render(operationalMetrics);
    assert.equal(nextCalled, true);
    assert.match(
      rendered,
      /chinese_study_http_requests_total\{method="GET",route="\/api\/items\/:itemId",status="unknown",outcome="aborted"\} 1/,
    );
    assert.doesNotMatch(rendered, /chinese_study_http_response_size_bytes_count\{[^\n]*route="\/api\/items\/:itemId"/);
    assert.doesNotMatch(rendered, /private-item-id/);
  });

  test('validates the optional private metrics port', () => {
    assert.equal(readMetricsPort(undefined), null);
    assert.equal(readMetricsPort(''), null);
    assert.equal(readMetricsPort('9091'), 9091);
    assert.throws(() => readMetricsPort('0'), /Invalid APP_METRICS_PORT/);
    assert.throws(() => readMetricsPort('not-a-port'), /Invalid APP_METRICS_PORT/);
    assert.throws(() => readMetricsPort('65536'), /Invalid APP_METRICS_PORT/);
  });

  test('configures Fly scraping without publishing the metrics listener', () => {
    const flyConfig = fs.readFileSync('deploy/fly/fly.template.toml', 'utf8');
    assert.match(flyConfig, /\[metrics\]\s+port = 9091\s+path = "\/metrics"/);
    assert.match(flyConfig, /APP_METRICS_PORT = "9091"/);
    assert.doesNotMatch(flyConfig, /internal_port = 9091/);
  });

  function createTestMetrics(
    clockMs?: () => number,
    buildInfo?: { version: string; deployment: string },
  ): ServiceMetrics {
    const eventLoopHistogram = {
      enable() {},
      disable() {},
      reset() {},
      percentile(percentile: number) {
        return percentile === 50 ? 100 : 200;
      },
      max: 300,
    };
    const metrics = createServiceMetrics({ clockMs, eventLoopHistogram, buildInfo });
    metricsInstances.push(metrics);
    return metrics;
  }
});

async function serverBaseUrl(server: Server): Promise<string> {
  if (!server.listening) {
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
  }
  const address = server.address();
  assert(address && typeof address === 'object');
  return `http://127.0.0.1:${address.port}`;
}
