import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { migrateDatabase, schemaMigrations, assertSchemaCurrent } from '../server/db/migrations.ts';
import { createBaselineFixture } from './helpers/baseline-database.ts';

const teachingMigrationIndex = schemaMigrations.findIndex((migration) => migration.id === 'app_schema:0012_pure_cue_teaching_notes');
const migrationsThroughTeaching = schemaMigrations.slice(0, teachingMigrationIndex + 1);

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'teaching-migration-'));
  createBaselineFixture(dir);
  const db = new DatabaseSync(path.join(dir, 'app.db'));
  db.function('current_learner_id', () => 'learner');
  db.exec('PRAGMA foreign_keys=ON');
  return { db, close() { db.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test('teaching-note upgrade preserves legacy axes and frozen history, guards ownership and repeats safely', () => {
  const upgraded = fixture();
  const fresh = fixture();
  try {
    const db = upgraded.db;
    migrateDatabase(db, schemaMigrations.slice(0, teachingMigrationIndex));
    db.exec(`
      INSERT INTO learners (learner_id, display_name, created_at) VALUES ('learner', 'Learner', '2026-09-26T00:00:00.000Z');
      INSERT INTO pure_cues (id, stimulus, axis_note, created_at) VALUES ('cue', 'stimulus', 'legacy pair commentary', '2026-09-26T00:00:00.000Z');
      INSERT INTO pure_cue_served_snapshots (learner_id, snapshot_id, pure_cue_id, served_at, stimulus, axis_note, accepted_answers_json)
      VALUES ('learner', 'snapshot', 'cue', '2026-09-26T00:00:00.000Z', 'stimulus', 'legacy pair commentary', '[]');
    `);
    migrateDatabase(db, migrationsThroughTeaching);
    assertSchemaCurrent(db, migrationsThroughTeaching);
    assert.deepEqual({ ...db.prepare('SELECT axis_note, teaching_note FROM pure_cues').get() }, { axis_note: 'legacy pair commentary', teaching_note: '' });
    assert.deepEqual({ ...db.prepare('SELECT axis_note, teaching_note FROM pure_cue_served_snapshots').get() }, { axis_note: 'legacy pair commentary', teaching_note: '' });
    assert.throws(() => db.exec("UPDATE pure_cue_served_snapshots SET teaching_note='rewritten'"), /immutable/);
    assert.throws(() => db.exec("UPDATE pure_cues SET axis_note='changed scope'"), /immutable/);
    db.exec(`INSERT INTO learner_owned_reflection_operation_invocations
      (learner_id, invocation_id, created_at, origin_kind, operation_kind, operation_version, operation_json, application_state, application_updated_at)
      VALUES ('learner', 'invocation', 'now', 'manual', 'reconcile_production_cues', 1, '{}', 'pending', 'now')`);
    assert.throws(() => db.exec(`INSERT INTO pure_cue_teaching_revisions
      VALUES ('other-learner', 'invocation', 'cue', '', 'new', 'now')`), /requires its learner/);
    db.exec("INSERT INTO pure_cue_teaching_revisions VALUES ('learner', 'invocation', 'cue', '', 'new', 'now')");
    assert.throws(() => db.exec("UPDATE pure_cue_teaching_revisions SET teaching_note='changed'"), /immutable/);
    migrateDatabase(db, migrationsThroughTeaching);
    assertSchemaCurrent(db, migrationsThroughTeaching);
    migrateDatabase(fresh.db, migrationsThroughTeaching);
    const schema = (value: DatabaseSync) => value.prepare("SELECT type, name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
    assert.deepEqual(schema(db), schema(fresh.db));
  } finally { upgraded.close(); fresh.close(); }
});

test('a failed teaching migration rolls back columns and ledger atomically', () => {
  const { db, close } = fixture();
  try {
    migrateDatabase(db, schemaMigrations.slice(0, teachingMigrationIndex));
    const last = schemaMigrations[teachingMigrationIndex]!;
    assert.throws(() => migrateDatabase(db, [...schemaMigrations.slice(0, teachingMigrationIndex), { ...last, sql: `${last.sql}\nINSERT INTO missing_table VALUES (1);` }]), /missing_table/);
    assert.equal(db.prepare("SELECT name FROM pragma_table_info('pure_cues') WHERE name = 'teaching_note'").get(), undefined);
    assert.equal(db.prepare('SELECT migration_id FROM schema_migrations WHERE migration_id = ?').get(last.id), undefined);
    migrateDatabase(db, migrationsThroughTeaching);
    assertSchemaCurrent(db, migrationsThroughTeaching);
  } finally { close(); }
});
