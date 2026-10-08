import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createBaselineFixture } from './helpers/baseline-database.ts';
import { assertSchemaCurrent, migrateDatabase, schemaMigrations } from '../server/db/migrations.ts';

test('usage migration preserves history, backfills only durable totals, and keeps scoped counts nullable', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-migration-'));
  const freshDir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-fresh-'));
  createBaselineFixture(dir);
  createBaselineFixture(freshDir);
  const db = new DatabaseSync(path.join(dir, 'app.db'));
  const fresh = new DatabaseSync(path.join(freshDir, 'app.db'));
  let learner = 'owner';
  db.function('current_learner_id', () => learner);
  fresh.function('current_learner_id', () => learner);
  try {
    const index = schemaMigrations.findIndex(m => m.id === 'app_schema:0034_usage_exercise_totals');
    migrateDatabase(db, schemaMigrations.slice(0, index));
    db.exec(`INSERT INTO learners (learner_id, display_name, created_at) VALUES ('owner', 'Owner', 'now'), ('other', 'Other', 'now');
      INSERT INTO review_session_summaries VALUES ('session', '2026-10-01T10:00:00.000Z', '2026-10-01', 7, 2, 90000);
      INSERT INTO usage_daily_snapshots VALUES ('2026-10-01', '2026-10-02T00:00:00.000Z', 1, 1, 3, 0.5, 2, 90000, 0, 0, 0, 0);`);
    const before = db.prepare('SELECT * FROM learner_owned_review_session_summaries').all();
    assert.deepEqual(migrateDatabase(db), schemaMigrations.slice(index).map(m => m.id));
    assertSchemaCurrent(db);
    assert.deepEqual(db.prepare(`SELECT learner_id, session_id, completed_at, day_key, completed_count, failed_count, active_duration_ms
      FROM learner_owned_review_session_summaries`).all(), before);
    const row = db.prepare('SELECT * FROM usage_daily_snapshots').get()!;
    assert.equal(row.review_correct, 5);
    assert.equal(row.review_wrong, 2);
    assert.equal(row.session_active_ms, 90000);
    assert.equal(row.practice_completed, null);
    assert.equal(row.mean_stash_size, null);
    assert.equal(row.model_spend_usd, 0.5);
    assert.equal(row.median_stash_size, 2);
    assert.equal(db.prepare('SELECT learning_completed_count FROM review_session_summaries').get()?.learning_completed_count, null);
    learner = 'other';
    assert.deepEqual(db.prepare('SELECT * FROM review_session_summaries').all(), []);
    db.exec(`INSERT INTO review_session_summaries VALUES ('session', '2026-10-01T11:00:00.000Z', '2026-10-01', 1, 0, 1000, 4);
      UPDATE review_session_summaries SET learning_completed_count = 5 WHERE session_id = 'session';`);
    assert.equal(db.prepare('SELECT learning_completed_count FROM review_session_summaries').get()?.learning_completed_count, 5);
    assert.throws(() => db.exec('UPDATE review_session_summaries SET learning_completed_count = -1'), /CHECK/);
    db.exec('DELETE FROM review_session_summaries');
    learner = 'owner';
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM review_session_summaries').get()?.n, 1);
    const plan = db.prepare(`EXPLAIN QUERY PLAN SELECT COUNT(*) FROM learner_owned_reflection_operation_invocations
      WHERE origin_kind = 'proposal_acceptance' AND created_at >= ? AND created_at < ?`).all('2026-10-01', '2026-10-02');
    assert.match(JSON.stringify(plan), /idx_usage_proposal_acceptance_time/);
    assert.deepEqual(migrateDatabase(db), []);
    migrateDatabase(fresh);
    const schema = (database: DatabaseSync) => database.prepare(`SELECT name, sql FROM sqlite_schema
      WHERE sql IS NOT NULL ORDER BY name`).all();
    assert.deepEqual(schema(db), schema(fresh));
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    db.close(); fresh.close();
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(freshDir, { recursive: true, force: true });
  }
});
