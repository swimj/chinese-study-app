import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createBaselineFixture } from './helpers/baseline-database.ts';
import { assertSchemaCurrent, migrateDatabase, schemaMigrations } from '../server/db/migrations.ts';

test('workspace migration preserves populated content and replaces supplement uniqueness with one live slot', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'improvement-migration-'));
  createBaselineFixture(dir);
  const db = new DatabaseSync(path.join(dir,'app.db'));
  db.function('current_learner_id',()=> 'owner');
  try {
    const index = schemaMigrations.findIndex(m => m.id === 'app_schema:0032_content_improvement_workspace');
    migrateDatabase(db,schemaMigrations.slice(0,index));
    db.exec(`INSERT INTO learners (learner_id,display_name,created_at) VALUES ('owner','Owner','now');
      INSERT INTO lexical_words(id,hanzi,pinyin,meaning,meanings_json,examples_json,priority,created_at) VALUES ('word','你好','nǐ hǎo','hello','[]','[]',10,'now');
      INSERT INTO scoped_production_cues VALUES ('cue','production-task:word:default_production','definition_gloss','greeting','now','manual',NULL,'learner','owner');
      INSERT INTO scoped_production_cue_supplements VALUES ('supp','production-task:word:default_production','cue','frame','你好！','Hello!','now',NULL,'learner','owner');`);
    const tables = ['lexical_words','production_tasks','scoped_production_cues','scoped_production_cue_supplements'];
    const before = tables.map(table => db.prepare(`SELECT * FROM ${table}`).all());
    assert.deepEqual(migrateDatabase(db),schemaMigrations.slice(index).map(m=>m.id));
    assertSchemaCurrent(db);
    assert.deepEqual(tables.map(table=>db.prepare(`SELECT * FROM ${table}`).all()),before);
    assert.throws(()=>db.exec(`INSERT INTO scoped_production_cue_supplements VALUES ('duplicate','production-task:word:default_production','cue','frame','你好！','Hello!','now',NULL,'learner','owner')`),/already has live/);
    assert.deepEqual(migrateDatabase(db),[]);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  } finally { db.close();fs.rmSync(dir,{recursive:true,force:true}); }
});
