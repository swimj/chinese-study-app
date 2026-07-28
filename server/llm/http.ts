import { ProviderHttpError, type JsonValue } from './types.js';

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
  const response = await fetchImplementation(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const responseText = await response.text();
  if (!response.ok) throw new ProviderHttpError(provider, response.status, responseText);

  let parsed: unknown;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    throw new Error(`${provider} returned a non-JSON HTTP response: ${responseText.slice(0, 1_000)}`);
  }
  if (!isJsonValue(parsed)) {
    throw new Error(`${provider} returned a value that is not JSON-compatible.`);
  }
  return parsed;
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
