import type { Request, RequestHandler } from 'express';
import { createServer, type Server } from 'node:http';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';

const requestDurationBuckets = [
  0.005,
  0.01,
  0.025,
  0.05,
  0.1,
  0.25,
  0.5,
  1,
  2.5,
  5,
  10,
  30,
  60,
  120,
  180,
  300,
  600,
  900,
  1_200,
] as const;
const responseSizeBuckets = [256, 1_024, 4_096, 16_384, 65_536, 262_144, 1_048_576, 4_194_304] as const;

type HistogramState = {
  count: number;
  sum: number;
  bucketCounts: number[];
};

type EventLoopHistogram = {
  enable(): void;
  disable(): void;
  reset(): void;
  percentile(percentile: number): number;
  readonly max: number;
};

export type ServiceOperationalMetrics = {
  databaseBytes: number | null;
  walBytes: number | null;
  backupReplicationAgeSeconds: number | null;
  maintenanceMode: boolean | null;
  providerWorkEnabled: boolean | null;
  activeProviderWorkCount: number;
};

export type ServiceMetrics = {
  requestMiddleware: RequestHandler;
  render(operational: ServiceOperationalMetrics): string;
  dispose(): void;
};

export function createServiceMetrics(options: {
  clockMs?: () => number;
  eventLoopHistogram?: EventLoopHistogram;
  buildInfo?: { version: string; deployment: string };
} = {}): ServiceMetrics {
  const clockMs = options.clockMs ?? (() => performance.now());
  const eventLoopHistogram = options.eventLoopHistogram ?? monitorEventLoopDelay({ resolution: 20 });
  const requestCounts = new Map<string, number>();
  const requestDurations = new Map<string, HistogramState>();
  const responseSizes = new Map<string, HistogramState>();
  const buildInfo = {
    version: normalizeBuildLabel(options.buildInfo?.version ?? process.env.npm_package_version),
    deployment: normalizeBuildLabel(options.buildInfo?.deployment ?? firstBuildIdentifier([
      process.env.APP_REVISION,
      flyImageTag(process.env.FLY_IMAGE_REF),
      process.env.FLY_MACHINE_VERSION,
    ])),
  };
  let requestsInFlight = 0;
  eventLoopHistogram.enable();

  const requestMiddleware: RequestHandler = (request, response, next) => {
    requestsInFlight += 1;
    const startedAtMs = clockMs();
    let recorded = false;
    const record = (outcome: 'completed' | 'aborted') => {
      if (recorded) return;
      recorded = true;
      requestsInFlight = Math.max(0, requestsInFlight - 1);
      observeRequest({
        method: normalizeMethod(request.method),
        route: resolveRouteLabel(request),
        status: outcome === 'completed' ? normalizeStatus(response.statusCode) : 'unknown',
        outcome,
        durationSeconds: Math.max(0, clockMs() - startedAtMs) / 1_000,
        responseBytes: outcome === 'completed' ? readResponseSize(response) : null,
      });
    };
    response.once('finish', () => record('completed'));
    response.once('close', () => record(response.writableFinished ? 'completed' : 'aborted'));
    next();
  };

  function observeRequest(input: {
    method: string;
    route: string;
    status: string;
    outcome: 'completed' | 'aborted';
    durationSeconds: number;
    responseBytes: number | null;
  }): void {
    const key = JSON.stringify([input.method, input.route, input.status, input.outcome]);
    requestCounts.set(key, (requestCounts.get(key) ?? 0) + 1);
    const histogram = requestDurations.get(key) ?? {
      count: 0,
      sum: 0,
      bucketCounts: requestDurationBuckets.map(() => 0),
    };
    histogram.count += 1;
    histogram.sum += input.durationSeconds;
    requestDurationBuckets.forEach((upperBound, index) => {
      if (input.durationSeconds <= upperBound) histogram.bucketCounts[index] += 1;
    });
    requestDurations.set(key, histogram);
    if (input.responseBytes !== null) {
      const sizeHistogram = responseSizes.get(key) ?? {
        count: 0,
        sum: 0,
        bucketCounts: responseSizeBuckets.map(() => 0),
      };
      sizeHistogram.count += 1;
      sizeHistogram.sum += input.responseBytes;
      responseSizeBuckets.forEach((upperBound, index) => {
        if (input.responseBytes !== null && input.responseBytes <= upperBound) {
          sizeHistogram.bucketCounts[index] += 1;
        }
      });
      responseSizes.set(key, sizeHistogram);
    }
  }

  return {
    requestMiddleware,
    render(operational) {
      const lines: string[] = [];
      appendHelpAndType(
        lines,
        'chinese_study_http_requests_total',
        'HTTP requests terminated by response completion or client disconnect.',
        'counter',
      );
      for (const [key, count] of sortedEntries(requestCounts)) {
        const [method, route, status, outcome] = JSON.parse(key) as [string, string, string, string];
        lines.push(metricLine('chinese_study_http_requests_total', count, { method, route, status, outcome }));
      }

      appendHelpAndType(
        lines,
        'chinese_study_http_request_duration_seconds',
        'HTTP request duration inside the application process until completion or client disconnect.',
        'histogram',
      );
      for (const [key, histogram] of sortedEntries(requestDurations)) {
        const [method, route, status, outcome] = JSON.parse(key) as [string, string, string, string];
        const labels = { method, route, status, outcome };
        requestDurationBuckets.forEach((upperBound, index) => {
          lines.push(metricLine(
            'chinese_study_http_request_duration_seconds_bucket',
            histogram.bucketCounts[index] ?? 0,
            { ...labels, le: String(upperBound) },
          ));
        });
        lines.push(metricLine(
          'chinese_study_http_request_duration_seconds_bucket',
          histogram.count,
          { ...labels, le: '+Inf' },
        ));
        lines.push(metricLine('chinese_study_http_request_duration_seconds_sum', histogram.sum, labels));
        lines.push(metricLine('chinese_study_http_request_duration_seconds_count', histogram.count, labels));
      }

      appendHelpAndType(
        lines,
        'chinese_study_http_response_size_bytes',
        'HTTP response size when the application provides a Content-Length header.',
        'histogram',
      );
      for (const [key, histogram] of sortedEntries(responseSizes)) {
        const [method, route, status, outcome] = JSON.parse(key) as [string, string, string, string];
        const labels = { method, route, status, outcome };
        responseSizeBuckets.forEach((upperBound, index) => {
          lines.push(metricLine(
            'chinese_study_http_response_size_bytes_bucket',
            histogram.bucketCounts[index] ?? 0,
            { ...labels, le: String(upperBound) },
          ));
        });
        lines.push(metricLine(
          'chinese_study_http_response_size_bytes_bucket',
          histogram.count,
          { ...labels, le: '+Inf' },
        ));
        lines.push(metricLine('chinese_study_http_response_size_bytes_sum', histogram.sum, labels));
        lines.push(metricLine('chinese_study_http_response_size_bytes_count', histogram.count, labels));
      }

      appendGauge(lines, 'chinese_study_http_requests_in_flight', 'HTTP requests currently in flight.', requestsInFlight);
      const cpuUsage = process.cpuUsage();
      appendCounter(
        lines,
        'chinese_study_process_cpu_seconds_total',
        'Total user and system CPU time consumed by the application process.',
        (cpuUsage.user + cpuUsage.system) / 1_000_000,
      );
      const memoryUsage = process.memoryUsage();
      appendGauge(
        lines,
        'chinese_study_process_resident_memory_bytes',
        'Resident memory used by the application process.',
        memoryUsage.rss,
      );
      appendGauge(
        lines,
        'chinese_study_process_heap_used_bytes',
        'V8 heap memory used by the application process.',
        memoryUsage.heapUsed,
      );
      appendGauge(
        lines,
        'chinese_study_process_uptime_seconds',
        'Application process uptime.',
        process.uptime(),
      );
      appendHelpAndType(
        lines,
        'chinese_study_build_info',
        'Application version and deployment identifier for the running process.',
        'gauge',
      );
      lines.push(metricLine('chinese_study_build_info', 1, buildInfo));
      appendGauge(
        lines,
        'chinese_study_nodejs_event_loop_delay_p50_seconds',
        'Median event-loop delay since the previous metrics scrape.',
        nanosecondsToSeconds(eventLoopHistogram.percentile(50)),
      );
      appendGauge(
        lines,
        'chinese_study_nodejs_event_loop_delay_p95_seconds',
        '95th percentile event-loop delay since the previous metrics scrape.',
        nanosecondsToSeconds(eventLoopHistogram.percentile(95)),
      );
      appendGauge(
        lines,
        'chinese_study_nodejs_event_loop_delay_max_seconds',
        'Maximum event-loop delay since the previous metrics scrape.',
        nanosecondsToSeconds(eventLoopHistogram.max),
      );
      eventLoopHistogram.reset();

      appendGauge(
        lines,
        'chinese_study_database_storage_available',
        'Whether database and WAL file sizes could be read.',
        operational.databaseBytes === null || operational.walBytes === null ? 0 : 1,
      );
      appendGauge(
        lines,
        'chinese_study_database_bytes',
        'Size of the SQLite database file, or -1 when unavailable.',
        operational.databaseBytes ?? -1,
      );
      appendGauge(
        lines,
        'chinese_study_wal_bytes',
        'Size of the SQLite WAL file, or -1 when unavailable.',
        operational.walBytes ?? -1,
      );
      appendGauge(
        lines,
        'chinese_study_backup_replication_available',
        'Whether Litestream reported a successful replication timestamp.',
        operational.backupReplicationAgeSeconds === null ? 0 : 1,
      );
      appendGauge(
        lines,
        'chinese_study_backup_replication_age_seconds',
        'Age of the latest successful Litestream replication, or -1 when unavailable.',
        operational.backupReplicationAgeSeconds ?? -1,
      );
      appendGauge(
        lines,
        'chinese_study_service_controls_available',
        'Whether hosted service control state could be read.',
        operational.maintenanceMode === null || operational.providerWorkEnabled === null ? 0 : 1,
      );
      appendGauge(
        lines,
        'chinese_study_maintenance_mode',
        'Whether learner writes are paused for maintenance, or -1 when unavailable.',
        operational.maintenanceMode === null ? -1 : operational.maintenanceMode ? 1 : 0,
      );
      appendGauge(
        lines,
        'chinese_study_provider_work_enabled',
        'Whether new model-provider work is enabled, or -1 when unavailable.',
        operational.providerWorkEnabled === null ? -1 : operational.providerWorkEnabled ? 1 : 0,
      );
      appendGauge(
        lines,
        'chinese_study_active_provider_work',
        'Model-provider operations currently in flight.',
        operational.activeProviderWorkCount,
      );
      return `${lines.join('\n')}\n`;
    },
    dispose() {
      eventLoopHistogram.disable();
    },
  };
}

export function startMetricsServer(options: {
  metrics: ServiceMetrics;
  port: number;
  host?: string;
  readOperationalMetrics: () => Promise<ServiceOperationalMetrics>;
  logError?: (message: string, metadata: Record<string, string>) => void;
}): Server {
  const logError = options.logError ?? ((message, metadata) => console.error(message, metadata));
  const server = createServer(async (request, response) => {
    if (request.method !== 'GET' || request.url !== '/metrics') {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found\n');
      return;
    }
    let operationalMetrics: ServiceOperationalMetrics;
    try {
      operationalMetrics = await options.readOperationalMetrics();
    } catch (error) {
      logError('Failed to read service operational metrics', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      operationalMetrics = unavailableOperationalMetrics();
    }
    try {
      const body = options.metrics.render(operationalMetrics);
      response.writeHead(200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' });
      response.end(body);
    } catch (error) {
      logError('Failed to render service metrics', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Metrics unavailable\n');
    }
  });
  server.listen(options.port, options.host ?? '0.0.0.0');
  return server;
}

export function readMetricsPort(value: string | undefined): number | null {
  if (value === undefined || value.trim() === '') return null;
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(`Invalid APP_METRICS_PORT: ${value}`);
  }
  return port;
}

function resolveRouteLabel(request: Request): string {
  const route = (request as Request & { route?: { path?: unknown } }).route;
  if (typeof route?.path === 'string') return route.path;
  if (route?.path instanceof RegExp) return '/frontend/*';
  const originalPath = request.originalUrl.split('?', 1)[0] ?? '';
  if (originalPath.startsWith('/assets/')) return '/assets/*';
  if (originalPath === '/favicon.ico') return '/favicon.ico';
  if (originalPath === '/healthz') return '/healthz';
  if (originalPath === '/metrics') return '/metrics';
  if (originalPath === '/api' || originalPath.startsWith('/api/')) return '/api/*';
  return '/unmatched';
}

function readResponseSize(response: import('express').Response): number | null {
  const contentLength = response.getHeader('content-length');
  const value = typeof contentLength === 'number'
    ? contentLength
    : typeof contentLength === 'string' && /^\d+$/.test(contentLength)
      ? Number(contentLength)
      : null;
  return value !== null && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function normalizeMethod(method: string): string {
  const normalized = method.toUpperCase();
  return ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(normalized)
    ? normalized
    : 'OTHER';
}

function normalizeStatus(statusCode: number): string {
  return Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599
    ? String(statusCode)
    : 'unknown';
}

function sortedEntries<T>(values: Map<string, T>): Array<[string, T]> {
  return [...values.entries()].sort(([left], [right]) => left.localeCompare(right));
}

function appendCounter(lines: string[], name: string, help: string, value: number): void {
  appendHelpAndType(lines, name, help, 'counter');
  lines.push(metricLine(name, value));
}

function appendGauge(lines: string[], name: string, help: string, value: number): void {
  appendHelpAndType(lines, name, help, 'gauge');
  lines.push(metricLine(name, value));
}

function appendHelpAndType(
  lines: string[],
  name: string,
  help: string,
  type: 'counter' | 'gauge' | 'histogram',
): void {
  lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
}

function metricLine(name: string, value: number, labels: Record<string, string> = {}): string {
  const renderedLabels = Object.entries(labels)
    .map(([key, labelValue]) => `${key}="${escapeLabelValue(labelValue)}"`)
    .join(',');
  return `${name}${renderedLabels ? `{${renderedLabels}}` : ''} ${finiteMetric(value)}`;
}

function escapeLabelValue(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll('"', '\\"');
}

function finiteMetric(value: number): string {
  return Number.isFinite(value) ? String(value) : '0';
}

function nanosecondsToSeconds(value: number): number {
  return Number.isFinite(value) ? value / 1_000_000_000 : 0;
}

function normalizeBuildLabel(value: string | undefined): string {
  const normalized = value?.trim() ?? '';
  return /^[A-Za-z0-9._-]{1,64}$/.test(normalized) ? normalized : 'unknown';
}

function firstBuildIdentifier(candidates: Array<string | undefined>): string | undefined {
  return candidates.find((candidate) => (
    candidate !== undefined && candidate.trim() !== '' && candidate.trim() !== 'unknown'
  ));
}

function flyImageTag(imageReference: string | undefined): string | undefined {
  const separator = imageReference?.lastIndexOf(':') ?? -1;
  return separator >= 0 ? imageReference?.slice(separator + 1) : undefined;
}

function unavailableOperationalMetrics(): ServiceOperationalMetrics {
  return {
    databaseBytes: null,
    walBytes: null,
    backupReplicationAgeSeconds: null,
    maintenanceMode: null,
    providerWorkEnabled: null,
    activeProviderWorkCount: 0,
  };
}
