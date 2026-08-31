import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { describe, test } from 'node:test';
import { OPENAI_PROXY_URL, fetchImplementationForProvider, proxiedFetch } from '../server/llm/proxy-fetch.js';

describe('local provider proxy fetch', () => {
  test('targets the local Clash/V2Ray HTTP CONNECT proxy used by the LLM spike', () => {
    assert.equal(OPENAI_PROXY_URL, 'http://127.0.0.1:7897');
    assert.equal(typeof proxiedFetch, 'function');
  });

  test('uses direct connections for every provider when the flag is unset or false', () => {
    const previousValue = process.env.APP_USE_LOCAL_PROVIDER_PROXY;
    delete process.env.APP_USE_LOCAL_PROVIDER_PROXY;
    try {
      assert.notEqual(fetchImplementationForProvider('openai'), proxiedFetch);
      assert.notEqual(fetchImplementationForProvider('openrouter'), proxiedFetch);
      assert.notEqual(fetchImplementationForProvider('zai'), proxiedFetch);

      process.env.APP_USE_LOCAL_PROVIDER_PROXY = 'false';
      assert.notEqual(fetchImplementationForProvider('openai'), proxiedFetch);
      assert.notEqual(fetchImplementationForProvider('openrouter'), proxiedFetch);
    } finally {
      if (previousValue === undefined) {
        delete process.env.APP_USE_LOCAL_PROVIDER_PROXY;
      } else {
        process.env.APP_USE_LOCAL_PROVIDER_PROXY = previousValue;
      }
    }
  });

  test('routes only OpenAI and OpenRouter through the local proxy when explicitly enabled', () => {
    const previousValue = process.env.APP_USE_LOCAL_PROVIDER_PROXY;
    process.env.APP_USE_LOCAL_PROVIDER_PROXY = 'true';
    try {
      assert.equal(fetchImplementationForProvider('openai'), proxiedFetch);
      assert.equal(fetchImplementationForProvider('openrouter'), proxiedFetch);
      assert.notEqual(fetchImplementationForProvider('zai'), proxiedFetch);
    } finally {
      if (previousValue === undefined) {
        delete process.env.APP_USE_LOCAL_PROVIDER_PROXY;
      } else {
        process.env.APP_USE_LOCAL_PROVIDER_PROXY = previousValue;
      }
    }
  });

  test('rejects invalid local proxy flag values', () => {
    const previousValue = process.env.APP_USE_LOCAL_PROVIDER_PROXY;
    process.env.APP_USE_LOCAL_PROVIDER_PROXY = 'TRUE';
    try {
      assert.throws(
        () => fetchImplementationForProvider('openai'),
        /APP_USE_LOCAL_PROVIDER_PROXY must be either "true" or "false"/,
      );
    } finally {
      if (previousValue === undefined) {
        delete process.env.APP_USE_LOCAL_PROVIDER_PROXY;
      } else {
        process.env.APP_USE_LOCAL_PROVIDER_PROXY = previousValue;
      }
    }
  });

  test('honors the provider timeout while waiting for response headers', async () => {
    const previousValue = process.env.APP_USE_LOCAL_PROVIDER_PROXY;
    delete process.env.APP_USE_LOCAL_PROVIDER_PROXY;
    const server = createServer((_request, response) => {
      setTimeout(() => {
        response.writeHead(200, { connection: 'close', 'content-type': 'application/json' });
        response.end('{}');
      }, 1_500);
    });

    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      const address = server.address();
      assert.ok(address && typeof address === 'object');
      const providerFetch = fetchImplementationForProvider('openai', 500);
      await assert.rejects(
        providerFetch(`http://127.0.0.1:${address.port}`),
        (error: unknown) => (
          error instanceof TypeError
          && error.cause instanceof Error
          && (error.cause as Error & { code?: unknown }).code === 'UND_ERR_HEADERS_TIMEOUT'
        ),
      );
    } finally {
      if (server.listening) {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => error ? reject(error) : resolve());
        });
      }
      if (previousValue === undefined) {
        delete process.env.APP_USE_LOCAL_PROVIDER_PROXY;
      } else {
        process.env.APP_USE_LOCAL_PROVIDER_PROXY = previousValue;
      }
    }
  });
});
