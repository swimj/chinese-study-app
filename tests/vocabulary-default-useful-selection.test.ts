import { createOpenAiCompatibleAdapter } from '../server/llm/openai-compatible.ts';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { before,after,beforeEach,afterEach,test } from 'node:test';
import { createBaselineFixture } from './helpers/baseline-database.ts';
import { migrateDatabase } from '../server/db/migrations.ts';
import { setDb } from '../server/db/connection.ts';
import { createVocabularySense,establishVocabularySenseCatalog,getVocabularySenseCatalog,getVocabularySenses } from '../server/db/vocabulary-content.ts';
import { getVocabularyWordSenseCoverage,writeVocabularyDefaultUsefulSenses } from '../server/db/vocabulary-sense-coverage.ts';
import { claimSharedWordIntroductionStage,finishSharedWordIntroductionBootstrap } from '../server/db/word-introductions.ts';
import { ensureVocabularySenses,VocabularySenseReadinessPending,VocabularySenseSelectionRequired } from '../server/vocabulary/sense-readiness.ts';
import { createUsefulSelectionProvider,defaultUsefulInitializationPlan,ensureVocabularyDefaultUsefulSelection,initializeDefaultUsefulBatch } from '../server/vocabulary/default-useful-selection.ts';
let root:string,baseline:string,db:DatabaseSync;
const actor={kind:'service' as const,id:'fixture'};
before(()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),'default-useful-'));const folder=path.join(root,'baseline');createBaselineFixture(folder);baseline=path.join(folder,'app.db');});
after(()=>fs.rmSync(root,{recursive:true,force:true}));
beforeEach(()=>{fs.copyFileSync(baseline,path.join(root,'current.db'));db=new DatabaseSync(path.join(root,'current.db'));db.exec('PRAGMA foreign_keys=ON');db.function('current_learner_id',()=> 'learner');migrateDatabase(db);setDb(db);
  db.exec("INSERT INTO lexical_words(id,hanzi,traditional,pinyin,meaning,meanings_json,examples_json,priority,created_at) VALUES ('word','函',NULL,'hán','letter; case','[\"letter\",\"case\"]','[]',1,'2026-10-29')");});
afterEach(()=>{setDb(null);db.close();});
function inventory(){for(const [id,label] of [['letter','formal correspondence'],['case','literary case']] as const)createVocabularySense({senseId:id,wordId:'word',description:{label,notes:[]} },actor);establishVocabularySenseCatalog('word',getVocabularySenseCatalog('word').version,actor);}
function imported(){const now=new Date().toISOString();claimSharedWordIntroductionStage('word','bootstrap','claim',now,new Date(Date.now()+300_000).toISOString());finishSharedWordIntroductionBootstrap('word','claim',{schemaVersion:1,id:'document',word:{wordId:'word',hanzi:'函',traditional:null,pinyin:'hán'},uses:[{id:'u1',label:'formal correspondence',notes:[],exampleIds:['e1']}],examples:[{id:'e1',text:'来函',translation:'A letter received',pronunciation:null}]},'fixture');}
test('imported active teaching senses deterministically initialize defaults without a model',async()=>{
  imported();const senses=getVocabularySenses('word');assert.equal(defaultUsefulInitializationPlan('word').kind,'imported');
  const result=await ensureVocabularyDefaultUsefulSelection('word',{workflowId:'legacy',provider:{isConfigured:()=>true,select:async()=>assert.fail('Imported senses must not call selector')}});
  assert.deepEqual(result.defaultUsefulSenseIds,senses.filter(sense=>sense.status==='active').map(sense=>sense.senseId));
  assert.equal(db.prepare('SELECT count(*) n FROM vocabulary_default_selection_readiness').get()!.n,0);
  const history=db.prepare("SELECT snapshot_json FROM vocabulary_sense_coverage_history WHERE subject_id='word'").get()!;
  assert.equal(JSON.parse(String(history.snapshot_json)).reason.source,'imported_teaching');
});
test('selector uses existing IDs without editing inventory and reuses established policy',async()=>{
  inventory();const before=getVocabularySenses('word');let calls=0;
  const provider={isConfigured:()=>true,async select(input:{senses:typeof before}){calls++;assert.deepEqual(input.senses,before);return {senseIds:['letter']};}};
  const result=await ensureVocabularyDefaultUsefulSelection('word',{workflowId:'first',provider});assert.deepEqual(result.defaultUsefulSenseIds,['letter']);
  await ensureVocabularyDefaultUsefulSelection('word',{workflowId:'repeat',provider});assert.equal(calls,1);assert.deepEqual(getVocabularySenses('word'),before);
  assert.equal(db.prepare("SELECT work_id FROM vocabulary_preparation_attempts WHERE preparation_kind='sense'").get()!.work_id,'default-selection:word');
});
for(const selected of [[],['letter']])test(`model zero recommendation retains inventory and operator choice resolves attention (${selected.length})`,async()=>{
  const ready=await ensureVocabularySenses('word',{workflowId:'fresh',provider:{isConfigured:()=>true,generate:async()=>({senses:[{label:'formal correspondence',notes:[],defaultUseful:false},{label:'literary case',notes:[],defaultUseful:false}]})}});
  assert.equal(ready.senses.length,2);assert.equal(getVocabularyWordSenseCoverage('word').defaultUsefulSenseIds,null);
  assert.equal(db.prepare("SELECT status FROM vocabulary_default_selection_readiness WHERE word_id='word'").get()!.status,'failed');
  await assert.rejects(ensureVocabularyDefaultUsefulSelection('word',{workflowId:'wait',provider:{isConfigured:()=>true,select:async()=>assert.fail('Must wait for operator')}}),VocabularySenseSelectionRequired);
  const ids=selected.length?[ready.senses[0]!.senseId]:[];writeVocabularyDefaultUsefulSenses('word',0,ids,actor);
  const fixed=await ensureVocabularyDefaultUsefulSelection('word',{workflowId:'fixed'});assert.deepEqual(fixed.defaultUsefulSenseIds,ids);
  assert.equal(db.prepare("SELECT status,last_error FROM vocabulary_default_selection_readiness WHERE word_id='word'").get()!.status,'ready');
});
test('selector empty recommendation is attention, not an explicit empty policy',async()=>{
  inventory();await assert.rejects(ensureVocabularyDefaultUsefulSelection('word',{workflowId:'zero',provider:{isConfigured:()=>true,select:async()=>({senseIds:[]})}}),VocabularySenseSelectionRequired);
  assert.equal(getVocabularyWordSenseCoverage('word').defaultUsefulSenseIds,null);
  assert.equal(db.prepare('SELECT outcome FROM vocabulary_preparation_attempts').get()!.outcome,'failed');
  assert.deepEqual(JSON.parse(String(db.prepare('SELECT recommendation_json FROM vocabulary_default_selection_readiness').get()!.recommendation_json)).senseIds,[]);
});
test('concurrent operator policy wins without dropping model recommendation evidence',async()=>{
  inventory();const result=await ensureVocabularyDefaultUsefulSelection('word',{workflowId:'race',provider:{isConfigured:()=>true,async select(){writeVocabularyDefaultUsefulSenses('word',0,['case'],actor);return {senseIds:['letter']};}}});
  assert.deepEqual(result.defaultUsefulSenseIds,['case']);
  const event=db.prepare("SELECT data_json FROM backend_events WHERE name='vocabulary.default_selection.recommended'").get()!;assert.equal(JSON.parse(String(event.data_json)).applied,false);
  assert.deepEqual(JSON.parse(String(db.prepare('SELECT recommendation_json FROM vocabulary_default_selection_readiness').get()!.recommendation_json)).senseIds,['letter']);
});
test('publication maintenance defers selector without losing inventory or permanently pausing',async()=>{
  inventory();let enabled=true;await assert.rejects(ensureVocabularyDefaultUsefulSelection('word',{workflowId:'race',canPublish:()=>enabled,provider:{isConfigured:()=>true,async select(){enabled=false;return {senseIds:['letter']};}}}),VocabularySenseReadinessPending);
  assert.equal(getVocabularyWordSenseCoverage('word').defaultUsefulSenseIds,null);assert.equal(getVocabularySenses('word').length,2);
  assert.equal(db.prepare('SELECT status,attempt_count FROM vocabulary_default_selection_readiness').get()!.status,'queued');
});
test('cutover dry-run is read-only; imported application is bounded and repeatable',async()=>{
  imported();const changes=db.prepare('SELECT total_changes() n').get()!.n;
  const dry=await initializeDefaultUsefulBatch({apply:false,limit:1});assert.equal(dry.items[0]!.kind,'imported');assert.equal(db.prepare('SELECT total_changes() n').get()!.n,changes);
  const applied=await initializeDefaultUsefulBatch({apply:true,limit:1});assert.equal(applied.items[0]!.outcome,'initialized');
  const version=getVocabularyWordSenseCoverage('word').version;const repeat=await initializeDefaultUsefulBatch({apply:true,limit:1});assert.equal(repeat.items[0]!.kind,'known');assert.equal(getVocabularyWordSenseCoverage('word').version,version);
});

test('an explicit operator none decision is preserved while a fresh inventory recommendation is audited',async()=>{
  writeVocabularyDefaultUsefulSenses('word',0,[],actor);
  await ensureVocabularySenses('word',{workflowId:'manual-first',provider:{isConfigured:()=>true,generate:async()=>({senses:[{label:'letter',notes:[],defaultUseful:true}]})}});
  assert.deepEqual(getVocabularyWordSenseCoverage('word').defaultUsefulSenseIds,[]);
  const event=db.prepare("SELECT data_json FROM backend_events WHERE name='vocabulary.default_selection.recommended'").get()!;
  assert.equal(JSON.parse(String(event.data_json)).applied,false);assert.equal(JSON.parse(String(event.data_json)).senseIds.length,1);
});

test('stale canonical import links raise attention without invoking selection or changing defaults',async()=>{
  imported();const sense=getVocabularySenses('word')[0]!;
  const {updateVocabularySense}=await import('../server/db/vocabulary-content.ts');
  updateVocabularySense(sense.senseId,sense.version,{description:sense.description,status:'active'},actor);
  assert.equal(defaultUsefulInitializationPlan('word').kind,'attention');
  await assert.rejects(ensureVocabularyDefaultUsefulSelection('word',{workflowId:'stale',provider:{isConfigured:()=>true,select:async()=>assert.fail('Stale source must be reviewed')}}),/mappings are missing or stale/);
  assert.equal(getVocabularyWordSenseCoverage('word').defaultUsefulSenseIds,null);
});
test('an unestablished partial inventory cannot be assigned defaults implicitly',async()=>{
  createVocabularySense({senseId:'partial',wordId:'word',description:'A partial sense'},actor);
  assert.equal(defaultUsefulInitializationPlan('word').kind,'attention');
  await assert.rejects(ensureVocabularyDefaultUsefulSelection('word',{workflowId:'partial'}),/not established/);
  assert.equal(getVocabularyWordSenseCoverage('word').defaultUsefulSenseIds,null);
});


test('selector uses call-local IDs on the wire and persists only decoded canonical IDs',async()=>{
  inventory();let wireIds:string[]=[],enumIds:string[]=[];
  const adapter=createOpenAiCompatibleAdapter({id:'openai',defaultBaseUrl:'https://example.invalid',apiKeyEnvironmentVariable:'KEY',structuredOutputMode:'json_schema',maxTokensField:'max_completion_tokens',fetchImplementation:async(_url,init)=>{
    const request=JSON.parse(String(init?.body));const input=JSON.parse(request.messages[1].content);
    wireIds=input.senses.map((sense:{senseId:string})=>sense.senseId);enumIds=request.response_format.json_schema.schema.properties.senseIds.items.enum;
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({senseIds:['s2']})},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:10}}),{status:200});
  }});
  const provider=createUsefulSelectionProvider({environment:{OPENAI_API_KEY:'fake'},adapter});
  const result=await ensureVocabularyDefaultUsefulSelection('word',{workflowId:'local-references',provider});
  assert.deepEqual(wireIds,['s1','s2']);assert.deepEqual(enumIds,wireIds);
  // The canonical inventory order is stable, but its persisted identities are never model IDs.
  assert.deepEqual(result.defaultUsefulSenseIds,[getVocabularySenses('word')[1]!.senseId]);
  assert.ok(result.defaultUsefulSenseIds!.every(id=>!/^s\d+$/.test(id)));
});
for(const bad of [['letter'],['s99'],['s1','s1']])test(`selector rejects foreign/canonical/duplicate wire references (${bad.join(',')})`,async()=>{
  inventory();const adapter=createOpenAiCompatibleAdapter({id:'openai',defaultBaseUrl:'https://example.invalid',apiKeyEnvironmentVariable:'KEY',structuredOutputMode:'json_schema',maxTokensField:'max_completion_tokens',fetchImplementation:async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({senseIds:bad})},finish_reason:'stop'}]}),{status:200})});
  const provider=createUsefulSelectionProvider({environment:{OPENAI_API_KEY:'fake'},adapter});
  await assert.rejects(provider.select({word:{wordId:'word',hanzi:'函',traditional:null,pinyin:'hán',meanings:['letter']},senses:getVocabularySenses('word')},{workflowId:'invalid-wire',attemptNumber:1,onInvocation:()=>{}}),/invalid/);
  assert.equal(getVocabularyWordSenseCoverage('word').defaultUsefulSenseIds,null);
});
