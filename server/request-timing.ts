import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { Request, RequestHandler, Response } from 'express';
import { normalizeMethod, readResponseSize, resolveRouteLabel } from './observability.ts';

/**
 * Exclusive per-request time buckets. `other` is the remainder of wall time:
 * handler JavaScript plus waiting for the event loop behind other work.
 */
export const requestTimingPhases = ['sqlite', 'provider', 'auth', 'response', 'other'] as const;
export type RequestTimingPhase = typeof requestTimingPhases[number];
type IntervalPhase = 'provider' | 'auth';

export const defaultSlowRequestThresholdMs = 500;
const topStatementLimit = 5;
const fingerprintCacheLimit = 2_000;
const sqlPreviewLength = 160;

type StatementStats = {
  fingerprint: string;
  sql: string;
  count: number;
  totalMs: number;
  maxMs: number;
};

type OpenInterval = {
  active: number;
  startedAtMs: number;
  sqliteMsAtStart: number;
};

export type RequestTiming = {
  readonly clockMs: () => number;
  readonly startedAtMs: number;
  readonly startedAt: string;
  readonly concurrentRequestsAtStart: number;
  readonly globalSqliteMsAtStart: number;
  phaseMs: Record<Exclude<RequestTimingPhase, 'other'>, number>;
  statementCount: number;
  statements: Map<string, StatementStats>;
  transactionCount: number;
  maxTransactionMs: number;
  intervals: Partial<Record<IntervalPhase, OpenInterval>>;
  learnerId: string | null;
  finished: boolean;
};

export type RequestTimingStatement = {
  fingerprint: string;
  sql: string;
  count: number;
  totalMs: number;
  maxMs: number;
};

export type RequestTimingSummary = {
  at: string;
  method: string;
  route: string;
  status: string;
  outcome: 'completed' | 'aborted';
  durationMs: number;
  /** Wall time excluding upstream provider waits; the slow-request threshold applies to this. */
  localMs: number;
  phasesMs: Record<RequestTimingPhase, number>;
  sqlite: {
    statements: number;
    transactions: number;
    maxTransactionMs: number;
    topStatements: RequestTimingStatement[];
  };
  /** SQLite time spent by other requests and background work while this request was open. */
  otherSqliteMs: number;
  concurrentRequestsAtStart: number;
  learnerId: string | null;
  responseBytes: number | null;
};

export type SlowRequestEvent = {
  schemaVersion: 'request_timing.v1';
  event: 'request.slow';
  thresholdMs: number;
  runtime: { appVersion: string | null; appRevision: string | null; flyMachineId: string | null };
} & RequestTimingSummary;

type SqliteTotals = {
  requestMs: number;
  backgroundMs: number;
  requestStatements: number;
  backgroundStatements: number;
};

export const transactionHoldBuckets = [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10] as const;

export type TransactionHoldHistogram = {
  count: number;
  sum: number;
  bucketCounts: number[];
};

const timingContext = new AsyncLocalStorage<RequestTiming>();
const timingByRequest = new WeakMap<Request, RequestTiming>();
const fingerprintCache = new Map<string, { fingerprint: string; sql: string }>();
const sqliteTotals: SqliteTotals = { requestMs: 0, backgroundMs: 0, requestStatements: 0, backgroundStatements: 0 };
const transactionHold: TransactionHoldHistogram = {
  count: 0,
  sum: 0,
  bucketCounts: transactionHoldBuckets.map(() => 0),
};
let openTransaction: { startedAtMs: number; timing: RequestTiming | undefined } | null = null;
let sqliteDepth = 0;
let requestsInFlight = 0;

export function startRequestTiming(options: { clockMs?: () => number; at?: string } = {}): RequestTiming {
  const clockMs = options.clockMs ?? (() => performance.now());
  return {
    clockMs,
    startedAtMs: clockMs(),
    startedAt: options.at ?? new Date().toISOString(),
    concurrentRequestsAtStart: requestsInFlight,
    globalSqliteMsAtStart: sqliteTotals.requestMs + sqliteTotals.backgroundMs,
    phaseMs: { sqlite: 0, provider: 0, auth: 0, response: 0 },
    statementCount: 0,
    statements: new Map(),
    transactionCount: 0,
    maxTransactionMs: 0,
    intervals: {},
    learnerId: null,
    finished: false,
  };
}

export function runWithRequestTiming<T>(timing: RequestTiming, operation: () => T): T {
  return timingContext.run(timing, operation);
}

export function currentRequestTiming(): RequestTiming | undefined {
  return timingContext.getStore();
}

/**
 * Times one synchronous SQLite call. Nested calls (for example an application
 * SQL function that queries) are attributed to the outermost statement.
 */
export function timeSqliteCall<T>(sql: string, operation: () => T, isTransaction: () => boolean): T {
  if (sqliteDepth > 0) return operation();
  const timing = timingContext.getStore();
  const clockMs = timing?.clockMs ?? performance.now.bind(performance);
  const wasInTransaction = isTransaction();
  const startedAtMs = clockMs();
  sqliteDepth += 1;
  try {
    return operation();
  } finally {
    sqliteDepth -= 1;
    const endedAtMs = clockMs();
    recordStatement(timing, sql, Math.max(0, endedAtMs - startedAtMs));
    trackTransaction(timing, wasInTransaction, isTransaction(), startedAtMs, endedAtMs);
  }
}

function recordStatement(timing: RequestTiming | undefined, sql: string, durationMs: number): void {
  if (!timing || timing.finished) {
    sqliteTotals.backgroundMs += durationMs;
    sqliteTotals.backgroundStatements += 1;
    return;
  }
  sqliteTotals.requestMs += durationMs;
  sqliteTotals.requestStatements += 1;
  timing.phaseMs.sqlite += durationMs;
  timing.statementCount += 1;
  const { fingerprint, sql: normalizedSql } = fingerprintSql(sql);
  const stats = timing.statements.get(fingerprint)
    ?? { fingerprint, sql: normalizedSql, count: 0, totalMs: 0, maxMs: 0 };
  stats.count += 1;
  stats.totalMs += durationMs;
  stats.maxMs = Math.max(stats.maxMs, durationMs);
  timing.statements.set(fingerprint, stats);
}

function trackTransaction(
  timing: RequestTiming | undefined,
  wasInTransaction: boolean,
  isInTransaction: boolean,
  startedAtMs: number,
  endedAtMs: number,
): void {
  if (!wasInTransaction && isInTransaction) {
    openTransaction = { startedAtMs, timing };
    return;
  }
  if (wasInTransaction && !isInTransaction && openTransaction) {
    const holdMs = Math.max(0, endedAtMs - openTransaction.startedAtMs);
    const owner = openTransaction.timing;
    openTransaction = null;
    observeTransactionHold(holdMs / 1_000);
    if (owner && !owner.finished) {
      owner.transactionCount += 1;
      owner.maxTransactionMs = Math.max(owner.maxTransactionMs, holdMs);
    }
  }
}

function observeTransactionHold(seconds: number): void {
  transactionHold.count += 1;
  transactionHold.sum += seconds;
  transactionHoldBuckets.forEach((upperBound, index) => {
    if (seconds <= upperBound) transactionHold.bucketCounts[index] += 1;
  });
}

/**
 * Times an awaited upstream model-provider call. Overlapping calls in one
 * request count once, and SQLite work done meanwhile stays in `sqlite`.
 */
export async function timeProviderCall<T>(operation: () => Promise<T>): Promise<T> {
  const timing = timingContext.getStore();
  if (!timing) return operation();
  enterInterval(timing, 'provider');
  try {
    return await operation();
  } finally {
    exitInterval(timing, 'provider');
  }
}

function enterInterval(timing: RequestTiming, phase: IntervalPhase): void {
  if (timing.finished) return;
  const interval = timing.intervals[phase];
  if (interval && interval.active > 0) {
    interval.active += 1;
    return;
  }
  timing.intervals[phase] = {
    active: 1,
    startedAtMs: timing.clockMs(),
    sqliteMsAtStart: timing.phaseMs.sqlite,
  };
}

function exitInterval(timing: RequestTiming, phase: IntervalPhase): void {
  if (timing.finished) return;
  const interval = timing.intervals[phase];
  if (!interval || interval.active === 0) {
    throw new Error(`Request timing ${phase} interval ended without starting.`);
  }
  interval.active -= 1;
  if (interval.active > 0) return;
  const elapsedMs = timing.clockMs() - interval.startedAtMs;
  const nestedSqliteMs = timing.phaseMs.sqlite - interval.sqliteMsAtStart;
  timing.phaseMs[phase] += Math.max(0, elapsedMs - nestedSqliteMs);
  delete timing.intervals[phase];
}

function timeResponseWrite<T>(timing: RequestTiming, operation: () => T): T {
  const startedAtMs = timing.clockMs();
  const sqliteMsAtStart = timing.phaseMs.sqlite;
  try {
    return operation();
  } finally {
    const elapsedMs = timing.clockMs() - startedAtMs;
    timing.phaseMs.response += Math.max(0, elapsedMs - (timing.phaseMs.sqlite - sqliteMsAtStart));
  }
}

export function finishRequestTiming(timing: RequestTiming, input: {
  method: string;
  route: string;
  status: string;
  outcome: 'completed' | 'aborted';
  responseBytes: number | null;
}): RequestTimingSummary {
  for (const phase of Object.keys(timing.intervals) as IntervalPhase[]) {
    const interval = timing.intervals[phase];
    if (interval && interval.active > 0) {
      interval.active = 1;
      exitInterval(timing, phase);
    }
  }
  timing.finished = true;
  const durationMs = Math.max(0, timing.clockMs() - timing.startedAtMs);
  const attributedMs = timing.phaseMs.sqlite + timing.phaseMs.provider + timing.phaseMs.auth + timing.phaseMs.response;
  const globalSqliteMs = sqliteTotals.requestMs + sqliteTotals.backgroundMs;
  return {
    at: timing.startedAt,
    method: input.method,
    route: input.route,
    status: input.status,
    outcome: input.outcome,
    durationMs: roundMs(durationMs),
    localMs: roundMs(Math.max(0, durationMs - timing.phaseMs.provider)),
    phasesMs: {
      sqlite: roundMs(timing.phaseMs.sqlite),
      provider: roundMs(timing.phaseMs.provider),
      auth: roundMs(timing.phaseMs.auth),
      response: roundMs(timing.phaseMs.response),
      other: roundMs(Math.max(0, durationMs - attributedMs)),
    },
    sqlite: {
      statements: timing.statementCount,
      transactions: timing.transactionCount,
      maxTransactionMs: roundMs(timing.maxTransactionMs),
      topStatements: [...timing.statements.values()]
        .sort((left, right) => right.totalMs - left.totalMs || left.fingerprint.localeCompare(right.fingerprint))
        .slice(0, topStatementLimit)
        .map((statement) => ({
          ...statement,
          totalMs: roundMs(statement.totalMs),
          maxMs: roundMs(statement.maxMs),
        })),
    },
    otherSqliteMs: roundMs(Math.max(0, globalSqliteMs - timing.globalSqliteMsAtStart - timing.phaseMs.sqlite)),
    concurrentRequestsAtStart: timing.concurrentRequestsAtStart,
    learnerId: timing.learnerId,
    responseBytes: input.responseBytes,
  };
}

/**
 * Normalizes SQL into a bounded statement identity. Statement text comes from
 * code, but literals and placeholder-list lengths are collapsed so a future
 * interpolated value cannot become a new identity or appear in logs.
 */
export function fingerprintSql(sql: string): { fingerprint: string; sql: string } {
  const cached = fingerprintCache.get(sql);
  if (cached) return cached;
  const normalized = sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/'(?:[^']|'')*'/g, "'?'")
    .replace(/\b\d+(?:\.\d+)?\b/g, 'N')
    .replace(/\s+/g, ' ')
    .replace(/\(\s*\?(?:\s*,\s*\?)+\s*\)/g, '(?…)')
    .trim();
  const entry = {
    fingerprint: createHash('sha1').update(normalized).digest('hex').slice(0, 12),
    sql: normalized.length > sqlPreviewLength ? `${normalized.slice(0, sqlPreviewLength - 1)}…` : normalized,
  };
  if (fingerprintCache.size >= fingerprintCacheLimit) fingerprintCache.clear();
  fingerprintCache.set(sql, entry);
  return entry;
}

export function readSqliteTimingTotals(): Readonly<SqliteTotals> {
  return { ...sqliteTotals };
}

export function readTransactionHoldHistogram(): Readonly<TransactionHoldHistogram> {
  return { ...transactionHold, bucketCounts: [...transactionHold.bucketCounts] };
}

export type RequestTimingMiddleware = {
  /** First middleware: opens the request's timing context and Server-Timing header. */
  begin: RequestHandler;
  /** Re-enters the context after body parsing, whose stream callbacks drop async context. */
  resume: RequestHandler;
  authStarted: RequestHandler;
  /** Runs inside the authenticated learner context. */
  authFinished: (readLearnerId: () => string | null) => RequestHandler;
};

export function createRequestTimingMiddleware(options: {
  clockMs?: () => number;
  onSummary: (summary: RequestTimingSummary) => void;
}): RequestTimingMiddleware {
  const begin: RequestHandler = (request, response, next) => {
    const timing = startRequestTiming({ clockMs: options.clockMs });
    timingByRequest.set(request, timing);
    requestsInFlight += 1;
    instrumentResponse(timing, response);
    let recorded = false;
    const record = (outcome: 'completed' | 'aborted') => {
      if (recorded) return;
      recorded = true;
      requestsInFlight = Math.max(0, requestsInFlight - 1);
      options.onSummary(finishRequestTiming(timing, {
        method: normalizeMethod(request.method),
        route: resolveRouteLabel(request),
        status: outcome === 'completed' ? String(response.statusCode) : 'unknown',
        outcome,
        responseBytes: outcome === 'completed' ? readResponseSize(response) : null,
      }));
    };
    response.once('finish', () => record('completed'));
    response.once('close', () => record(response.writableFinished ? 'completed' : 'aborted'));
    runWithRequestTiming(timing, next);
  };
  const resume: RequestHandler = (request, _response, next) => {
    const timing = timingByRequest.get(request);
    if (!timing) throw new Error('Request timing resume middleware ran before begin.');
    runWithRequestTiming(timing, next);
  };
  return {
    begin,
    resume,
    authStarted: (request, _response, next) => {
      const timing = timingByRequest.get(request);
      if (!timing) throw new Error('Request timing auth middleware ran before begin.');
      enterInterval(timing, 'auth');
      next();
    },
    authFinished: (readLearnerId) => (request, _response, next) => {
      const timing = timingByRequest.get(request);
      if (!timing) throw new Error('Request timing auth middleware ran before begin.');
      exitInterval(timing, 'auth');
      timing.learnerId = readLearnerId();
      next();
    },
  };
}

function instrumentResponse(timing: RequestTiming, response: Response): void {
  const json = response.json.bind(response);
  response.json = (body?: unknown) => timeResponseWrite(timing, () => json(body));
  const writeHead = response.writeHead.bind(response) as (...args: unknown[]) => Response;
  response.writeHead = ((...args: unknown[]) => {
    if (!response.headersSent) response.setHeader('Server-Timing', renderServerTiming(timing));
    return writeHead(...args);
  }) as Response['writeHead'];
}

export function renderServerTiming(timing: RequestTiming): string {
  const elapsedMs = timing.clockMs() - timing.startedAtMs;
  const entries = [
    `sqlite;dur=${roundMs(timing.phaseMs.sqlite)};desc="${timing.statementCount} statements"`,
    `auth;dur=${roundMs(timing.phaseMs.auth)}`,
    `provider;dur=${roundMs(timing.phaseMs.provider)}`,
    `app;dur=${roundMs(elapsedMs)};desc="until headers"`,
  ];
  return entries.join(', ');
}

export function describeSlowRequest(summary: RequestTimingSummary, thresholdMs: number): SlowRequestEvent {
  return {
    schemaVersion: 'request_timing.v1',
    event: 'request.slow',
    thresholdMs,
    ...summary,
    runtime: {
      appVersion: nonEmpty(process.env.npm_package_version),
      appRevision: nonEmpty(process.env.APP_REVISION),
      flyMachineId: nonEmpty(process.env.FLY_MACHINE_ID),
    },
  };
}

export function createSlowRequestLogger(options: {
  thresholdMs: number;
  logLine?: (line: string) => void;
}): (summary: RequestTimingSummary) => boolean {
  const logLine = options.logLine ?? ((line: string) => console.log(line));
  return (summary) => {
    if (summary.localMs < options.thresholdMs) return false;
    logLine(JSON.stringify(describeSlowRequest(summary, options.thresholdMs)));
    return true;
  };
}

export function readSlowRequestThresholdMs(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return defaultSlowRequestThresholdMs;
  const threshold = Number(value);
  if (!Number.isInteger(threshold) || threshold <= 0) {
    throw new Error(`Invalid APP_SLOW_REQUEST_MS: ${value}`);
  }
  return threshold;
}

function roundMs(value: number): number {
  return Math.round(value * 10) / 10;
}

function nonEmpty(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}
