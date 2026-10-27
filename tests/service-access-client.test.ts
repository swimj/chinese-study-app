import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchServiceAccess, fetchMyWords, setClientIncidentStorageScope, subscribeServiceAccessDenied } from '../src/services/api.ts';

test('access preflight validates the server contract and regular requests broadcast only access denials', async () => {
  const originalFetch = globalThis.fetch;
  let denied = 0;
  const unsubscribe = subscribeServiceAccessDenied(() => { denied += 1; });
  try {
    globalThis.fetch = async () => Response.json({ allowed: false });
    assert.deepEqual(await fetchServiceAccess(), { allowed: false });
    assert.equal(denied, 0);
    globalThis.fetch = async () => Response.json({ unexpected: true });
    await assert.rejects(fetchServiceAccess(), /Invalid service availability/);
    globalThis.fetch = async () => Response.json({ code: 'MAINTENANCE_MODE' }, { status: 503 });
    await assert.rejects(fetchMyWords('deck', ''));
    assert.equal(denied, 0);
    globalThis.fetch = async () => Response.json({ code: 'OPERATOR_ONLY' }, { status: 503 });
    await assert.rejects(fetchMyWords('deck', ''));
    assert.equal(denied, 1);
  } finally { globalThis.fetch = originalFetch; unsubscribe(); }
});

test('late denied requests from another account cannot lock out the current account', async () => {
  const originalFetch = globalThis.fetch;
  let denied = 0;
  const unsubscribe = subscribeServiceAccessDenied(() => { denied += 1; });
  let finish!: (response: Response) => void;
  let started!: () => void;
  const requestStarted = new Promise<void>(resolve => { started = resolve; });
  try {
    setClientIncidentStorageScope('learner-a');
    globalThis.fetch = () => { started(); return new Promise(resolve => { finish = resolve; }); };
    const pending = fetchMyWords('deck', '');
    await requestStarted;
    setClientIncidentStorageScope('operator-b');
    // Returning to A must also fence the original session's request.
    setClientIncidentStorageScope('learner-a');
    finish(Response.json({ code: 'OPERATOR_ONLY' }, { status: 503 }));
    await assert.rejects(pending);
    assert.equal(denied, 0);
  } finally {
    globalThis.fetch = originalFetch;
    unsubscribe();
    setClientIncidentStorageScope('trusted-local');
  }
});
