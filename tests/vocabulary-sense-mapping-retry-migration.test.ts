import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createBaselineFixture } from './helpers/baseline-database.ts';
import { assertSchemaCurrent, migrateDatabase, schemaMigrations } from '../server/db/migrations.ts';

const migrationId='app_schema:0061_vocabulary_sense_mapping_retries';
const at='2026-10-29T12:00:00.000Z';
test('mapping retry migration preserves populated jobs, defaults to Luna, and matches fresh migration',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'sense-mapping-migration-'));
  createBaselineFixture(path.join(root,'baseline'));
  const file=path.join(root,'baseline','app.db');
  fs.copyFileSync(file,path.join(root,'fresh.db'));
  const db=new DatabaseSync(file),fresh=new DatabaseSync(path.join(root,'fresh.db'));
  for(const target of [db,fresh])target.function('current_learner_id',()=> 'learner');
  try {
    const index=schemaMigrations.findIndex(migration=>migration.id===migrationId);
    assert.ok(index>0);migrateDatabase(db,schemaMigrations.slice(0,index));
    db.exec(`INSERT INTO learners VALUES('learner','Learner','${at}',NULL);
      INSERT INTO vocabulary_sessions VALUES('session','learner',1,'{}','${at}','${at}','closed');
      INSERT INTO vocabulary_session_completions VALUES('completion','learner','session',1,0,'${at}','${at}','closed','{}','{}','fixture','${at}',NULL);
      INSERT INTO vocabulary_reflection_session_evidence VALUES('completion','learner','session','{}','${at}');`);
    for(const status of ['queued','running','succeeded','failed']) {
      db.prepare(`INSERT INTO reflection_cases VALUES(?, 'completion','learner','exercise_improvement',?,NULL,NULL,'open','{}',?)`).run(status,status,at);
      db.prepare(`INSERT INTO vocabulary_reflection_jobs(job_id,case_id,kind,dedupe_key,status,next_attempt_at,attempt_number,
        lease_token,lease_expires_at,result_json,last_error,created_at,model_choice)
        VALUES(?,?,'exercise_improvement',?,?,?,7,?,?,'{"retained":true}','retained_error',?,'zai:glm-5.3-flash-high')`)
        .run(status,status,status,status,at,status==='running'?'lease':null,status==='running'?'2026-10-30T00:00:00.000Z':null,at);
    }
    const before=db.prepare('SELECT * FROM vocabulary_reflection_jobs ORDER BY job_id').all().map(row=>({...row}));
    assert.deepEqual(migrateDatabase(db),schemaMigrations.slice(index).map(migration=>migration.id));assertSchemaCurrent(db);
    const after=db.prepare('SELECT * FROM vocabulary_reflection_jobs ORDER BY job_id').all();
    assert.deepEqual(after.map(({sense_mapping_availability_failures,...row})=>{
      assert.equal(sense_mapping_availability_failures,0);return row;
    }),before);
    assert.throws(()=>db.exec("UPDATE vocabulary_reflection_jobs SET sense_mapping_availability_failures=7"),/CHECK/);
    assert.deepEqual(migrateDatabase(db),[]);
    migrateDatabase(fresh);
    const schema=(target:DatabaseSync)=>target.prepare("SELECT type,name,sql FROM sqlite_schema ORDER BY type,name").all();
    assert.deepEqual(schema(db),schema(fresh));
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  } finally {db.close();fresh.close();fs.rmSync(root,{recursive:true,force:true});}
});
