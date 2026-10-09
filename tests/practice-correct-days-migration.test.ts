import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createBaselineFixture } from './helpers/baseline-database.ts';
import { migrateDatabase, schemaMigrations } from '../server/db/migrations.ts';

test('correct-day migration recovers latest successes without altering progress or other usage metrics', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'practice-days-migration-'));
  createBaselineFixture(dir);
  const db = new DatabaseSync(path.join(dir, 'app.db'));
  db.function('current_learner_id', () => 'a');
  try {
    const index = schemaMigrations.findIndex(m => m.id === 'app_schema:0035_practice_correct_days');
    migrateDatabase(db, schemaMigrations.slice(0, index));
    db.exec(`INSERT INTO learners (learner_id, display_name, created_at) VALUES ('a', 'A', 'now'), ('b', 'B', 'now');
      INSERT INTO lexical_words (id, hanzi, pinyin, meaning, examples_json, priority, created_at)
      VALUES ('w', '字', 'zi', 'word', '[]', 1, 'now'), ('reset', '清', 'qing', 'clear', '[]', 1, 'now');
      INSERT INTO learner_word_state (learner_id, word_id, status, learning_streak, last_learning_success_on)
      VALUES ('a', 'w', 'review', 3, '2026-10-09'), ('b', 'w', 'learning', 1, '2026-10-09'),
        ('a', 'reset', 'unstudied', 0, NULL);
      INSERT INTO usage_daily_snapshots (day_key, captured_at, dau, sessions_completed, new_words,
        model_spend_usd, median_stash_size, median_session_active_ms, learners_inactive_7d,
        sessions_abandoned, learners_spend_without_accepts, study_commit_failures, practice_completed,
        review_correct) VALUES ('2026-10-08', 'now', 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 9, 7);`);
    const progress = db.prepare('SELECT * FROM learner_word_state').all();
    const snapshot = db.prepare('SELECT * FROM usage_daily_snapshots').get()!;
    migrateDatabase(db);
    assert.deepEqual(db.prepare('SELECT * FROM learner_word_state').all(), progress);
    assert.deepEqual({ ...db.prepare('SELECT * FROM usage_daily_snapshots').get() }, { ...snapshot, practice_completed: null });
    assert.deepEqual(db.prepare('SELECT * FROM learner_practice_correct_days ORDER BY learner_id').all().map(r => ({ ...r })), [
      { learner_id: 'a', word_id: 'w', day_key: '2026-10-09' },
      { learner_id: 'b', word_id: 'w', day_key: '2026-10-09' },
    ]);
    assert.throws(() => db.exec(`INSERT INTO learner_practice_correct_days VALUES ('a', 'w', '2026-10-09')`), /UNIQUE/);
    db.exec(`INSERT INTO learner_practice_correct_days VALUES ('a', 'w', '2026-10-10')`);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM learner_practice_correct_days').get()?.n, 3);
    assert.deepEqual(migrateDatabase(db), []);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
