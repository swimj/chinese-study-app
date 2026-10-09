import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, after, test } from 'node:test';
import { getDb } from '../server/db/connection.ts';
import { runWithLearnerId } from '../server/db/learner-context.ts';
import { bootstrapLearner } from '../server/db/identity.ts';
import { recordReviewSessionSummary } from '../server/db/persistence.ts';
import { claimSessionDebrief, enqueueSessionDebrief, finishSessionDebrief, getSessionDebrief,
  retrySessionDebrief } from '../server/db/session-debrief.ts';
import { createSessionDebriefWorker } from '../server/session-debrief/worker.ts';
import type { SessionDebriefResult } from '../src/domain/session-debrief.ts';

let dir: string;
let sequence = 0;
const start = Date.parse('2026-10-01T00:00:00.000Z');
const at = (hours: number) => new Date(start + hours * 60 * 60 * 1000).toISOString();
const words = ['诗意', '诗意', '清风', ...Array.from({ length: 12 }, (_, i) => `词${i}`)];
const note = (...refs: string[]) => ({ text: 'A connection', refs, followUp: null });
function learner() {
  const id = `cooldown-${sequence++}`;
  bootstrapLearner({ learnerId: id });
  return <T>(work: () => T) => runWithLearnerId(id, work);
}
function enqueue(id: string, hours: number, inventory = words) {
  // The summary's client completion date is deliberately unrelated to server time.
  recordReviewSessionSummary({ sessionId: id, completedAt: at(-1000), completedReviewActionCount: 0,
    failedReviewActionCount: 0, activeDurationMs: 0 });
  enqueueSessionDebrief(id, at(-1000), inventory.map((word) => ({ word, pinyin: '' })), at(hours));
}
function claim(id: string, hours: number, token = id) {
  return claimSessionDebrief(id, token, at(hours), at(hours + 1));
}
function finish(id: string, hours: number, result: SessionDebriefResult | null, token = id) {
  return finishSessionDebrief({ sessionId: id, token, completedAt: at(hours), durationMs: 0,
    result, error: result ? null : 'failure', errorCode: result ? null : 'generation_failed', metadata: null });
}
function connect(id: string, hours: number, notes = [note('w1')], inventory = words) {
  enqueue(id, hours, inventory);
  assert.ok(claim(id, hours));
  assert.equal(finish(id, hours, { notes }), true);
}

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'debrief-cooldown-'));
  process.env.APP_MODE = 'study'; process.env.APP_AUTH_MODE = 'clerk'; process.env.APP_DATA_DIR = dir;
  await import('../server/db.ts');
});
after(() => { getDb().close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('two distinct connected sessions suppress all matching rows; duplicate notes and unreferenced words do not count', () => {
  learner()(() => {
    connect('first', 0, [note('w1', 'w2'), note('w1')]);
    enqueue('second', 24);
    assert.equal(claim('second', 24)!.items.length, 15, 'one session allows a second connection');
    finish('second', 24, { notes: [note('w2')] });
    enqueue('third', 48);
    const input = claim('third', 48)!;
    assert.deepEqual(input.items.map((item) => item.word), words.slice(2));
    assert.equal(input.items[0].ref, 'w3', 'references still identify original rows');
    assert.equal(getSessionDebrief('third')!.exerciseCount, 15, 'threshold uses covered exercises');
    const stored = JSON.parse(String(getDb().prepare(`SELECT input_json FROM learner_session_debrief_jobs WHERE session_id = 'third'`).get()!.input_json));
    assert.equal(stored.items.length, 15);
    assert.deepEqual(stored.excludedRefs, ['w1', 'w2']);
    assert.equal('excludedRefs' in input, false, 'selection metadata is not sent to the provider');
    assert.throws(() => finish('third', 48, { notes: [note('w1')] }), /Invalid debrief/);
    finish('third', 48, { notes: [note('w3')] });
  });
});

test('rolling 72-hour boundary expires independently; suppressed appearances do not extend it', () => {
  learner()(() => {
    connect('boundary-first', 0);
    connect('boundary-second', 24);
    enqueue('boundary-before', 72 - 1 / 3600000);
    assert.equal(claim('boundary-before', 72)!.items.some((item) => item.word === '诗意'), false);
    finish('boundary-before', 72, { notes: [] });
    enqueue('boundary-exact', 72);
    assert.equal(claim('boundary-exact', 72)!.items.length, 15);
    finish('boundary-exact', 72, { notes: [] });
  });
});

test('history is learner-private and excludes failed, pending, empty, and future results', () => {
  const other = learner();
  other(() => { connect('other-first', 0); connect('other-second', 1); });
  learner()(() => {
    connect('eligible-once', 0);
    enqueue('failed', 1); claim('failed', 1); finish('failed', 1, null);
    enqueue('pending', 2);
    connect('empty', 3, []);
    connect('future', 100);
    enqueue('eligible', 4);
    assert.equal(claim('eligible', 4)!.items.length, 15);
    finish('eligible', 4, { notes: [] });
    claim('pending', 4); finish('pending', 4, { notes: [] });
  });
});

test('duplicate finalization and retries preserve selection even after history expires', () => {
  learner()(() => {
    connect('retry-first', 0); connect('retry-second', 1);
    enqueue('retry-target', 2);
    const input = claim('retry-target', 2)!;
    finish('retry-target', 2, null);
    enqueueSessionDebrief('retry-target', at(100), [{ word: 'different', pinyin: '' }], at(100));
    retrySessionDebrief('retry-target');
    assert.deepEqual(claim('retry-target', 100, 'retry-token'), input);
    finish('retry-target', 100, { notes: [] }, 'retry-token');
  });
});

test('slash alternatives share word history and preserve whole rows and pinyin', () => {
  learner()(() => {
    const alternatives = ['诗意 / 清风', ...words.slice(1)];
    connect('alternatives-first', 0, [note('w1')], alternatives);
    connect('alternatives-second', 1, [note('w1')], alternatives);
    enqueue('alternatives-next', 2, ['新词 / 清风', ...words.slice(1)]);
    const input = claim('alternatives-next', 2)!;
    assert.deepEqual(input.items.map((item) => item.word), words.slice(3));
    finish('alternatives-next', 2, { notes: [] });
  });
});

test('existing ready snapshots without exclusions contribute history and old queued snapshots remain claimable', () => {
  learner()(() => {
    for (const [id, status] of [['legacy-ready', 'ready'], ['legacy-queued', 'queued']] as const) {
      recordReviewSessionSummary({ sessionId: id, completedAt: at(-1000), completedReviewActionCount: 0,
        failedReviewActionCount: 0, activeDurationMs: 0 });
      getDb().prepare(`INSERT INTO learner_session_debrief_jobs
        (learner_id, session_id, completed_at, exercise_count, input_json, status, result_json, updated_at)
        SELECT learner_id, session_id, ?, 15, ?, ?, ?, ? FROM learner_owned_review_session_summaries WHERE session_id = ?`)
        .run(at(-1000), JSON.stringify({ schemaVersion: 'session_debrief_input.v1', sessionDate: at(-1000),
          interests: [], items: words.map((word, i) => ({ word, pinyin: '', ref: `w${i + 1}` })) }),
        status, status === 'ready' ? JSON.stringify({ notes: [note('w1')] }) : null, at(0), id);
    }
    connect('legacy-second', 1);
    enqueue('legacy-next', 2);
    assert.equal(claim('legacy-next', 2)!.items.some((item) => item.word === '诗意'), false);
    finish('legacy-next', 2, { notes: [] });
    assert.equal(claim('legacy-queued', 2)!.items.length, 15);
    finish('legacy-queued', 2, { notes: [] });
  });
});

test('fully filtered sessions become ready-empty without attempts or provider work', async () => {
  const owner = learner();
  owner(() => {
    const same = Array.from({ length: 15 }, () => '重复');
    connect('all-first', 0, [note('w1')], same);
    connect('all-second', 1, [note('w1')], same);
    enqueue('all-third', 2, same);
    const job = getSessionDebrief('all-third')!;
    assert.equal(job.status, 'ready'); assert.deepEqual(job.notes, []);
    assert.equal(job.exerciseCount, 15); assert.equal(job.attemptCount, 0);
    assert.equal(claim('all-third', 2), null);
  });
  let calls = 0;
  const worker = createSessionDebriefWorker({ now: () => start + 2 * 3600000,
    controls: () => ({ maintenanceMode: false, providerWorkEnabled: true }), providerWork: async (work) => work(),
    provider: { isConfigured: () => true, generate: async () => { calls++; throw new Error('unexpected call'); } } });
  assert.equal(await worker.step(), false); assert.equal(calls, 0); await worker.stop();
});
