import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createBaselineFixture } from './helpers/baseline-database.ts';
import { assertSchemaCurrent, migrateDatabase, schemaMigrations } from '../server/db/migrations.ts';

test('reconciliation migration preserves ordinary jobs, attempts, leases and schema on populated upgrade',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'reconciliation-migration-'));
  createBaselineFixture(path.join(root,'baseline'));
  const file=path.join(root,'baseline','app.db');fs.copyFileSync(file,path.join(root,'fresh.db'));
  let db=new DatabaseSync(file);const fresh=new DatabaseSync(path.join(root,'fresh.db'));
  for(const target of [db,fresh]){target.function('current_learner_id',()=> 'learner');target.exec('PRAGMA foreign_keys=ON');}
  const at='2026-11-06T12:00:00.000Z';
  try{
    const index=schemaMigrations.findIndex(m=>m.id==='app_schema:0069_sense_content_reconciliation');assert.ok(index>0);
    migrateDatabase(db,schemaMigrations.slice(0,index));
    db.prepare("INSERT INTO lexical_words(id,hanzi,pinyin,meaning,examples_json,priority,created_at) VALUES('word','字','zì','character','[]',1,?)").run(at);
    db.prepare("INSERT INTO shared_content_publications VALUES('publication','word_content','source','word','available',?,?)").run(at,at);
    db.prepare("INSERT INTO word_content_documents(content_id,word_id,content_json,model,created_at,publication_id) VALUES('source','word','{}','fixture',?,'publication')").run(at);
    for(const status of ['queued','running','ready','failed']){
      db.prepare(`INSERT INTO vocabulary_practice_preparation(work_id,word_id,source_content_id,generation_key,status,attempt_count,active_token,expires_at,created_at,updated_at,last_error,next_attempt_at,total_attempt_count)
        VALUES(?,'word','source',?,?,2,?,?,?,?,?,?,4)`).run(status,status,status,status==='running'?'lease':null,status==='running'?'2026-11-07T00:00:00.000Z':null,at,at,status==='failed'?'generation_failed':null,at);
      db.prepare("INSERT INTO vocabulary_preparation_attempts(attempt_id,preparation_kind,work_id,attempt_number,cycle_attempt,started_at) VALUES(?,'practice',?,4,2,?)").run(`attempt:${status}`,status,at);
    }
    const jobs=db.prepare('SELECT * FROM vocabulary_practice_preparation ORDER BY work_id').all().map(row=>({...row}));
    const attempts=db.prepare('SELECT * FROM vocabulary_preparation_attempts ORDER BY attempt_id').all();
    assert.throws(()=>migrateDatabase(db,[...schemaMigrations,{id:'app_schema:9999_test_failure',sql:'SELECT * FROM missing_table;'}]),/missing_table/);
    assert.deepEqual(db.prepare('SELECT * FROM vocabulary_practice_preparation ORDER BY work_id').all().map(row=>({...row})),jobs);
    migrateDatabase(db);assertSchemaCurrent(db);
    assert.deepEqual(db.prepare('SELECT * FROM vocabulary_practice_preparation ORDER BY work_id').all().map(({reconciliation_id,proactive_scope_key,...row})=>{
      assert.equal(reconciliation_id,null);assert.equal(proactive_scope_key,null);return row;
    }),jobs);
    assert.equal(db.prepare("SELECT enabled FROM service_controls WHERE control_key='proactive_repertoire'").get()!.enabled,1);
    assert.deepEqual(db.prepare('SELECT * FROM vocabulary_preparation_attempts ORDER BY attempt_id').all(),attempts);
    assert.throws(()=>db.prepare("INSERT INTO vocabulary_practice_preparation(work_id,word_id,generation_key,status,created_at,updated_at) VALUES('invalid','word','key','queued',?,?)").run(at,at),/CHECK/);
    db.close();db=new DatabaseSync(file);db.function('current_learner_id',()=> 'learner');
    assert.deepEqual(migrateDatabase(db),[]);migrateDatabase(fresh);
    const schema=(target:DatabaseSync)=>target.prepare('SELECT type,name,sql FROM sqlite_schema ORDER BY type,name').all();
    assert.deepEqual(schema(db),schema(fresh));
    assert.equal(db.prepare("SELECT active_token FROM vocabulary_practice_preparation WHERE work_id='running'").get()!.active_token,'lease');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
    assert.equal(db.prepare('PRAGMA quick_check').get()!.quick_check,'ok');
  }finally{db.close();fresh.close();fs.rmSync(root,{recursive:true,force:true});}
});
