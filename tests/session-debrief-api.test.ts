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
import { createVocabularyContent } from '../server/db/vocabulary-content.ts';
import { createVocabularySession,appendVocabularySessionActions,stageVocabularySessionCompletion } from '../server/db/vocabulary-sessions.ts';
import { validateDebriefInventory } from '../src/domain/session-debrief.ts';
import type { VocabularySessionAction } from '../src/domain/vocabulary-session.ts';
import { claimSessionDebrief, finishSessionDebrief } from '../server/db/session-debrief.ts';
let server: http.Server; let base: string; let dir: string; let wakes = 0;let vocabularyWakes=0;
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'debrief-api-'));
  Object.assign(process.env, { APP_MODE: 'study', APP_AUTH_MODE: 'trusted_local', APP_LEARNER_ID: 'http-learner', APP_DATA_DIR: dir });

  const { createApp } = await import('../server/index.ts');
  getDb().prepare(`INSERT INTO lexical_words(id,hanzi,pinyin,meaning,meanings_json,examples_json,priority,created_at)
    VALUES ('http-vocabulary-word','报备','bào bèi','report in advance','[]','[]',10,'2026-01-01')`).run();
  getDb().prepare(`INSERT INTO learner_words(learner_id,word_id,in_stash,added_at,mode,mode_changed_at)
    VALUES ('http-learner','http-vocabulary-word',1,'2026-01-01','practice','2026-01-01')`).run();
  getDb().prepare(`INSERT INTO learner_word_schedules(learner_id,word_id,next_eligible_at,policy_version,scheduler_state_json)
    VALUES ('http-learner','http-vocabulary-word',NULL,'fixture','{"intervalHours":24,"easeFactor":2.5,"enabled":1,"cleanCoveredSessions":0}')`).run();
  createVocabularyContent({contentId:'http-vocabulary-cue',kind:'exercise',payloadVersion:1,body:{prompt:'Report a plan in advance'},exerciseType:'definition',skill:'production',exerciseRole:'general',assessment:{match:'exact'},
    accessScope:'shared',availability:'active',originKind:'human',words:[{wordId:'http-vocabulary-word',relation:'target'}],answers:[{wordId:'http-vocabulary-word',acceptedForms:['报备']}]},{kind:'operator',id:'fixture'});

  server = createApp({ frontendDistPath: null, wakeSessionDebriefs: () => { wakes++; },wakeVocabulary:()=>{vocabularyWakes++;} }).listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const address = server.address(); assert(address && typeof address !== 'string'); base = `http://127.0.0.1:${address.port}`;
});
after(async () => { if (server?.listening) await new Promise<void>((resolve) => server.close(() => resolve())); getDb().close(); if (dir) fs.rmSync(dir, { recursive: true, force: true }); });
const json = (method: string, body: unknown) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const summary = { sessionId: 'http-session', completedAt: '2026-10-06T04:00:00.000Z', completedReviewActionCount: 0, failedReviewActionCount: 0, activeDurationMs: 1000 };
async function newCompletion(sessionId:string,count:number) {
  const at='2026-10-06T04:00:00.000Z';
  createVocabularySession({sessionId,words:[{wordId:'http-vocabulary-word',mode:'practice'}]},at);
  const inputs:({kind:string;payload:unknown})[]=Array.from({length:count},(_,index)=>({kind:'presentation',payload:{encounterId:`${sessionId}-e-${index}`,wordId:'http-vocabulary-word',
    snapshot:{contentId:'http-vocabulary-cue',contentVersion:1,kind:'production',role:'general',body:{prompt:'Report a plan in advance',material:{prompt:'Report a plan in advance'}},assessment:{acceptedAnswers:['报备'],criteria:{match:'exact'}}}}}));
  inputs.push({kind:'finish_for_now',payload:{}},{kind:'finish_immediately',payload:{}});
  const actions=inputs.map((input,index)=>({...input,protocolVersion:1,actionId:`${sessionId}-a-${index}`,clientActionId:`${sessionId}-c-${index}`,sequence:index+1,occurredAt:at})) as VocabularySessionAction[];
  appendVocabularySessionActions(sessionId,actions,at);const staged=stageVocabularySessionCompletion(sessionId,actions.length,at);
  return fetch(`${base}/api/vocabulary/sessions/${sessionId}/completion/close`,json('POST',{completionId:staged.completionId}));
}
test('optional interests defaults empty and accepts learner-owned bounded text', async () => {
  let status = await fetch(`${base}/api/status?studyDayKey=2026-10-06`).then((response) => response.json());
  assert.equal(status.debriefInterests, '');
  assert.equal((await fetch(`${base}/api/learner-settings/debrief-interests`, json('PATCH', { debriefInterests: 'books', learnerId: 'forged' }))).status, 200);
  status = await fetch(`${base}/api/status?studyDayKey=2026-10-06`).then((response) => response.json()); assert.equal(status.debriefInterests, 'books');
  const row = getDb().prepare(`SELECT learner_id FROM learner_settings WHERE setting_key = 'debrief_interests'`).get(); assert.equal(row?.learner_id, 'http-learner');
  for (const value of [null, 10, 'x'.repeat(1001)]) assert.equal((await fetch(`${base}/api/learner-settings/debrief-interests`, json('PATCH', { debriefInterests: value }))).status, 400);
});
test('retired completion returns409 without effects; actual vocabulary completion queues immutable Connections input', async () => {
  assert.deepEqual(await fetch(`${base}/api/session-debriefs/latest`).then((response) => response.json()), { debrief: null });
  assert.equal((await fetch(`${base}/api/review-session-summaries`, json('POST', summary))).status, 409);
  assert.equal(getDb().prepare('SELECT 1 FROM learner_owned_review_session_summaries WHERE session_id=?').get(summary.sessionId),undefined);
  assert.equal((await fetch(`${base}/api/session-debriefs/http-session`)).status, 404); assert.equal(wakes, 0);
  const inventory = Array.from({ length: 15 }, () => ({ word: '报备', pinyin: 'bào bèi' }));
  assert.equal((await newCompletion(summary.sessionId,inventory.length)).status,200);
  const { debrief } = await fetch(`${base}/api/session-debriefs/latest`).then((response) => response.json());
  assert.equal(debrief.sessionId, summary.sessionId); assert.equal(debrief.exerciseCount, 15); assert.equal(debrief.status, 'queued'); assert.equal(vocabularyWakes,1);assert.equal(wakes,0);
  assert.equal((await fetch(`${base}/api/session-debriefs/http-session/retry`, { method: 'POST' })).status, 409);
  assert.equal((await fetch(`${base}/api/review-session-summaries`, json('POST', { ...summary, sessionId: 'bad', debriefInventory: [{ word: 'bad' }] }))).status, 409);
  assert.throws(()=>validateDebriefInventory([{word:'bad'}]),/nonempty word/);
  assert.equal(getDb().prepare(`SELECT 1 FROM learner_owned_review_session_summaries WHERE session_id = 'bad'`).get(), undefined);
});
test('retry is explicit, preserves first input and does not leak another learner record', async () => {
  const input = claimSessionDebrief('http-session', 'http-token', '2026-10-06T04:01:00.000Z', '2026-10-06T04:05:00.000Z')!;
  finishSessionDebrief({ sessionId: 'http-session', token: 'http-token', completedAt: '2026-10-06T04:02:00.000Z', durationMs: 60000, result: null,
    error: 'Try again', errorCode: 'stubbed_failure', metadata: null });
  const response = await fetch(`${base}/api/session-debriefs/http-session/retry`, { method: 'POST' }); assert.equal(response.status, 200);
  assert.equal((await response.json()).debrief.status, 'queued'); assert.equal(wakes, 1);
  assert.deepEqual(claimSessionDebrief('http-session', 'retry-token', '2026-10-06T04:03:00.000Z', '2026-10-06T04:07:00.000Z'), input);
  bootstrapLearner({ learnerId: 'other' });
  runWithLearnerId('other', () => recordReviewSessionSummary({ ...summary, sessionId: 'other-session', debriefInventory: [] }));
  assert.equal((await fetch(`${base}/api/session-debriefs/other-session/retry`, { method: 'POST' })).status, 404);
  assert.equal((await fetch(`${base}/api/session-debriefs/other-session`)).status, 404);
});

test('14-encounter vocabulary completion is ready-empty; retired client inventories cannot create summaries', async () => {
  const inventory = Array.from({ length: 14 }, () => ({ word: '报备', pinyin: '' }));
  const previousWakes = wakes;
  const small = { ...summary, sessionId: 'small-http', completedAt: '2026-10-07T00:00:00.000Z' };
  assert.equal((await newCompletion(small.sessionId,inventory.length)).status,200);
  const { debrief } = await fetch(`${base}/api/session-debriefs/latest`).then((response) => response.json());
  assert.equal(debrief.sessionId, 'small-http'); assert.equal(debrief.exerciseCount, 14); assert.equal(debrief.status, 'ready');
  assert.deepEqual(debrief.notes, []); assert.equal(debrief.attemptCount, 0); assert.equal(wakes, previousWakes);
  const oversized = { ...summary, sessionId: 'oversized-http', debriefInventory: Array(1001).fill(inventory[0]) };
  assert.equal((await fetch(`${base}/api/review-session-summaries`, json('POST', oversized))).status, 409);
  assert.throws(()=>validateDebriefInventory(oversized.debriefInventory),/at most 1000/);
  assert.equal(getDb().prepare(`SELECT 1 FROM learner_owned_review_session_summaries WHERE session_id = 'oversized-http'`).get(), undefined);
});

test('retired summary requests cannot mutate historical learning totals; legacy domain validation remains bounded', async () => {
  const known = { ...summary, sessionId: 'learning-count', completedLearningWordCount: 7 };
  recordReviewSessionSummary(known);
  assert.equal((await fetch(`${base}/api/review-session-summaries`, json('POST', known))).status, 409);
  assert.equal((await fetch(`${base}/api/review-session-summaries`, json('POST', { ...summary, sessionId: known.sessionId }))).status, 409);
  assert.equal(getDb().prepare(`SELECT learning_completed_count AS count FROM learner_owned_review_session_summaries
    WHERE session_id = ?`).get(known.sessionId)?.count, 7);
  for (const count of [-1, 1.5, null, '7']) {
    assert.equal((await fetch(`${base}/api/review-session-summaries`, json('POST', { ...known, completedLearningWordCount: count }))).status, 409);
    assert.throws(()=>recordReviewSessionSummary({...known,completedLearningWordCount:count} as Parameters<typeof recordReviewSessionSummary>[0]),/completedLearningWordCount/);
  }
});
