import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { planUnstudiedStashAdmission, selectDeckDietWordIds } from '../server/db/unstudied-admission.ts';

const stash = Array.from({ length: 8 }, (_, index) => ({ id: `stash-${index}`, isTop: false, isRequired: false, overlayUpdatedAt: '2026-01-01' }));

test('pending stash and weighted deck candidates keep their intended slots', () => {
  const plan = planUnstudiedStashAdmission({ stash, remainingQuota: 6, seedSource: 'test', eligibleIds: new Set(['stash-1']) });
  assert.deepEqual(plan.selectedStashIds, ['stash-1']);
  assert.equal(plan.dietDemand, 3);
  assert.equal(planUnstudiedStashAdmission({ stash: [], remainingQuota: 6, seedSource: 'test' }).dietDemand, 6);
  const loaded: string[] = [];
  const selected = selectDeckDietWordIds({ targets: new Map([['first', 2], ['second', 2]]), spillDeckIds: ['third'], limit: 4,
    seedSource: 'test', eligibleIds: new Set(['second-1', 'second-2', 'third-1']),
    loadCandidatesForDeck: (deck) => { loaded.push(deck); return [`${deck}-1`, `${deck}-2`]; },
  });
  assert.deepEqual(new Set(selected), new Set(['second-1', 'second-2']));
  assert.deepEqual(loaded, ['first', 'second']);
});

test('reserve preference is stable but explicit tops displace ordinary stash', () => {
  const preferredIds = new Set(['stash-1', 'stash-2']);
  const choose = (seedSource: string) => planUnstudiedStashAdmission({ stash, remainingQuota: 2, source: 'stash_only', seedSource, preferredIds });
  assert.deepEqual(new Set(choose('day-one').selectedStashIds), preferredIds);
  assert.deepEqual(new Set(choose('day-two').selectedStashIds), preferredIds);
  const top = planUnstudiedStashAdmission({ stash: stash.map((item) => ({ ...item, isTop: item.id === 'stash-7' })),
    remainingQuota: 2, source: 'stash_only', seedSource: 'test', preferredIds });
  assert.equal(top.selectedStashIds[0], 'stash-7');
  assert.equal(top.selectedStashIds.length, 2);
});

test('reserve is private, bounded and stable; snapshots are read-only; review waits for actual study', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'preparation-reserve-'));
  process.env.APP_MODE = 'study'; process.env.APP_AUTH_MODE = 'clerk'; process.env.APP_DATA_DIR = directory;
  const db = await import('../server/db.ts');
  const persistence = await import('../server/db/persistence.ts');
  const reserve = await import('../server/db/word-reserve.ts');
  const work = await import('../server/db/preparation-work.ts');
  const { prepareSessionPayload } = await import('../server/word-content/session-preparation.ts');
  const sqlite = new DatabaseSync(path.join(directory, 'app.db'));
  sqlite.exec('PRAGMA foreign_keys = ON');
  sqlite.function('current_learner_id', () => 'reserve-a');
  try {
    for (const learnerId of ['reserve-a', 'reserve-b']) db.bootstrapLearner({ learnerId });
    for (let index = 0; index < 40; index += 1) {
      const id = `reserve-${index}`;
      sqlite.prepare(`INSERT INTO lexical_words (id, hanzi, traditional, pinyin, meaning, meanings_json, examples_json, priority, created_at)
        VALUES (?, '你好', NULL, 'nǐ hǎo', 'hello', '["hello"]', '[]', 10, '2026-01-01T00:00:00.000Z')`).run(id);
      for (const learnerId of ['reserve-a', 'reserve-b']) {
        sqlite.prepare(`INSERT INTO learner_owned_user_word_priority
          (learner_id, word_id, bump_count, force_top, priority_tier, required_for_next_session, updated_at)
          VALUES (?, ?, 1, 0, 0, 0, '2026-01-01T00:00:00.000Z')`).run(learnerId, id);
      }
    }
    await db.runWithLearnerId('reserve-a', async () => {
      db.setUnstudiedAdmissionSource('stash_only'); db.setDailyNewWordLimit(5);
      persistence.reconcileWordPreparationReserve('2026-10-01');
      const first = reserve.getWordReserveCandidates();
      assert.equal(first.length, 10);
      assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM word_preparation_work').get()!.count, 20);
      assert.equal(work.getWordPreparationWork(first[0]!, 'review'), null);
      sqlite.prepare(`UPDATE word_preparation_work SET status = 'paused', attempt_count = 3
        WHERE stage = 'bootstrap'`).run();
      persistence.reconcileWordPreparationReserve('2026-10-02');
      assert.deepEqual(reserve.getWordReserveCandidates(), first);
      assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM word_preparation_work').get()!.count, 20);
      assert.equal(persistence.inspectSessionPreparation('2026-10-01').pending, false);
      // Explicit operator action can restore work; mere visits above could not.
      for (const id of first) work.retryWordPreparation(work.getWordPreparationWork(id, 'bootstrap')!.workId, 'operator');
      persistence.reconcileWordPreparationReserve('2026-10-02');
      assert.deepEqual(reserve.getWordReserveCandidates(), first);
      assert.equal(persistence.getSessionPayload('2026-10-01').buckets.unstudied.length, 0);
      let elapsed = 0; let wakes = 0;
      const cold = await prepareSessionPayload('2026-10-01', { wake: () => { wakes += 1; }, budgetMs: 500,
        now: () => elapsed, wait: async (ms) => { elapsed += ms; } });
      assert.equal(elapsed, 500); assert.equal(wakes, 1); assert.equal(cold.preparation.pending, true);
      const wordId = first[0]!;
      const content = { schemaVersion: 1 as const, id: 'reserve-content', word: { wordId, hanzi: '你好', traditional: null, pinyin: 'nǐ hǎo' },
        uses: [{ id: 'use', label: 'greeting', notes: ['A greeting.'], exampleIds: ['example'] }],
        examples: [{ id: 'example', text: '你好！', translation: 'Hello!', pronunciation: 'nǐ hǎo' }] };
      db.saveWordContentDocument(content, 'fake');
      db.saveWordTeachingPackage({ schemaVersion: 1, id: 'reserve-package', wordContentId: content.id,
        beats: [{ id: 'beat', parts: [{ kind: 'example', exampleId: 'example', field: 'sentence' }] }],
        rehearsals: [{ id: 'rehearsal', responseMode: 'hanzi_entry', contract: { kind: 'target_rehearsal', wordId },
          instruction: 'Say hello', stimulus: { kind: 'direct_text', text: 'Hello' },
          acceptedAnswers: [{ wordId, hanzi: '你好', traditional: null }] }] }, 'fake');
      const payload = persistence.getSessionPayload('2026-10-01');
      assert.deepEqual(payload.buckets.unstudied.map((word) => word.id), [wordId]);
      assert.equal(payload.buckets.introductions?.[wordId]?.selectedPackageId, 'reserve-package');
      assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM learner_word_introduction_events').get()!.count, 0);
      assert.equal(work.getWordPreparationWork(wordId, 'review'), null);
      db.completeUnstudiedWordSession(wordId, '2026-10-01');
      assert.equal(work.getWordPreparationWork(wordId, 'review')?.status, 'queued');
      assert.ok(reserve.listPendingWordReserveLearners().includes('reserve-a'));
      persistence.reconcileWordPreparationReserve('2026-10-01');
      assert.equal(reserve.getWordReserveCandidates().length, 10);
      assert.ok(!reserve.getWordReserveCandidates().includes(wordId));
      db.setDailyNewWordLimit(20); persistence.reconcileWordPreparationReserve();
      assert.equal(reserve.getWordReserveCandidates().length, 39); // one already studied
      db.setDailyNewWordLimit(0); persistence.reconcileWordPreparationReserve();
      assert.deepEqual(reserve.getWordReserveCandidates(), []);
      assert.throws(() => db.setDailyNewWordLimit(21), /between 0 and 20/);
    });
    db.runWithLearnerId('reserve-b', () => { assert.deepEqual(reserve.getWordReserveCandidates(), []); });
  } finally { sqlite.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('migration caps all saved intake limits without provisioning dormant reserves', async () => {
  const { createBaselineFixture } = await import('./helpers/baseline-database.ts');
  const { migrateDatabase, schemaMigrations } = await import('../server/db/migrations.ts');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'reserve-migration-'));
  createBaselineFixture(directory);
  const sqlite = new DatabaseSync(path.join(directory, 'app.db'));
  sqlite.exec('PRAGMA foreign_keys = ON');
  sqlite.function('current_learner_id', () => 'old');
  try {
    migrateDatabase(sqlite, schemaMigrations.filter((item) => !item.id.endsWith('0019_word_preparation_reserve')));
    sqlite.prepare(`INSERT INTO learners (learner_id, display_name, created_at) VALUES ('old', 'Old', '2026-01-01')`).run();
    sqlite.prepare(`INSERT INTO learner_settings (learner_id, setting_key, value_json, updated_at)
      VALUES ('old', 'daily_new_word_limit', '100', '2026-01-01')`).run();
    migrateDatabase(sqlite);
    assert.equal(sqlite.prepare(`SELECT value_json FROM learner_settings WHERE learner_id = 'old'`).get()!.value_json, '20');
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM learner_word_preparation_reserve').get()!.count, 0);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM learner_word_reserve_requests').get()!.count, 0);
    assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { sqlite.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});
