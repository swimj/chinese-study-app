import { ProxyAgent, fetch as undiciFetch, type Dispatcher } from 'undici';

// Hard-coded local proxy (Clash/V2Ray-style HTTP CONNECT proxy on port 7897).
export const OPENAI_PROXY_URL = 'http://127.0.0.1:7897';

const proxyDispatcher: Dispatcher = new ProxyAgent(OPENAI_PROXY_URL);

export const proxiedFetch: typeof globalThis.fetch = (input, init) =>
  undiciFetch(input as Parameters<typeof undiciFetch>[0], {
    ...(init as Record<string, unknown>),
    dispatcher: proxyDispatcher,
  } as Parameters<typeof undiciFetch>[1]);
