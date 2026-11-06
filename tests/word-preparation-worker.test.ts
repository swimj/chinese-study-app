import { createVocabularySense,establishVocabularySenseCatalog,getVocabularySenseCatalog } from '../server/db/vocabulary-content.ts';
import { writeVocabularyDefaultUsefulSenses } from '../server/db/vocabulary-sense-coverage.ts';
import { requireLearnerId, runWithLearnerId } from '../server/db/learner-context.ts';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, test } from 'node:test';
import { createBaselineFixture } from './helpers/baseline-database.ts';
import { migrateDatabase } from '../server/db/migrations.ts';
import { getDb, setDb } from '../server/db/connection.ts';
import { wordContentFixtures } from './fixtures/word-content.ts';
import {
  enqueueWordPreparation as enqueue, getWordPreparationWork, listWordPreparationFailures,
  retryWordPreparation as retry, beginWordPreparationAttempt, recoverExpiredWordPreparation,
  failWordPreparationAttempt, markWordPreparationReady,
} from '../server/db/preparation-work.ts';
import { getSharedWordIntroductionPreparation, claimSharedWordIntroductionStage } from '../server/db/word-introductions.ts';
import { quarantineSharedContentPublication } from '../server/db/shared-content.ts';
import { createSharedWordPreparation } from '../server/word-content/shared-preparation.ts';
import { createWordPreparationWorker } from '../server/word-content/preparation-worker.ts';
import { retryPreparationWithReadiness } from '../server/word-content/retry-preparation.ts';
import type { WordIntroductionProvider } from '../server/word-content/provider.ts';

const enqueueWordPreparation: typeof enqueue = (...args) => runWithLearnerId('test-learner', () => enqueue(...args));
const retryWordPreparation: typeof retry = (...args) => runWithLearnerId('test-learner', () => retry(...args));
const fixture = wordContentFixtures[0]!;
let dataDir: string;
let sqlite: DatabaseSync;
before(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'preparation-worker-'));
  createBaselineFixture(dataDir);
  sqlite = new DatabaseSync(path.join(dataDir, 'app.db'));
  sqlite.function('current_learner_id', () => { throw new Error('Background work must not consult private context'); });
  migrateDatabase(sqlite);
  setDb(sqlite);
  sqlite.prepare(`INSERT INTO learners (learner_id, display_name, created_at) VALUES ('test-learner', 'Test', '2026-01-01')`).run();
});
after(() => { sqlite.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
function word(id: string) {
  const value = fixture.content.word;
  sqlite.prepare(`INSERT INTO lexical_words
    (id, hanzi, traditional, pinyin, meaning, meanings_json, examples_json, priority, created_at)
    VALUES (?, ?, ?, ?, 'meaning', '["meaning"]', '[]', 10, ?)`)
    .run(id, value.hanzi, value.traditional, value.pinyin, new Date().toISOString());
  const ids=fixture.content.uses.map(use=>createVocabularySense({senseId:`${id}:${use.id}`,wordId:id,description:{label:use.label,notes:[...use.notes]}},{kind:'service',id:'fixture'}).senseId);
  establishVocabularySenseCatalog(id,getVocabularySenseCatalog(id).version,{kind:'service',id:'fixture'});
  writeVocabularyDefaultUsefulSenses(id,0,ids,{kind:'service',id:'fixture'});

}
function fake(overrides: Partial<WordIntroductionProvider> = {}): WordIntroductionProvider {
  return {
    model: 'test', isConfigured: () => true,
    generateBootstrap: async input => ({ uses: fixture.content.uses.map((use,index)=>({...use,id:input.canonicalSenses![index]!.senseId})), examples: fixture.content.examples }),
    generationKey: async (stage) => `test-${stage}-v1`,
    generateTeaching: async content => ({ beats: fixture.teaching.beats.map(beat=>({...beat,parts:beat.parts.map(part=>part.kind==='use_note'?{...part,useId:content.uses[fixture.content.uses.findIndex(use=>use.id===part.useId)]!.id}:part)})) }),
    generatePractice: async () => ({ rehearsals: [{ id: 'rehearsal', stimulus: { kind: 'direct_text', text: 'Recall the expression.' } }] }),
    generateReview: async () => ({ exercises: [{ id: 'cue', cueType: 'circumstance',
      stimulus: { kind: 'direct_text', text: 'Tell a colleague formally that their request has been recorded.' }, supplement: null }] }),
    ...overrides,
  };
}
const controls = () => ({ maintenanceMode: false, providerWorkEnabled: true });
const providerWork = async <T>(work: () => Promise<T>) => work();

function overrideDatabaseMethods(overrides: Partial<Pick<DatabaseSync, 'prepare' | 'exec'>>) {
  const descriptors = Object.getOwnPropertyDescriptors(sqlite);
  Object.assign(getDb(), overrides);
  return () => {
    for (const method of Object.keys(overrides)) {
      const descriptor = descriptors[method];
      if (descriptor) Object.defineProperty(sqlite, method, descriptor);
      else Reflect.deleteProperty(sqlite, method);
    }
  };
}

function runningPreparation(id: string, clock: number, leaseMs: number) {
  word(id);
  const startedAt = new Date(clock).toISOString();
  const expiresAt = new Date(clock + leaseMs).toISOString();
  const work = enqueueWordPreparation(id, 'bootstrap', startedAt);
  assert.equal(claimSharedWordIntroductionStage(id, 'bootstrap', id, startedAt, expiresAt), 'claimed');
  assert.ok(beginWordPreparationAttempt(work.workId, id, null, startedAt, expiresAt));
  return work;
}

test('idle recovery and dispatch do not contend with another SQLite writer', async () => {
  const clock = Date.now();
  const work = runningPreparation('unexpired-read-only', clock, 60_000);
  const writer = new DatabaseSync(path.join(dataDir, 'app.db'));
  const worker = createWordPreparationWorker({ controls, providerWork, provider: fake(), now: () => clock });
  writer.exec('BEGIN IMMEDIATE');
  try {
    // A second BEGIN IMMEDIATE would fail here, even without updating any rows.
    recoverExpiredWordPreparation(new Date(clock).toISOString());
    assert.equal(await worker.step(), false);
    assert.equal(getWordPreparationWork(work.wordId, work.stage)?.status, 'running');
  } finally {
    writer.exec('ROLLBACK');
    writer.close();
    await worker.stop();
  }
  recoverExpiredWordPreparation(new Date(clock + 60_001).toISOString());
  const resumed = createWordPreparationWorker({ controls, providerWork, provider: fake(), now: () => clock + 90_001 });
  try { await resumed.drain(); } finally { await resumed.stop(); }
});

test('recovery rechecks leases after acquiring the write lock instead of trusting the preflight', async () => {
  const clock = Date.now();
  const renewed = runningPreparation('renewed-between-check-and-lock', clock, 1_000);
  const expired = runningPreparation('expired-between-check-and-lock', clock, 60_000);
  const writer = new DatabaseSync(path.join(dataDir, 'app.db'));
  const db = getDb();
  const exec = db.exec.bind(db);
  let acquisitions = 0;
  const restore = overrideDatabaseMethods({ exec: sql => {
    if (sql === 'BEGIN IMMEDIATE') {
      acquisitions++;
      // Another connection changes which job is expired after the read hint.
      writer.exec('BEGIN IMMEDIATE');
      writer.prepare('UPDATE word_preparation_work SET expires_at=? WHERE work_id=?')
        .run(new Date(clock + 60_000).toISOString(), renewed.workId);
      writer.prepare('UPDATE word_preparation_work SET expires_at=? WHERE work_id=?')
        .run(new Date(clock + 1_000).toISOString(), expired.workId);
      writer.exec('COMMIT');
    }
    exec(sql);
  } });
  try {
    recoverExpiredWordPreparation(new Date(clock + 2_000).toISOString());
    assert.equal(acquisitions, 1);
    assert.equal(getWordPreparationWork(renewed.wordId, renewed.stage)?.status, 'running');
    assert.equal(sqlite.prepare('SELECT outcome FROM word_preparation_attempts WHERE attempt_id=?').get(renewed.wordId)!.outcome, null);
    assert.equal(getWordPreparationWork(expired.wordId, expired.stage)?.status, 'queued');
    assert.equal(sqlite.prepare('SELECT outcome FROM word_preparation_attempts WHERE attempt_id=?').get(expired.wordId)!.outcome, 'interrupted');
  } finally { restore(); writer.close(); }
  recoverExpiredWordPreparation(new Date(clock + 60_001).toISOString());
  const resumed = createWordPreparationWorker({ controls, providerWork, provider: fake(), now: () => clock + 90_001 });
  try { await resumed.drain(); } finally { await resumed.stop(); }
});

test('explicit steps do not bypass the 30-second recovery cadence or delay queued work', async () => {
  let clock = Date.now();
  const start = clock;
  let maintenanceMode = false;
  const worker = createWordPreparationWorker({ provider: fake(), providerWork, now: () => clock,
    controls: () => ({ maintenanceMode, providerWorkEnabled: true }) });
  const prepare = getDb().prepare.bind(getDb());
  let recoveryReads = 0;
  const restore = overrideDatabaseMethods({ prepare: sql => {
    if (/SELECT 1 FROM word_preparation_work/.test(sql)) recoveryReads++;
    return prepare(sql);
  } });
  try {
    assert.equal(await worker.step(), false);
    assert.equal(recoveryReads, 1);
    const expired = runningPreparation('expired-after-idle-check', start, 1_000);
    clock = start + 5_000;
    word('dispatch-between-recovery-checks');
    enqueueWordPreparation('dispatch-between-recovery-checks', 'bootstrap', new Date(clock).toISOString());
    await worker.drain();
    assert.equal(getWordPreparationWork('dispatch-between-recovery-checks', 'bootstrap')?.status, 'ready');
    for (const elapsed of [10_000, 15_000, 20_000, 25_000, 29_999]) {
      clock = start + elapsed;
      assert.equal(await worker.step(), false);
    }
    assert.equal(recoveryReads, 1);
    assert.equal(getWordPreparationWork(expired.wordId, expired.stage)?.status, 'running');
    clock = start + 30_000;
    assert.equal(await worker.step(), false);
    assert.equal(recoveryReads, 2);
    assert.equal(getWordPreparationWork(expired.wordId, expired.stage)?.status, 'queued');
    clock = start + 60_000;
    maintenanceMode = true;
    assert.equal(await worker.step(), false);
    assert.equal(recoveryReads, 2);
    maintenanceMode = false;
    await worker.drain();
    assert.equal(recoveryReads, 3);
    assert.equal(getWordPreparationWork(expired.wordId, expired.stage)?.status, 'ready');
  } finally { restore(); await worker.stop(); }
});

test('a failed recovery read is retried on the next step without waiting 30 seconds', async () => {
  const worker = createWordPreparationWorker({ controls, providerWork, provider: fake() });
  const prepare = getDb().prepare.bind(getDb());
  let recoveryReads = 0;
  const restore = overrideDatabaseMethods({ prepare: sql => {
    if (/SELECT 1 FROM word_preparation_work/.test(sql) && ++recoveryReads === 1) throw new Error('Temporary read failure');
    return prepare(sql);
  } });
  try {
    await assert.rejects(worker.step(), /Temporary read failure/);
    assert.equal(await worker.step(), false);
    assert.equal(recoveryReads, 2);
  } finally { restore(); await worker.stop(); }
});

test('30-second fallback dispatch catches missed wakes and retries while explicit wakes run immediately', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.now() });
  const settle = () => new Promise<void>(resolve => setImmediate(resolve));
  let calls = 0;
  let failNext = false;
  const base = fake();
  const worker = createWordPreparationWorker({ controls, providerWork, provider: fake({
    generateBootstrap: async input => {
      calls++;
      if (failNext) { failNext = false; return { uses: [], examples: [] }; }
      return base.generateBootstrap(input);
    },
  }) });
  try {
    worker.wake();
    await settle();
    word('missed-wake-dispatch');
    enqueueWordPreparation('missed-wake-dispatch', 'bootstrap');
    t.mock.timers.tick(29_999); await settle();
    assert.equal(calls, 0);
    assert.equal(getWordPreparationWork('missed-wake-dispatch', 'bootstrap')?.status, 'queued');
    t.mock.timers.tick(1); await settle();
    assert.equal(calls, 1);
    assert.equal(getWordPreparationWork('missed-wake-dispatch', 'bootstrap')?.status, 'ready');

    word('immediate-wake-retry');
    enqueueWordPreparation('immediate-wake-retry', 'bootstrap');
    failNext = true;
    worker.wake(); await settle();
    assert.equal(calls, 2, 'explicit wake dispatches without waiting for the next interval');
    assert.equal(getWordPreparationWork('immediate-wake-retry', 'bootstrap')?.attemptCount, 1);
    t.mock.timers.tick(29_999); await settle();
    assert.equal(calls, 2);
    t.mock.timers.tick(1); await settle();
    assert.equal(calls, 3);
    assert.equal(getWordPreparationWork('immediate-wake-retry', 'bootstrap')?.status, 'ready');
    assert.equal(getWordPreparationWork('immediate-wake-retry', 'bootstrap')?.attemptCount, 2);
  } finally { await worker.stop(); t.mock.timers.reset(); }
});

test('maintenance polls only service controls and defers expired recovery until reopening', async () => {
  word('maintenance-recovery');
  let clock = Date.now();
  const startedAt = new Date(clock).toISOString();
  const expiresAt = new Date(clock + 1_000).toISOString();
  const work = enqueueWordPreparation('maintenance-recovery', 'bootstrap', startedAt);
  assert.equal(claimSharedWordIntroductionStage(work.wordId, work.stage, 'expired-maintenance', startedAt, expiresAt), 'claimed');
  assert.ok(beginWordPreparationAttempt(work.workId, 'expired-maintenance', null, startedAt, expiresAt));
  const original = getWordPreparationWork(work.wordId, work.stage);
  clock += 2_000;
  const worker = createWordPreparationWorker({ provider: fake(), now: () => clock });
  let restoreDatabaseMethods = () => {};
  sqlite.prepare("UPDATE service_controls SET enabled=1 WHERE control_key='maintenance_mode'").run();
  try {
    // Exercise the production control reader, but fail on recovery transactions or queue reads.
    const db = getDb();
    const prepare = db.prepare.bind(db);
    let controlReads = 0;
    restoreDatabaseMethods = overrideDatabaseMethods({
      prepare: sql => {
        controlReads++;
        assert.match(sql, /FROM service_controls/);
        return prepare(sql);
      },
      exec: () => assert.fail('Maintenance must not open a recovery transaction'),
    });
    assert.equal(await worker.step(), false);
    await worker.drain();
    assert.ok(controlReads > 0);
    restoreDatabaseMethods();
    assert.deepEqual(getWordPreparationWork(work.wordId, work.stage), original);

    // Recovery is independent of provider dispatch once maintenance ends.
    sqlite.prepare("UPDATE service_controls SET enabled=0 WHERE control_key IN ('maintenance_mode','provider_work_enabled')").run();
    assert.equal(await worker.step(), false);
    const recovered = getWordPreparationWork(work.wordId, work.stage)!;
    assert.equal(recovered.status, 'queued');
    assert.equal(recovered.attemptCount, 1);
    assert.equal(recovered.activeToken, null);
    assert.equal(sqlite.prepare("SELECT outcome FROM word_preparation_attempts WHERE attempt_id='expired-maintenance'").get()!.outcome, 'interrupted');

    sqlite.prepare("UPDATE service_controls SET enabled=1 WHERE control_key='provider_work_enabled'").run();
    clock += 31_000;
    await worker.drain();
    assert.equal(getWordPreparationWork(work.wordId, work.stage)?.status, 'ready');
    assert.equal(getWordPreparationWork(work.wordId, work.stage)?.attemptCount, 2);
  } finally {
    restoreDatabaseMethods();
    await worker.stop();
    sqlite.prepare("UPDATE service_controls SET enabled=0 WHERE control_key='maintenance_mode'").run();
    sqlite.prepare("UPDATE service_controls SET enabled=1 WHERE control_key='provider_work_enabled'").run();
  }
});

test('expired recovery still runs with an unconfigured provider outside maintenance', async () => {
  word('unconfigured-recovery');
  const clock = Date.now();
  const startedAt = new Date(clock).toISOString();
  const expiresAt = new Date(clock + 1_000).toISOString();
  const work = enqueueWordPreparation('unconfigured-recovery', 'bootstrap', startedAt);
  assert.equal(claimSharedWordIntroductionStage(work.wordId, work.stage, 'expired-unconfigured', startedAt, expiresAt), 'claimed');
  assert.ok(beginWordPreparationAttempt(work.workId, 'expired-unconfigured', null, startedAt, expiresAt));
  const worker = createWordPreparationWorker({ controls, providerWork,
    provider: fake({ isConfigured: () => false }), now: () => clock + 2_000 });
  try {
    assert.equal(await worker.step(), false);
    assert.equal(getWordPreparationWork(work.wordId, work.stage)?.status, 'queued');
    assert.equal(getWordPreparationWork(work.wordId, work.stage)?.attemptCount, 1);
  } finally { await worker.stop(); }
  const resumed = createWordPreparationWorker({ controls, providerWork, provider: fake(), now: () => clock + 33_000 });
  try { await resumed.drain(); } finally { await resumed.stop(); }
});

test('stopped worker steps do not read controls or access the database', async () => {
  const worker = createWordPreparationWorker({ provider: fake(),
    controls: () => assert.fail('Stopped worker must not read controls') });
  await worker.stop();
  setDb(null);
  try {
    assert.equal(await worker.step(), false);
    await worker.drain();
    worker.wake();
  } finally { setDb(sqlite); }
});

test('worker rechecks maintenance after provider-work admission before claiming an attempt', async () => {
  word('maintenance-admission');
  const work = enqueueWordPreparation('maintenance-admission', 'bootstrap');
  let maintenanceMode = false;
  const worker = createWordPreparationWorker({ provider: fake(),
    controls: () => ({ maintenanceMode, providerWorkEnabled: true }),
    providerWork: async work => { maintenanceMode = true; return work(); },
  });
  try {
    assert.equal(await worker.step(), false);
    assert.equal(getWordPreparationWork(work.wordId, work.stage)?.status, 'queued');
    assert.equal(getWordPreparationWork(work.wordId, work.stage)?.attemptCount, 0);
  } finally { await worker.stop(); }
  const resumed = createWordPreparationWorker({ controls, providerWork, provider: fake() });
  try { await resumed.drain(); } finally { await resumed.stop(); }
});

test('shared demand deduplicates, generates teaching without pins, and defers review until requested', async () => {
  word('dedup');
  let bootstraps = 0; let teachings = 0; let reviews = 0;
  const provider = fake();
  const worker = createWordPreparationWorker({ controls, providerWork, provider: fake({
    generateBootstrap: async (input) => { bootstraps++; return provider.generateBootstrap(input); },
    generateTeaching: async (input) => { teachings++; return provider.generateTeaching(input); },
    generateReview: async (input) => { reviews++; return provider.generateReview(input); },
  }) });
  const first = enqueueWordPreparation('dedup', 'teaching');
  assert.equal(enqueueWordPreparation('dedup', 'teaching').workId, first.workId);
  await Promise.all([worker.drain(), worker.drain()]);
  assert.deepEqual([bootstraps, teachings, reviews], [1, 1, 0]);
  assert.equal(getWordPreparationWork('dedup', 'teaching')?.status, 'ready');
  assert.equal((sqlite.prepare('SELECT COUNT(*) AS n FROM learner_word_introduction_events').get() as { n: number }).n, 0);
  enqueueWordPreparation('dedup', 'review');
  await worker.drain();
  assert.equal(reviews, 1);
  assert.equal(getWordPreparationWork('dedup', 'review')?.status, 'ready');
  await worker.stop();
});

test('finish a runnable lesson before bootstrapping the rest of a cold reserve', async () => {
  for (const id of ['pipeline-a', 'pipeline-b', 'pipeline-c']) word(id);
  const clock = Date.now();
  enqueueWordPreparation('pipeline-a', 'bootstrap', new Date(clock - 4).toISOString());
  enqueueWordPreparation('pipeline-b', 'bootstrap', new Date(clock - 3).toISOString());
  enqueueWordPreparation('pipeline-c', 'bootstrap', new Date(clock - 2).toISOString());
  enqueueWordPreparation('pipeline-a', 'teaching', new Date(clock - 1).toISOString());
  const calls: string[] = [];
  const provider = fake();
  const worker = createWordPreparationWorker({ concurrency: 1, controls, providerWork, now: () => clock, provider: fake({
    generateBootstrap: async (input) => { calls.push('bootstrap'); return provider.generateBootstrap(input); },
    generateTeaching: async (input) => { calls.push('teaching'); return provider.generateTeaching(input); },
  }) });
  await worker.step();
  await worker.step();
  assert.deepEqual(calls, ['bootstrap', 'teaching']);
  assert.equal(getWordPreparationWork('pipeline-a', 'teaching')?.status, 'ready');
  assert.equal(getWordPreparationWork('pipeline-b', 'bootstrap')?.attemptCount, 0);
  await worker.drain();
  await worker.stop();
});

test('three validation failures pause shared stage; prior bootstrap survives; operator retry is audited', async () => {
  word('failure');
  let clock = Date.now();
  let bootstrapCalls = 0;
  const provider = fake();
  const worker = createWordPreparationWorker({ controls, providerWork, now: () => clock, provider: fake({
    generateBootstrap: async (input) => { bootstrapCalls++; return provider.generateBootstrap(input); },
    generateTeaching: async () => ({ beats: [], rehearsals: [] }),
  }) });
  enqueueWordPreparation('failure', 'teaching', new Date(clock).toISOString());
  for (let i = 0; i < 3; i++) {
    await worker.drain();
    clock += 120_000;
  }
  const work = getWordPreparationWork('failure', 'teaching')!;
  assert.equal(work.status, 'paused');
  assert.equal(work.attemptCount, 3);
  assert.equal(bootstrapCalls, 1);
  assert.ok(getSharedWordIntroductionPreparation('failure')?.contentId);
  assert.equal(enqueueWordPreparation('failure', 'teaching').status, 'paused');
  const diagnostic = listWordPreparationFailures().find((item) => item.workId === work.workId)!;
  assert.equal(diagnostic.attempts.length, 3);
  assert.ok(diagnostic.lastError);
  retryWordPreparation(work.workId, 'operator-1', new Date(clock).toISOString());
  assert.equal(getWordPreparationWork('failure', 'teaching')?.attemptCount, 0);
  assert.equal((sqlite.prepare('SELECT actor_id FROM word_preparation_retry_events WHERE work_id = ?').get(work.workId) as { actor_id: string }).actor_id, 'operator-1');
  await worker.stop();
  const retry = createWordPreparationWorker({ controls, providerWork, now: () => clock, provider: fake() });
  await retry.drain();
  assert.equal(getWordPreparationWork('failure', 'teaching')?.status, 'ready');
  await retry.stop();
});

test('operator retry composes with readiness orchestration and preserves caller rollback', () => {
  word('nested-retry');
  const work = enqueueWordPreparation('nested-retry', 'bootstrap');
  sqlite.prepare("UPDATE word_preparation_work SET status='paused',attempt_count=3,last_error='Invalid output' WHERE work_id=?").run(work.workId);
  sqlite.exec('BEGIN IMMEDIATE');
  try {
    runWithLearnerId('test-learner', () => retryPreparationWithReadiness(work.workId, 'operator-nested'));
    assert.equal(sqlite.isTransaction, true);
    assert.equal(getWordPreparationWork('nested-retry', 'bootstrap')!.status, 'queued');
    assert.equal(sqlite.prepare('SELECT count(*) n FROM word_preparation_retry_events WHERE work_id=?').get(work.workId)!.n, 1);
  } finally {
    sqlite.exec('ROLLBACK');
  }
  assert.equal(getWordPreparationWork('nested-retry', 'bootstrap')!.status, 'paused');
  assert.equal(sqlite.prepare('SELECT count(*) n FROM word_preparation_retry_events WHERE work_id=?').get(work.workId)!.n, 0);
  runWithLearnerId('test-learner', () => retryPreparationWithReadiness(work.workId, 'operator-nested'));
  assert.equal(getWordPreparationWork('nested-retry', 'bootstrap')!.status, 'queued');
  assert.throws(() => runWithLearnerId('test-learner', () => retryPreparationWithReadiness(work.workId, 'operator-nested')), /Only paused preparation/);
  assert.equal(sqlite.isTransaction, false);
});

test('expired attempt recovery preserves budget across restart and fences stale completion', async () => {
  word('crash');
  let clock = Date.now();
  const start = new Date(clock).toISOString();
  const expiry = new Date(clock + 1000).toISOString();
  const work = enqueueWordPreparation('crash', 'bootstrap', start);
  assert.equal(claimSharedWordIntroductionStage('crash', 'bootstrap', 'dead-process', start, expiry), 'claimed');
  assert.ok(beginWordPreparationAttempt(work.workId, 'dead-process', null, start, expiry));
  recoverExpiredWordPreparation(start);
  assert.equal(getWordPreparationWork('crash', 'bootstrap')?.status, 'running');
  clock += 2000;
  recoverExpiredWordPreparation(new Date(clock).toISOString());
  assert.equal(getWordPreparationWork('crash', 'bootstrap')?.attemptCount, 1);
  assert.equal(getWordPreparationWork('crash', 'bootstrap')?.status, 'queued');
  clock += 31_000;
  const worker = createWordPreparationWorker({ controls, providerWork, now: () => clock, provider: fake() });
  await worker.drain();
  assert.equal(getWordPreparationWork('crash', 'bootstrap')?.attemptCount, 2);
  failWordPreparationAttempt(work.workId, 'dead-process', 'stale', new Date(clock).toISOString());
  markWordPreparationReady(work.workId, new Date(clock).toISOString(), 'dead-process');
  assert.equal(getWordPreparationWork('crash', 'bootstrap')?.status, 'ready');
  await worker.stop();
});

test('crash after publication on attempt three recovers authoritative success instead of pausing', async () => {
  word('published-crash');
  let clock = Date.now();
  const work = enqueueWordPreparation('published-crash', 'bootstrap', new Date(clock).toISOString());
  const worker = createWordPreparationWorker({ controls, providerWork, now: () => clock,
    provider: fake({ generateBootstrap: async () => ({ uses: [], examples: [] }) }),
  });
  for (let attempt = 0; attempt < 2; attempt++) { await worker.drain(); clock += 61_000; }
  await worker.stop();
  const shared = createSharedWordPreparation(fake());
  const start = new Date(clock).toISOString();
  const expires = new Date(clock + 300_000).toISOString();
  assert.equal(shared.claim('published-crash', 'bootstrap', 'published-token', start, expires), 'claimed');
  assert.ok(beginWordPreparationAttempt(work.workId, 'published-token', null, start, expires));
  await shared.generate('published-crash', 'bootstrap', 'published-token');
  // Simulate process death before markWordPreparationReady.
  recoverExpiredWordPreparation(new Date(clock + 300_001).toISOString());
  const recovered = getWordPreparationWork('published-crash', 'bootstrap')!;
  assert.equal(recovered.status, 'ready');
  assert.equal(recovered.attemptCount, 3);
  assert.equal(recovered.lastError, null);
  assert.equal((sqlite.prepare(`SELECT outcome FROM word_preparation_attempts WHERE attempt_id = 'published-token'`).get() as { outcome: string }).outcome, 'ready');
});

test('withdrawn published content pauses once without spending or starving later words', async () => {
  word('withdrawn'); word('after-withdrawn');
  const shared = createSharedWordPreparation(fake());
  const start = new Date().toISOString();
  const expires = new Date(Date.now() + 300_000).toISOString();
  for (const stage of ['bootstrap', 'teaching'] as const) {
    const token = `withdrawn:${stage}`;
    assert.equal(shared.claim('withdrawn', stage, token, start, expires), 'claimed');
    await shared.generate('withdrawn', stage, token);
  }
  const publication = sqlite.prepare(`SELECT publication_id FROM shared_content_publications
    WHERE content_kind = 'teaching_package' AND learning_purpose_key = 'withdrawn'`).get() as { publication_id: string };
  quarantineSharedContentPublication({ publicationId: publication.publication_id, operatorId: 'test-operator', reason: 'incorrect' });
  enqueueWordPreparation('withdrawn', 'teaching', start);
  enqueueWordPreparation('after-withdrawn', 'teaching', start);
  const worker = createWordPreparationWorker({ controls, providerWork, concurrency: 1, provider: fake() });
  await worker.drain();
  assert.equal(getWordPreparationWork('withdrawn', 'teaching')?.status, 'paused');
  assert.equal(getWordPreparationWork('withdrawn', 'teaching')?.attemptCount, 0);
  assert.equal(getWordPreparationWork('after-withdrawn', 'teaching')?.status, 'ready');
  assert.match(getWordPreparationWork('withdrawn', 'teaching')?.lastError ?? '', /withdrawn/);
  await worker.stop();
});

test('concurrent steps share a bounded batch and stop drains the active provider call', async () => {
  word('shutdown');
  let finish!: (value: unknown) => void;
  let calls = 0;let entered!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve;});
  const pendingOutput = new Promise<unknown>((resolve) => { finish = resolve; });
  const worker = createWordPreparationWorker({ controls, providerWork, concurrency: 1, provider: fake({
    generateBootstrap: async () => { calls++;entered(); return pendingOutput; },
  }) });
  enqueueWordPreparation('shutdown', 'bootstrap');
  const first = worker.step();
  const second = worker.step();
  assert.equal(first, second);
  await started;assert.equal(calls, 1);
  let stopped = false;
  const stopping = worker.stop().then(() => { stopped = true; });
  await Promise.resolve();
  assert.equal(stopped, false);
  finish({ uses: fixture.content.uses.map(use=>({...use,id:`shutdown:${use.id}`})), examples: fixture.content.examples });
  await stopping;
  assert.equal(getWordPreparationWork('shutdown', 'bootstrap')?.status, 'ready');
  assert.equal(calls, 1);
});

test('provider controls do not spend attempts; outages back off the worker and redact provider diagnostics', async () => {
  word('disabled'); word('outage');
  let clock = Date.now();
  enqueueWordPreparation('disabled', 'bootstrap', new Date(clock).toISOString());
  let disabled = true;
  const worker = createWordPreparationWorker({ concurrency: 1, providerWork, now: () => clock,
    controls: () => ({ maintenanceMode: disabled, providerWorkEnabled: !disabled }),
    provider: fake({ generateBootstrap: async () => { throw new Error('secret bearer abc123'); } }),
  });
  await worker.drain();
  assert.equal(getWordPreparationWork('disabled', 'bootstrap')?.attemptCount, 0);
  disabled = false;
  clock++;
  enqueueWordPreparation('outage', 'bootstrap', new Date(clock).toISOString());
  await worker.drain();
  assert.equal(getWordPreparationWork('disabled', 'bootstrap')?.attemptCount, 1);
  assert.equal(getWordPreparationWork('outage', 'bootstrap')?.attemptCount, 0);
  assert.doesNotMatch(getWordPreparationWork('disabled', 'bootstrap')?.lastError ?? '', /abc123/);
  clock += 60_001;
  await worker.drain();
  assert.equal(getWordPreparationWork('outage', 'bootstrap')?.attemptCount, 1);
  await worker.stop();
});


test('shared preparation preserves the requesting learner across background execution', async () => {
  word('attributed');
  const demand = enqueueWordPreparation('attributed', 'bootstrap');
  assert.equal(demand.requestedByLearnerId, 'test-learner');
  sqlite.prepare(`INSERT INTO learners (learner_id, display_name, created_at) VALUES ('second-learner', 'Second', '2026-01-01')`).run();
  runWithLearnerId('second-learner', () => enqueue('attributed', 'bootstrap'));
  assert.equal(getWordPreparationWork('attributed', 'bootstrap')?.requestedByLearnerId, 'test-learner');
  let observed: string | undefined;
  const provider = fake();
  const worker = createWordPreparationWorker({ controls, providerWork, provider: fake({
    generateBootstrap: async (input) => { observed = requireLearnerId(); return provider.generateBootstrap(input); },
  }) });
  await worker.drain();
  assert.equal(observed, 'test-learner');
  await worker.stop();
});

test('unattributed historical demand waits for a real requester', async () => {
  word('unattributed');
  const demand = enqueueWordPreparation('unattributed', 'bootstrap');
  sqlite.prepare('UPDATE word_preparation_work SET requested_by_learner_id = NULL WHERE work_id = ?').run(demand.workId);
  let calls = 0;
  const provider = fake();
  const worker = createWordPreparationWorker({ controls, providerWork, provider: fake({
    generateBootstrap: async (input) => { calls++; return provider.generateBootstrap(input); },
  }) });
  await worker.drain();
  assert.equal(calls, 0);
  assert.equal(getWordPreparationWork('unattributed', 'bootstrap')?.status, 'paused');
  enqueueWordPreparation('unattributed', 'bootstrap');
  await worker.drain();
  assert.equal(calls, 1);
  await worker.stop();
});

for (const failing of ['teaching', 'practice'] as const) {
  test(`retains successful introduction and waits for it across ${failing} failure and fresh worker retry`, async () => {
    const id = `component-retry-${failing}`; word(id);
    let clock = Date.now(); let fail = true;
    const calls = { teaching: 0, practice: 0 };
    const base = fake();
    const provider = fake({
      generateTeaching: async (input) => { calls.teaching++; if (fail && failing === 'teaching') throw new Error('temporary'); return base.generateTeaching(input); },
      generatePractice: async (input) => { calls.practice++; if (fail && failing === 'practice') throw new Error('temporary'); return base.generatePractice(input); },
    });
    const first = createWordPreparationWorker({ controls, providerWork, provider, now: () => clock });
    enqueueWordPreparation(id, 'teaching', new Date(clock).toISOString());
    await first.drain(); await first.stop();
    assert.equal(getSharedWordIntroductionPreparation(id)?.packageId, null);
    assert.deepEqual(calls, { teaching: 1, practice: failing === 'teaching' ? 0 : 1 });
    fail = false; clock += 120_000;
    const second = createWordPreparationWorker({ controls, providerWork, provider, now: () => clock });
    await second.drain(); await second.stop();
    assert.equal(getWordPreparationWork(id, 'teaching')?.status, 'ready');
    assert.deepEqual(calls, failing === 'teaching' ? { teaching: 2, practice: 1 } : { teaching: 1, practice: 2 });
    assert.ok(getSharedWordIntroductionPreparation(id)?.packageId);
  });
}


test('invalid teaching prevents speculative calls to the exercise provider', async () => {
  word('dual-failure');
  const { ProviderHttpError } = await import('../server/llm/types.ts');
  let practiceCalls=0;
  const prep = createSharedWordPreparation(fake({
    generateTeaching: async () => ({ beats: [] }),
    generatePractice: async () => { practiceCalls++;throw new ProviderHttpError('test', 429, 'rate limited', new Headers()); },
  }));
  const now = new Date(); const expiry = new Date(Date.now() + 300_000).toISOString();
  prep.claim('dual-failure','bootstrap','b',now.toISOString(),expiry);
  await prep.generate('dual-failure','bootstrap','b');
  prep.claim('dual-failure','teaching','t',now.toISOString(),expiry);
  await assert.rejects(prep.generate('dual-failure','teaching','t'),/beats/);
  assert.equal(practiceCalls,0);
  prep.release('dual-failure','teaching','t');
});
