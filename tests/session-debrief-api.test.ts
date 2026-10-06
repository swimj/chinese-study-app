import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type http from 'node:http';
import { before, after, test } from 'node:test';
import { getDb } from '../server/db/connection.ts';
import { bootstrapLearner } from '../server/db/identity.ts';
import { runWithLearnerId } from '../server/db/learner-context.ts';
import { recordReviewSessionSummary } from '../server/db/persistence.ts';
import { claimSessionDebrief, finishSessionDebrief } from '../server/db/session-debrief.ts';
let server: http.Server; let base: string; let dir: string; let wakes = 0;
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'debrief-api-'));
  Object.assign(process.env, { APP_MODE: 'study', APP_AUTH_MODE: 'trusted_local', APP_LEARNER_ID: 'http-learner', APP_DATA_DIR: dir });
  const { createApp } = await import('../server/index.ts');
  server = createApp({ frontendDistPath: null, wakeSessionDebriefs: () => { wakes++; } }).listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const address = server.address(); assert(address && typeof address !== 'string'); base = `http://127.0.0.1:${address.port}`;
});
after(async () => { if (server?.listening) await new Promise<void>((resolve) => server.close(() => resolve())); getDb().close(); if (dir) fs.rmSync(dir, { recursive: true, force: true }); });
const json = (method: string, body: unknown) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const summary = { sessionId: 'http-session', completedAt: '2026-10-06T04:00:00.000Z', completedReviewActionCount: 0, failedReviewActionCount: 0, activeDurationMs: 1000 };
test('optional interests defaults empty and accepts learner-owned bounded text', async () => {
  let status = await fetch(`${base}/api/status?studyDayKey=2026-10-06`).then((response) => response.json());
  assert.equal(status.debriefInterests, '');
  assert.equal((await fetch(`${base}/api/learner-settings/debrief-interests`, json('PATCH', { debriefInterests: 'books', learnerId: 'forged' }))).status, 200);
  status = await fetch(`${base}/api/status?studyDayKey=2026-10-06`).then((response) => response.json()); assert.equal(status.debriefInterests, 'books');
  const row = getDb().prepare(`SELECT learner_id FROM learner_settings WHERE setting_key = 'debrief_interests'`).get(); assert.equal(row?.learner_id, 'http-learner');
  for (const value of [null, 10, 'x'.repeat(1001)]) assert.equal((await fetch(`${base}/api/learner-settings/debrief-interests`, json('PATCH', { debriefInterests: value }))).status, 400);
});
test('legacy completion stays204, latest is nullable, supplied inventory queues before returning', async () => {
  assert.deepEqual(await fetch(`${base}/api/session-debriefs/latest`).then((response) => response.json()), { debrief: null });
  assert.equal((await fetch(`${base}/api/review-session-summaries`, json('POST', summary))).status, 204);
  assert.equal((await fetch(`${base}/api/session-debriefs/http-session`)).status, 404); assert.equal(wakes, 0);
  const inventory = [{ word: '报备', pinyin: 'bào bèi' }];
  assert.equal((await fetch(`${base}/api/review-session-summaries`, json('POST', { ...summary, debriefInventory: inventory }))).status, 204);
  const { debrief } = await fetch(`${base}/api/session-debriefs/latest`).then((response) => response.json());
  assert.equal(debrief.sessionId, summary.sessionId); assert.equal(debrief.exerciseCount, 1); assert.equal(debrief.status, 'queued'); assert.equal(wakes, 1);
  assert.equal((await fetch(`${base}/api/session-debriefs/http-session/retry`, { method: 'POST' })).status, 409);
  assert.equal((await fetch(`${base}/api/review-session-summaries`, json('POST', { ...summary, sessionId: 'bad', debriefInventory: [{ word: 'bad' }] }))).status, 400);
  assert.equal(getDb().prepare(`SELECT 1 FROM learner_owned_review_session_summaries WHERE session_id = 'bad'`).get(), undefined);
});
test('retry is explicit, preserves first input and does not leak another learner record', async () => {
  const input = claimSessionDebrief('http-session', 'http-token', '2026-10-06T04:01:00.000Z', '2026-10-06T04:05:00.000Z')!;
  finishSessionDebrief({ sessionId: 'http-session', token: 'http-token', completedAt: '2026-10-06T04:02:00.000Z', durationMs: 60000, result: null,
    error: 'Try again', errorCode: 'stubbed_failure', metadata: null });
  const response = await fetch(`${base}/api/session-debriefs/http-session/retry`, { method: 'POST' }); assert.equal(response.status, 200);
  assert.equal((await response.json()).debrief.status, 'queued'); assert.equal(wakes, 2);
  assert.deepEqual(claimSessionDebrief('http-session', 'retry-token', '2026-10-06T04:03:00.000Z', '2026-10-06T04:07:00.000Z'), input);
  bootstrapLearner({ learnerId: 'other' });
  runWithLearnerId('other', () => recordReviewSessionSummary({ ...summary, sessionId: 'other-session', debriefInventory: [] }));
  assert.equal((await fetch(`${base}/api/session-debriefs/other-session/retry`, { method: 'POST' })).status, 404);
  assert.equal((await fetch(`${base}/api/session-debriefs/other-session`)).status, 404);
});
