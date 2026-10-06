import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, after, test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { getDb } from '../server/db/connection.ts';
import { runWithLearnerId } from '../server/db/learner-context.ts';
import { bootstrapLearner, setLearnerDisabled } from '../server/db/identity.ts';
import { recordReviewSessionSummary } from '../server/db/persistence.ts';
import { claimSessionDebrief, finishSessionDebrief, getDebriefInterests, getLatestSessionDebrief, getSessionDebrief,
  recoverExpiredSessionDebriefs, retrySessionDebrief, setDebriefInterests } from '../server/db/session-debrief.ts';
import { createSessionDebriefWorker } from '../server/session-debrief/worker.ts';
import { SessionDebriefProviderError, DEBRIEF_PRICING, type DebriefRunMetadata } from '../server/session-debrief/provider.ts';
import type { SessionDebriefInput } from '../src/domain/session-debrief.ts';

let dir: string;
const owner = <T>(work: () => T) => runWithLearnerId('a', work);
const inventory = [{ word: '学问 / 学识', pinyin: 'xué wèn / xué shí' }, { word: '报备', pinyin: 'bào bèi' }];
const metadata: DebriefRunMetadata = { responseId: 'stub', finishReason: 'stop', usage: { inputTokens: 10, cachedInputTokens: 0,
  cacheWriteInputTokens: null, outputTokens: 5, reasoningTokens: 1, totalTokens: 15 }, pricing: DEBRIEF_PRICING, estimatedCostUsd: .00007 };
function summary(sessionId: string, debriefInventory?: typeof inventory, completedAt = '2026-10-06T01:00:00.000Z') {
  owner(() => recordReviewSessionSummary({ sessionId, completedAt, completedReviewActionCount: 0, failedReviewActionCount: 0,
    activeDurationMs: 1000, ...(debriefInventory === undefined ? {} : { debriefInventory }) }));
}
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'debrief-'));
  process.env.APP_MODE = 'study'; process.env.APP_AUTH_MODE = 'clerk'; process.env.APP_DATA_DIR = dir;
  await import('../server/db.ts');
  bootstrapLearner({ learnerId: 'a' }); bootstrapLearner({ learnerId: 'b' });
});
after(() => { getDb().close(); fs.rmSync(dir, { recursive: true, force: true }); });
test('legacy summaries enqueue nothing; empty inventory is ready without provider work', () => {
  summary('legacy'); assert.equal(owner(() => getSessionDebrief('legacy')), null);
  summary('empty', []); assert.deepEqual(owner(() => getSessionDebrief('empty')), {
    sessionId: 'empty', completedAt: '2026-10-06T01:00:00.000Z', exerciseCount: 0, status: 'ready', notes: [], error: null, attemptCount: 0 });
  summary('empty', inventory); assert.equal(owner(() => getSessionDebrief('empty'))?.exerciseCount, 0);
});
test('settings and jobs are isolated; first exact input and interests survive duplicate finish and explicit retries', () => {
  assert.equal(owner(getDebriefInterests), ''); owner(() => setDebriefInterests('rock climbing'));
  assert.equal(runWithLearnerId('b', getDebriefInterests), '');
  summary('snapshot', inventory);
  owner(() => setDebriefInterests('reading')); summary('snapshot', [{ word: 'different', pinyin: 'other' }]);
  const input = owner(() => claimSessionDebrief('snapshot', 'first', '2026-10-06T02:00:00.000Z', '2026-10-06T03:00:00.000Z'))!;
  assert.deepEqual(input.interests, ['rock climbing']); assert.equal(input.items[0].word, inventory[0].word);
  assert.equal(input.items.length, 2); assert.equal(input.items[1].ref, 'w2');
  assert.equal(runWithLearnerId('b', () => getSessionDebrief('snapshot')), null);
  assert.throws(() => runWithLearnerId('b', () => retrySessionDebrief('snapshot')), /not found/);
  assert.equal(owner(() => finishSessionDebrief({ sessionId: 'snapshot', token: 'first', completedAt: '2026-10-06T02:01:00.000Z', durationMs: 60000,
    result: null, error: 'Failed', errorCode: 'upstream_failure', metadata })), true);
  owner(() => retrySessionDebrief('snapshot'));
  assert.deepEqual(owner(() => claimSessionDebrief('snapshot', 'second', '2026-10-06T02:02:00.000Z', '2026-10-06T03:00:00.000Z')), input);
  owner(() => finishSessionDebrief({ sessionId: 'snapshot', token: 'second', completedAt: '2026-10-06T02:03:00.000Z', durationMs: 60000,
    result: { notes: [] }, error: null, errorCode: null, metadata }));
  assert.equal(owner(() => getSessionDebrief('snapshot'))?.attemptCount, 2);
  assert.deepEqual(owner(() => getSessionDebrief('snapshot'))?.notes, []);
  assert.throws(() => getDb().prepare("UPDATE learner_session_debrief_jobs SET input_json = '{}' WHERE session_id = 'snapshot'").run(), /immutable/);
  assert.throws(() => getDb().prepare("UPDATE learner_session_debrief_jobs SET result_json = '{}' WHERE session_id = 'snapshot'").run(), /immutable/);
  assert.throws(() => getDb().prepare("UPDATE learner_session_debrief_attempts SET estimated_cost_usd = 100 WHERE attempt_id = 'second'").run(), /immutable/);
  assert.throws(() => owner(() => retrySessionDebrief('snapshot')), /Only failed/);
  const attempts = getDb().prepare(`SELECT outcome, usage_json, pricing_json FROM learner_session_debrief_attempts WHERE session_id = 'snapshot' ORDER BY started_at`).all();
  assert.equal(attempts.length, 2); assert.equal(attempts[0].outcome, 'failed'); assert.equal(attempts[1].outcome, 'ready');
  assert.deepEqual(JSON.parse(String(attempts[1].pricing_json)), DEBRIEF_PRICING);
  assert.throws(() => getDb().prepare(`INSERT INTO learner_session_debrief_jobs (learner_id, session_id, completed_at, exercise_count, input_json, status, updated_at)
    VALUES ('b','snapshot','2026-10-06',1,'{}','queued','2026-10-06')`).run(), /FOREIGN KEY/);
});
test('invalid inventory cannot leave a partial durable completion or job', () => {
  assert.throws(() => summary('invalid', [{ word: '', pinyin: 'x' }]), /nonempty/);
  assert.equal(owner(() => getSessionDebrief('invalid')), null);
  assert.equal(getDb().prepare(`SELECT COUNT(*) AS count FROM learner_owned_review_session_summaries WHERE session_id = 'invalid'`).get()?.count, 0);
});
test('an enqueue SQL failure rolls back the summary inserted in the same transaction', () => {
  getDb().exec(`CREATE TEMP TRIGGER reject_test_debrief BEFORE INSERT ON learner_session_debrief_jobs
    WHEN NEW.session_id = 'enqueue-fails' BEGIN SELECT RAISE(ABORT, 'test enqueue failure'); END;`);
  try {
    assert.throws(() => summary('enqueue-fails', [{ word: '学问', pinyin: '' }]), /test enqueue failure/);
    assert.equal(getDb().prepare(`SELECT 1 FROM learner_owned_review_session_summaries WHERE session_id = 'enqueue-fails'`).get(), undefined);
    assert.equal(owner(() => getSessionDebrief('enqueue-fails')), null);
  } finally { getDb().exec('DROP TRIGGER reject_test_debrief'); }
});
test('expired attempt becomes retryable, preserves input and rejects stale completion after retry', () => {
  summary('interrupted', inventory);
  owner(() => claimSessionDebrief('interrupted', 'expired', '2026-10-06T02:00:00.000Z', '2026-10-06T02:04:00.000Z'));
  recoverExpiredSessionDebriefs('2026-10-06T02:05:00.000Z');
  assert.equal(owner(() => getSessionDebrief('interrupted'))?.status, 'failed');
  assert.match(owner(() => getSessionDebrief('interrupted'))!.error!, /interrupted/);
  owner(() => retrySessionDebrief('interrupted'));
  assert.equal(owner(() => finishSessionDebrief({ sessionId: 'interrupted', token: 'expired', completedAt: '2026-10-06T02:06:00.000Z', durationMs: 360000,
    result: { notes: [] }, error: null, errorCode: null, metadata })), false);
  assert.equal(getDb().prepare(`SELECT outcome FROM learner_session_debrief_attempts WHERE attempt_id = 'expired'`).get()?.outcome, 'interrupted');
});
test('background worker respects maintenance and disabled account, survives recreation, and isolates failure', async () => {
  let calls = 0; let paused = true; let captured: SessionDebriefInput | null = null;
  const options = { controls: () => ({ maintenanceMode: paused, providerWorkEnabled: true }), providerWork: async <T>(work: () => Promise<T>) => work(),
    now: () => Date.parse('2026-10-06T02:05:00.000Z'), provider: { isConfigured: () => true, generate: async (input: SessionDebriefInput) => {
      calls++; captured = input; throw new SessionDebriefProviderError('invalid_result', 'Invalid result. You can retry.', metadata);
    } } };
  summary('worker', inventory, '2026-10-07T00:00:00.000Z');
  let worker = createSessionDebriefWorker(options);
  assert.equal(await worker.step(), false); assert.equal(calls, 0);
  paused = false; setLearnerDisabled('a', true);
  assert.equal(await worker.step(), false); assert.equal(calls, 0);
  setLearnerDisabled('a', false); await worker.stop(); worker = createSessionDebriefWorker(options);
  assert.equal(await worker.step(), true); // the interrupted retry is older and resumes first
  assert.equal(await worker.step(), true);
  assert.equal(calls, 2); assert.ok(captured);
  assert.equal(owner(() => getSessionDebrief('worker'))?.status, 'failed');
  assert.equal(getDb().prepare(`SELECT completed_count FROM learner_owned_review_session_summaries WHERE session_id = 'worker'`).get()?.completed_count, 0);
  assert.equal(owner(getLatestSessionDebrief)?.sessionId, 'worker');
  await worker.stop();
});
test('stop waits for active generation and repeated steps share one call', async () => {
  summary('shutdown', inventory, '2026-10-08T00:00:00.000Z');
  let finish!: () => void; let began!: () => void;
  const started = new Promise<void>((resolve) => { began = resolve; });
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  let calls = 0;
  const worker = createSessionDebriefWorker({ providerWork: async (work) => work(), controls: () => ({ maintenanceMode: false, providerWorkEnabled: true }),
    provider: { isConfigured: () => true, generate: async () => { calls++; began(); await pending; return { result: { notes: [] }, metadata }; } } });
  const first = worker.step(); const duplicate = worker.step(); assert.equal(first, duplicate); await started;
  let stopped = false; const stopping = worker.stop().then(() => { stopped = true; });
  await Promise.resolve(); assert.equal(stopped, false); finish(); await stopping;
  assert.equal(calls, 1); assert.equal(owner(() => getSessionDebrief('shutdown'))?.status, 'ready');
});

test('French completion never enqueues the Mandarin provider flow', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
    const db = await import('./server/db.ts');
    db.recordReviewSessionSummary({ sessionId:'french', completedAt:'2026-10-06T00:00:00.000Z', completedReviewActionCount:0,
      failedReviewActionCount:0, activeDurationMs:0, debriefInventory:[{word:'bonjour',pinyin:''}] });
    if (db.getSessionDebrief('french') !== null) throw new Error('French debrief was enqueued');
  `], { encoding: 'utf8', env: { ...process.env, APP_AUTH_MODE: 'trusted_local', APP_STUDY_PROFILE: 'french',
    APP_LEARNER_ID: 'french-test', APP_DATA_DIR: path.join(dir, 'french') } });
  assert.equal(result.status, 0, result.stderr);
});
