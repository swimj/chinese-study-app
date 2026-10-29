import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSessionDebriefLoader, type SessionDebriefLoadState } from '../src/features/session/session-debrief-loader.ts';
import type { SessionDebrief } from '../src/domain/session-debrief.ts';

function debrief(status: SessionDebrief['status'], sessionId = 'session'): SessionDebrief {
  return { sessionId, completedAt: '2026-10-06T00:00:00.000Z', exerciseCount: 2, status,
    notes: status === 'ready' ? [] : null, error: null, attemptCount: 1 };
}
function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function harness(overrides: Partial<Parameters<typeof createSessionDebriefLoader>[0]['api']> = {}, sessionId?: string) {
  const changes: SessionDebriefLoadState[] = [];
  const callbacks = new Map<ReturnType<typeof setTimeout>, () => void>();
  let count = 0;
  const loader = createSessionDebriefLoader({ sessionId, onChange: (state) => changes.push(state),
    api: { latest: async () => debrief('ready'), get: async () => debrief('ready'), retry: async () => debrief('queued'), ...overrides },
    schedule: (callback) => { const id = ++count as unknown as ReturnType<typeof setTimeout>; callbacks.set(id, callback); return id; },
    cancel: (id) => { callbacks.delete(id); } });
  return { loader, changes, callbacks, last: () => changes.at(-1)! };
}
async function settle() { await Promise.resolve(); await Promise.resolve(); }

test('polls queued/running only, pins latest identity, and stops on empty ready', async () => {
  const ids: string[] = []; let reads = 0;
  const h = harness({ latest: async () => debrief('queued'), get: async (id) => { ids.push(id); return debrief(++reads === 1 ? 'running' : 'ready'); } });
  await h.loader.reload(); assert.equal(h.callbacks.size, 1);
  h.callbacks.values().next().value!(); h.callbacks.clear(); await settle();
  assert.equal(h.last().debrief?.status, 'running'); assert.equal(h.callbacks.size, 1);
  h.callbacks.values().next().value!(); h.callbacks.clear(); await settle();
  assert.equal(h.last().debrief?.status, 'ready'); assert.equal(h.callbacks.size, 0);
  assert.deepEqual(ids, ['session', 'session']); h.loader.dispose();
});

test('disposal aborts request and ignores a late response', async () => {
  const response = deferred<SessionDebrief | null>(); let signal: AbortSignal | undefined;
  const h = harness({ get: (id, current) => { signal = current; return response.promise; } }, 'session');
  const read = h.loader.reload(); const before = h.changes.length;
  h.loader.dispose(); assert.equal(signal?.aborted, true);
  response.resolve(debrief('queued')); await read;
  assert.equal(h.changes.length, before); assert.equal(h.callbacks.size, 0);
});

test('new reads fence stale successes and errors; fetch errors are explicitly recoverable', async () => {
  const old = deferred<SessionDebrief | null>(); let reads = 0;
  const h = harness({ get: async () => { reads += 1; if (reads === 1) return old.promise; if (reads === 2) throw new Error('Offline'); return debrief('ready'); } }, 'session');
  const stale = h.loader.reload(); await h.loader.reload();
  assert.equal(h.last().error, 'Offline'); old.resolve(debrief('queued')); await stale;
  assert.equal(h.last().error, 'Offline'); assert.equal(h.callbacks.size, 0);
  await h.loader.reload(); assert.equal(h.last().error, null); assert.equal(h.last().debrief?.status, 'ready'); h.loader.dispose();
});

test('retry aborts and fences an older GET, suppresses double retry, then polls the returned job', async () => {
  const old = deferred<SessionDebrief | null>(); const post = deferred<SessionDebrief>();
  let reads = 0; let retries = 0; let oldSignal: AbortSignal | undefined;
  const h = harness({ get: (id, signal) => { reads += 1; if (reads === 1) return Promise.resolve(debrief('failed')); oldSignal = signal; return old.promise; },
    retry: () => { retries += 1; return post.promise; } }, 'session');
  await h.loader.reload(); const stale = h.loader.reload(); const retry = h.loader.retry(); void h.loader.retry();
  assert.equal(oldSignal?.aborted, true); assert.equal(retries, 1);
  post.resolve(debrief('queued')); await retry; old.resolve(debrief('failed')); await stale;
  assert.equal(h.last().debrief?.status, 'queued'); assert.equal(h.callbacks.size, 1); h.loader.dispose();
});

test('lost retry response reads durable state without replaying provider work', async () => {
  let reads = 0; let retries = 0;
  const h = harness({ get: async () => debrief(++reads === 1 ? 'failed' : 'running'), retry: async () => { retries += 1; throw new Error('Lost response'); } }, 'session');
  await h.loader.reload(); await h.loader.retry();
  assert.equal(h.last().error, null); assert.equal(h.last().debrief?.status, 'running'); assert.equal(retries, 1);
  assert.equal(h.callbacks.size, 1); h.loader.dispose();
});

test('ready/absent summaries cannot be retried and mismatched session responses are rejected', async () => {
  let retries = 0;
  const h = harness({ retry: async () => { retries += 1; return debrief('queued'); }, get: async () => debrief('ready', 'other') }, 'session');
  await h.loader.reload(); assert.match(h.last().error!, /did not match/); await h.loader.retry(); assert.equal(retries, 0); h.loader.dispose();
  const ready = harness(); await ready.loader.reload(); await ready.loader.retry(); assert.equal(ready.last().debrief?.status, 'ready'); ready.loader.dispose();
});
