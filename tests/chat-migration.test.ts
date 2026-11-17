import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createBaselineFixture } from './helpers/baseline-database.ts';
import { assertSchemaCurrent, migrateDatabase, schemaMigrations } from '../server/db/migrations.ts';
test('chat migration preserves populated prior state, rolls back failed batches, and matches fresh schema', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-migration-'));
  let previous: DatabaseSync | undefined, fresh: DatabaseSync | undefined;
  try {
    createBaselineFixture(path.join(directory, 'previous')); createBaselineFixture(path.join(directory, 'fresh'));
    previous = new DatabaseSync(path.join(directory, 'previous', 'app.db')); fresh = new DatabaseSync(path.join(directory, 'fresh', 'app.db'));
    previous.function('current_learner_id', () => 'learner'); fresh.function('current_learner_id', () => 'learner');
    const priorMigrations = schemaMigrations.filter(migration => !/0075_learner_chat|0076_/.test(migration.id));
    migrateDatabase(previous, priorMigrations);
    previous.prepare('INSERT INTO learners(learner_id,display_name,created_at) VALUES (?,?,?)').run('learner', 'Preserved', '2026-11-15');
    const before = previous.prepare('SELECT * FROM learners').all();
    assert.throws(() => migrateDatabase(previous!, [...schemaMigrations, { id: 'app_schema:9999_bad', sql: 'SELECT * FROM nonexistent_table;' }]));
    assert.equal(previous.prepare("SELECT COUNT(*) AS n FROM sqlite_schema WHERE name='learner_chat_cards'").get()!.n, 0);
    assert.deepEqual(previous.prepare('SELECT * FROM learners').all(), before);
    migrateDatabase(previous); assert.deepEqual(migrateDatabase(previous), []); assertSchemaCurrent(previous);
    assert.deepEqual(previous.prepare('SELECT * FROM learners').all(), before);
    for (const table of ['conversations', 'turns', 'events', 'cards', 'commands']) {
      assert.equal(previous.prepare(`SELECT COUNT(*) AS n FROM learner_chat_${table}`).get()!.n, 0);
    }
    migrateDatabase(fresh);
    const schema = (db: DatabaseSync) => db.prepare("SELECT type,name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
    assert.deepEqual(schema(previous), schema(fresh));
    assert.deepEqual(previous.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { previous?.close(); fresh?.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});
