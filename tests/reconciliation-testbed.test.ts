import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { scenarioById } from '../scripts/testbed/catalog.ts';

test('reconciliation preview seeds separate canonical and teaching sources with failed practice and no provider work',()=>{
  const parent=fs.mkdtempSync(path.join(os.tmpdir(),'reconciliation-testbed-test-'));
  const dataDir=path.join(parent,'data');
  const env={...process.env,APP_MODE:'study',APP_AUTH_MODE:'trusted_local',APP_OPERATOR_CLERK_USER_IDS:'trusted_local',APP_STUDY_PROFILE:'mandarin',APP_DATA_DIR:dataDir,APP_LEARNER_ID:'dev-learner'};
  try {
    for(const script of ['scripts/prepare-vocabulary-fixtures.ts','scripts/testbed/prepare-reconciliation.ts']){
      const result=spawnSync(process.execPath,['--import','tsx',script,`--data-dir=${dataDir}`],{env,encoding:'utf8'});
      assert.equal(result.status,0,result.stderr);
    }
    const ids=JSON.parse(fs.readFileSync(path.join(dataDir,'reconciliation-fixture.json'),'utf8')) as {wordId:string;originalContentId:string;replacementContentId:string;canonicalSenseIds:string[];practiceWorkId:string};
    const db=new DatabaseSync(path.join(dataDir,'app.db'),{readOnly:true});
    try {
      assert.equal(ids.canonicalSenseIds.length,3);
      const source=(id:string)=>JSON.parse(db.prepare('SELECT content_json FROM word_content_documents WHERE content_id=?').get(id)!.content_json as string) as {uses:unknown[]};
      assert.equal(source(ids.originalContentId).uses.length,3);
      assert.equal(source(ids.replacementContentId).uses.length,4);
      assert.equal(db.prepare('SELECT count(*) n FROM legacy_sense_imports WHERE source_content_id=?').get(ids.originalContentId)!.n,3);
      assert.equal(db.prepare('SELECT count(*) n FROM legacy_sense_imports WHERE source_content_id=?').get(ids.replacementContentId)!.n,0);
      assert.equal(db.prepare('SELECT content_id FROM word_introduction_preparation WHERE word_id=?').get(ids.wordId)!.content_id,ids.replacementContentId);
      assert.equal(db.prepare('SELECT last_error FROM vocabulary_practice_preparation WHERE work_id=?').get(ids.practiceWorkId)!.last_error,'source_mapping_requires_operator');
      assert.equal(db.prepare("SELECT count(*) n FROM vocabulary_practice_preparation WHERE word_id=? AND last_error='source_mapping_requires_operator'").get(ids.wordId)!.n,2);
      assert.equal(db.prepare("SELECT count(*) n FROM vocabulary_practice_preparation WHERE word_id=? AND last_error='generation_failed'").get(ids.wordId)!.n,1);
      assert.equal(db.prepare('SELECT in_stash FROM learner_words WHERE word_id=? AND learner_id=?').get(ids.wordId,'dev-learner')!.in_stash,1);
      assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
    } finally {db.close();}
    assert.equal(scenarioById('reconciliation').entryPath,'/operator/improvement');
    assert.match(scenarioById('reconciliation').limits,/replacement content remains pending/);
    const refused=spawnSync(process.execPath,['--import','tsx','scripts/testbed/prepare-reconciliation.ts',`--data-dir=${dataDir}`],{env,encoding:'utf8'});
    assert.notEqual(refused.status,0,'Re-seeding must not overwrite a previously explored case');
  } finally {fs.rmSync(parent,{recursive:true,force:true});}
});
