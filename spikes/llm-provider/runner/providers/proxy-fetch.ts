import { ProxyAgent, fetch as undiciFetch, type Dispatcher } from 'undici';

// Hard-coded local proxy (Clash/V2Ray-style HTTP CONNECT proxy on port 7897).
const PROXY_URL = 'http://127.0.0.1:7897';

const proxyDispatcher: Dispatcher = new ProxyAgent(PROXY_URL);

// The npm undici package declares its own copy of the Fetch API types. Its
// Response is the implementation behind Node's global fetch, so present it as
// the global Response type callers expect.
export const proxiedFetch: typeof globalThis.fetch = (input, init) =>
  undiciFetch(input as Parameters<typeof undiciFetch>[0], {
    ...(init as Record<string, unknown>),
    dispatcher: proxyDispatcher,
  } as Parameters<typeof undiciFetch>[1]) as Promise<Response>;
