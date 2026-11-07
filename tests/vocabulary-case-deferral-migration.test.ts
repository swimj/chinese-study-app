import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createBaselineFixture } from './helpers/baseline-database.ts';
import { assertSchemaCurrent, migrateDatabase, schemaMigrations } from '../server/db/migrations.ts';

const at='2026-11-06T12:00:00.000Z';
test('deferral migration preserves existing case state, survives reopen and matches fresh schema',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'case-deferral-migration-'));
  createBaselineFixture(path.join(root,'baseline'));
  const file=path.join(root,'baseline','app.db');fs.copyFileSync(file,path.join(root,'fresh.db'));
  let db=new DatabaseSync(file);const fresh=new DatabaseSync(path.join(root,'fresh.db'));
  for(const target of [db,fresh])target.function('current_learner_id',()=> 'learner');
  try {
    const index=schemaMigrations.findIndex(m=>m.id==='app_schema:0068_vocabulary_case_deferral');assert.ok(index>0);
    migrateDatabase(db,schemaMigrations.slice(0,index));
    db.exec(`INSERT INTO learners VALUES('learner','Learner','${at}',NULL);
      INSERT INTO vocabulary_sessions VALUES('session','learner',1,'{}','${at}','${at}','closed');
      INSERT INTO vocabulary_session_completions VALUES('completion','learner','session',1,0,'${at}','${at}','closed','{}','{}','fixture','${at}',NULL);
      INSERT INTO vocabulary_reflection_session_evidence VALUES('completion','learner','session','{}','${at}');`);
    for(const state of ['open','resolved']){
      db.prepare("INSERT INTO reflection_cases VALUES(?,'completion','learner','exercise_improvement',?,NULL,NULL,'completed','{}',?)").run(state,state,at);
      db.prepare('INSERT INTO vocabulary_case_reviews(case_id,state,version,created_at,resolved_at) VALUES(?,?,3,?,?)').run(state,state,at,state==='resolved'?at:null);
      db.prepare('INSERT INTO vocabulary_case_lineage VALUES(?,?)').run(state,state);
    }
    const before=db.prepare('SELECT * FROM vocabulary_case_reviews ORDER BY case_id').all().map(row=>({...row}));
    // A later failure rolls this additive migration back as part of the same batch.
    assert.throws(()=>migrateDatabase(db,[...schemaMigrations,{id:'app_schema:0071_test_failure',sql:'SELECT * FROM missing_table;'}]),/missing_table/);
    assert.deepEqual(db.prepare('SELECT * FROM vocabulary_case_reviews ORDER BY case_id').all().map(row=>({...row})),before);
    assert.deepEqual(migrateDatabase(db),schemaMigrations.slice(index).map(m=>m.id));assertSchemaCurrent(db);
    const after=db.prepare('SELECT * FROM vocabulary_case_reviews ORDER BY case_id').all();
    assert.deepEqual(after.map(({deferred_at,...row})=>{assert.equal(deferred_at,null);return row;}),before);
    db.prepare("UPDATE vocabulary_case_reviews SET deferred_at=? WHERE case_id='open'").run(at);
    db.close();db=new DatabaseSync(file);db.function('current_learner_id',()=> 'learner');
    assert.equal(db.prepare("SELECT deferred_at FROM vocabulary_case_reviews WHERE case_id='open'").get()!.deferred_at,at);
    assert.deepEqual(migrateDatabase(db),[]);migrateDatabase(fresh);
    const schema=(target:DatabaseSync)=>target.prepare('SELECT type,name,sql FROM sqlite_schema ORDER BY type,name').all();
    assert.deepEqual(schema(db),schema(fresh));assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  } finally {db.close();fresh.close();fs.rmSync(root,{recursive:true,force:true});}
});
