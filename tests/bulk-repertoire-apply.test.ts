import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { before, after, beforeEach, afterEach, test } from 'node:test';
import { createBaselineFixture } from './helpers/baseline-database.ts';
import { migrateDatabase } from '../server/db/migrations.ts';
import { setDb } from '../server/db/connection.ts';
import { runWithLearnerId } from '../server/db/learner-context.ts';
import { addVocabularyWord, changeVocabularyMode } from '../server/db/vocabulary-learners.ts';
import { createVocabularyContent, createVocabularySense, establishVocabularySenseCatalog, getVocabularySenses, getVocabularySenseCatalog, getVocabularyContentForMaintenance, updateVocabularyContent } from '../server/db/vocabulary-content.ts';
import { writeVocabularyDefaultUsefulSenses, getVocabularyWordSenseCoverage } from '../server/db/vocabulary-sense-coverage.ts';
import { snapshotBulkRepertoireWord } from '../server/db/bulk-repertoire-snapshot.ts';
import { generateBulkWord } from '../server/vocabulary/bulk-repertoire.ts';
import { applyBulkRepertoireWord } from '../server/db/bulk-repertoire-apply.ts';
import { BULK_REPERTOIRE_APPLIED } from '../server/db/bulk-repertoire-state.ts';
import { authoredVocabularyRepertoire } from '../server/db/vocabulary-authored-repertoire.ts';
import { composeVocabularySessionPayload } from '../server/vocabulary/study.ts';
import { createVocabularyPracticePreparation } from '../server/vocabulary/preparation.ts';
import { parseResponse } from '../server/llm/openai-compatible.ts';
import type { ProviderAdapter, JsonValue } from '../server/llm/types.ts';
import { claimSharedWordIntroductionStage, finishSharedWordIntroductionBootstrap } from '../server/db/word-introductions.ts';
import { createVocabularyProposal } from '../server/db/vocabulary-reflection.ts';

let root:string,baseline:string,db:DatabaseSync;
const actor={kind:'service' as const,id:'fixture'};
const authority={operationId:'trial-run',actorId:'operator',confirmAppStopped:true};
const previousEnvironment:Record<string,string|undefined>={};
before(()=>{
  root=fs.mkdtempSync(path.join(os.tmpdir(),'bulk-repertoire-apply-'));
  const directory=path.join(root,'baseline'); createBaselineFixture(directory); baseline=path.join(directory,'app.db');
  for(const key of ['APP_MODE','APP_DATA_DIR','APP_AUTH_MODE','APP_OPERATOR_CLERK_USER_IDS'])previousEnvironment[key]=process.env[key];
  process.env.APP_MODE='study';process.env.APP_DATA_DIR=root;process.env.APP_AUTH_MODE='clerk';process.env.APP_OPERATOR_CLERK_USER_IDS='operator';
});
after(()=>{for(const [key,value] of Object.entries(previousEnvironment)){if(value===undefined)delete process.env[key];else process.env[key]=value;}fs.rmSync(root,{recursive:true,force:true});});
beforeEach(()=>{
  const file=path.join(root,`${Math.random()}.db`);fs.copyFileSync(baseline,file);db=new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys=ON');db.function('current_learner_id',()=> 'alice');migrateDatabase(db);setDb(db);
  const at=new Date().toISOString();
  db.prepare("INSERT INTO learners(learner_id,display_name,created_at) VALUES ('alice','Alice',?),('bob','Bob',?)").run(at,at);
  db.prepare(`INSERT INTO lexical_words(id,hanzi,traditional,pinyin,meaning,meanings_json,examples_json,priority,created_at)
    VALUES ('w1','你好',NULL,'nǐ hǎo','hello','["hello"]','[]',1,?)`).run(at);
  runWithLearnerId('alice',()=>{const word=addVocabularyWord('w1');changeVocabularyMode('w1','practice',word.stateVersion);});
  runWithLearnerId('bob',()=>addVocabularyWord('w1'));
  db.exec("UPDATE learner_word_schedules SET next_eligible_at='2026-11-01T00:00:00.000Z',last_practised_at='2026-10-30T00:00:00.000Z'; UPDATE service_controls SET enabled=CASE control_key WHEN 'maintenance_mode' THEN 1 ELSE 0 END");
});
afterEach(()=>{db.close();setDb(null);});
function establish(defaults:boolean){
  createVocabularySense({senseId:'greeting',wordId:'w1',description:{label:'greeting',notes:['Greet someone.']}},actor);
  establishVocabularySenseCatalog('w1',getVocabularySenseCatalog('w1').version,actor);
  if(defaults)writeVocabularyDefaultUsefulSenses('w1',0,['greeting'],actor);
}
function fallback(id='fallback'){
  return createVocabularyContent({contentId:id,kind:'exercise',payloadVersion:1,
    body:{prompt:'hello',instruction:'',source:{kind:'dictionary_baseline',wordId:'w1'}},
    accessScope:'shared',availability:'active',originKind:'human',authorKind:'service',authorId:'fixture',
    exerciseType:'definition',skill:'production',exerciseRole:'general',assessment:{responseMode:'hanzi_entry',matchingProfile:'mandarin'},
    words:[{wordId:'w1',relation:'target'}],answers:[{wordId:'w1',acceptedForms:['你好']}]},actor);
}
function manualRepertoire(){
  return createVocabularyContent({contentId:'manual-repertoire',kind:'exercise',payloadVersion:1,
    body:{prompt:'A greeting.',instruction:'',source:{kind:'authored_prompt'}},accessScope:'shared',availability:'active',originKind:'human',
    exerciseType:'definition_gloss',skill:'production',exerciseRole:'general',assessment:{responseMode:'hanzi_entry',matchingProfile:'mandarin'},
    words:[{wordId:'w1',relation:'target',senseId:'greeting',senseMappingEstablishedAt:new Date().toISOString()}],answers:[{wordId:'w1',acceptedForms:['你好']}]},actor);
}
function addTeachingSource(){
  const now=new Date().toISOString();
  assert.equal(claimSharedWordIntroductionStage('w1','bootstrap','fixture-source',now,new Date(Date.now()+300_000).toISOString()),'claimed');
  finishSharedWordIntroductionBootstrap('w1','fixture-source',{schemaVersion:1,id:'bootstrap-source',word:{wordId:'w1',hanzi:'你好',traditional:null,pinyin:'nǐ hǎo'},uses:[{id:'greeting',label:'greeting',notes:['Greet someone.'],exampleIds:['e1']}],examples:[{id:'e1',text:'你好！',translation:'Hello!',pronunciation:'nǐ hǎo'}]},'fixture',null,
    {catalogVersion:getVocabularySenseCatalog('w1').version,senseVersions:[{senseId:'greeting',version:1}],senseIds:['greeting']});
}
function tables(){return {words:db.prepare('SELECT * FROM learner_words ORDER BY learner_id').all(),schedules:db.prepare('SELECT * FROM learner_word_schedules ORDER BY learner_id').all()};}
async function generate(empty=false){
  const steps:string[]=[];
  const adapter:ProviderAdapter={id:'openai',defaultBaseUrl:'',apiKeyEnvironmentVariable:'',structuredOutputMode:'json_schema',async run(request){
    const step=request.provenance!.stepName!;steps.push(step);
    const output=step==='sense_inventory'?{senses:[{label:'greeting',notes:['Greet someone.'],defaultUseful:true},{label:'formal greeting',notes:['Formal greeting.'],defaultUseful:false}]}:
      step==='default_useful_selection'?{senseIds:['s1']}:{exercises:empty?[]:[{id:'one',sourceUseId:'s1',stimulus:{kind:'direct_text',text:'A greeting when meeting someone.'},teachingNote:'Use to greet someone.'},{id:'two',sourceUseId:'s1',stimulus:{kind:'direct_text',text:'Hello!'},teachingNote:null}]};
    return parseResponse('openai','json_schema',{id:`response-${step}`,model:request.model,choices:[{message:{content:JSON.stringify(output)},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:80,total_tokens:180}} as JsonValue);
  }};
  const result=await generateBulkWord(snapshotBulkRepertoireWord('w1'),{model:'gpt-6-sol',reasoningEffort:'high',adapter,apiKey:'fake',baseUrl:null,workflowId:'trial:w1'});
  return {result,steps};
}

test('unknown inventory imports exact provider evidence, selected canonical identities and repertoire without changing tracked schedules',async()=>{
  const before=tables();const {result,steps}=await generate();
  assert.deepEqual(steps,['sense_inventory','general_exercises']);assert.equal(result.snapshot.hasBootstrap,false);
  const receipt=await applyBulkRepertoireWord(result,authority);
  assert.equal(receipt.replayed,false);assert.equal(receipt.contentIds.length,2);assert.equal(receipt.invocationIds.length,2);
  const senses=getVocabularySenses('w1');assert.equal(senses.length,2);
  const selected=getVocabularyWordSenseCoverage('w1').defaultUsefulSenseIds!;assert.equal(selected.length,1);
  assert.equal(senses.find(s=>s.senseId===selected[0])!.description && (senses.find(s=>s.senseId===selected[0])!.description as {label:string}).label,'greeting');
  for(const id of receipt.contentIds){const content=getVocabularyContentForMaintenance(id)!;assert.equal(content.words[0]!.senseId,selected[0]);assert.equal(content.availability,'active');}
  assert.deepEqual(tables(),before);
  assert.equal(db.prepare("SELECT count(*) n FROM model_invocations WHERE status='completed' AND response_snapshot_json IS NOT NULL").get()!.n,2);
  assert.equal(db.prepare("SELECT count(*) n FROM invocation_content_links WHERE role='output'").get()!.n,2);
  assert.equal(db.prepare("SELECT count(*) n FROM invocation_sense_links WHERE role='output'").get()!.n,2);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('existing inventory with unknown defaults replays selection, preserving existing sense identities',async()=>{
  establish(false);const before=getVocabularySenses('w1');const {result,steps}=await generate();
  assert.deepEqual(steps,['default_useful_selection','general_exercises']);
  await applyBulkRepertoireWord(result,authority);
  assert.deepEqual(getVocabularySenses('w1'),before);assert.deepEqual(getVocabularyWordSenseCoverage('w1').defaultUsefulSenseIds,['greeting']);
  assert.equal(db.prepare("SELECT status FROM vocabulary_default_selection_readiness WHERE word_id='w1'").get()!.status,'ready');
});

test('additive publication preserves fallback identities and history and replays one receipt',async()=>{
  establish(true);fallback('fallback-a');fallback('fallback-b');const before=tables();const {result}=await generate();
  const first=await applyBulkRepertoireWord(result,authority);
  assert.deepEqual(first.retiredFallbackIds,[]);
  for(const id of ['fallback-a','fallback-b']){assert.equal(getVocabularyContentForMaintenance(id)!.availability,'active');assert.equal(db.prepare('SELECT count(*) n FROM content_revision_history WHERE content_id=?').get(id)!.n,1);}
  const counts={content:db.prepare('SELECT count(*) n FROM content_items').get()!.n,invocations:db.prepare('SELECT count(*) n FROM model_invocations').get()!.n};
  const replay=await applyBulkRepertoireWord(result,authority);assert.equal(replay.replayed,true);assert.deepEqual(replay.contentIds,first.contentIds);
  assert.equal(db.prepare('SELECT count(*) n FROM content_items').get()!.n,counts.content);assert.equal(db.prepare('SELECT count(*) n FROM model_invocations').get()!.n,counts.invocations);
  assert.deepEqual(tables(),before);
  await assert.rejects(applyBulkRepertoireWord(result,{...authority,actorId:'different-operator'}),/different content or authority/);
});

test('stale lexical source rejects before imports and rolls back all effects',async()=>{
  establish(true);const {result}=await generate();db.exec("UPDATE lexical_words SET pinyin='changed' WHERE id='w1'");
  await assert.rejects(applyBulkRepertoireWord(result,authority),/inputs changed/);
  assert.equal(db.prepare('SELECT count(*) n FROM model_invocations').get()!.n,0);assert.equal(db.prepare('SELECT count(*) n FROM content_items').get()!.n,0);
});

test('an outstanding proposal appearing after generation prevents automatic application',async()=>{
  establish(true);const source=fallback();const {result}=await generate();
  createVocabularyProposal({operations:[{operationKey:'pending',scope:{kind:'shared'},rationale:'pending review',strategy:'update_existing',sourceContentId:source.contentId,expectedVersion:source.version,content:source}],rationale:'pending'},'operator');
  await assert.rejects(applyBulkRepertoireWord(result,authority),/outstanding_proposal/);
  assert.equal(getVocabularyContentForMaintenance(source.contentId)!.availability,'active');assert.equal(db.prepare('SELECT count(*) n FROM model_invocations').get()!.n,0);
});

test('superseded incomplete reconciliation does not block application after the latest resolution completed',async()=>{
  establish(true);const {result}=await generate();const at=new Date().toISOString();
  const insert=db.prepare(`INSERT INTO sense_content_reconciliations
    (resolution_id,word_id,version,status,draft_json,snapshot_json,actor_id,created_at,updated_at,applied_at,completed_at)
    VALUES (?,'w1',1,'applied','{}','{}','operator',?,?,?,?)`);
  insert.run('old-incomplete',at,at,at,null);
  insert.run('latest-complete',at,at,at,at);
  const receipt=await applyBulkRepertoireWord(result,authority);assert.equal(receipt.contentIds.length,2);
});

test('latest incomplete reconciliation still blocks application',async()=>{
  establish(true);const {result}=await generate();const at=new Date().toISOString();
  db.prepare(`INSERT INTO sense_content_reconciliations
    (resolution_id,word_id,version,status,draft_json,snapshot_json,actor_id,created_at,updated_at,applied_at)
    VALUES ('latest-incomplete','w1',1,'applied','{}','{}','operator',?,?,?)`).run(at,at,at);
  await assert.rejects(applyBulkRepertoireWord(result,authority),/pending_reconciliation/);
  assert.equal(db.prepare('SELECT count(*) n FROM model_invocations').get()!.n,0);
});

test('empty repertoire cannot retire fallback or create a receipt',async()=>{
  establish(true);const source=fallback();const {result}=await generate(true);assert.equal(result.status,'empty_repertoire');
  await assert.rejects(applyBulkRepertoireWord(result,authority),/nonempty/);
  assert.equal(getVocabularyContentForMaintenance(source.contentId)!.version,1);assert.equal(db.prepare('SELECT count(*) n FROM backend_events WHERE name=?').get(BULK_REPERTOIRE_APPLIED)!.n,0);
});

test('authored repertoire blocks automatic preparation regardless of bulk receipts or teaching history',()=>{
  establish(true);
  const beforeSource=createVocabularyPracticePreparation();assert.equal(beforeSource.ensure('w1'),null);
  const existing=manualRepertoire();addTeachingSource();
  assert.equal(authoredVocabularyRepertoire('w1').length,1);
  assert.equal(createVocabularyPracticePreparation().ensure('w1'),null);
  assert.equal(db.prepare('SELECT count(*) n FROM vocabulary_practice_preparation').get()!.n,0);
  assert.equal(db.prepare('SELECT count(*) n FROM backend_events WHERE name=?').get(BULK_REPERTOIRE_APPLIED)!.n,0);
  updateVocabularyContent(existing.contentId,existing.version,{...existing,availability:'retired'},actor);
  assert.equal(createVocabularyPracticePreparation().ensure('w1')!.status,'queued');
});

test('queued standard preparation recognizes ordinary authored content without fake provider attempts',async()=>{
  establish(true);addTeachingSource();
  const preparation=createVocabularyPracticePreparation();const work=preparation.ensure('w1')!;assert.equal(work.status,'queued');
  manualRepertoire();
  assert.equal(await preparation.preflight(work.workId),false);
  const settled=db.prepare('SELECT status,last_error,attempt_count,total_attempt_count FROM vocabulary_practice_preparation WHERE work_id=?').get(work.workId)!;
  assert.equal(settled.status,'ready');assert.match(String(settled.last_error),/Existing authored repertoire/);assert.equal(settled.attempt_count,0);assert.equal(settled.total_attempt_count,0);
  assert.equal(db.prepare('SELECT count(*) n FROM vocabulary_preparation_attempts').get()!.n,0);
  assert.equal(db.prepare('SELECT count(*) n FROM model_invocations').get()!.n,0);
});

test('in-flight automatic authoring retains its real attempt but cannot duplicate concurrently published repertoire',async()=>{
  establish(true);addTeachingSource();let calls=0;
  const preparation=createVocabularyPracticePreparation({provider:{model:'fixture',isConfigured:()=>true,generationKey:()=> 'fixture',async generate(){
    calls++;manualRepertoire();return {exercises:[{id:'racing-output',sourceUseId:'greeting',stimulus:{kind:'direct_text',text:'A greeting.'},teachingNote:null}]};
  }}});
  const work=preparation.ensure('w1')!;assert.equal(await preparation.preflight(work.workId),true);
  const token=preparation.claim(work.workId)!;assert.ok(token);assert.deepEqual(await preparation.run(work.workId,token),[]);
  assert.equal(calls,1);assert.deepEqual(authoredVocabularyRepertoire('w1').map(row=>row.content_id),['manual-repertoire']);
  const settled=db.prepare('SELECT status,attempt_count,total_attempt_count,active_token FROM vocabulary_practice_preparation WHERE work_id=?').get(work.workId)!;
  assert.equal(settled.status,'ready');assert.equal(settled.attempt_count,1);assert.equal(settled.total_attempt_count,1);assert.equal(settled.active_token,null);
  const attempt=db.prepare('SELECT * FROM vocabulary_preparation_attempts WHERE attempt_id=?').get(token)!;assert.equal(attempt.outcome,'ready');assert.ok(attempt.finished_at);
});

test('legacy practice uses new repertoire while Maintain keeps its uncurated dictionary fallback',async()=>{
  establish(true);const baselineId='vocabulary:baseline:v1:shared:production:general:w1';fallback(baselineId);
  db.exec("INSERT INTO learner_senses(learner_id,word_id,sense_id,disposition) VALUES ('alice','w1','greeting','excluded')");
  const historicalScopes=db.prepare('SELECT * FROM learner_senses').all();const {result}=await generate();const receipt=await applyBulkRepertoireWord(result,authority);
  runWithLearnerId('alice',()=>{
    const practice=composeVocabularySessionPayload({sessionId:'practice',words:[{wordId:'w1',mode:'practice',selectedSkill:'production'}]});
    const production=practice.words.w1.general.practice.filter(content=>content.kind==='exercise'&&content.skill==='production');
    assert.deepEqual(production.map(content=>content.contentId).sort(),[...receipt.contentIds].sort());
    assert.ok(!production.some(content=>content.contentId===baselineId));
    const maintain=composeVocabularySessionPayload({sessionId:'maintain',words:[{wordId:'w1',mode:'maintain',selectedSkill:'production'}]});
    const maintained=maintain.words.w1.general.maintain.filter(content=>content.kind==='exercise'&&content.skill==='production');
    assert.deepEqual(maintained.map(content=>content.contentId),[baselineId]);
  });
  assert.deepEqual(db.prepare('SELECT * FROM learner_senses').all(),historicalScopes);
  assert.equal(db.prepare('SELECT count(*) n FROM content_mode_suitability').get()!.n,0);
  assert.equal(getVocabularyContentForMaintenance(baselineId)!.availability,'active');
});

test('application requires maintenance, disabled provider work and stopped-writer confirmation',async()=>{
  establish(true);const {result}=await generate();
  await assert.rejects(applyBulkRepertoireWord(result,{...authority,confirmAppStopped:false}),/stopped-writer/);
  db.exec("UPDATE service_controls SET enabled=0 WHERE control_key='maintenance_mode'");
  await assert.rejects(applyBulkRepertoireWord(result,authority),/Maintenance/);
  db.exec("UPDATE service_controls SET enabled=1 WHERE control_key IN ('maintenance_mode','provider_work_enabled')");
  await assert.rejects(applyBulkRepertoireWord(result,authority),/Maintenance/);
  assert.equal(db.prepare('SELECT count(*) n FROM model_invocations').get()!.n,0);
});

test('publication failure rolls back imported invocations, generated senses, defaults and prerequisite work together',async()=>{
  const before=tables();const {result}=await generate();
  db.exec("CREATE TRIGGER fail_bulk_content BEFORE INSERT ON content_items WHEN NEW.author_id='vocabulary-bulk-repertoire' BEGIN SELECT RAISE(ABORT,'injected publication failure'); END");
  await assert.rejects(applyBulkRepertoireWord(result,authority),/injected publication failure/);
  assert.equal(getVocabularySenseCatalog('w1').establishedAt,null);assert.deepEqual(getVocabularySenses('w1'),[]);
  assert.equal(getVocabularyWordSenseCoverage('w1').defaultUsefulSenseIds,null);
  for(const table of ['model_invocations','content_items','vocabulary_sense_readiness','vocabulary_default_selection_readiness'])assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get()!.n,0,table);
  assert.equal(db.prepare('SELECT count(*) n FROM backend_events WHERE name=?').get(BULK_REPERTOIRE_APPLIED)!.n,0);assert.deepEqual(tables(),before);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  db.exec('DROP TRIGGER fail_bulk_content');
  const receipt=await applyBulkRepertoireWord(result,authority);assert.equal(receipt.replayed,false);assert.equal(receipt.contentIds.length,2);
});
