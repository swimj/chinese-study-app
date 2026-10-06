import { requireLearnerId, runWithLearnerId } from '../server/db/learner-context.ts';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, test } from 'node:test';
import { createBaselineFixture } from './helpers/baseline-database.ts';
import { migrateDatabase } from '../server/db/migrations.ts';
import { setDb } from '../server/db/connection.ts';
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

}
function fake(overrides: Partial<WordIntroductionProvider> = {}): WordIntroductionProvider {
  return {
    model: 'test', isConfigured: () => true,
    generateBootstrap: async () => ({ uses: fixture.content.uses, examples: fixture.content.examples }),
    generateTeaching: async () => ({ beats: fixture.teaching.beats,
      rehearsals: [{ id: 'rehearsal', stimulus: { kind: 'direct_text', text: 'Recall the expression.' } }] }),
    generateReview: async () => ({ exercises: [{ id: 'cue', cueType: 'circumstance',
      stimulus: { kind: 'direct_text', text: 'Tell a colleague formally that their request has been recorded.' }, supplement: null }] }),
    ...overrides,
  };
}
const controls = () => ({ maintenanceMode: false, providerWorkEnabled: true });
const providerWork = async <T>(work: () => Promise<T>) => work();

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
  let calls = 0;
  const pendingOutput = new Promise<unknown>((resolve) => { finish = resolve; });
  const worker = createWordPreparationWorker({ controls, providerWork, concurrency: 1, provider: fake({
    generateBootstrap: async () => { calls++; return pendingOutput; },
  }) });
  enqueueWordPreparation('shutdown', 'bootstrap');
  const first = worker.step();
  const second = worker.step();
  assert.equal(first, second);
  assert.equal(calls, 1);
  let stopped = false;
  const stopping = worker.stop().then(() => { stopped = true; });
  await Promise.resolve();
  assert.equal(stopped, false);
  finish({ uses: fixture.content.uses, examples: fixture.content.examples });
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
