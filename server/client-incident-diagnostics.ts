import fs from 'node:fs';
import path from 'node:path';
import {
  isClientTransportIncident,
  type ClientTransportIncident,
} from '../src/domain/client-incidents.ts';

export const CLIENT_INCIDENT_DIAGNOSTICS_FILENAME = 'client-transport-incidents.jsonl';
export const CLIENT_INCIDENT_DIAGNOSTICS_RETENTION_DAYS = 30;

export type StoredClientTransportIncident = ClientTransportIncident & {
  learnerId: string;
  receivedAt: string;
  runtime: {
    appVersion: string | null;
    appRevision: string | null;
    flyMachineId: string | null;
    processId: number;
  };
};

export type ClientIncidentDiagnosticSink = {
  record(input: { learnerId: string; incident: ClientTransportIncident }): void;
};

export function createClientIncidentDiagnosticSink(
  dataDir: string,
  options: { logLine?: (line: string) => void; now?: () => Date } = {},
): ClientIncidentDiagnosticSink {
  const diagnosticsPath = path.join(dataDir, CLIENT_INCIDENT_DIAGNOSTICS_FILENAME);
  const logLine = options.logLine ?? ((line: string) => console.error(line));
  const now = options.now ?? (() => new Date());
  let knownDiagnosticIds: Set<string> | null = null;
  let lastRetentionDayKey: string | null = null;

  return {
    record({ learnerId, incident }) {
      knownDiagnosticIds ??= readKnownDiagnosticIds(diagnosticsPath);
      if (knownDiagnosticIds.has(incident.diagnosticId)) return;

      const receivedAt = now().toISOString();
      const retentionDayKey = receivedAt.slice(0, 10);
      if (retentionDayKey !== lastRetentionDayKey) {
        pruneExpiredDiagnostics(diagnosticsPath, Date.parse(receivedAt));
        lastRetentionDayKey = retentionDayKey;
      }

      const stored: StoredClientTransportIncident = {
        schemaVersion: incident.schemaVersion,
        event: incident.event,
        diagnosticId: incident.diagnosticId,
        at: incident.at,
        appVersion: incident.appVersion,
        route: incident.route,
        method: incident.method,
        phase: incident.phase,
        elapsedMs: incident.elapsedMs,
        correlation: {
          sessionId: incident.correlation.sessionId,
          sessionActionId: incident.correlation.sessionActionId,
          eventIds: [...incident.correlation.eventIds],
        },
        browser: {
          online: incident.browser.online,
          visibilityState: incident.browser.visibilityState,
        },
        error: {
          name: incident.error.name,
          message: incident.error.message,
        },
        learnerId,
        receivedAt,
        runtime: {
          appVersion: nonEmptyString(process.env.npm_package_version),
          appRevision: nonEmptyString(process.env.APP_REVISION),
          flyMachineId: nonEmptyString(process.env.FLY_MACHINE_ID),
          processId: process.pid,
        },
      };
      fs.appendFileSync(
        diagnosticsPath,
        `${JSON.stringify(stored)}\n`,
        { encoding: 'utf8', mode: 0o600 },
      );
      knownDiagnosticIds.add(incident.diagnosticId);
      logLine(JSON.stringify({
        at: receivedAt,
        event: 'client_transport.received',
        diagnosticId: incident.diagnosticId,
        learnerId,
        clientAt: incident.at,
        route: incident.route,
        method: incident.method,
        phase: incident.phase,
        elapsedMs: incident.elapsedMs,
        sessionId: incident.correlation.sessionId,
        sessionActionId: incident.correlation.sessionActionId,
        eventIds: incident.correlation.eventIds,
        online: incident.browser.online,
        visibilityState: incident.browser.visibilityState,
        errorName: incident.error.name,
      }));
    },
  };
}

export function readClientIncidentDiagnostics(input: {
  dataDir: string;
  limit?: number;
  diagnosticId?: string | null;
}): {
  diagnosticsPath: string;
  totalRecordCount: number;
  malformedRecordCount: number;
  diagnostics: StoredClientTransportIncident[];
} {
  const diagnosticsPath = path.join(input.dataDir, CLIENT_INCIDENT_DIAGNOSTICS_FILENAME);
  if (!fs.existsSync(diagnosticsPath)) {
    return { diagnosticsPath, totalRecordCount: 0, malformedRecordCount: 0, diagnostics: [] };
  }

  const lines = fs.readFileSync(diagnosticsPath, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0);
  const diagnostics: StoredClientTransportIncident[] = [];
  let malformedRecordCount = 0;
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as unknown;
      if (!isStoredClientTransportIncident(parsed)) {
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

function readKnownDiagnosticIds(diagnosticsPath: string): Set<string> {
  if (!fs.existsSync(diagnosticsPath)) return new Set();
  const ids = new Set<string>();
  for (const line of fs.readFileSync(diagnosticsPath, 'utf8').split('\n')) {
    if (line.trim().length === 0) continue;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (isStoredClientTransportIncident(parsed)) ids.add(parsed.diagnosticId);
    } catch {
      // Malformed lines are retained but cannot participate in deduplication.
    }
  }
  return ids;
}

function pruneExpiredDiagnostics(diagnosticsPath: string, nowMs: number): void {
  if (!fs.existsSync(diagnosticsPath) || !Number.isFinite(nowMs)) return;
  const original = fs.readFileSync(diagnosticsPath, 'utf8');
  const cutoffMs = nowMs - CLIENT_INCIDENT_DIAGNOSTICS_RETENTION_DAYS * 24 * 60 * 60 * 1_000;
  const retainedLines = original.split('\n').filter((line) => {
    if (line.trim().length === 0) return false;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (!isRecord(parsed) || typeof parsed.receivedAt !== 'string') return true;
      const recordTime = Date.parse(parsed.receivedAt);
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

function isStoredClientTransportIncident(value: unknown): value is StoredClientTransportIncident {
  if (!isRecord(value)) return false;
  const clientIncident = {
    schemaVersion: value.schemaVersion,
    event: value.event,
    diagnosticId: value.diagnosticId,
    at: value.at,
    appVersion: value.appVersion,
    route: value.route,
    method: value.method,
    phase: value.phase,
    elapsedMs: value.elapsedMs,
    correlation: value.correlation,
    browser: value.browser,
    error: value.error,
  };
  if (!isClientTransportIncident(clientIncident)) return false;
  if (
    !nonEmptyString(value.learnerId)
    || !isIsoTimestamp(value.receivedAt)
    || !isRecord(value.runtime)
  ) {
    return false;
  }
  return nullableString(value.runtime.appVersion)
    && nullableString(value.runtime.appRevision)
    && nullableString(value.runtime.flyMachineId)
    && typeof value.runtime.processId === 'number'
    && Number.isInteger(value.runtime.processId)
    && value.runtime.processId >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function nullableString(value: unknown): boolean {
  return value === null || typeof value === 'string';
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}
