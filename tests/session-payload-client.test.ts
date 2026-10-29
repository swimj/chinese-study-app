import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchSessionPayload } from '../src/services/api.ts';

test('session payload readiness is requested by POST with a study day key', async () => {
  const previousFetch = globalThis.fetch;
  let request: { url: string; method: string | undefined; body: unknown } | null = null;
  globalThis.fetch = async (input, init) => {
    request = { url: String(input), method: init?.method, body: init?.body };
    return Response.json({
      buckets: { review: [], learning: [], unstudied: [] },
      preparation: { pending: true },
    });
  };
  try {
    const payload = await fetchSessionPayload();
    assert.equal(payload.preparation?.pending, true);
    assert.ok(request);
    assert.match(request.url, /\/api\/session-payload$/);
    assert.equal(request.method, 'POST');
    assert.match(JSON.parse(String(request.body)).studyDayKey, /^\d{4}-\d{2}-\d{2}$/);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('pending and empty readiness can be checked again after background recovery', async () => {
  const { beginSessionPrefetch, resetSessionPrefetchCache } = await import('../src/features/session/session-prefetch.ts');
  const previousFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json({
      buckets: { review: [], learning: [], unstudied: [] },
      preparation: { pending: calls === 1 },
    });
  };
  try {
    resetSessionPrefetchCache();
    assert.equal((await beginSessionPrefetch()).preparation?.pending, true);
    assert.equal((await beginSessionPrefetch()).preparation?.pending, false);
    await beginSessionPrefetch();
    assert.equal(calls, 3);
  } finally {
    resetSessionPrefetchCache();
    globalThis.fetch = previousFetch;
  }
});


test('a partial prepared session starts from its snapshot without a second entry wait', async () => {
  const { beginSessionPrefetch, resetSessionPrefetchCache } = await import('../src/features/session/session-prefetch.ts');
  const previousFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ buckets: { review: [], learning: [{ id: 'ready-learning' }], unstudied: [] }, preparation: { pending: true } });
  };
  try {
    resetSessionPrefetchCache();
    const prepared = await beginSessionPrefetch();
    assert.equal(await beginSessionPrefetch(), prepared);
    assert.equal(calls, 1);
  } finally { resetSessionPrefetchCache(); globalThis.fetch = previousFetch; }
});
