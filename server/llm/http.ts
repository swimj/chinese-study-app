import { ProviderHttpError, ProviderTimeoutError, ProviderInvalidResponseError, type JsonValue } from './types.js';

export type FetchImplementation = typeof globalThis.fetch;

export function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
}

export async function postJson(
  provider: string,
  fetchImplementation: FetchImplementation,
  url: string,
  headers: Record<string, string>,
  body: JsonValue,
  timeoutMs: number,
): Promise<JsonValue> {
  const signal = AbortSignal.timeout(timeoutMs);
  let response: Response;
  let responseText: string;
  try {
    response = await fetchImplementation(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal,
    });
    signal.throwIfAborted();
    responseText = await response.text();
    signal.throwIfAborted();
  } catch (error) {
    // Our deadline and explicit transport deadline codes prove timeouts; unrelated aborts do not.
    if (signal.aborted || isTransportTimeout(error)) throw new ProviderTimeoutError(provider, timeoutMs);
    throw error;
  }
  if (!response.ok) throw new ProviderHttpError(provider, response.status, responseText, response.headers);

  let parsed: unknown;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    throw new ProviderInvalidResponseError(`${provider} returned a non-JSON HTTP response: ${responseText.slice(0, 1_000)}`);
  }
  if (!isJsonValue(parsed)) {
    throw new ProviderInvalidResponseError(`${provider} returned a value that is not JSON-compatible.`);
  }
  return parsed;
}

function isTransportTimeout(error: unknown): boolean {
  const visited = new Set<unknown>();
  let current = error;
  while (current instanceof Error && !visited.has(current)) {
    visited.add(current);
    if ('code' in current && ['UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_CONNECT_TIMEOUT'].includes(String(current.code))) return true;
    current = current.cause;
  }
  return false;
}

export function asRecord(value: JsonValue, location: string): Record<string, JsonValue> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${location} must be an object.`);
  }
  return value;
}

export function asArray(value: JsonValue | undefined, location: string): JsonValue[] {
  if (!Array.isArray(value)) throw new Error(`${location} must be an array.`);
  return value;
}

export function stringOrNull(value: JsonValue | undefined): string | null {
  return typeof value === 'string' ? value : null;
}

export function numberOrNull(value: JsonValue | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value === 'object') return Object.values(value).every(isJsonValue);
  return false;
}
