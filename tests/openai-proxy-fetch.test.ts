import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { OPENAI_PROXY_URL, fetchImplementationForProvider, proxiedFetch } from '../server/llm/proxy-fetch.js';

describe('openai proxied fetch', () => {
  test('targets the local Clash/V2Ray HTTP CONNECT proxy used by the LLM spike', () => {
    assert.equal(OPENAI_PROXY_URL, 'http://127.0.0.1:7897');
    assert.equal(typeof proxiedFetch, 'function');
  });

  test('routes only OpenAI through the local proxy by default', () => {
    assert.equal(fetchImplementationForProvider('openai'), proxiedFetch);
    assert.equal(fetchImplementationForProvider('zai'), globalThis.fetch);
  });
});
