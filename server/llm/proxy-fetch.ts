import { Agent, ProxyAgent, fetch as undiciFetch, type Dispatcher } from 'undici';

// Hard-coded local proxy (Clash/V2Ray-style HTTP CONNECT proxy on port 7897).
export const OPENAI_PROXY_URL = 'http://127.0.0.1:7897';

const DEFAULT_PROVIDER_TIMEOUT_MS = 300_000;

function fetchWithDispatcher(dispatcher: Dispatcher): typeof globalThis.fetch {
  return (input, init) => undiciFetch(input as Parameters<typeof undiciFetch>[0], {
    ...(init as Record<string, unknown>),
    dispatcher,
  } as Parameters<typeof undiciFetch>[1]);
}

function directDispatcher(timeoutMs: number): Dispatcher {
  // Undici otherwise applies its own 300-second headers timeout before the
  // provider request's longer AbortSignal budget can elapse.
  return new Agent({ headersTimeout: timeoutMs, bodyTimeout: timeoutMs });
}

function proxyDispatcher(timeoutMs: number): Dispatcher {
  return new ProxyAgent({
    uri: OPENAI_PROXY_URL,
    headersTimeout: timeoutMs,
    bodyTimeout: timeoutMs,
  });
}

export const proxiedFetch = fetchWithDispatcher(proxyDispatcher(DEFAULT_PROVIDER_TIMEOUT_MS));

/** OpenAI is routed through the local proxy; other providers use direct fetch. */
export function fetchImplementationForProvider(
  providerId: string,
  timeoutMs = DEFAULT_PROVIDER_TIMEOUT_MS,
): typeof globalThis.fetch {
  if (providerId === 'openai' && timeoutMs === DEFAULT_PROVIDER_TIMEOUT_MS) {
    return proxiedFetch;
  }
  return fetchWithDispatcher(
    providerId === 'openai' ? proxyDispatcher(timeoutMs) : directDispatcher(timeoutMs),
  );
}
