import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { experimentOutputSchema } from '../server/word-content-lab/vocabulary-experiments/contracts.ts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { before,after,beforeEach,afterEach,test } from 'node:test';
import { createBaselineFixture } from './helpers/baseline-database.ts';
import { migrateDatabase } from '../server/db/migrations.ts';
import { setDb } from '../server/db/connection.ts';
import { runWithLearnerId } from '../server/db/learner-context.ts';
import { createVocabularyContent } from '../server/db/vocabulary-content.ts';
import { claimSharedWordIntroductionStage,finishSharedWordIntroductionBootstrap,releaseSharedWordIntroductionStage,
  getSharedWordIntroductionContent } from '../server/db/word-introductions.ts';
import { createSharedWordPreparation } from '../server/word-content/shared-preparation.ts';
import { createWordIntroductionProvider,type WordIntroductionProvider } from '../server/word-content/provider.ts';
import { createVocabularyPracticeWorker } from '../server/vocabulary/preparation-worker.ts';
import { getActiveProviderWorkCount } from '../server/hosted-runtime-controls.ts';
import { addVocabularyWord,changeVocabularyMode } from '../server/db/vocabulary-learners.ts';
import { createVocabularySession } from '../server/db/vocabulary-sessions.ts';
import { createVocabularyPracticePreparation,createVocabularyPracticeProvider,VOCABULARY_PRACTICE_SERVICE } from '../server/vocabulary/preparation.ts';
import { installModelInvocationLedger } from '../server/llm/invocation-ledger.ts';
import { startModelInvocation,startServiceModelInvocation,finishModelInvocation,finishServiceModelInvocation } from '../server/db/model-invocations.ts';
import { linkVocabularyInvocationContent } from '../server/db/vocabulary-provenance.ts';
import type { WordContentDocument } from '../src/domain/word-content/types.ts';
let root: string; let baseline: string; let db: DatabaseSync;
const oldEnvironment: Record<string,string | undefined> = {};
const content: WordContentDocument = { schemaVersion: 1,id: 'bootstrap',word: { wordId: 'w1',hanzi: '你好',traditional: null,pinyin: 'nǐ hǎo' },
  uses: [{ id: 'u1',label: 'greeting',notes: ['Greet someone'],exampleIds: ['e1'] }],
  examples: [{ id: 'e1',text: '你好！',translation: 'Hello!',pronunciation: 'nǐ hǎo' }] };
before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(),'vocabulary-preparation-'));
  const directory = path.join(root,'baseline'); createBaselineFixture(directory); baseline = path.join(directory,'app.db');
  for (const key of ['APP_MODE','APP_DATA_DIR','APP_AUTH_MODE']) oldEnvironment[key] = process.env[key];
  process.env.APP_MODE='study';process.env.APP_DATA_DIR=root;process.env.APP_AUTH_MODE='clerk';
  installModelInvocationLedger();
});
after(() => { for (const [key,value] of Object.entries(oldEnvironment)) { if (value === undefined) delete process.env[key]; else process.env[key]=value; }
  fs.rmSync(root,{ recursive: true,force: true }); });
beforeEach(() => {
  const file = path.join(root,`${Math.random()}.db`); fs.copyFileSync(baseline,file); db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys=ON');db.function('current_learner_id',() => 'a');migrateDatabase(db);setDb(db);
  db.prepare("INSERT INTO learners(learner_id,display_name,created_at) VALUES ('a','A',?),('b','B',?)").run(new Date().toISOString(),new Date().toISOString());
  db.prepare(`INSERT INTO lexical_words(id,hanzi,traditional,pinyin,meaning,meanings_json,examples_json,priority,created_at)
    VALUES ('w1','你好',NULL,'nǐ hǎo','hello','["hello"]','[]',1,?)`).run(new Date().toISOString());
  const now = new Date().toISOString();
  assert.equal(claimSharedWordIntroductionStage('w1','bootstrap','bootstrap-claim',now,new Date(Date.now()+300_000).toISOString()),'claimed');
  finishSharedWordIntroductionBootstrap('w1','bootstrap-claim',content,'test-model');
});
afterEach(() => db.close());
function output(count = 6) {
  return { exercises: Array.from({ length: count },(_,i) => ({ id: `exercise-${i}`,sourceUseId: i === 0 ? null : 'u1',
    stimulus: { kind: 'direct_text',text: `A greeting, version ${i+1}.` },teachingNote: i % 2 ? 'Use when greeting someone.' : null })) };
}
function response(value: unknown): Response {
  return new Response(JSON.stringify({ id: 'provider-result',model: 'resolved-model',choices: [{ message: { content: JSON.stringify(value) },finish_reason: 'stop' }],
    usage: { prompt_tokens: 20,completion_tokens: 50,total_tokens: 70 } }),{ status: 200,headers: { 'content-type': 'application/json' } });
}

test('generous general generation retains service invocation, exact prompt/source, answers and independent use hints', async () => {
  let calls = 0;let sent: Record<string,unknown> = {};
  const provider = createVocabularyPracticeProvider({ environment: { OPENAI_API_KEY: 'test-key' },fetchImplementation: (async (_url,init) => {
    calls++;sent=JSON.parse(String(init?.body));return response(output());
  }) as typeof fetch });
  const preparation = createVocabularyPracticePreparation({ provider });
  const work = preparation.ensure('w1')!;assert.equal(work.status,'queued');assert.equal(preparation.listQueued().length,1);
  await preparation.prepare('w1');await preparation.prepare('w1');assert.equal(calls,1);
  const rows = db.prepare("SELECT * FROM content_items WHERE exercise_role='general'").all() as Array<{ origin_kind: string; access_scope: string }>;assert.equal(rows.length,6);
  assert.ok(rows.every((row) => row.origin_kind === 'model' && row.access_scope === 'shared'));
  const invocation = db.prepare("SELECT * FROM model_invocations WHERE actor_id=?").get(VOCABULARY_PRACTICE_SERVICE)!;
  assert.equal(invocation.actor_kind,'service');assert.equal(invocation.learner_id,null);assert.equal(invocation.status,'completed');
  assert.equal(invocation.prompt_name,'vocabulary-general-exercises');assert.equal(invocation.prompt_version,'v4');
  assert.ok(invocation.prompt_template);assert.ok(invocation.prompt_hash);assert.ok(invocation.request_snapshot_json);assert.ok(invocation.response_snapshot_json);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM invocation_content_links WHERE invocation_id=? AND role='output'").get(invocation.id)!.n,6);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM invocation_sense_links WHERE invocation_id=? AND role='input'").get(invocation.id)!.n,1);
  const answers = db.prepare('SELECT accepted_forms_json FROM exercise_answer_words').all() as Array<{ accepted_forms_json: string }>;assert.ok(answers.every((row) => row.accepted_forms_json === '["你好"]'));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM content_words WHERE sense_id IS NOT NULL").get()!.n,5);
  const messages = sent.messages as Array<{ content: string }>;
  assert.match(messages[0]!.content,/Five or six/);assert.deepEqual(JSON.parse(messages[1]!.content).content,content);
  assert.equal(db.prepare('SELECT status FROM vocabulary_practice_preparation').get()!.status,'ready');
});

test('invalid preparation retries after 30 and 60 seconds, then an operator starts a new bounded cycle retaining history', async () => {
  let now=Date.now(),calls=0;
  const bad=output(1);bad.exercises[0]!.sourceUseId='invented-use';
  const provider=createVocabularyPracticeProvider({environment:{OPENAI_API_KEY:'test-key'},fetchImplementation:(async()=>{calls++;return response(bad);})as typeof fetch});
  let preparation=createVocabularyPracticePreparation({provider,now:()=>new Date(now).toISOString()});
  await assert.rejects(preparation.prepare('w1'),/failed validation/);
  const work=preparation.ensure('w1')!;
  assert.equal(work.status,'queued');assert.equal(preparation.listFailed().length,0);
  assert.equal(work.nextAttemptAt,new Date(now+30_000).toISOString());
  assert.equal(db.prepare('SELECT status FROM model_invocations').get()!.status,'invalid_response');
  // A fresh service instance honors the durable due time.
  preparation=createVocabularyPracticePreparation({provider,now:()=>new Date(now).toISOString()});
  now+=29_999;await preparation.prepare('w1');assert.equal(calls,1);assert.equal(preparation.listQueued().length,0);
  now++;await assert.rejects(preparation.prepare('w1'));assert.equal(calls,2);
  assert.equal(preparation.ensure('w1')!.nextAttemptAt,new Date(now+60_000).toISOString());
  now+=59_999;await preparation.prepare('w1');assert.equal(calls,2);
  now++;await assert.rejects(preparation.prepare('w1'));assert.equal(calls,3);
  const failed=preparation.listFailed();assert.equal(failed.length,1);assert.equal(failed[0]!.attemptCount,3);assert.equal(failed[0]!.retryable,true);
  now+=600_000;await preparation.prepare('w1');assert.equal(calls,3);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM content_items WHERE exercise_role='general'").get()!.n,0);
  assert.throws(()=>preparation.retry(work.workId,''),/Operator/);
  preparation.retry(work.workId,'operator');assert.equal(preparation.ensure('w1')!.attemptCount,0);
  await assert.rejects(preparation.prepare('w1'));assert.equal(calls,4);
  const attempts=db.prepare('SELECT attempt_number,cycle_attempt,outcome,invocation_id FROM vocabulary_preparation_attempts ORDER BY attempt_number').all();
  assert.deepEqual(attempts.map(row=>[row.attempt_number,row.cycle_attempt,row.outcome]),[[1,1,'failed'],[2,2,'failed'],[3,3,'failed'],[4,1,'failed']]);
  assert.ok(attempts.every(row=>typeof row.invocation_id==='string'));
  assert.equal(preparation.ensure('w1')!.totalAttemptCount,4);
});

test('expired work cannot publish and interrupted outcomes retry only after the old lease is fenced', async () => {
  let now = new Date().toISOString();
  const provider = createVocabularyPracticeProvider({ environment: { OPENAI_API_KEY: 'test-key' },fetchImplementation: (async () => {
    now = new Date(Date.parse(now)+6*60_000).toISOString();return response(output());
  }) as typeof fetch });
  const preparation = createVocabularyPracticePreparation({ provider,now: () => now });
  await assert.rejects(preparation.prepare('w1'),/lease changed/);
  assert.equal(preparation.listQueued().length,0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM content_items WHERE exercise_role='general'").get()!.n,0);
  // A second brief creates a distinct queued job; recovery fences and schedules its expired call.
  const second = createVocabularyPracticePreparation({ provider: { ...provider,generationKey: () => 'changed-brief' },now: () => now });
  const work = second.ensure('w1')!;assert.ok(second.claim(work.workId));
  now = new Date(Date.parse(now)+6*60_000).toISOString();second.recoverExpired();
  assert.equal(db.prepare('SELECT last_error FROM vocabulary_practice_preparation WHERE work_id=?').get(work.workId)!.last_error,'interrupted_unknown_outcome');
  assert.equal(second.claim(work.workId),null);
  now=new Date(Date.parse(now)+30_000).toISOString();assert.ok(second.claim(work.workId));
});

test('provenance enforces exact versions, ownership and private-input publication boundaries', () => {
  const actor = { kind: 'service' as const,id: 'test-author' };
  const common = { kind: 'exercise' as const,payloadVersion: 1,body: 'hello',exerciseType: 'definition',skill: 'production',exerciseRole: 'general' as const,
    assessment: {},availability: 'active' as const,originKind: 'human' as const,words: [{ wordId: 'w1',relation: 'target' as const }],answers: [{ wordId: 'w1',acceptedForms: ['你好'] }] };
  const shared=createVocabularyContent({ ...common,contentId:'shared',accessScope:'shared' },actor);
  const privateContent=createVocabularyContent({ ...common,contentId:'private',accessScope:'private',ownerLearnerId:'a' },actor);
  const serviceId=startServiceModelInvocation({ provider:'openai',model:'test',invocationType:'test',serviceId:'test-author' });
  assert.throws(() => linkVocabularyInvocationContent({ invocationId:serviceId,contentId:shared.contentId,contentVersion:1,role:'output' },actor),/outcome/);
  finishServiceModelInvocation(serviceId,'test-author','completed',1);
  assert.throws(() => linkVocabularyInvocationContent({ invocationId:serviceId,contentId:shared.contentId,contentVersion:99,role:'output' },actor),/FOREIGN KEY/);
  assert.throws(() => linkVocabularyInvocationContent({ invocationId:serviceId,contentId:privateContent.contentId,contentVersion:1,role:'input' },actor),/scope/);
  runWithLearnerId('a',() => {
    const invocationId=startModelInvocation({ provider:'openai',model:'test',invocationType:'test' });finishModelInvocation(invocationId,'completed',1);
    const learner={ kind:'learner' as const,id:'a' };
    linkVocabularyInvocationContent({ invocationId,contentId:privateContent.contentId,contentVersion:1,role:'input' },learner);
    assert.throws(() => linkVocabularyInvocationContent({ invocationId,contentId:shared.contentId,contentVersion:1,role:'output' },learner),/private authored input/);
    assert.throws(() => linkVocabularyInvocationContent({ invocationId,contentId:privateContent.contentId,contentVersion:1,role:'input' },actor),/specified actor/);
  });
});

test('teaching exercises consume exact retained introduction and keep successful introduction after exercise failure', async () => {
  const order: string[]=[];let teachingCalls=0;let practiceCalls=0;
  const beats=[{ id:'intro',parts:[{ kind:'text' as const,text:'We greet a familiar person with this expression.' }] }];
  const provider: WordIntroductionProvider = { model:'test-model',isConfigured:()=>true,
    generationKey:async (stage,teaching)=>stage==='teaching'?'teaching-v1':`practice:${JSON.stringify(teaching)}`,
    generateBootstrap:async()=>{throw new Error('unexpected bootstrap');},generateReview:async()=>{throw new Error('unexpected review');},
    generateTeaching:async()=>{teachingCalls++;order.push('teaching');return { beats };},
    generatePractice:async (_content,options)=>{
      practiceCalls++;order.push('practice');assert.deepEqual(options!.teaching!.beats,beats);
      assert.equal(options!.teaching!.wordContentId,content.id);
      if(practiceCalls===1)throw new Error('unavailable');
      return { rehearsals:[{id:'r1',stimulus:{kind:'direct_text',text:'A greeting to someone familiar.'}}] };
    } };
  const service=createSharedWordPreparation(provider);
  function claim(token:string) { assert.equal(service.claim('w1','teaching',token,new Date().toISOString(),new Date(Date.now()+300_000).toISOString()),'claimed'); }
  claim('first');await assert.rejects(service.generate('w1','teaching','first'));releaseSharedWordIntroductionStage('w1','first');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM word_introduction_components WHERE stage='teaching'").get()!.n,1);
  claim('retry');await service.generate('w1','teaching','retry');
  assert.equal(teachingCalls,1);assert.equal(practiceCalls,2);assert.deepEqual(order,['teaching','practice','practice']);
  const intro = db.prepare("SELECT body_json FROM content_items WHERE kind='introduction'").get()!;
  assert.equal(JSON.parse(intro.body_json as string).beats[0].parts[0].text,beats[0]!.parts[0]!.text);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM content_items WHERE exercise_role='teaching'").get()!.n,1);
});

test('actual teaching-exercise transport retains delivered text and changes generation key with it', async () => {
  let sent:Record<string,unknown>={};
  const provider=createWordIntroductionProvider({environment:{OPENAI_API_KEY:'test-key'},fetchImplementation:(async(_url,init)=>{
    sent=JSON.parse(String(init?.body));return response({exercises:[{id:'r',sourceUseId:'u1',stimulus:{kind:'direct_text',text:'Hello.'},teachingNote:'A familiar greeting.'}]});
  }) as typeof fetch});
  const teaching={id:'intro',wordContentId:content.id,beats:[{id:'b',parts:[{kind:'text' as const,text:'A familiar greeting.'}]}]};
  const adapted=await provider.generatePractice(content,{teaching,invocationActor:{kind:'service',serviceId:'teaching-test'}});
  assert.deepEqual(adapted,{rehearsals:[{id:'r',stimulus:{kind:'direct_text',text:'Hello.'}}]});
  const messages=sent.messages as Array<{content:string}>;assert.equal(JSON.parse(messages[1]!.content).deliveredIntroduction.beats[0].parts[0].text,'A familiar greeting.');
  assert.match(messages[0]!.content,/exact introduction delivered/);
  const projected=JSON.parse(messages[1]!.content);assert.equal(projected.role,'teaching_exercises');assert.deepEqual(projected.content,content);
  const invocation=db.prepare("SELECT prompt_name,prompt_version,step_name,response_snapshot_json FROM model_invocations WHERE actor_id='teaching-test'").get()!;
  assert.equal(invocation.prompt_name,'vocabulary-teaching-exercises');assert.equal(invocation.prompt_version,'v2');assert.equal(invocation.step_name,'teaching_exercises');
  assert.match(String(invocation.response_snapshot_json),/sourceUseId/);assert.match(String(invocation.response_snapshot_json),/teachingNote/);
  assert.notEqual(await provider.generationKey('practice',teaching),await provider.generationKey('practice',{...teaching,beats:[]}));
  assert.notEqual(await provider.generationKey('practice',teaching),await provider.generationKey('practice'));
  assert.ok(getSharedWordIntroductionContent('w1'));
});

test('successful real shared teaching transport publishes separate author and exercise-input provenance', async () => {
  const provider=createWordIntroductionProvider({environment:{OPENAI_API_KEY:'test-key'},fetchImplementation:(async(_url,init)=>{
    const sent=JSON.parse(String(init?.body));
    const name=sent.response_format.json_schema.name as string;
    return response(name==='intro_lab_teaching_v2' ? {beats:[{id:'b',parts:[{kind:'text',text:'Use this expression to greet a familiar person.'}]}]}
      : {exercises:[{id:'r',sourceUseId:'u1',stimulus:{kind:'direct_text',text:'Greet a familiar person.'},teachingNote:null}]});
  }) as typeof fetch});
  const service=createSharedWordPreparation(provider);
  assert.equal(service.claim('w1','teaching','authoring',new Date().toISOString(),new Date(Date.now()+300_000).toISOString()),'claimed');
  await service.generate('w1','teaching','authoring');
  const calls=db.prepare('SELECT id,prompt_name,actor_kind,actor_id,workflow_id FROM model_invocations ORDER BY timestamp').all() as Array<{
    id:string;prompt_name:string;actor_kind:string;actor_id:string;workflow_id:string}>;
  assert.equal(calls.length,2);assert.ok(calls.every((call)=>call.actor_kind==='service'&&call.actor_id==='vocabulary-shared-authoring'&&call.workflow_id==='authoring'));
  const lesson=calls.find((call)=>call.prompt_name==='vocabulary-introduction')!;
  const exercises=calls.find((call)=>call.prompt_name==='vocabulary-teaching-exercises')!;
  const output=db.prepare("SELECT c.kind,c.exercise_role FROM invocation_content_links l JOIN content_items c ON c.content_id=l.content_id WHERE l.invocation_id=? AND l.role='output'").all(lesson.id);
  assert.equal(output.length,1);assert.equal(output[0]!.kind,'introduction');
  const exerciseOutput=db.prepare("SELECT c.exercise_role FROM invocation_content_links l JOIN content_items c ON c.content_id=l.content_id WHERE l.invocation_id=? AND l.role='output'").all(exercises.id);
  assert.equal(exerciseOutput.length,1);assert.equal(exerciseOutput[0]!.exercise_role,'teaching');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM invocation_content_links WHERE invocation_id=? AND role='input'").get(exercises.id)!.n,1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM invocation_sense_links WHERE role='input'").get()!.n,2);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('bootstrap publication links its actual invocation to seeded sense versions', () => {
  const timestamp=new Date().toISOString();
  db.prepare(`INSERT INTO lexical_words(id,hanzi,traditional,pinyin,meaning,meanings_json,examples_json,priority,created_at)
    VALUES ('w2','您好',NULL,'nín hǎo','greeting','["greeting"]','[]',1,?)`).run(timestamp);
  const invocationId=startServiceModelInvocation({serviceId:'vocabulary-shared-authoring',provider:'openai',model:'test-model',invocationType:'bootstrap'});
  finishServiceModelInvocation(invocationId,'vocabulary-shared-authoring','completed',1);
  assert.equal(claimSharedWordIntroductionStage('w2','bootstrap','b2',timestamp,new Date(Date.now()+300_000).toISOString()),'claimed');
  finishSharedWordIntroductionBootstrap('w2','b2',{...content,id:'bootstrap-w2',word:{wordId:'w2',hanzi:'您好',traditional:null,pinyin:'nín hǎo'},
    examples:[{id:'e1',text:'您好！',translation:'Hello!',pronunciation:'nín hǎo'}]},'test-model',invocationId);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM invocation_sense_links WHERE invocation_id=? AND role='output'").get(invocationId)!.n,1);
});

test('background worker consumes explicitly queued demand, fences provider calls and publishes ready work', async () => {
  runWithLearnerId('a',()=>{const word=addVocabularyWord('w1');changeVocabularyMode('w1','practice',word.stateVersion);
    createVocabularySession({sessionId:'active-demand',words:[{wordId:'w1',mode:'practice'}]});});
  let calls=0;let failures=0;
  const provider=createVocabularyPracticeProvider({environment:{OPENAI_API_KEY:'test'},fetchImplementation:(async()=>{calls++;return response(output());})as typeof fetch});
  createVocabularyPracticePreparation({provider}).ensure('w1');
  const worker=createVocabularyPracticeWorker({provider,onError:()=>{failures++;}});
  db.prepare("UPDATE service_controls SET enabled=0 WHERE control_key='provider_work_enabled'").run();
  assert.equal(await worker.step(),false);assert.equal(calls,0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM vocabulary_practice_preparation').get()!.n,1);
  db.prepare("UPDATE service_controls SET enabled=1 WHERE control_key='maintenance_mode'").run();
  assert.equal(await worker.step(),false);assert.equal(calls,0);
  db.prepare("UPDATE service_controls SET enabled=0 WHERE control_key='maintenance_mode'").run();
  db.prepare("UPDATE service_controls SET enabled=1 WHERE control_key='provider_work_enabled'").run();
  await Promise.all([worker.drain(),worker.drain()]);assert.equal(calls,1);assert.equal(failures,0);
  await worker.drain();assert.equal(calls,1);await worker.stop();
  assert.equal(await worker.step(),false);
});

test('worker rechecks controls after provider-work admission before claiming queued work', async () => {
  let enabled=true;let calls=0;
  const provider=createVocabularyPracticeProvider({environment:{OPENAI_API_KEY:'test'},fetchImplementation:(async()=>{calls++;return response(output());})as typeof fetch});
  const worker=createVocabularyPracticeWorker({provider,demand:()=>['w1'],controls:()=>({maintenanceMode:false,providerWorkEnabled:enabled}),
    providerWork:async(work)=>{enabled=false;return work();}});
  assert.equal(await worker.step(),false);assert.equal(calls,0);
  const row=db.prepare('SELECT status,attempt_count FROM vocabulary_practice_preparation').get()!;
  assert.equal(row.status,'queued');assert.equal(row.attempt_count,0);await worker.stop();
});

test('maintenance fences late model publication while the hosted provider counter retains the in-flight call', async () => {
  let entered!:()=>void;const started=new Promise<void>((resolve)=>{entered=resolve;});
  let release!:()=>void;const wait=new Promise<void>((resolve)=>{release=resolve;});
  const provider=createVocabularyPracticeProvider({environment:{OPENAI_API_KEY:'test'},fetchImplementation:(async()=>{entered();await wait;return response(output());})as typeof fetch});
  const worker=createVocabularyPracticeWorker({provider,demand:()=>['w1']});const step=worker.step();await started;
  assert.equal(getActiveProviderWorkCount(),1);
  db.prepare("UPDATE service_controls SET enabled=1 WHERE control_key='maintenance_mode'").run();release();await step;
  assert.equal(getActiveProviderWorkCount(),0);
  assert.equal(db.prepare("SELECT count(*) AS n FROM content_items WHERE exercise_role='general'").get()!.n,0);
  assert.equal(db.prepare('SELECT status FROM vocabulary_practice_preparation').get()!.status,'failed');
  db.prepare("UPDATE service_controls SET enabled=0 WHERE control_key='maintenance_mode'").run();await worker.drain();
  assert.equal(db.prepare('SELECT attempt_count FROM vocabulary_practice_preparation').get()!.attempt_count,1);await worker.stop();
});

test('worker shutdown waits for an in-flight call, fences publication and never starts failed work again', async () => {
  let entered!:()=>void;const started=new Promise<void>((resolve)=>{entered=resolve;});
  let release!:()=>void;const wait=new Promise<void>((resolve)=>{release=resolve;});let calls=0;
  const provider=createVocabularyPracticeProvider({environment:{OPENAI_API_KEY:'test'},fetchImplementation:(async()=>{calls++;entered();await wait;return response(output());})as typeof fetch});
  const worker=createVocabularyPracticeWorker({provider,demand:()=>['w1']});const step=worker.step();await started;
  let stopped=false;const stop=worker.stop().then(()=>{stopped=true;});await Promise.resolve();assert.equal(stopped,false);
  release();await Promise.all([step,stop]);assert.equal(stopped,true);worker.wake();assert.equal(await worker.step(),false);assert.equal(calls,1);
  assert.equal(db.prepare('SELECT status FROM vocabulary_practice_preparation').get()!.status,'failed');
  const restart=createVocabularyPracticeWorker({provider,demand:()=>['w1']});await restart.drain();assert.equal(calls,1);await restart.stop();
});

test('retained active sessions do not create preparation demand during worker polling', async () => {
  runWithLearnerId('a',()=>{const word=addVocabularyWord('w1');changeVocabularyMode('w1','practice',word.stateVersion);
    createVocabularySession({sessionId:'disabled-demand',words:[{wordId:'w1',mode:'practice'}]});});
  let calls=0;
  const provider=createVocabularyPracticeProvider({environment:{OPENAI_API_KEY:'test'},fetchImplementation:(async()=>{calls++;return response(output());})as typeof fetch});
  const worker=createVocabularyPracticeWorker({provider});assert.equal(await worker.step(),false);assert.equal(calls,0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM vocabulary_practice_preparation').get()!.n,0);await worker.stop();
});

test('teaching trial rejects invented source-use hints before adapting rehearsal wire',async()=>{
 const provider=createWordIntroductionProvider({environment:{OPENAI_API_KEY:'test-key'},fetchImplementation:(async()=>response({exercises:[{
   id:'r',sourceUseId:'not-in-bootstrap',stimulus:{kind:'direct_text',text:'A familiar greeting.'},teachingNote:null,
 }]})) as typeof fetch});
 const teaching={id:'intro',wordContentId:content.id,beats:[{id:'b',parts:[{kind:'text' as const,text:'A greeting.'}]}]};
 await assert.rejects(provider.generatePractice(content,{teaching,invocationActor:{kind:'service',serviceId:'teaching-test'}}),/invalid structure/);
 assert.equal(db.prepare("SELECT status FROM model_invocations WHERE actor_id='teaching-test'").get()!.status,'invalid_response');
 assert.equal(db.prepare("SELECT COUNT(*) n FROM content_items WHERE exercise_role='teaching'").get()!.n,0);
});

test('worker polls delayed retries automatically and maintenance prevents dispatch until lifted',async()=>{
  let now=Date.now(),calls=0,maintenance=false;
  const provider=createVocabularyPracticeProvider({environment:{OPENAI_API_KEY:'test'},fetchImplementation:(async()=>{
    calls++;if(calls<3)throw new Error('transient transport');return response(output());
  })as typeof fetch});
  const worker=createVocabularyPracticeWorker({provider,now:()=>now,demand:()=>['w1'],controls:()=>({maintenanceMode:maintenance,providerWorkEnabled:true}),providerWork:async work=>work()});
  await worker.step();assert.equal(calls,1);
  now+=29_999;assert.equal(await worker.step(),false);assert.equal(calls,1);
  now++;assert.equal(await worker.step(),false);assert.equal(calls,1);
  now+=30_000;await worker.step();assert.equal(calls,2);
  now+=60_000;maintenance=true;assert.equal(await worker.step(),false);assert.equal(calls,2);
  maintenance=false;await worker.step();assert.equal(calls,3);
  assert.equal(db.prepare('SELECT status FROM vocabulary_practice_preparation').get()!.status,'ready');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM vocabulary_preparation_attempts').get()!.n,3);
  await worker.stop();
});

function seedSecondPreparationWord() {
  const timestamp = new Date().toISOString();
  db.prepare(`INSERT INTO lexical_words(id,hanzi,traditional,pinyin,meaning,meanings_json,examples_json,priority,created_at)
    VALUES ('w2','你好',NULL,'nǐ hǎo','hello','["hello"]','[]',1,?)`).run(timestamp);
  assert.equal(claimSharedWordIntroductionStage('w2','bootstrap','second-bootstrap',timestamp,new Date(Date.now()+300_000).toISOString()),'claimed');
  finishSharedWordIntroductionBootstrap('w2','second-bootstrap',{...content,id:'bootstrap2',word:{...content.word,wordId:'w2'}},'test-model');
}

test('provider outage pauses other practice words for 60 seconds without spending their attempts or exposing errors', async () => {
  seedSecondPreparationWord();
  let now = Date.now(), calls = 0, enabled = false;
  const errors: unknown[] = [];
  const provider = createVocabularyPracticeProvider({environment:{OPENAI_API_KEY:'test'},fetchImplementation:(async()=>{
    calls++;return new Response('secret bearer abc123',{status:503});
  }) as typeof fetch});
  const worker = createVocabularyPracticeWorker({provider,concurrency:1,now:()=>now,demand:()=>['w1','w2'],
    controls:()=>({maintenanceMode:false,providerWorkEnabled:enabled}),providerWork:async work=>work(),onError:error=>errors.push(error)});
  await worker.drain();assert.equal(calls,0);
  enabled = true;
  await worker.drain();assert.equal(calls,1);
  const attempts = () => db.prepare('SELECT attempt_count FROM vocabulary_practice_preparation ORDER BY attempt_count').all().map(row=>row.attempt_count);
  assert.deepEqual(attempts(),[0,1]);
  now+=59_999;assert.equal(await worker.step(),false);assert.equal(calls,1);assert.deepEqual(attempts(),[0,1]);
  now++;await worker.step();assert.equal(calls,2);assert.deepEqual(attempts(),[1,1]);
  assert.doesNotMatch(errors.map(String).join('\n'),/abc123/);
  assert.doesNotMatch(JSON.stringify(db.prepare('SELECT last_error FROM vocabulary_practice_preparation').all()),/abc123/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM vocabulary_preparation_attempts').get()!.n,2);
  await worker.stop();
});

for (const failure of ['invalid-json','invalid-structure'] as const) test(`${failure} retries its own job without pausing another practice word`, async () => {
  seedSecondPreparationWord();let calls=0;
  const provider=createVocabularyPracticeProvider({environment:{OPENAI_API_KEY:'test'},fetchImplementation:(async()=>{
    calls++;
    if(calls>1)return response(output());
    if(failure==='invalid-structure')return response(output(0));
    return new Response(JSON.stringify({choices:[{message:{content:'not JSON'},finish_reason:'stop'}]}),{status:200,headers:{'content-type':'application/json'}});
  })as typeof fetch});
  const worker=createVocabularyPracticeWorker({provider,concurrency:1,demand:()=>['w1','w2'],
    controls:()=>({maintenanceMode:false,providerWorkEnabled:true}),providerWork:async work=>work()});
  await worker.drain();assert.equal(calls,2);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM vocabulary_practice_preparation WHERE status='ready'").get()!.n,1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM vocabulary_practice_preparation WHERE status='queued' AND attempt_count=1").get()!.n,1);
  await worker.stop();
});

test('an outage pauses new dispatch without rejecting a running sibling publication', async () => {
  seedSecondPreparationWord();let calls=0;
  let releaseSibling!: (value: unknown) => void;
  const sibling = new Promise<unknown>(resolve => {releaseSibling=resolve;});
  const provider = {model:'test',isConfigured:()=>true,generationKey:()=> 'outage-sibling-test',
    async generate() {
      calls++;
      if(calls===1) {await Promise.resolve();throw new Error('connection unavailable');}
      return sibling;
    }};
  const worker=createVocabularyPracticeWorker({provider,concurrency:2,demand:()=>['w1','w2'],
    controls:()=>({maintenanceMode:false,providerWorkEnabled:true}),providerWork:async work=>work(),
    onError:()=>releaseSibling(output())});
  assert.equal(await worker.step(),true);assert.equal(calls,2);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM vocabulary_practice_preparation WHERE status='ready'").get()!.n,1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM vocabulary_practice_preparation WHERE status='queued'").get()!.n,1);
  assert.equal(await worker.step(),false);assert.equal(calls,2);
  await worker.stop();
});


test('shared authoring extraction preserves the ordinary preparation generation identity',()=>{
  const prompt=fs.readFileSync(new URL('../server/word-content-lab/vocabulary-experiments/prompts/general-exercises-v4.md',import.meta.url),'utf8');
  const priorIdentity={prompt,promptVersion:'v4',schema:experimentOutputSchema({role:'general_exercises',content}),
    model:'gpt-5.6-luna',reasoning:'high',maxOutputTokens:24_000,inputProjectionVersion:'general-exercises-v1'};
  const priorKey=createHash('sha256').update(JSON.stringify(priorIdentity)).digest('hex');
  assert.equal(createVocabularyPracticeProvider({environment:{OPENAI_API_KEY:'fake'}}).generationKey(content),priorKey);
});

for(const badText of ['没有空格。','____'])test(`ordinary preparation reaches shared cloze validation for ${badText}`,async()=>{
  const value={exercises:[{id:'invalid-cloze',sourceUseId:'u1',stimulus:{kind:'phrase_cloze',frame:'A greeting.',text:badText},teachingNote:null}]};
  const provider=createVocabularyPracticeProvider({environment:{OPENAI_API_KEY:'fake'},fetchImplementation:(async()=>response(value))as typeof fetch});
  await assert.rejects(createVocabularyPracticePreparation({provider}).prepare('w1'),/Vocabulary practice generation failed/);
  assert.equal(db.prepare("SELECT count(*) n FROM content_items WHERE exercise_role='general'").get()!.n,0);
});
