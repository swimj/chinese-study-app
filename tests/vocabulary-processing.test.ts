import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach,afterEach,test } from 'node:test';
import { setDb } from '../server/db/connection.ts';
import { runWithLearnerId } from '../server/db/learner-context.ts';
import { createVocabularyContent,createVocabularySense,establishVocabularySenseCatalog,getVocabularySenseCatalog,getVocabularySenses,getVocabularyContent } from '../server/db/vocabulary-content.ts';
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
  for(const name of ['0039_vocabulary_content.sql','0025_model_invocations.sql','0026_model_invocation_outcomes.sql','0040_model_provenance.sql'])sql.exec(fs.readFileSync(new URL(`../server/db/migrations/${name}`,import.meta.url),'utf8'));
  sql.exec(fs.readFileSync(new URL('../server/db/migrations/0041_vocabulary_learner_state.sql',import.meta.url),'utf8').split('-- Do not use the words view')[0]!);
  sql.exec(fs.readFileSync(new URL('../server/db/migrations/0047_vocabulary_dismissal.sql',import.meta.url),'utf8'));
  sql.exec(fs.readFileSync(new URL('../server/db/migrations/0052_vocabulary_automatic_promotion_pause.sql',import.meta.url),'utf8'));
  sql.exec(`CREATE TABLE learner_settings(learner_id TEXT,setting_key TEXT,value_json TEXT,updated_at TEXT,PRIMARY KEY(learner_id,setting_key));
    CREATE TABLE learner_owned_review_session_summaries(learner_id TEXT,session_id TEXT,PRIMARY KEY(learner_id,session_id));`);

  for(const name of ['0042_vocabulary_sessions.sql','0044_vocabulary_reflection.sql','0055_vocabulary_feedback_dismissal.sql','0045_vocabulary_provenance_links.sql'])sql.exec(fs.readFileSync(new URL(`../server/db/migrations/${name}`,import.meta.url),'utf8'));
  for(const name of ['0023_session_debrief.sql','0048_vocabulary_connections.sql','0049_vocabulary_sense_readiness.sql','0050_vocabulary_improvement_admission.sql','0051_vocabulary_pure_cue_promotion.sql'])sql.exec(fs.readFileSync(new URL(`../server/db/migrations/${name}`,import.meta.url),'utf8'));
  sql.exec(fs.readFileSync(new URL('../server/db/migrations/0054_vocabulary_provider_retry_routing.sql',import.meta.url),'utf8'));
  sql.exec(`INSERT INTO learner_words(learner_id,word_id,in_stash,added_at,mode,mode_changed_at) VALUES ('alice','a',1,'2026-01-01','practice','2026-01-01');
    INSERT INTO learner_word_schedules(learner_id,word_id,next_eligible_at,policy_version,scheduler_state_json)
      VALUES ('alice','a','2026-10-20T10:00:00.000Z','test','{"intervalHours":24,"easeFactor":2.5,"enabled":1,"cleanCoveredSessions":0}');`);
  for(const id of ['one','two'])createVocabularyContent({contentId:id,kind:'exercise',payloadVersion:1,body:{prompt:`Prompt ${id}`},exerciseType:'definition',skill:'production',exerciseRole:'general',assessment:{match:'exact'},
    accessScope:'shared',availability:'active',originKind:'human',words:[{wordId:'a',relation:'target'}],answers:[{wordId:'a',acceptedForms:['字']}]},{kind:'operator',id:'editor'});
});
afterEach(()=>{sql.close();for(const [key,value]of Object.entries(env)){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
function pending(sessionId='session',two=false,contentId='one') {
  return alice(()=>{
    const started=new Date(clock-16_000).toISOString();
    createVocabularySession({sessionId,words:[{wordId:'a',mode:'practice'}]},started);
    const inputs:({kind:VocabularySessionAction['kind'];payload:unknown})[]=[];
    for(const id of two?['one','two']:[contentId])inputs.push({kind:'presentation',payload:{encounterId:`${sessionId}-${id}`,wordId:'a',snapshot:{contentId:id,contentVersion:1,kind:'production',role:'general',body:{prompt:`Prompt ${id}`,material:getVocabularyContent(id)!.body},assessment:{acceptedAnswers:['字'],criteria:{match:'exact'}}}}},
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
  const sense=createVocabularySense({wordId:'a',description:{label:'written character'}},{kind:'operator',id:'editor'});
  establishVocabularySenseCatalog('a',getVocabularySenseCatalog('a').version,{kind:'operator',id:'editor'});
  const adapter=createOpenAiCompatibleAdapter({id:'openai',defaultBaseUrl:'https://example.invalid',apiKeyEnvironmentVariable:'KEY',structuredOutputMode:'json_schema',maxTokensField:'max_tokens',
    fetchImplementation:async(_url,init)=>{
      const request=JSON.parse(String(init?.body)) as {response_format:{json_schema:{name:string}}};
      const value=request.response_format.json_schema.name.includes('sense_mapping')?{outcome:'single_sense',rationale:'A written character.',senseIds:[sense.senseId]}:payload;
      return new Response(JSON.stringify({id:'provider-1',model:'resolved',choices:[{message:{content:JSON.stringify(value)},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:10}}),{status:200});
    }});
  const provider=createVocabularyReflectionProvider({environment:{OPENAI_API_KEY:'never-save-token'},adapter,spendCap:()=>buildReflectionSpendCap(1,new Date(at)),
    ensureSenses:async()=>({catalog:getVocabularySenseCatalog('a'),senses:getVocabularySenses('a'),source:'existing'})});
  const output=await provider.run(job);assert.equal(output.kind,'learner_feedback');
  const invocation=sql.prepare('SELECT * FROM model_invocations').get()!;assert.equal(invocation.actor_kind,'service');assert.equal(invocation.learner_id,null);
  assert.equal(invocation.prompt_name,'vocabulary-reflection-feedback');assert.equal(invocation.workflow_id,job.jobId);assert.ok(!JSON.stringify(invocation).includes('never-save-token'));
  assert.equal(invocation.prompt_version,'4');assert.equal(invocation.schema_version,'1');assert.equal(invocation.input_projection_version,'vocabulary-reflection.v2');
  assert.equal(invocation.prompt_template,fs.readFileSync(new URL('../server/vocabulary/reflection-prompts/feedback.md',import.meta.url),'utf8'));
  payload={diagnosis:'Claim',lesson:'Lesson',unfairEncounterIds:['invented']};await assert.rejects(()=>provider.run(job),/supplied rejected/);
  assert.equal(sql.prepare("SELECT count(*) n FROM model_invocations WHERE status='invalid_response'").get()!.n,1);
  const improve=claimVocabularyReflectionJob({kind:'exercise_improvement',now:new Date(clock).toISOString()})!;
  const valid={diagnosis:'Repair the overloaded cue',operations:[{sourceContentId:'one',strategy:'update_existing',rationale:'A faithful wording',prompt:'A written character',acceptedAnswers:['字']}]};
  assert.equal(normalizeVocabularyReflectionOutput(improve,valid).kind,'exercise_improvement');
  payload={...valid,pureCueReferral:null};assert.equal((await provider.run(improve)).kind,'exercise_improvement');
  const improvementInvocation=sql.prepare("SELECT * FROM model_invocations WHERE prompt_name='vocabulary-reflection-single-improvement'").get()!;
  assert.equal(improvementInvocation.prompt_version,'3');assert.equal(improvementInvocation.schema_version,'2');assert.equal(improvementInvocation.input_projection_version,'vocabulary-admission.v2');
  assert.equal(improvementInvocation.prompt_template,`\n\n${fs.readFileSync(new URL('../server/vocabulary/reflection-prompts/single-improvement.md',import.meta.url),'utf8')}`);
  assert.throws(()=>normalizeVocabularyReflectionOutput(improve,{...valid,operations:[{...valid.operations[0],acceptedAnswers:['invented']}]}),/answer criteria/);
  assert.throws(()=>normalizeVocabularyReflectionOutput(improve,{...valid,operations:[{...valid.operations[0],sourceContentId:'two'}]}),/source identities/);
  assert.throws(()=>normalizeVocabularyReflectionOutput(improve,{...valid,operations:[{...valid.operations[0],accessScope:'shared'}]}),/strict schema/);
  const proposed=normalizeVocabularyReflectionOutput(improve,valid);
  assert.equal(proposed.kind,'exercise_improvement');
  if(proposed.kind!=='exercise_improvement'||!proposed.result.proposal)throw new Error('Expected fixture proposal');
  const opinionJob:VocabularyReflectionJob={...improve,secondOpinion:{requestId:'opinion-test',notes:'Check the proposed wording',proposal:{
    ...proposed.result.proposal,proposalId:'proposal-test',caseId:improve.caseId,version:1,status:'awaiting_review',
    bases:proposed.result.proposal.bases??[],invocationId:null,authorKind:'service',authorId:'vocabulary-reflection'}}};
  payload={verdict:'revise',rationale:'The definition needs a clearer construction.'};
  const opinion=await provider.run(opinionJob);
  assert.equal(opinion.kind,'exercise_improvement');
  if(opinion.kind==='exercise_improvement'){
    assert.equal(opinion.result.proposal,null);assert.equal(opinion.result.secondOpinion?.verdict,'revise');
  }
  const opinionInvocation=sql.prepare("SELECT * FROM model_invocations WHERE prompt_name='vocabulary-reflection-second-opinion'").get()!;
  assert.equal(opinionInvocation.workflow_id,improve.jobId);assert.equal(opinionInvocation.prompt_version,'1');
  assert.equal(opinionInvocation.prompt_template,`${fs.readFileSync(new URL('../server/vocabulary/reflection-prompts/reasoning.md',import.meta.url),'utf8')}\n\n${fs.readFileSync(new URL('../server/vocabulary/reflection-prompts/second-opinion.md',import.meta.url),'utf8')}`);
  payload={verdict:'support',rationale:'Fine',operations:[]};await assert.rejects(()=>provider.run(opinionJob),/strict schema/);
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

for(const source of [
  {kind:'dictionary_baseline',wordId:'a'},
  {kind:'production_cue_supplement',supplementId:'legacy-explanation',cueId:null,taskId:'production-task:a:default_production'},
] as const)test(`single improvement authors targeted prompts from ${source.kind} for every proposal strategy`,async()=>{
  createVocabularyContent({contentId:'fallback',kind:'exercise',payloadVersion:1,
    body:{prompt:'Prompt fallback',source,reveal:{explanation:'Retained teaching'}},exerciseType:'definition',skill:'production',exerciseRole:'general',
    assessment:{match:'exact'},accessScope:'private',ownerLearnerId:'alice',availability:'active',originKind:'human',
    words:[{wordId:'a',relation:'target'}],answers:[{wordId:'a',acceptedForms:['字']}]},{kind:'operator',id:'editor'});
  pending('fallback-session',false,'fallback');
  const ingestOnly=worker({isConfigured:()=>false,run:async job=>result(job)});
  await ingestOnly.step();await ingestOnly.stop();
  const job=claimVocabularyReflectionJob({kind:'exercise_improvement',now:new Date(clock).toISOString()})!;
  for(const strategy of ['create','update_existing','replace'] as const) {
    const proposal=normalizeVocabularyReflectionOutput(job,{diagnosis:'Clarify the productive use',pureCueReferral:null,
      operations:[{sourceContentId:'fallback',strategy,rationale:'Use a concrete context',prompt:'A single written symbol in this sentence',acceptedAnswers:['字']}]},null,true);
    assert.equal(proposal.kind,'exercise_improvement');
    if(proposal.kind!=='exercise_improvement'||!proposal.result.proposal)throw new Error('Expected improvement proposal');
    const operation=proposal.result.proposal.operations[0]!;
    assert.equal(operation.strategy,strategy);
    assert.deepEqual(operation.content.body,{prompt:'A single written symbol in this sentence',
      source:{kind:'authored_prompt',previous:source},reveal:{explanation:'Retained teaching'}});
    assert.equal(operation.content.accessScope,'private');assert.equal(operation.content.ownerLearnerId,'alice');
    assert.deepEqual(operation.content.answers,[{wordId:'a',acceptedForms:['字']}]);
  }
  const unchanged=normalizeVocabularyReflectionOutput(job,{diagnosis:'Retain the existing prompt',pureCueReferral:null,
    operations:[{sourceContentId:'fallback',strategy:'create',rationale:'Keep wording',prompt:'Prompt fallback',acceptedAnswers:['字']}]},null,true);
  if(unchanged.kind!=='exercise_improvement'||!unchanged.result.proposal)throw new Error('Expected unchanged fixture proposal');
  assert.deepEqual(unchanged.result.proposal.operations[0]!.content.body,
    {prompt:'Prompt fallback',source,reveal:{explanation:'Retained teaching'}},'a proposed copy alone does not author a distinctive cue');
  assert.deepEqual(JSON.parse(String(sql.prepare("SELECT body_json FROM content_items WHERE content_id='fallback'").get()!.body_json)),
    {prompt:'Prompt fallback',source,reveal:{explanation:'Retained teaching'}},'normalizing proposals leaves source evidence unchanged');
});

test('incomplete teaching reactions enter manual inbox without model work',async()=>{
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

test('reflection routes a case once, retains GLM after failure/recreation, and enforces spend cap without failover',async()=>{
  pending();const ingestOnly=worker({isConfigured:()=>false,run:async job=>result(job)});await ingestOnly.step();await ingestOnly.stop();
  const job=claimVocabularyReflectionJob({kind:'learner_feedback',now:new Date(clock).toISOString()})!;
  const requests:import('../server/llm/types.ts').ProviderRunRequest[]=[];
  let fail=true;
  const adapter:import('../server/llm/types.ts').ProviderAdapter={id:'zai',defaultBaseUrl:'https://unused.invalid',apiKeyEnvironmentVariable:'ZAI_API_KEY',structuredOutputMode:'json_object',async run(request){
    requests.push(request);if(fail)throw new Error('temporary failure');
    return {provider:'zai',model:request.model,responseId:null,structuredOutputMode:'json_object',rawText:JSON.stringify({diagnosis:'Fair cue',lesson:'Lesson',unfairEncounterIds:[]}),finishReason:'stop',rawResponse:null,usage:{inputTokens:null,cachedInputTokens:null,cacheWriteInputTokens:null,outputTokens:null,reasoningTokens:null,totalTokens:null},invocationId:null};
  }};
  const environment={ZAI_API_KEY:'test'};
  const low=()=>buildReflectionSpendCap(0,new Date(at));
  const first=createVocabularyReflectionProvider({environment,adapter,random:()=>0.5,spendCap:low});
  assert.equal(first.isConfigured(),true);
  await assert.rejects(()=>first.run(job),/temporary failure/);
  assert.equal(sql.prepare('SELECT model_choice FROM vocabulary_reflection_jobs WHERE job_id=?').get(job.jobId)!.model_choice,'zai:glm-5.3-flash-high');
  fail=false;
  const retry=createVocabularyReflectionProvider({environment,adapter,random:()=>{throw new Error('Must not reroll');},spendCap:low});
  await retry.run({...job,attemptNumber:2});
  assert.deepEqual(requests.map(request=>request.model),['glm-5.3-flash','glm-5.3-flash']);
  assert.equal(requests[1]!.provenance!.attemptNumber,2);
  const capped=createVocabularyReflectionProvider({environment,adapter,spendCap:()=>buildReflectionSpendCap(1,new Date(at))});
  await assert.rejects(()=>capped.run(job),/Only Luna/);
  assert.equal(requests.length,2);
});


test('routed GLM transport uses its credentials, endpoint and JSON-object protocol',async()=>{
  pending();const ingestOnly=worker({isConfigured:()=>false,run:async job=>result(job)});await ingestOnly.step();await ingestOnly.stop();
  const job=claimVocabularyReflectionJob({kind:'learner_feedback',now:new Date(clock).toISOString()})!;
  installModelInvocationLedger();
  const provider=createVocabularyReflectionProvider({environment:{ZAI_API_KEY:'zai-test'},random:()=>0.5,spendCap:()=>buildReflectionSpendCap(0,new Date(at)),
    fetchImplementation:async(url,init)=>{
      assert.equal(String(url),'https://api.z.ai/api/paas/v4/chat/completions');
      assert.equal(new Headers(init?.headers).get('authorization'),'Bearer zai-test');
      const body=JSON.parse(String(init?.body));
      assert.equal(body.model,'glm-5.3-flash');assert.deepEqual(body.response_format,{type:'json_object'});
      assert.equal(body.max_tokens,131072);assert.equal(body.max_completion_tokens,undefined);
      return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({diagnosis:'Fair cue',lesson:'Lesson',unfairEncounterIds:[]})},finish_reason:'stop'}]}),{status:200});
    }});
  await provider.run(job);
  const invocation=sql.prepare('SELECT provider,model,workflow_id FROM model_invocations').get()!;
  assert.equal(invocation.provider,'zai');assert.equal(invocation.model,'glm-5.3-flash');assert.equal(invocation.workflow_id,job.jobId);
});

test('a sense prerequisite defers its reflection job durably until due and does not block feedback',async()=>{
  const {VocabularySenseReadinessPending}=await import('../server/vocabulary/sense-readiness.ts');
  pending();let improvementCalls=0;
  const provider={isConfigured:()=>true,run:async(job:VocabularyReflectionJob)=>{
    if(job.kind==='exercise_improvement'&&++improvementCalls<=2)throw new VocabularySenseReadinessPending(new Date(clock+(improvementCalls===1?30_000:60_000)).toISOString());
    return result(job);
  }};
  let processing=worker(provider);await processing.step();
  assert.equal(alice(listOwnVocabularyMessages).length,1);
  assert.equal(sql.prepare("SELECT status FROM vocabulary_reflection_jobs WHERE kind='exercise_improvement'").get()!.status,'queued');
  await processing.stop();processing=worker(provider);
  clock+=29_999;await processing.step();assert.equal(improvementCalls,1);
  clock++;await processing.step();assert.equal(improvementCalls,2);
  clock+=59_999;await processing.step();assert.equal(improvementCalls,2);
  clock++;await processing.step();assert.equal(improvementCalls,3);
  assert.equal(sql.prepare("SELECT status FROM vocabulary_reflection_jobs WHERE kind='exercise_improvement'").get()!.status,'succeeded');
  await processing.stop();
});

test('expired sense preparation fences its crashed reflection and resumes after durable backoff',async()=>{
  pending();const ingest=worker({isConfigured:()=>false,run:async job=>result(job)});await ingest.step();await ingest.stop();
  const old=claimVocabularyReflectionJob({kind:'exercise_improvement',now:new Date(clock).toISOString(),leaseMs:30*60_000})!;
  sql.prepare(`INSERT INTO vocabulary_sense_readiness(word_id,status,attempt_count,total_attempt_count,active_token,expires_at,expected_catalog_version,workflow_id,created_at,updated_at)
    VALUES ('a','running',1,1,'sense-old',?,0,?,?,?)`).run(new Date(clock+300_000).toISOString(),old.jobId,at,at);
  clock+=300_000;
  let calls=0;
  const processing=worker({isConfigured:()=>true,run:async job=>{if(job.kind==='exercise_improvement')calls++;return result(job);}});
  await processing.step();assert.equal(calls,0);
  const waiting=sql.prepare('SELECT status,lease_token,next_attempt_at FROM vocabulary_reflection_jobs WHERE job_id=?').get(old.jobId)!;
  assert.equal(waiting.status,'queued');assert.equal(waiting.lease_token,null);assert.equal(waiting.next_attempt_at,new Date(clock+30_000).toISOString());
  assert.equal(sql.prepare('SELECT active_token FROM vocabulary_sense_readiness').get()!.active_token,null);
  clock+=30_000;await processing.step();assert.equal(calls,1);
  assert.equal(sql.prepare('SELECT status FROM vocabulary_reflection_jobs WHERE job_id=?').get(old.jobId)!.status,'succeeded');
  await processing.stop();
});
