import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach,afterEach,test } from 'node:test';
import { setDb } from '../server/db/connection.ts';
import { runWithLearnerId } from '../server/db/learner-context.ts';
import { createVocabularyContent } from '../server/db/vocabulary-content.ts';
import { createVocabularySession,appendVocabularySessionActions,stageVocabularySessionCompletion } from '../server/db/vocabulary-sessions.ts';
import { claimVocabularyReflectionJob,retryOwnVocabularyFeedback,retryVocabularyPostSessionDispatch,listOwnVocabularyMessages,recordVocabularyFeedbackJudgment } from '../server/db/vocabulary-reflection.ts';
import { createVocabularyProcessingWorker } from '../server/vocabulary/processing-worker.ts';
import { createVocabularyReflectionProvider,normalizeVocabularyReflectionOutput } from '../server/vocabulary/reflection-provider.ts';
import { buildReflectionSpendCap } from '../server/reflection/spend-cap.ts';
import { createOpenAiCompatibleAdapter } from '../server/llm/openai-compatible.ts';
import { installModelInvocationLedger } from '../server/llm/invocation-ledger.ts';
import type { VocabularyReflectionJob,VocabularyReflectionResult } from '../src/domain/vocabulary-reflection.ts';
import type { VocabularySessionAction } from '../src/domain/vocabulary-session.ts';
let sql:DatabaseSync;
const at='2026-10-17T10:00:00.000Z';
let clock:number;
let env:Record<string,string|undefined>;
const alice=<T>(work:()=>T)=>runWithLearnerId('alice',work);
const permitted=<T>(work:()=>Promise<T>)=>work();
beforeEach(()=>{
  env=Object.fromEntries(['APP_AUTH_MODE','APP_DATA_DIR','APP_MODE','APP_OPERATOR_CLERK_USER_IDS'].map(key=>[key,process.env[key]]));
  Object.assign(process.env,{APP_AUTH_MODE:'clerk',APP_MODE:'study',APP_DATA_DIR:'/tmp/vocabulary-processing',APP_OPERATOR_CLERK_USER_IDS:'editor'});
  clock=Date.parse(at)+16_000;sql=new DatabaseSync(':memory:');setDb(sql);
  sql.exec(`PRAGMA foreign_keys=ON;CREATE TABLE learners(learner_id TEXT PRIMARY KEY,disabled_at TEXT,display_name TEXT);
    CREATE TABLE lexical_words(id TEXT PRIMARY KEY,hanzi TEXT,traditional TEXT,pinyin TEXT,meaning TEXT);
    CREATE TABLE word_preparation_work(id TEXT);INSERT INTO learners VALUES ('alice',NULL,'Alice'),('bob',NULL,'Bob');
    INSERT INTO lexical_words VALUES ('a','字',NULL,'zì','character');`);
  for(const name of ['0037_vocabulary_content.sql','0025_model_invocations.sql','0026_model_invocation_outcomes.sql','0038_model_provenance.sql'])sql.exec(fs.readFileSync(new URL(`../server/db/migrations/${name}`,import.meta.url),'utf8'));
  sql.exec(fs.readFileSync(new URL('../server/db/migrations/0039_vocabulary_learner_state.sql',import.meta.url),'utf8').split('-- Do not use the words view')[0]!);
  sql.exec(fs.readFileSync(new URL('../server/db/migrations/0045_vocabulary_dismissal.sql',import.meta.url),'utf8'));
  sql.exec(`CREATE TABLE learner_settings(learner_id TEXT,setting_key TEXT,value_json TEXT,updated_at TEXT,PRIMARY KEY(learner_id,setting_key));
    CREATE TABLE learner_owned_review_session_summaries(learner_id TEXT,session_id TEXT,PRIMARY KEY(learner_id,session_id));`);

  for(const name of ['0040_vocabulary_sessions.sql','0042_vocabulary_reflection.sql'])sql.exec(fs.readFileSync(new URL(`../server/db/migrations/${name}`,import.meta.url),'utf8'));
  for(const name of ['0023_session_debrief.sql','0046_vocabulary_connections.sql'])sql.exec(fs.readFileSync(new URL(`../server/db/migrations/${name}`,import.meta.url),'utf8'));
  sql.exec(`INSERT INTO learner_words(learner_id,word_id,in_stash,added_at,mode,mode_changed_at) VALUES ('alice','a',1,'2026-01-01','practice','2026-01-01');
    INSERT INTO learner_word_schedules(learner_id,word_id,next_eligible_at,policy_version,scheduler_state_json)
      VALUES ('alice','a','2026-10-20T10:00:00.000Z','test','{"intervalHours":24,"easeFactor":2.5,"enabled":1,"cleanCoveredSessions":0}');`);
  for(const id of ['one','two'])createVocabularyContent({contentId:id,kind:'exercise',payloadVersion:1,body:{prompt:`Prompt ${id}`},exerciseType:'definition',skill:'production',exerciseRole:'general',assessment:{match:'exact'},
    accessScope:'shared',availability:'active',originKind:'human',words:[{wordId:'a',relation:'target'}],answers:[{wordId:'a',acceptedForms:['字']}]},{kind:'operator',id:'editor'});
});
afterEach(()=>{sql.close();for(const [key,value]of Object.entries(env)){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
function pending(sessionId='session',two=false) {
  return alice(()=>{
    const started=new Date(clock-16_000).toISOString();
    createVocabularySession({sessionId,words:[{wordId:'a',mode:'practice'}]},started);
    const inputs:({kind:VocabularySessionAction['kind'];payload:unknown})[]=[];
    for(const id of two?['one','two']:['one'])inputs.push({kind:'presentation',payload:{encounterId:`${sessionId}-${id}`,wordId:'a',snapshot:{contentId:id,contentVersion:1,kind:'production',role:'general',body:{prompt:`Prompt ${id}`,material:{prompt:`Prompt ${id}`}},assessment:{acceptedAnswers:['字'],criteria:{match:'exact'}}}}},
      {kind:'response',payload:{encounterId:`${sessionId}-${id}`,response:'wrong',outcome:'rejected'}});
    inputs.push({kind:'finish_for_now',payload:{}},{kind:'finish_immediately',payload:{}});
    const actions=inputs.map((input,index)=>({...input,protocolVersion:1,actionId:`${sessionId}-a-${index}`,clientActionId:`${sessionId}-c-${index}`,sequence:index+1,occurredAt:started})) as VocabularySessionAction[];
    appendVocabularySessionActions(sessionId,actions,started);return stageVocabularySessionCompletion(sessionId,actions.length,started);
  });
}
function result(job:VocabularyReflectionJob):VocabularyReflectionResult {
  return job.kind==='learner_feedback'?{kind:'learner_feedback',judgment:{diagnosis:'A useful distinction',message:'A private lesson',unfairEncounterIds:[]}}
    :{kind:'exercise_improvement',result:{diagnosis:'Keep the cue',proposal:null}};
}
function worker(provider:{isConfigured():boolean;run(job:VocabularyReflectionJob):Promise<VocabularyReflectionResult>},controls=()=>({maintenanceMode:false,providerWorkEnabled:true})) {
  return createVocabularyProcessingWorker({provider,now:()=>clock,controls,providerWork:permitted});
}

test('provider-disabled worker still closes and ingests; maintenance and disabled learner fence work',async()=>{
  const completion=pending();let calls=0;let state={maintenanceMode:true,providerWorkEnabled:false};
  const processing=worker({isConfigured:()=>true,run:async job=>{calls++;return result(job);}},()=>state);
  assert.equal(await processing.step(),false);assert.equal(sql.prepare('SELECT status FROM vocabulary_session_completions').get()!.status,'pending');
  state={maintenanceMode:false,providerWorkEnabled:false};sql.exec("UPDATE learners SET disabled_at='disabled' WHERE learner_id='alice'");
  assert.equal(await processing.step(),false);sql.exec("UPDATE learners SET disabled_at=NULL WHERE learner_id='alice'");
  assert.equal(await processing.step(),true);assert.equal(sql.prepare('SELECT status FROM vocabulary_session_completions').get()!.status,'closed');
  assert.equal(sql.prepare('SELECT status FROM vocabulary_post_session_dispatches').get()!.status,'succeeded');
  assert.equal(Number(sql.prepare('SELECT count(*) n FROM vocabulary_reflection_jobs').get()!.n),2);assert.equal(calls,0);
  assert.equal(Number(sql.prepare('SELECT count(*) n FROM learner_messages').get()!.n),0);assert.ok(completion.completionId);await processing.stop();
});

test('feedback succeeds when improvement fails; failed work requires explicit own/operator retry',async()=>{
  pending();let feedbackCalls=0,improvementCalls=0;
  const processing=worker({isConfigured:()=>true,run:async job=>{
    if(job.kind==='exercise_improvement'){improvementCalls++;throw new Error('private provider error must not enter public failure');}
    feedbackCalls++;return result(job);
  }});
  await processing.step();assert.equal(alice(listOwnVocabularyMessages).length,1);
  assert.equal(sql.prepare("SELECT status FROM vocabulary_reflection_jobs WHERE kind='exercise_improvement'").get()!.status,'failed');
  await processing.step();assert.equal(feedbackCalls,1);assert.equal(improvementCalls,1);await processing.stop();
});

test('in-flight feedback never blocks another closure or subsequent improvement jobs',async()=>{
  pending('first',true);let release!:(value:VocabularyReflectionResult)=>void;let entered!:()=>void;
  const begun=new Promise<void>(resolve=>{entered=resolve;});let held:VocabularyReflectionJob|null=null,improvements=0;
  const processing=worker({isConfigured:()=>true,run:async job=>{
    if(job.kind==='learner_feedback'&&!held){held=job;entered();return new Promise(resolve=>{release=resolve;});}
    if(job.kind==='exercise_improvement')improvements++;return result(job);
  }});
  const first=processing.step();await begun;
  // Wait for the independent first improvement result to commit before dispatching another batch.
  for(let index=0;index<4;index++)await Promise.resolve();
  clock+=60_000;pending('second');await processing.step();
  assert.equal(sql.prepare("SELECT status FROM vocabulary_sessions WHERE session_id='second'").get()!.status,'closed');
  assert.ok(improvements>=2);release(result(held!));await first;await processing.stop();
});

test('expired unknown outcome is failed and fenced until explicit retry',async()=>{
  pending();const ingestOnly=worker({isConfigured:()=>false,run:async job=>result(job)});await ingestOnly.step();await ingestOnly.stop();
  const old=claimVocabularyReflectionJob({kind:'learner_feedback',now:new Date(clock).toISOString(),leaseMs:1})!;
  clock+=2;let calls=0;
  const processing=worker({isConfigured:()=>true,run:async job=>{calls++;return result(job);}});
  await processing.step();assert.equal(sql.prepare('SELECT last_error FROM vocabulary_reflection_jobs WHERE job_id=?').get(old.jobId)!.last_error,'provider_outcome_unknown');
  assert.throws(()=>recordVocabularyFeedbackJudgment(old.jobId,old.leaseToken,{diagnosis:null,message:'late',unfairEncounterIds:[]},new Date(clock).toISOString()),/stale/);
  const before=calls;await processing.step();assert.equal(calls,before);
  alice(()=>retryOwnVocabularyFeedback(old.jobId,new Date(clock).toISOString()));await processing.step();assert.equal(calls,before+1);await processing.stop();
});

test('strict real injected provider retains service provenance and rejects forged subjects/answers/scope',async()=>{
  pending();const ingestOnly=worker({isConfigured:()=>false,run:async job=>result(job)});await ingestOnly.step();await ingestOnly.stop();
  const job=claimVocabularyReflectionJob({kind:'learner_feedback',now:new Date(clock).toISOString()})!;installModelInvocationLedger();
  let payload:unknown={diagnosis:'An alternate fits',lesson:'The original cue also permits this answer.',unfairEncounterIds:['session-one']};
  const adapter=createOpenAiCompatibleAdapter({id:'openai',defaultBaseUrl:'https://example.invalid',apiKeyEnvironmentVariable:'KEY',structuredOutputMode:'json_schema',maxTokensField:'max_tokens',
    fetchImplementation:async()=>new Response(JSON.stringify({id:'provider-1',model:'resolved',choices:[{message:{content:JSON.stringify(payload)},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:10}}),{status:200})});
  const provider=createVocabularyReflectionProvider({environment:{OPENAI_API_KEY:'never-save-token'},adapter,spendCap:()=>buildReflectionSpendCap(1,new Date(at))});
  const output=await provider.run(job);assert.equal(output.kind,'learner_feedback');
  const invocation=sql.prepare('SELECT * FROM model_invocations').get()!;assert.equal(invocation.actor_kind,'service');assert.equal(invocation.learner_id,null);
  assert.equal(invocation.prompt_name,'vocabulary-reflection-feedback');assert.equal(invocation.workflow_id,job.jobId);assert.ok(!JSON.stringify(invocation).includes('never-save-token'));
  payload={diagnosis:'Claim',lesson:'Lesson',unfairEncounterIds:['invented']};await assert.rejects(()=>provider.run(job),/supplied rejected/);
  assert.equal(sql.prepare("SELECT count(*) n FROM model_invocations WHERE status='invalid_response'").get()!.n,1);
  const improve=claimVocabularyReflectionJob({kind:'exercise_improvement',now:new Date(clock).toISOString()})!;
  const valid={diagnosis:'Repair the overloaded cue',operations:[{sourceContentId:'one',strategy:'update_existing',rationale:'A faithful wording',prompt:'A written character',acceptedAnswers:['字']}]};
  assert.equal(normalizeVocabularyReflectionOutput(improve,valid).kind,'exercise_improvement');
  assert.throws(()=>normalizeVocabularyReflectionOutput(improve,{...valid,operations:[{...valid.operations[0],acceptedAnswers:['invented']}]}),/answer criteria/);
  assert.throws(()=>normalizeVocabularyReflectionOutput(improve,{...valid,operations:[{...valid.operations[0],sourceContentId:'two'}]}),/source identities/);
  assert.throws(()=>normalizeVocabularyReflectionOutput(improve,{...valid,operations:[{...valid.operations[0],accessScope:'shared'}]}),/strict schema/);
  const teaching={...improve,evidence:{...improve.evidence,kind:'teaching_review' as const,evidence:improve.evidence.evidence.map(item=>({...item,snapshot:{...item.snapshot,role:'teaching' as const}}))}};
  await assert.rejects(()=>provider.run(teaching),/manual inbox/);
});

test('ingestion faults preserve closed sessions and expose an explicit safe dispatch retry',async()=>{
  pending();sql.exec("CREATE TRIGGER fail_case BEFORE INSERT ON reflection_cases BEGIN SELECT RAISE(ABORT,'test ingestion fault'); END;");
  const processing=worker({isConfigured:()=>false,run:async job=>result(job)});
  await processing.step();assert.equal(sql.prepare('SELECT status FROM vocabulary_sessions').get()!.status,'closed');
  const dispatch=sql.prepare('SELECT dispatch_id,status FROM vocabulary_post_session_dispatches').get()!;
  assert.equal(dispatch.status,'failed');assert.equal(Number(sql.prepare('SELECT count(*) n FROM reflection_cases').get()!.n),0);
  sql.exec('DROP TRIGGER fail_case');retryVocabularyPostSessionDispatch(String(dispatch.dispatch_id),'editor',new Date(clock).toISOString());
  await processing.step();assert.equal(sql.prepare('SELECT status FROM vocabulary_post_session_dispatches').get()!.status,'succeeded');
  assert.equal(Number(sql.prepare('SELECT count(*) n FROM reflection_cases').get()!.n),2);await processing.stop();
});

test('incomplete teaching feedback enters manual inbox without model work',async()=>{
  sql.exec("UPDATE learner_words SET mode='unstudied' WHERE word_id='a'");
  createVocabularyContent({contentId:'teach',kind:'exercise',payloadVersion:1,body:{prompt:'Teaching prompt'},exerciseType:'definition',skill:'production',exerciseRole:'teaching',assessment:{match:'exact'},
    accessScope:'shared',availability:'active',originKind:'human',words:[{wordId:'a',relation:'target'}],answers:[{wordId:'a',acceptedForms:['字']}]},{kind:'operator',id:'editor'});
  alice(()=>{
    createVocabularySession({sessionId:'teaching',words:[{wordId:'a',mode:'unstudied'}]},at);
    const inputs=[{kind:'presentation',payload:{encounterId:'teaching-encounter',wordId:'a',snapshot:{contentId:'teach',contentVersion:1,kind:'production',role:'teaching',
      body:{prompt:'Teaching prompt',material:{prompt:'Teaching prompt'}},assessment:{acceptedAnswers:['字'],criteria:{match:'exact'}}}}},
      {kind:'feedback',payload:{encounterId:'teaching-encounter',feedback:'negative'}},{kind:'finish_for_now',payload:{}},{kind:'finish_immediately',payload:{}}];
    const actions=inputs.map((input,index)=>({...input,protocolVersion:1,actionId:`teach-${index}`,clientActionId:`teach-c-${index}`,sequence:index+1,occurredAt:at})) as VocabularySessionAction[];
    appendVocabularySessionActions('teaching',actions,at);stageVocabularySessionCompletion('teaching',actions.length,at);
  });
  let calls=0;const processing=worker({isConfigured:()=>true,run:async job=>{calls++;return result(job);}});
  await processing.step();assert.equal(calls,0);assert.equal(sql.prepare('SELECT kind FROM reflection_cases').get()!.kind,'teaching_review');
  assert.equal(Number(sql.prepare('SELECT count(*) n FROM vocabulary_reflection_jobs').get()!.n),0);await processing.stop();
});
