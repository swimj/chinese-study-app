import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createBaselineFixture } from './helpers/baseline-database.ts';
import { assertSchemaCurrent, migrateDatabase, schemaMigrations } from '../server/db/migrations.ts';

test('strict cutover resets all word cue memberships, drops rechecks, and leaves history unchanged', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'strict-cue-cutover-'));
  createBaselineFixture(dir);
  const db = new DatabaseSync(path.join(dir, 'app.db'));
  db.function('current_learner_id', () => 'learner-a');
  db.exec('PRAGMA foreign_keys=ON');
  try {
    const cutoverIndex = schemaMigrations.findIndex((m) => m.id === 'app_schema:0010_strict_word_cues');
    migrateDatabase(db, schemaMigrations.slice(0, cutoverIndex));
    db.exec("INSERT INTO learners VALUES ('learner-a', 'A', '2026-09-19', NULL)");
    for (const id of ['a', 'b']) {
      db.prepare(`INSERT INTO lexical_words
        (id, hanzi, pinyin, meaning, meanings_json, examples_json, priority, created_at)
        VALUES (?, ?, '', 'meaning', '[]', '[]', 0, '2026-09-19')`).run(id, id);
    }
    const taskId = db.prepare("SELECT task_id FROM production_tasks WHERE word_id = 'a'").get()!.task_id as string;
    for (const [cue, scope, owner] of [['private', 'learner', 'learner-a'], ['shared', 'shared', null]]) {
      db.prepare(`INSERT INTO scoped_production_cues
        (cue_id, task_id, cue_type, cue_text, created_at, origin_kind, content_scope, owner_learner_id)
        VALUES (?, ?, 'definition_gloss', 'ambiguous cue', '2026-09-19', 'manual', ?, ?)`).run(cue, taskId, scope, owner);
      db.prepare('INSERT INTO scoped_production_cue_accepted_words VALUES (?, ?, ?)').run(cue, 'b', 0);
      db.prepare('INSERT INTO scoped_production_cue_accepted_words VALUES (?, ?, ?)').run(cue, 'a', 1);
    }
    const cuesBefore = db.prepare('SELECT * FROM scoped_production_cues ORDER BY cue_id').all();
    db.exec(`INSERT INTO study_sessions (id, started_at, processing_state)
      VALUES ('session', '2026-09-19', 'processed');
      INSERT INTO study_attempt_events
        (id, occurred_at, session_id, session_action_id, session_event_sequence,
         action_attempt_sequence, action_kind, target_word_id, sampled_skill_ids_json,
         response, outcome, rating, metadata_json, projected_at)
      VALUES ('attempt', '2026-09-19', 'session', 'action', 1, 1, 'production', 'a',
        '["production"]', 'b', 'correct', 'good', '{"legacy":"accepted_non_anchor"}', '2026-09-19');`);
    db.prepare(`INSERT INTO production_recheck_demands
      (demand_id, task_id, source_attempt_id, scheduled_at, due_at)
      VALUES ('demand', ?, 'attempt', '2026-09-19', '2026-09-21')`).run(taskId);
    const attemptsBefore = db.prepare('SELECT * FROM learner_owned_study_attempt_events').all();
    migrateDatabase(db);
    assertSchemaCurrent(db);
    assert.deepEqual(db.prepare('SELECT * FROM scoped_production_cues ORDER BY cue_id').all(), cuesBefore);
    assert.deepEqual(db.prepare('SELECT * FROM scoped_production_cue_accepted_words ORDER BY cue_id').all().map((r) => ({ ...r })), [
      { cue_id: 'private', word_id: 'a', position: 0 },
      { cue_id: 'shared', word_id: 'a', position: 0 },
    ]);
    assert.equal(db.prepare("SELECT name FROM sqlite_schema WHERE name = 'learner_owned_production_recheck_demands'").get(), undefined);
    assert.deepEqual(db.prepare('SELECT * FROM learner_owned_study_attempt_events').all(), attemptsBefore);
    assert.throws(() => db.exec("INSERT INTO scoped_production_cue_accepted_words VALUES ('private', 'b', 1)"), /only their target/);
    assert.throws(() => db.exec("DELETE FROM scoped_production_cue_accepted_words"), /cannot be deleted/);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.deepEqual(migrateDatabase(db), []);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
