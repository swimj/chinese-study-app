import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

test('migration upgrades populated history without inventing snapshots and reopens idempotently', async () => {
  const { createBaselineFixture } = await import('./helpers/baseline-database.ts');
  const { migrateDatabase, schemaMigrations, assertSchemaCurrent } = await import('../server/db/migrations.ts');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pure-restore-migration-'));
  createBaselineFixture(dir);
  const file = path.join(dir, 'app.db');
  let connection = new DatabaseSync(file);
  try {
    connection.function('current_learner_id', () => 'legacy');
    connection.exec('PRAGMA foreign_keys=ON');
    const index = schemaMigrations.findIndex(m => m.id === 'app_schema:0014_pure_cue_reflection');
    migrateDatabase(connection, schemaMigrations.slice(0, index));
    connection.exec(`INSERT INTO learners (learner_id, display_name, created_at) VALUES ('legacy', 'Learner', 'now');
      INSERT INTO pure_cues (id, stimulus, axis_note, created_at) VALUES ('legacy-cue', 'cue', '', 'now');
      INSERT INTO pure_cue_served_snapshots
        (learner_id, snapshot_id, pure_cue_id, served_at, stimulus, axis_note, accepted_answers_json)
        VALUES ('legacy', 'legacy-snapshot', 'legacy-cue', 'now', 'cue', '', '[]');
      INSERT INTO pure_cue_attempts VALUES
        ('legacy', 'legacy-attempt', 'legacy-cue', 'legacy-snapshot', 'session', 'action', 'now', '[{"outcome":"rejected"}]', 1, NULL);`);
    const history = connection.prepare('SELECT * FROM pure_cue_attempts').all();
    assert.deepEqual(migrateDatabase(connection), schemaMigrations.slice(index).map((migration) => migration.id));
    assert.deepEqual(connection.prepare('SELECT * FROM pure_cue_attempts').all(), history);
    assert.equal(connection.prepare('SELECT COUNT(*) AS count FROM pure_cue_assessment_scheduler_snapshots').get()?.count, 0);
    assert.deepEqual(connection.prepare('PRAGMA foreign_key_check').all(), []);
    connection.close();
    connection = new DatabaseSync(file);
    connection.function('current_learner_id', () => 'legacy');
    connection.exec('PRAGMA foreign_keys=ON');
    assertSchemaCurrent(connection);
    assert.deepEqual(migrateDatabase(connection), []);
  } finally { connection.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
