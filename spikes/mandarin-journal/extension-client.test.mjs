import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { journalOrigin, permissionFor, sendReading } from './extension/journal.js';

const origin = 'https://mini.tailnet.ts.net';
const pairing = { origin, token: 'fake-test-token' };
const reading = {
  sourceUrl: 'https://example.com/reading',
  title: '乡土本色',
  paragraphs: [{ text: '第一章', kind: 'heading' }, { text: '这是开头。' }],
};

test('pairing accepts a device HTTPS origin and requests only that host', () => {
  assert.equal(journalOrigin(' HTTPS://MINI.TAILNET.TS.NET/ '), origin);
  assert.deepEqual(permissionFor(origin), { origins: [origin + '/*'] });
  for (const invalid of [
    'http://mini.tailnet.ts.net', 'https://tailnet.ts.net', 'https://mini.tailnet.ts.net.other.example',
    origin + '/read', origin + '?extra', origin + '#extra', origin + ':8443',
    'https://name@mini.tailnet.ts.net', 'https://localhost',
  ]) {
    assert.throws(() => journalOrigin(invalid), /Enter the Journal’s HTTPS address/);
  }
});

test('import sends the reading only to the paired endpoint and opens the returned ID', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({ documentId: 'article-exact' }));
  const link = await sendReading(pairing, reading);
  assert.equal(link, origin + '/#read/library/article-exact');
  assert.equal(fetch.mock.callCount(), 1);
  const [url, request] = fetch.mock.calls[0].arguments;
  assert.equal(url, origin + '/api/extension/import');
  assert.equal(request.method, 'POST');
  assert.equal(request.headers.Authorization, 'Bearer fake-test-token');
  assert.equal(request.credentials, 'omit');
  assert.equal(request.redirect, 'error');
  assert.deepEqual(JSON.parse(request.body), reading);
});

test('import surfaces the server error and checks the deadline through the response body', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ error: 'The source returned a verification page.' }, { status: 422 }));
  await assert.rejects(sendReading(pairing, reading), { message: 'The source returned a verification page.' });

  fetch.mock.mockImplementation(async (_url, { signal }) => ({
    ok: true,
    async json() {
      await delay(1_000, undefined, { signal });
    },
  }));
  await assert.rejects(sendReading(pairing, reading, 10), { message:
    'Could not reach the journal at ' + origin + '. Check that the journal is running and Tailscale is connected.' });
});
