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

test('migration caps all saved intake limits without provisioning dormant reserves', async () => {
  const { createBaselineFixture } = await import('./helpers/baseline-database.ts');
  const { migrateDatabase, schemaMigrations } = await import('../server/db/migrations.ts');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'reserve-migration-'));
  createBaselineFixture(directory);
  const sqlite = new DatabaseSync(path.join(directory, 'app.db'));
  sqlite.exec('PRAGMA foreign_keys = ON');
  sqlite.function('current_learner_id', () => 'old');
  try {
    const reserveMigrationIndex = schemaMigrations.findIndex((item) => item.id === 'app_schema:0019_word_preparation_reserve');
    migrateDatabase(sqlite, schemaMigrations.slice(0, reserveMigrationIndex));
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
