export const CLIENT_TRANSPORT_INCIDENT_SCHEMA_VERSION = 'client_transport_incident.v1' as const;
export const CLIENT_TRANSPORT_INCIDENT_EVENT = 'client_transport.failed' as const;
export const CLIENT_TRANSPORT_INCIDENT_MAX_BATCH_SIZE = 20;

export type ClientTransportIncidentRoute =
  | '/api/study-sessions/:sessionId/accepted-review-attempt-batch'
  | '/api/study-sessions/:sessionId/accepted-contrast-selection-attempt';

export type ClientTransportIncident = {
  schemaVersion: typeof CLIENT_TRANSPORT_INCIDENT_SCHEMA_VERSION;
  event: typeof CLIENT_TRANSPORT_INCIDENT_EVENT;
  diagnosticId: string;
  at: string;
  appVersion: string;
  route: ClientTransportIncidentRoute;
  method: 'POST';
  phase: 'authentication' | 'fetch';
  elapsedMs: number;
  correlation: {
    sessionId: string;
    sessionActionId: string;
    eventIds: string[];
  };
  browser: {
    online: boolean | null;
    visibilityState: 'hidden' | 'visible' | 'prerender' | null;
  };
  error: {
    name: string;
    message: string;
  };
};

export function isClientTransportIncident(value: unknown): value is ClientTransportIncident {
  if (!isRecord(value)) return false;
  if (
    !hasExactKeys(value, [
      'schemaVersion',
      'event',
      'diagnosticId',
      'at',
      'appVersion',
      'route',
      'method',
      'phase',
      'elapsedMs',
      'correlation',
      'browser',
      'error',
    ])
    ||
    value.schemaVersion !== CLIENT_TRANSPORT_INCIDENT_SCHEMA_VERSION
    || value.event !== CLIENT_TRANSPORT_INCIDENT_EVENT
    || !isBoundedString(value.diagnosticId, 200)
    || !isIsoTimestamp(value.at)
    || !isBoundedString(value.appVersion, 100)
    || !isClientTransportIncidentRoute(value.route)
    || value.method !== 'POST'
    || (value.phase !== 'authentication' && value.phase !== 'fetch')
    || !isBoundedNonNegativeNumber(value.elapsedMs, 24 * 60 * 60 * 1_000)
  ) {
    return false;
  }

  const correlation = isRecord(value.correlation) ? value.correlation : null;
  if (
    correlation === null
    || !hasExactKeys(correlation, ['sessionId', 'sessionActionId', 'eventIds'])
    || !isBoundedString(correlation.sessionId, 1_000)
    || !isBoundedString(correlation.sessionActionId, 1_000)
    || !Array.isArray(correlation.eventIds)
    || correlation.eventIds.length < 1
    || correlation.eventIds.length > CLIENT_TRANSPORT_INCIDENT_MAX_BATCH_SIZE
    || correlation.eventIds.some((eventId) => !isBoundedString(eventId, 2_000))
    || new Set(correlation.eventIds).size !== correlation.eventIds.length
  ) {
    return false;
  }

  const browser = isRecord(value.browser) ? value.browser : null;
  if (
    browser === null
    || !hasExactKeys(browser, ['online', 'visibilityState'])
    || (browser.online !== null && typeof browser.online !== 'boolean')
    || !isVisibilityState(browser.visibilityState)
  ) {
    return false;
  }

  const error = isRecord(value.error) ? value.error : null;
  return error !== null
    && hasExactKeys(error, ['name', 'message'])
    && isBoundedString(error.name, 100)
    && isBoundedString(error.message, 500);
}

export function isClientTransportIncidentRoute(
  value: unknown,
): value is ClientTransportIncidentRoute {
  return value === '/api/study-sessions/:sessionId/accepted-review-attempt-batch'
    || value === '/api/study-sessions/:sessionId/accepted-contrast-selection-attempt';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length && keys.every((key) => actualKeys.includes(key));
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 100) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function isBoundedNonNegativeNumber(value: unknown, maximum: number): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= 0
    && value <= maximum;
}

function isVisibilityState(
  value: unknown,
): value is ClientTransportIncident['browser']['visibilityState'] {
  return value === null || value === 'hidden' || value === 'visible' || value === 'prerender';
}
