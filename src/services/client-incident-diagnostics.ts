import {
  CLIENT_TRANSPORT_INCIDENT_EVENT,
  CLIENT_TRANSPORT_INCIDENT_MAX_BATCH_SIZE,
  CLIENT_TRANSPORT_INCIDENT_SCHEMA_VERSION,
  isClientTransportIncident,
  type ClientTransportIncident,
  type ClientTransportIncidentRoute,
} from '../domain/client-incidents';

const STORAGE_KEY_PREFIX = 'chinese-study-app.client-transport-incidents.v1';
export const CLIENT_TRANSPORT_INCIDENT_RETENTION_DAYS = 30;

export type ClientIncidentStorage = Pick<Storage, 'getItem' | 'setItem'>;

export type ClientTransportIncidentContext = {
  route: ClientTransportIncidentRoute;
  sessionId: string;
  sessionActionId: string;
  eventIds: string[];
};

export function captureClientTransportFailure(input: {
  error: unknown;
  phase: ClientTransportIncident['phase'];
  context: ClientTransportIncidentContext;
  storageScope: string | null;
  appVersion: string;
  startedAtMs: number;
  storage?: ClientIncidentStorage | null;
  diagnosticId?: string;
  now?: Date;
  online?: boolean | null;
  visibilityState?: ClientTransportIncident['browser']['visibilityState'];
}): Error {
  const now = input.now ?? new Date();
  const original = describeError(input.error);
  const incident: ClientTransportIncident = {
    schemaVersion: CLIENT_TRANSPORT_INCIDENT_SCHEMA_VERSION,
    event: CLIENT_TRANSPORT_INCIDENT_EVENT,
    diagnosticId: input.diagnosticId ?? crypto.randomUUID(),
    at: now.toISOString(),
    appVersion: boundedString(input.appVersion, 100, 'unknown'),
    route: input.context.route,
    method: 'POST',
    phase: input.phase,
    elapsedMs: Math.max(0, Math.min(now.getTime() - input.startedAtMs, 24 * 60 * 60 * 1_000)),
    correlation: {
      sessionId: boundedString(input.context.sessionId, 1_000, 'unknown'),
      sessionActionId: boundedString(input.context.sessionActionId, 1_000, 'unknown'),
      eventIds: [...new Set(input.context.eventIds)]
        .slice(0, CLIENT_TRANSPORT_INCIDENT_MAX_BATCH_SIZE)
        .map((eventId) => boundedString(eventId, 2_000, 'unknown')),
    },
    browser: {
      online: input.online ?? readBrowserOnlineState(),
      visibilityState: input.visibilityState ?? readBrowserVisibilityState(),
    },
    error: original,
  };

  const storage = input.storage === undefined ? readBrowserStorage() : input.storage;
  if (input.storageScope !== null && storage !== null) {
    try {
      appendPendingClientTransportIncident(storage, input.storageScope, incident, now.getTime());
    } catch {
      // Diagnostics must not replace the original transport failure.
    }
  }

  const error = new Error(`${original.message} Client incident ID: ${incident.diagnosticId}`, {
    cause: input.error,
  });
  error.name = 'ClientTransportError';
  return error;
}

export function appendPendingClientTransportIncident(
  storage: ClientIncidentStorage,
  storageScope: string,
  incident: ClientTransportIncident,
  nowMs = Date.now(),
): void {
  const existing = readPendingClientTransportIncidents(storage, storageScope, nowMs)
    .filter((candidate) => candidate.diagnosticId !== incident.diagnosticId);
  const next = [...existing, incident].slice(-CLIENT_TRANSPORT_INCIDENT_MAX_BATCH_SIZE);
  storage.setItem(storageKey(storageScope), JSON.stringify(next));
}

export function readPendingClientTransportIncidents(
  storage: ClientIncidentStorage,
  storageScope: string,
  nowMs = Date.now(),
): ClientTransportIncident[] {
  const raw = storage.getItem(storageKey(storageScope));
  if (raw === null) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const cutoffMs = nowMs - CLIENT_TRANSPORT_INCIDENT_RETENTION_DAYS * 24 * 60 * 60 * 1_000;
    return parsed
      .filter(isClientTransportIncident)
      .filter((incident) => Date.parse(incident.at) >= cutoffMs)
      .slice(-CLIENT_TRANSPORT_INCIDENT_MAX_BATCH_SIZE);
  } catch {
    return [];
  }
}

export function removeUploadedClientTransportIncidents(
  storage: ClientIncidentStorage,
  storageScope: string,
  diagnosticIds: readonly string[],
  nowMs = Date.now(),
): void {
  const uploadedIds = new Set(diagnosticIds);
  const retained = readPendingClientTransportIncidents(storage, storageScope, nowMs)
    .filter((incident) => !uploadedIds.has(incident.diagnosticId));
  storage.setItem(storageKey(storageScope), JSON.stringify(retained));
}

export function readBrowserStorage(): ClientIncidentStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function storageKey(storageScope: string): string {
  return `${STORAGE_KEY_PREFIX}:${encodeURIComponent(storageScope)}`;
}

function describeError(error: unknown): ClientTransportIncident['error'] {
  if (error instanceof Error) {
    return {
      name: boundedString(error.name, 100, 'Error'),
      message: boundedString(error.message, 500, 'Unknown transport error'),
    };
  }
  return {
    name: typeof error,
    message: boundedString(String(error), 500, 'Unknown transport error'),
  };
}

function boundedString(value: string, maxLength: number, fallback: string): string {
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return normalized.length === 0 ? fallback : normalized.slice(0, maxLength);
}

function readBrowserOnlineState(): boolean | null {
  return typeof navigator === 'undefined' ? null : navigator.onLine;
}

function readBrowserVisibilityState(): ClientTransportIncident['browser']['visibilityState'] {
  if (typeof document === 'undefined') return null;
  return document.visibilityState === 'hidden'
    || document.visibilityState === 'visible'
    || document.visibilityState === 'prerender'
    ? document.visibilityState
    : null;
}
