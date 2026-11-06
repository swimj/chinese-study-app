import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { scenarios, scenarioById } from '../scripts/testbed/catalog.ts';

test('catalog routes resolve to maintained fixtures and state their evidence boundary',()=>{
  assert.equal(new Set(scenarios.map(s=>s.id)).size,scenarios.length);
  for(const scenario of scenarios) {
    assert.ok(scenario.purpose && scenario.limits);
    if(scenario.fixture) assert.ok(fs.existsSync(new URL(`./browser/${scenario.fixture}.html`,import.meta.url)));
    if(scenario.archetype==='app-simulated') assert.equal(new URLSearchParams(scenario.query).get('shell'),'1');
  }
  assert.throws(()=>scenarioById('missing'),/Unknown scenario/);
});

test('fresh backend seed can save, reopen, and apply through real persistence without providers',async()=>{
  const parent=fs.mkdtempSync(path.join(os.tmpdir(),'testbed-seed-test-'));
  const dataDir=path.join(parent,'data');
  const env={...process.env,APP_MODE:'study',APP_AUTH_MODE:'trusted_local',APP_OPERATOR_CLERK_USER_IDS:'trusted_local',APP_STUDY_PROFILE:'mandarin',APP_DATA_DIR:dataDir,APP_LEARNER_ID:'dev-learner'};
  function run(script:string) {
    const result=spawnSync(process.execPath,['--import','tsx',script,`--data-dir=${dataDir}`],{env,encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);return result;
  }
  try {
    run('scripts/prepare-vocabulary-fixtures.ts');run('scripts/testbed/prepare-operator.ts');
    // Run domain operations in a separate process: the suite must not inherit a database singleton.
    const result=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',`
      import fs from 'node:fs';
      import assert from 'node:assert/strict';
      await import('./server/db.ts');
      const {getDb,closeDbConnection}=await import('./server/db/connection.ts');
      const {getHostedServiceControls}=await import('./server/db/hosted-operations.ts');
      const {getVocabularyProposal,saveVocabularyProposal,completeVocabularyApprovalRequest}=await import('./server/db/vocabulary-reflection.ts');
      const {getVocabularyContentForMaintenance}=await import('./server/db/vocabulary-content.ts');
      try {
        assert.equal(getHostedServiceControls().providerWorkEnabled,false);
        const ids=JSON.parse(fs.readFileSync(process.env.APP_DATA_DIR+'/operator-fixture.json','utf8'));
        const proposal=getVocabularyProposal(ids.proposalId,'testbed');
        const draft={rationale:proposal.rationale,operations:proposal.operations};
        draft.operations[0].content.body={prompt:'Retained testbed edit'};
        const saved=saveVocabularyProposal(proposal.proposalId,proposal.version,draft,'testbed');
        assert.equal(getVocabularyProposal(proposal.proposalId,'testbed').version,2);
        completeVocabularyApprovalRequest({requestId:'testbed-verification',proposalId:saved.proposalId,expectedVersion:saved.version,actorId:'testbed',notes:''});
        assert.equal(getVocabularyContentForMaintenance(ids.sourceContentId).body.prompt,'Retained testbed edit');
        assert.equal(getVocabularyProposal(ids.proposalId,'testbed').status,'applied');
        assert.deepEqual(getDb().prepare('PRAGMA foreign_key_check').all(),[]);
      } finally {closeDbConnection();}
    `],{env,encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    const refused=spawnSync(process.execPath,['--import','tsx','scripts/prepare-vocabulary-fixtures.ts',`--data-dir=${dataDir}`],{env,encoding:'utf8'});
    assert.notEqual(refused.status,0);assert.match(refused.stderr,/EEXIST/);
  } finally {fs.rmSync(parent,{recursive:true,force:true});}
});
