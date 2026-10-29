import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { readSqliteTimingTotals, requestTimingPhases, type RequestTimingPhase, type RequestTimingSummary } from './request-timing.ts';

export const defaultRequestCapacity = 2_000;
export const defaultSampleIntervalMs = 10_000;
/** One hour of process samples at the default interval. */
export const defaultSampleCapacity = 360;
const defaultQueryLimit = 50;

export type ProcessSample = {
  at: string;
  intervalMs: number;
  requestsCompleted: number;
  eventLoopDelayP95Ms: number;
  eventLoopDelayMaxMs: number;
  cpuPercent: number;
  rssBytes: number;
  heapUsedBytes: number;
  sqliteRequestMs: number;
  sqliteBackgroundMs: number;
};

export type RouteTimingAggregate = {
  method: string;
  route: string;
  count: number;
  durationMs: { p50: number; p95: number; max: number };
  localMs: { p50: number; p95: number; max: number };
  meanPhasesMs: Record<RequestTimingPhase, number>;
  statements: { mean: number; max: number };
  maxTransactionMs: number;
};

export type RequestTimingQuery = {
  limit?: number;
  route?: string;
  minLocalMs?: number;
  since?: string;
};

export type FlightRecorderSnapshot = {
  schemaVersion: 'request_flight_recorder.v1';
  generatedAt: string;
  process: { pid: number; uptimeSeconds: number };
  capacity: { requests: number; samples: number; sampleIntervalMs: number };
  recordedRequestsTotal: number;
  retainedRequests: number;
  oldestRetainedAt: string | null;
  matchedRequests: number;
  routes: RouteTimingAggregate[];
  requests: RequestTimingSummary[];
  samples: ProcessSample[];
};

type EventLoopHistogram = {
  enable(): void;
  disable(): void;
  reset(): void;
  percentile(percentile: number): number;
  readonly max: number;
};

export type RequestFlightRecorder = {
  record(summary: RequestTimingSummary): void;
  /** Records one process sample; the interval timer calls this, tests may call it directly. */
  sample(): void;
  snapshot(query?: RequestTimingQuery): FlightRecorderSnapshot;
  stop(): void;
};

/**
 * Keeps recent request summaries and process samples in memory so an operator
 * can inspect a slow period after it happened. Contents are lost on restart.
 */
export function createRequestFlightRecorder(options: {
  requestCapacity?: number;
  sampleCapacity?: number;
  sampleIntervalMs?: number | null;
  clockMs?: () => number;
  now?: () => Date;
  eventLoopHistogram?: EventLoopHistogram;
  readProcess?: () => { cpuMicros: number; rssBytes: number; heapUsedBytes: number };
} = {}): RequestFlightRecorder {
  const requestCapacity = requirePositiveInteger(options.requestCapacity ?? defaultRequestCapacity, 'requestCapacity');
  const sampleCapacity = requirePositiveInteger(options.sampleCapacity ?? defaultSampleCapacity, 'sampleCapacity');
  const sampleIntervalMs = options.sampleIntervalMs === undefined ? defaultSampleIntervalMs : options.sampleIntervalMs;
  const clockMs = options.clockMs ?? (() => performance.now());
  const now = options.now ?? (() => new Date());
  const eventLoopHistogram = options.eventLoopHistogram ?? monitorEventLoopDelay({ resolution: 20 });
  const readProcess = options.readProcess ?? (() => {
    const cpu = process.cpuUsage();
    const memory = process.memoryUsage();
    return { cpuMicros: cpu.user + cpu.system, rssBytes: memory.rss, heapUsedBytes: memory.heapUsed };
  });
  const requests = new Ring<RequestTimingSummary>(requestCapacity);
  const samples = new Ring<ProcessSample>(sampleCapacity);
  let recordedRequestsTotal = 0;
  let requestsSinceSample = 0;
  let previous = { atMs: clockMs(), cpuMicros: readProcess().cpuMicros, ...readSqliteTimingTotals() };
  eventLoopHistogram.enable();

  const sample = () => {
    const atMs = clockMs();
    const processState = readProcess();
    const sqlite = readSqliteTimingTotals();
    const intervalMs = Math.max(0, atMs - previous.atMs);
    samples.push({
      at: now().toISOString(),
      intervalMs: round(intervalMs),
      requestsCompleted: requestsSinceSample,
      eventLoopDelayP95Ms: nanosecondsToMs(eventLoopHistogram.percentile(95)),
      eventLoopDelayMaxMs: nanosecondsToMs(eventLoopHistogram.max),
      cpuPercent: intervalMs > 0 ? round((processState.cpuMicros - previous.cpuMicros) / 10 / intervalMs) : 0,
      rssBytes: processState.rssBytes,
      heapUsedBytes: processState.heapUsedBytes,
      sqliteRequestMs: round(sqlite.requestMs - previous.requestMs),
      sqliteBackgroundMs: round(sqlite.backgroundMs - previous.backgroundMs),
    });
    eventLoopHistogram.reset();
    requestsSinceSample = 0;
    previous = { atMs, cpuMicros: processState.cpuMicros, ...sqlite };
  };
  const timer = sampleIntervalMs === null ? null : setInterval(sample, sampleIntervalMs);
  timer?.unref();

  return {
    record(summary) {
      requests.push(summary);
      recordedRequestsTotal += 1;
      requestsSinceSample += 1;
    },
    sample,
    snapshot(query = {}) {
      const retained = requests.newestFirst();
      const since = query.since === undefined ? null : Date.parse(query.since);
      if (since !== null && Number.isNaN(since)) throw new Error(`Invalid since timestamp: ${query.since}`);
      const matched = retained.filter((summary) => (
        (query.route === undefined || summary.route === query.route)
        && (query.minLocalMs === undefined || summary.localMs >= query.minLocalMs)
        && (since === null || Date.parse(summary.at) >= since)
      ));
      return {
        schemaVersion: 'request_flight_recorder.v1',
        generatedAt: now().toISOString(),
        process: { pid: process.pid, uptimeSeconds: Math.round(process.uptime()) },
        capacity: { requests: requestCapacity, samples: sampleCapacity, sampleIntervalMs: sampleIntervalMs ?? 0 },
        recordedRequestsTotal,
        retainedRequests: retained.length,
        oldestRetainedAt: retained.at(-1)?.at ?? null,
        matchedRequests: matched.length,
        routes: aggregateByRoute(matched),
        requests: matched.slice(0, query.limit ?? defaultQueryLimit),
        samples: samples.newestFirst(),
      };
    },
    stop() {
      if (timer) clearInterval(timer);
      eventLoopHistogram.disable();
    },
  };
}

export function aggregateByRoute(summaries: readonly RequestTimingSummary[]): RouteTimingAggregate[] {
  const groups = new Map<string, RequestTimingSummary[]>();
  for (const summary of summaries) {
    const key = `${summary.method} ${summary.route}`;
    const group = groups.get(key) ?? [];
    group.push(summary);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => {
      const durations = group.map((summary) => summary.durationMs).sort((left, right) => left - right);
      const local = group.map((summary) => summary.localMs).sort((left, right) => left - right);
      const statements = group.map((summary) => summary.sqlite.statements);
      const meanPhasesMs = Object.fromEntries(requestTimingPhases.map((phase) => [
        phase,
        round(group.reduce((sum, summary) => sum + summary.phasesMs[phase], 0) / group.length),
      ])) as Record<RequestTimingPhase, number>;
      return {
        method: group[0]!.method,
        route: group[0]!.route,
        count: group.length,
        durationMs: { p50: percentile(durations, 0.5), p95: percentile(durations, 0.95), max: durations.at(-1)! },
        localMs: { p50: percentile(local, 0.5), p95: percentile(local, 0.95), max: local.at(-1)! },
        meanPhasesMs,
        statements: {
          mean: round(statements.reduce((sum, count) => sum + count, 0) / group.length),
          max: Math.max(...statements),
        },
        maxTransactionMs: Math.max(...group.map((summary) => summary.sqlite.maxTransactionMs)),
      };
    })
    .sort((left, right) => right.localMs.p95 - left.localMs.p95 || left.route.localeCompare(right.route));
}

export function parseRequestTimingQuery(searchParams: URLSearchParams): RequestTimingQuery {
  const query: RequestTimingQuery = {};
  const limit = searchParams.get('limit');
  if (limit !== null) query.limit = requirePositiveInteger(Number(limit), 'limit');
  const route = searchParams.get('route');
  if (route !== null && route.trim() !== '') query.route = route.trim();
  const minLocalMs = searchParams.get('minLocalMs');
  if (minLocalMs !== null) {
    const value = Number(minLocalMs);
    if (!Number.isFinite(value) || value < 0) throw new Error('minLocalMs must be a non-negative number.');
    query.minLocalMs = value;
  }
  const since = searchParams.get('since');
  if (since !== null && since.trim() !== '') {
    if (Number.isNaN(Date.parse(since))) throw new Error('since must be an ISO timestamp.');
    query.since = since.trim();
  }
  return query;
}

class Ring<T> {
  private readonly items: T[] = [];
  private next = 0;

  constructor(private readonly capacity: number) {}

  push(item: T): void {
    if (this.items.length < this.capacity) {
      this.items.push(item);
    } else {
      this.items[this.next] = item;
    }
    this.next = (this.next + 1) % this.capacity;
  }

  newestFirst(): T[] {
    const ordered = this.items.length < this.capacity
      ? [...this.items]
      : [...this.items.slice(this.next), ...this.items.slice(0, this.next)];
    return ordered.reverse();
  }
}

function percentile(sorted: readonly number[], fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)] ?? 0;
}

function requirePositiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer.`);
  return value;
}

function nanosecondsToMs(value: number): number {
  return Number.isFinite(value) ? round(value / 1_000_000) : 0;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
