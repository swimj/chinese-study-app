import { normalizePracticeRehearsals } from '../server/word-content/authoring.ts';
import { startServiceModelInvocation,finishServiceModelInvocation } from '../server/db/model-invocations.ts';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after,afterEach,before,beforeEach,test } from 'node:test';
import { createBaselineFixture } from './helpers/baseline-database.ts';
import { migrateDatabase } from '../server/db/migrations.ts';
import { setDb } from '../server/db/connection.ts';
import { runWithLearnerId } from '../server/db/learner-context.ts';
import { createSharedWordPreparation } from '../server/word-content/shared-preparation.ts';
import type { WordIntroductionProvider } from '../server/word-content/provider.ts';
import { ensureVocabularySenses,VocabularySenseReadinessPending } from '../server/vocabulary/sense-readiness.ts';
import { getVocabularySenses,updateVocabularySense } from '../server/db/vocabulary-content.ts';
import { resolveVocabularySenseCoverage,writeVocabularyDefaultUsefulSenses } from '../server/db/vocabulary-sense-coverage.ts';
import { claimSharedWordIntroductionStage,finishSharedWordIntroductionBootstrap,finishSharedWordIntroductionTeaching,getSharedWordTeachingPackageId,getSharedWordIntroductionContent } from '../server/db/word-introductions.ts';
import { vocabularyRevealSnapshot } from '../server/vocabulary/reveal-snapshot.ts';
import { enqueueWordPreparation,getWordPreparationWork } from '../server/db/preparation-work.ts';
import { createWordPreparationWorker } from '../server/word-content/preparation-worker.ts';
let root:string,baseline:string,db:DatabaseSync;
const actor={kind:'service' as const,id:'fixture'};
const inventory={senses:[{label:'formal correspondence',notes:['A letter in formal communication.'],defaultUseful:true},{label:'literary case or box',notes:['Peripheral literary use.'],defaultUseful:false}]};
const senseProvider={isConfigured:()=>true,generate:async()=>inventory};
const ensure:typeof ensureVocabularySenses=(wordId,options)=>ensureVocabularySenses(wordId,{...options,provider:senseProvider});
let calls:number;
function provider(onBootstrap?:()=>void):WordIntroductionProvider {
  return {model:'fake',isConfigured:()=>true,generationKey:async()=> 'key',async generateBootstrap(input){calls++;onBootstrap?.();return {uses:input.canonicalSenses!.map(sense=>({id:sense.senseId,exampleIds:['e1']})),examples:[{id:'e1',text:'请来函联系。',translation:'Please contact us by letter.',pronunciation:null}]};},
    generateTeaching:async()=>{throw new Error('Unexpected teaching generation');},generatePractice:async()=>{throw new Error('Unexpected practice generation');},generateReview:async()=>{throw new Error('Unexpected review generation');}};
}
before(()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),'unified-bootstrap-'));const directory=path.join(root,'baseline');createBaselineFixture(directory);baseline=path.join(directory,'app.db');});
after(()=>fs.rmSync(root,{recursive:true,force:true}));
beforeEach(()=>{fs.copyFileSync(baseline,path.join(root,'current.db'));db=new DatabaseSync(path.join(root,'current.db'));db.exec('PRAGMA foreign_keys=ON');db.function('current_learner_id',()=> 'learner');migrateDatabase(db);setDb(db);
  db.exec("INSERT INTO learners(learner_id,display_name,created_at) VALUES ('learner','Learner','2026-10-29'); INSERT INTO lexical_words(id,hanzi,traditional,pinyin,meaning,meanings_json,examples_json,priority,created_at) VALUES ('word','函',NULL,'hán','letter; case','[\"letter\",\"case\"]','[]',1,'2026-10-29')");calls=0;
});
afterEach(()=>{setDb(null);db.close();});
function claim(){const now=new Date().toISOString();assert.equal(claimSharedWordIntroductionStage('word','bootstrap','claim',now,new Date(Date.now()+300_000).toISOString()),'claimed');}
for(const order of ['teaching-first','reflection-first'])test(`${order} shares canonical identity and enriches only persisted useful senses`,async()=>{
  let first:Awaited<ReturnType<typeof ensure>>|undefined;
  if(order==='reflection-first')first=await ensure('word',{workflowId:'reflection'});
  const shared=createSharedWordPreparation(provider(),{ensureSenses:ensure});claim();await shared.generate('word','bootstrap','claim');
  const source=getSharedWordIntroductionContent('word')!,senses=getVocabularySenses('word'),selection=resolveVocabularySenseCoverage('word');
  assert.equal(senses.length,2);assert.equal(source.uses.length,1);assert.deepEqual(source.uses.map(use=>use.id),selection.includedSenseIds);
  assert.equal(source.uses[0].label,'formal correspondence');assert.equal(calls,1);
  if(first)assert.deepEqual(senses,first.senses);
  const mapping=db.prepare('SELECT * FROM legacy_sense_imports WHERE source_content_id=?').get(source.id)!;
  assert.equal(mapping.source_use_id,selection.includedSenseIds[0]);assert.equal(mapping.sense_id,selection.includedSenseIds[0]);assert.equal(mapping.imported_sense_version,1);
  const snapshot=vocabularyRevealSnapshot({contentId:'fixture',version:1,createdAt:'2026-10-29',updatedAt:'2026-10-29',kind:'exercise',payloadVersion:1,body:{prompt:'A formal letter'},exerciseType:'definition',skill:'production',exerciseRole:'general',assessment:{},answers:[{wordId:'word',acceptedForms:['函']}],words:[{wordId:'word',relation:'target',senseId:selection.includedSenseIds[0]}],accessScope:'shared',availability:'active',originKind:'human'});
  assert.equal(snapshot.bootstrapReveal?.useId,selection.includedSenseIds[0]);
  assert.equal((senses[0].description as {source:{kind:string}}).source.kind,'sense_inventory');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});
test('explicit empty selection preserves inventory and makes no enrichment call',async()=>{
  await ensure('word',{workflowId:'first'});writeVocabularyDefaultUsefulSenses('word',1,[],actor);
  const shared=createSharedWordPreparation(provider(),{ensureSenses:ensure});claim();
  await assert.rejects(shared.generate('word','bootstrap','claim'),/No useful senses/);assert.equal(calls,0);assert.equal(getVocabularySenses('word').length,2);
});
test('selection changes during enrichment preserve the captured document scope and mappings',async()=>{
  const shared=createSharedWordPreparation(provider(()=>writeVocabularyDefaultUsefulSenses('word',1,[],actor)),{ensureSenses:ensure});claim();
  await shared.generate('word','bootstrap','claim');
  assert.equal(db.prepare('SELECT count(*) n FROM word_content_documents').get()!.n,1);assert.equal(db.prepare('SELECT count(*) n FROM legacy_sense_imports').get()!.n,1);
  assert.equal(getSharedWordIntroductionContent('word')!.uses[0]!.label,'formal correspondence');
  assert.deepEqual(resolveVocabularySenseCoverage('word').includedSenseIds,[]);
  assert.equal(getVocabularySenses('word').length,2);
});
test('legacy source retains explicit mapped document scope without assigning useful defaults',async()=>{
  claim();finishSharedWordIntroductionBootstrap('word','claim',{schemaVersion:1,id:'legacy',word:{wordId:'word',hanzi:'函',traditional:null,pinyin:'hán'},uses:[{id:'u1',label:'letter',notes:[],exampleIds:['e1']}],examples:[{id:'e1',text:'来函',translation:'A letter received',pronunciation:null}]},'legacy');
  assert.equal(resolveVocabularySenseCoverage('word').selectionEstablished,false);
  const now=new Date().toISOString();claimSharedWordIntroductionStage('word','teaching','teach',now,new Date(Date.now()+300_000).toISOString());
  const shared=createSharedWordPreparation({...provider(),async generateTeaching(){return {beats:[{id:'beat',parts:[{kind:'text',text:'A formal letter.'}]}]};},async generatePractice(){return {rehearsals:[{id:'exercise',stimulus:{kind:'direct_text',text:'A formal letter.'}}]};}});
  await shared.generate('word','teaching','teach');
  assert.equal(db.prepare('SELECT count(*) n FROM word_teaching_packages').get()!.n,1);
  assert.equal(resolveVocabularySenseCoverage('word').selectionEstablished,false);
});
test('worker waits for shared sense readiness without consuming enrichment attempts or leases',async()=>{
  runWithLearnerId('learner',()=>enqueueWordPreparation('word','bootstrap'));
  const retryAt=new Date(Date.now()+60_000).toISOString();
  const worker=createWordPreparationWorker({provider:provider(),ensureSenses:async()=>{throw new VocabularySenseReadinessPending(retryAt);},controls:()=>({maintenanceMode:false,providerWorkEnabled:true}),providerWork:async work=>work()});
  assert.equal(await worker.step(),true);await worker.stop();
  const work=getWordPreparationWork('word','bootstrap')!;assert.equal(work.status,'queued');assert.equal(work.attemptCount,0);assert.equal(work.nextAttemptAt,retryAt);assert.equal(work.activeToken,null);assert.equal(calls,0);
});


test('enrichment invocation consumes canonical versions without claiming sense authorship',async()=>{
  const serviceId='vocabulary-shared-authoring';
  const id=startServiceModelInvocation({serviceId,provider:'fake',model:'fake',invocationType:'bootstrap'});
  finishServiceModelInvocation(id,serviceId,'completed',1);
  const original=provider(),withLedger={...original,async generateBootstrap(input:Parameters<WordIntroductionProvider['generateBootstrap']>[0],options?:Parameters<WordIntroductionProvider['generateBootstrap']>[1]){options?.onInvocation?.(id);return original.generateBootstrap(input,options);}};
  claim();await createSharedWordPreparation(withLedger,{ensureSenses:ensure}).generate('word','bootstrap','claim');
  assert.equal(db.prepare("SELECT count(*) n FROM invocation_sense_links WHERE invocation_id=? AND role='input'").get(id)!.n,1);
  assert.equal(db.prepare("SELECT count(*) n FROM invocation_sense_links WHERE invocation_id=? AND role='output'").get(id)!.n,0);
});


test('an existing prepared legacy package stays available while defaults remain unknown',()=>{
  claim();finishSharedWordIntroductionBootstrap('word','claim',{schemaVersion:1,id:'legacy-ready',word:{wordId:'word',hanzi:'函',traditional:null,pinyin:'hán'},uses:[{id:'u1',label:'letter',notes:[],exampleIds:['e1']}],examples:[{id:'e1',text:'来函',translation:'A letter received',pronunciation:null}]},'legacy');
  const now=new Date().toISOString();claimSharedWordIntroductionStage('word','teaching','teach',now,new Date(Date.now()+300_000).toISOString());
  finishSharedWordIntroductionTeaching('word','teach',{schemaVersion:1,id:'legacy-package',wordContentId:'legacy-ready',beats:[{id:'one',parts:[{kind:'text',text:'A formal letter.'}]}],rehearsals:normalizePracticeRehearsals({rehearsals:[{id:'exercise',stimulus:{kind:'direct_text',text:'A formal letter.'}}]},getSharedWordIntroductionContent('word')!)},'legacy');
  assert.equal(resolveVocabularySenseCoverage('word').selectionEstablished,false);assert.equal(getSharedWordTeachingPackageId('word'),'legacy-package');
  assert.equal(getSharedWordIntroductionContent('word')?.id,'legacy-ready');
});


test('new teaching generation pauses when immutable source sense versions no longer match',async()=>{
  const shared=createSharedWordPreparation(provider(),{ensureSenses:ensure});claim();await shared.generate('word','bootstrap','claim');
  const sense=getVocabularySenses('word').find(sense=>resolveVocabularySenseCoverage('word').includedSenseIds.includes(sense.senseId))!;
  updateVocabularySense(sense.senseId,sense.version,{description:{label:'Updated correspondence',notes:[]},status:'active'},actor);
  assert.throws(()=>shared.validatePreparedSource('word'),/source sense versions changed/);assert.equal(calls,1);
});
for(const stage of ['teaching','review'] as const)test(`${stage} publication fences catalog changes during provider generation`,async()=>{
  const original=provider();
  const change=()=>{const sense=getVocabularySenses('word')[0]!;updateVocabularySense(sense.senseId,sense.version,{description:sense.description,status:'active'},actor);};
  const service=createSharedWordPreparation({...original,
    async generateTeaching(){change();return {beats:[{id:'beat',parts:[{kind:'text',text:'A formal letter.'}]}]};},
    async generateReview(){change();return {exercises:[{id:'review',cueType:'circumstance',stimulus:{kind:'direct_text',text:'A formal letter.'},supplement:null}]};},
  },{ensureSenses:ensure});
  claim();await service.generate('word','bootstrap','claim');
  const now=new Date().toISOString();assert.equal(service.claim('word',stage,'later',now,new Date(Date.now()+300_000).toISOString()),'claimed');
  await assert.rejects(service.generate('word',stage,'later'),/catalog changed/);
  assert.equal(db.prepare('SELECT count(*) n FROM word_teaching_packages').get()!.n,0);
});

for(const stage of ['teaching','review'] as const)test(`${stage} publication retains document scope across serving policy edits`,async()=>{
  const original=provider();const change=()=>writeVocabularyDefaultUsefulSenses('word',1,[],actor);
  const service=createSharedWordPreparation({...original,
    async generateTeaching(){change();return {beats:[{id:'beat',parts:[{kind:'text',text:'A formal letter.'}]}]};},
    async generatePractice(){return {rehearsals:[{id:'exercise',stimulus:{kind:'direct_text',text:'A formal letter.'}}]};},
    async generateReview(){change();return {exercises:[{id:'review',cueType:'circumstance',stimulus:{kind:'direct_text',text:'A formal letter.'},supplement:null}]};},
  },{ensureSenses:ensure});
  claim();await service.generate('word','bootstrap','claim');
  const now=new Date().toISOString();assert.equal(service.claim('word',stage,'later',now,new Date(Date.now()+300_000).toISOString()),'claimed');
  await service.generate('word',stage,'later');assert.deepEqual(resolveVocabularySenseCoverage('word').includedSenseIds,[]);
  assert.equal(db.prepare('SELECT count(*) n FROM word_teaching_packages').get()!.n,stage==='teaching'?1:0);
});
test('canonical edits during enrichment still reject immutable document publication',async()=>{
  const service=createSharedWordPreparation(provider(()=>{const sense=getVocabularySenses('word')[0]!;updateVocabularySense(sense.senseId,sense.version,{description:sense.description,status:'active'},actor);}),{ensureSenses:ensure});claim();
  await assert.rejects(service.generate('word','bootstrap','claim'),/source or catalog changed/);
  assert.equal(db.prepare('SELECT count(*) n FROM word_content_documents').get()!.n,0);
});
