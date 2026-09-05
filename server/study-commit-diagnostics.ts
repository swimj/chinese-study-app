import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const STUDY_COMMIT_DIAGNOSTICS_FILENAME = 'study-commit-diagnostics.jsonl';
export const STUDY_COMMIT_DIAGNOSTICS_RETENTION_DAYS = 30;

export type StudyCommitRoute =
  | '/api/study-sessions/:sessionId/accepted-review-attempt-batch'
  | '/api/study-sessions/:sessionId/accepted-contrast-selection-attempt'
  | '/api/review-session-summaries';

export type StudyCommitFailureDiagnostic = {
  schemaVersion: 'study_commit_failure.v1';
  event: 'study_commit.failed';
  diagnosticId: string;
  at: string;
  route: StudyCommitRoute;
  responseStatus: 400 | 500;
  elapsedMs: number;
  learnerId: string | null;
  correlation: {
    sessionId: string | null;
    sessionActionId: string | null;
    targetWordId: string | null;
    actionKind: string | null;
    promptTargetWordId: string | null;
    selectedWordId: string | null;
    eventIds: string[];
  };
  request: {
    params: Record<string, string>;
    body: unknown;
  };
  error: StudyCommitDiagnosticError;
  runtime: {
    appVersion: string | null;
    appRevision: string | null;
    flyMachineId: string | null;
    processId: number;
  };
};

export type StudyCommitSuccessEvent = {
  schemaVersion: 'study_commit_success.v1';
  event: 'study_commit.succeeded';
  at: string;
  route: Exclude<StudyCommitRoute, '/api/review-session-summaries'>;
  responseStatus: 204;
  elapsedMs: number;
  learnerId: string | null;
  correlation: StudyCommitFailureDiagnostic['correlation'];
  results: Array<{
    eventId: string;
    outcome: string | null;
    rating: string | null;
  }>;
};

export type StudyCommitDiagnosticError = {
  name: string;
  message: string;
  stack: string | null;
  details: Record<string, string | number | boolean | null>;
  cause: StudyCommitDiagnosticError | null;
};

export type StudyCommitDiagnosticSink = {
  record(diagnostic: StudyCommitFailureDiagnostic): void;
  recordSuccess?(event: StudyCommitSuccessEvent): void;
};

export function describeStudyCommitFailure(input: {
  route: StudyCommitRoute;
  responseStatus: 400 | 500;
  learnerId: string | null;
  params: Record<string, string>;
  body: unknown;
  error: unknown;
  elapsedMs?: number;
  diagnosticId?: string;
  at?: string;
}): StudyCommitFailureDiagnostic {
  return {
    schemaVersion: 'study_commit_failure.v1',
    event: 'study_commit.failed',
    diagnosticId: input.diagnosticId ?? randomUUID(),
    at: input.at ?? new Date().toISOString(),
    route: input.route,
    responseStatus: input.responseStatus,
    elapsedMs: input.elapsedMs ?? 0,
    learnerId: input.learnerId,
    correlation: readCorrelation(input.params, input.body),
    request: {
      params: { ...input.params },
      body: input.body,
    },
    error: describeError(input.error),
    runtime: {
      appVersion: nonEmptyString(process.env.npm_package_version),
      appRevision: nonEmptyString(process.env.APP_REVISION),
      flyMachineId: nonEmptyString(process.env.FLY_MACHINE_ID),
      processId: process.pid,
    },
  };
}

export function describeStudyCommitSuccess(input: {
  route: StudyCommitSuccessEvent['route'];
  learnerId: string | null;
  params: Record<string, string>;
  body: unknown;
  elapsedMs: number;
  at?: string;
}): StudyCommitSuccessEvent {
  const body = isRecord(input.body) ? input.body : null;
  const event = isRecord(body?.event) ? body.event : null;
  const events = Array.isArray(body?.events) ? body.events.filter(isRecord) : [];
  return {
    schemaVersion: 'study_commit_success.v1',
    event: 'study_commit.succeeded',
    at: input.at ?? new Date().toISOString(),
    route: input.route,
    responseStatus: 204,
    elapsedMs: input.elapsedMs,
    learnerId: input.learnerId,
    correlation: readCorrelation(input.params, input.body),
    results: [event, ...events]
      .filter((candidate): candidate is Record<string, unknown> => candidate !== null)
      .map((candidate) => ({
        eventId: nonEmptyString(candidate.id) ?? '',
        outcome: nonEmptyString(candidate.outcome),
        rating: nonEmptyString(candidate.rating),
      })),
  };
}

/**
 * Writes compact success/failure events to stderr and complete failures to a
 * sidecar beside app.db. Observability must never replace a study-commit result.
 */
export function createStudyCommitDiagnosticSink(
  dataDir: string,
  options: { logLine?: (line: string) => void } = {},
): StudyCommitDiagnosticSink {
  const diagnosticsPath = path.join(dataDir, STUDY_COMMIT_DIAGNOSTICS_FILENAME);
  const logLine = options.logLine ?? ((line: string) => console.error(line));
  let lastRetentionDayKey: string | null = null;
  return {
    record(diagnostic) {
      try {
        logLine(JSON.stringify(compactLogEvent(diagnostic)));
      } catch {
        // Preserve the original study-commit failure.
      }

      try {
        const diagnosticTime = Date.parse(diagnostic.at);
        const retentionDayKey = Number.isFinite(diagnosticTime)
          ? new Date(diagnosticTime).toISOString().slice(0, 10)
          : null;
        if (retentionDayKey !== null && retentionDayKey !== lastRetentionDayKey) {
          pruneExpiredDiagnostics(diagnosticsPath, diagnosticTime);
          lastRetentionDayKey = retentionDayKey;
        }
        fs.appendFileSync(
          diagnosticsPath,
          `${JSON.stringify(diagnostic)}\n`,
          { encoding: 'utf8', mode: 0o600 },
        );
      } catch {
        // Preserve the original study-commit failure.
      }
    },
    recordSuccess(event) {
      try {
        logLine(JSON.stringify(event));
      } catch {
        // Observability must not turn a durable commit into a failed response.
      }
    },
  };
}

export function readStudyCommitDiagnostics(input: {
  dataDir: string;
  limit?: number;
  diagnosticId?: string | null;
}): {
  diagnosticsPath: string;
  totalRecordCount: number;
  malformedRecordCount: number;
  diagnostics: StudyCommitFailureDiagnostic[];
} {
  const diagnosticsPath = path.join(input.dataDir, STUDY_COMMIT_DIAGNOSTICS_FILENAME);
  if (!fs.existsSync(diagnosticsPath)) {
    return { diagnosticsPath, totalRecordCount: 0, malformedRecordCount: 0, diagnostics: [] };
  }

  const lines = fs.readFileSync(diagnosticsPath, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0);
  const diagnostics: StudyCommitFailureDiagnostic[] = [];
  let malformedRecordCount = 0;
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as unknown;
      if (!isStudyCommitFailureDiagnostic(parsed)) {
        malformedRecordCount += 1;
        continue;
      }
      if (!input.diagnosticId || parsed.diagnosticId === input.diagnosticId) {
        diagnostics.push(parsed);
      }
    } catch {
      malformedRecordCount += 1;
    }
  }

  const limit = input.limit ?? 20;
  return {
    diagnosticsPath,
    totalRecordCount: lines.length - malformedRecordCount,
    malformedRecordCount,
    diagnostics: diagnostics.slice(Math.max(0, diagnostics.length - limit)),
  };
}

function compactLogEvent(diagnostic: StudyCommitFailureDiagnostic) {
  return {
    at: diagnostic.at,
    event: diagnostic.event,
    diagnosticId: diagnostic.diagnosticId,
    route: diagnostic.route,
    responseStatus: diagnostic.responseStatus,
    elapsedMs: diagnostic.elapsedMs,
    learnerId: diagnostic.learnerId,
    ...diagnostic.correlation,
    errorName: diagnostic.error.name,
    errorMessage: diagnostic.error.message,
    errorDetails: diagnostic.error.details,
  };
}

function readCorrelation(
  params: Record<string, string>,
  body: unknown,
): StudyCommitFailureDiagnostic['correlation'] {
  const record = isRecord(body) ? body : null;
  const commitIntent = isRecord(record?.commitIntent) ? record.commitIntent : null;
  const event = isRecord(record?.event) ? record.event : null;
  const events = Array.isArray(record?.events) ? record.events.filter(isRecord) : [];
  return {
    sessionId: nonEmptyString(params.sessionId)
      ?? nonEmptyString(record?.sessionId)
      ?? nonEmptyString(event?.sessionId)
      ?? nonEmptyString(events[0]?.sessionId),
    sessionActionId: nonEmptyString(commitIntent?.sessionActionId)
      ?? nonEmptyString(event?.sessionActionId)
      ?? nonEmptyString(events[0]?.sessionActionId),
    targetWordId: nonEmptyString(commitIntent?.targetWordId)
      ?? nonEmptyString(event?.targetWordId)
      ?? nonEmptyString(events[0]?.targetWordId),
    actionKind: nonEmptyString(commitIntent?.actionKind)
      ?? nonEmptyString(event?.actionKind)
      ?? nonEmptyString(events[0]?.actionKind),
    promptTargetWordId: nonEmptyString(commitIntent?.promptTargetWordId)
      ?? nonEmptyString(isRecord(event?.metadata) ? event.metadata.promptTargetWordId : null),
    selectedWordId: nonEmptyString(commitIntent?.selectedWordId)
      ?? nonEmptyString(event?.response),
    eventIds: [event, ...events]
      .map((candidate) => nonEmptyString(candidate?.id))
      .filter((id): id is string => id !== null),
  };
}

function pruneExpiredDiagnostics(diagnosticsPath: string, nowMs: number): void {
  if (!fs.existsSync(diagnosticsPath) || !Number.isFinite(nowMs)) return;
  const original = fs.readFileSync(diagnosticsPath, 'utf8');
  const cutoffMs = nowMs - STUDY_COMMIT_DIAGNOSTICS_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const retainedLines = original.split('\n').filter((line) => {
    if (line.trim().length === 0) return false;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (!isRecord(parsed) || typeof parsed.at !== 'string') return true;
      const recordTime = Date.parse(parsed.at);
      return !Number.isFinite(recordTime) || recordTime >= cutoffMs;
    } catch {
      return true;
    }
  });
  const retained = retainedLines.length === 0 ? '' : `${retainedLines.join('\n')}\n`;
  if (retained === original) return;

  const temporaryPath = `${diagnosticsPath}.pruning-${process.pid}`;
  fs.writeFileSync(temporaryPath, retained, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporaryPath, diagnosticsPath);
}

function describeError(error: unknown, depth = 0): StudyCommitDiagnosticError {
  if (!(error instanceof Error)) {
    return {
      name: typeof error,
      message: stringifyUnknown(error),
      stack: null,
      details: {},
      cause: null,
    };
  }

  const errorWithDetails = error as Error & {
    code?: unknown;
    errno?: unknown;
    errcode?: unknown;
    errstr?: unknown;
  };
  const details: Record<string, string | number | boolean | null> = {};
  for (const key of ['code', 'errno', 'errcode', 'errstr'] as const) {
    const value = errorWithDetails[key];
    if (isDiagnosticScalar(value)) details[key] = value;
  }
  return {
    name: error.name,
    message: error.message,
    stack: error.stack ?? null,
    details,
    cause: depth < 4 && error.cause !== undefined
      ? describeError(error.cause, depth + 1)
      : null,
  };
}

function isStudyCommitFailureDiagnostic(value: unknown): value is StudyCommitFailureDiagnostic {
  return isRecord(value)
    && value.schemaVersion === 'study_commit_failure.v1'
    && value.event === 'study_commit.failed'
    && typeof value.diagnosticId === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function isDiagnosticScalar(value: unknown): value is string | number | boolean | null {
  return value === null
    || typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean';
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
