import { proxiedFetch } from './proxy-fetch.js';

// Hit the OpenAI /v1/models endpoint with no auth. A 401 means we successfully
// reached OpenAI through the proxy; a network error means the proxy path failed.
const response = await proxiedFetch('https://api.openai.com/v1/models', {
  method: 'GET',
  signal: AbortSignal.timeout(15_000),
});

console.log('status:', response.status);
console.log('body (first 500 chars):', (await response.text()).slice(0, 500));

if (response.status === 401) {
  console.log('PING OK: reached OpenAI through the proxy (401 = no auth, but tunnel works).');
  process.exit(0);
} else {
  console.log('PING: unexpected status, but tunnel reached a server.');
  process.exit(0);
}
