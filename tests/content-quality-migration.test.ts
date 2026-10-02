import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { assertSchemaCurrent, migrateDatabase, schemaMigrations } from '../server/db/migrations.ts';
import { createBaselineFixture } from './helpers/baseline-database.ts';

test('quality migration preserves existing data, matches fresh installs, and repeats without new evidence', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'quality-migration-'));
  const freshDir = fs.mkdtempSync(path.join(os.tmpdir(),'quality-fresh-'));
  createBaselineFixture(dir); createBaselineFixture(freshDir);
  const db = new DatabaseSync(path.join(dir,'app.db'));
  const fresh = new DatabaseSync(path.join(freshDir,'app.db'));
  try {
    db.function('current_learner_id',()=> 'learner');
    fresh.function('current_learner_id',()=> 'learner');
    const index = schemaMigrations.findIndex(m=>m.id === 'app_schema:0021_content_quality'); assert(index >= 0);
    migrateDatabase(db,schemaMigrations.slice(0,index));
    db.exec("INSERT INTO learners (learner_id,display_name,created_at) VALUES ('learner','Preserved','now')");
    const before = db.prepare('SELECT * FROM learners').all();
    migrateDatabase(db); assertSchemaCurrent(db);
    assert.deepEqual(db.prepare('SELECT * FROM learners').all(),before);
    for (const table of ['content_quality_items','learner_content_quality_encounters','learner_content_quality_ratings']) {
      assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get()!.n,0);
    }
    const ledger = db.prepare('SELECT * FROM schema_migrations').all();
    migrateDatabase(db); assert.deepEqual(db.prepare('SELECT * FROM schema_migrations').all(),ledger);
    migrateDatabase(fresh); assert.deepEqual(
      db.prepare("SELECT type,name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all(),
      fresh.prepare("SELECT type,name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all(),
    );
  } finally { db.close(); fresh.close(); fs.rmSync(dir,{recursive:true,force:true}); fs.rmSync(freshDir,{recursive:true,force:true}); }
});
