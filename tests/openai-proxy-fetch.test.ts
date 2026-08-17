import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { describe, test } from 'node:test';
import { OPENAI_PROXY_URL, fetchImplementationForProvider, proxiedFetch } from '../server/llm/proxy-fetch.js';

describe('openai proxied fetch', () => {
  test('targets the local Clash/V2Ray HTTP CONNECT proxy used by the LLM spike', () => {
    assert.equal(OPENAI_PROXY_URL, 'http://127.0.0.1:7897');
    assert.equal(typeof proxiedFetch, 'function');
  });

  test('routes only OpenAI through the local proxy by default', () => {
    assert.equal(fetchImplementationForProvider('openai'), proxiedFetch);
    assert.notEqual(fetchImplementationForProvider('zai'), globalThis.fetch);
  });

  test('honors the provider timeout while waiting for response headers', async () => {
    const server = createServer((_request, response) => {
      setTimeout(() => {
        response.writeHead(200, { connection: 'close', 'content-type': 'application/json' });
        response.end('{}');
      }, 1_500);
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });

    try {
      const address = server.address();
      assert.ok(address && typeof address === 'object');
      const providerFetch = fetchImplementationForProvider('dashscope', 500);
      await assert.rejects(
        providerFetch(`http://127.0.0.1:${address.port}`),
        (error: unknown) => (
          error instanceof TypeError
          && error.cause instanceof Error
          && (error.cause as Error & { code?: unknown }).code === 'UND_ERR_HEADERS_TIMEOUT'
        ),
      );
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });
});
