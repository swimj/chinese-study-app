import { installCaseReviewSchema } from './helpers/case-review-schema.ts';
import { ensureVocabularySenses } from '../server/vocabulary/sense-readiness.ts';
import { recoverVocabularySenseDependencies } from '../server/db/vocabulary-reflection.ts';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach,afterEach,test } from 'node:test';
import { setDb } from '../server/db/connection.ts';
import { runWithLearnerId } from '../server/db/learner-context.ts';
import { createVocabularyContent,updateVocabularyContent,mapVocabularyContentSense,createVocabularySense,establishVocabularySenseCatalog,getVocabularySenseCatalog,getVocabularySenses,getVocabularyContent,getVocabularyContentForMaintenance } from '../server/db/vocabulary-content.ts';
import { writeVocabularyDefaultUsefulSenses } from '../server/db/vocabulary-sense-coverage.ts';
import { createVocabularySession,appendVocabularySessionActions,stageVocabularySessionCompletion,cancelVocabularySessionCompletion,closeVocabularySessionCompletion } from '../server/db/vocabulary-sessions.ts';
import { VocabularyReflectionConflict,VocabularyReflectionSourceConflict,claimVocabularyReflectionJob,retryVocabularyReflectionJob,retryOwnVocabularyFeedback,retryVocabularyPostSessionDispatch,listOwnVocabularyMessages,recordVocabularyFeedbackJudgment } from '../server/db/vocabulary-reflection.ts';
import { createVocabularyProcessingWorker } from '../server/vocabulary/processing-worker.ts';
import { createVocabularyReflectionProvider,normalizeVocabularyReflectionOutput,normalizeVocabularySingleImprovementOutput } from '../server/vocabulary/reflection-provider.ts';
import { projectVocabularyImprovementInput } from '../server/vocabulary/exercise-improvement-authoring.ts';
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
    CREATE TABLE learner_word_reserve_requests(learner_id TEXT PRIMARY KEY,requested_at TEXT NOT NULL);
    CREATE TABLE lexical_words(id TEXT PRIMARY KEY,hanzi TEXT,traditional TEXT,pinyin TEXT,meaning TEXT);
    CREATE TABLE word_preparation_work(id TEXT);INSERT INTO learners VALUES ('alice',NULL,'Alice'),('bob',NULL,'Bob');
    INSERT INTO lexical_words VALUES ('a','字',NULL,'zì','character');`);
  for(const name of ['0062_vocabulary_sense_coverage.sql','0064_vocabulary_default_useful_senses.sql','0039_vocabulary_content.sql','0025_model_invocations.sql','0026_model_invocation_outcomes.sql','0040_model_provenance.sql'])sql.exec(fs.readFileSync(new URL(`../server/db/migrations/${name}`,import.meta.url),'utf8'));
  sql.exec(fs.readFileSync(new URL('../server/db/migrations/0041_vocabulary_learner_state.sql',import.meta.url),'utf8').split('-- Do not use the words view')[0]!);
  sql.exec(fs.readFileSync(new URL('../server/db/migrations/0047_vocabulary_dismissal.sql',import.meta.url),'utf8'));
  sql.exec(fs.readFileSync(new URL('../server/db/migrations/0052_vocabulary_automatic_promotion_pause.sql',import.meta.url),'utf8'));
  sql.exec(`CREATE TABLE learner_settings(learner_id TEXT,setting_key TEXT,value_json TEXT,updated_at TEXT,PRIMARY KEY(learner_id,setting_key));
    CREATE TABLE learner_owned_review_session_summaries(learner_id TEXT,session_id TEXT,PRIMARY KEY(learner_id,session_id));`);

  for(const name of ['0042_vocabulary_sessions.sql','0044_vocabulary_reflection.sql','0059_vocabulary_reassessment.sql','0060_vocabulary_reassessment_source.sql','0055_vocabulary_feedback_dismissal.sql','0045_vocabulary_provenance_links.sql'])sql.exec(fs.readFileSync(new URL(`../server/db/migrations/${name}`,import.meta.url),'utf8'));
  for(const name of ['0023_session_debrief.sql','0048_vocabulary_connections.sql','0049_vocabulary_sense_readiness.sql','0050_vocabulary_improvement_admission.sql','0051_vocabulary_pure_cue_promotion.sql'])sql.exec(fs.readFileSync(new URL(`../server/db/migrations/${name}`,import.meta.url),'utf8'));
  sql.exec(fs.readFileSync(new URL('../server/db/migrations/0054_vocabulary_provider_retry_routing.sql',import.meta.url),'utf8'));
  sql.exec(fs.readFileSync(new URL('../server/db/migrations/0061_vocabulary_sense_mapping_retries.sql',import.meta.url),'utf8'));
  sql.exec(fs.readFileSync(new URL('../server/db/migrations/0065_vocabulary_dispatch_polling_indexes.sql',import.meta.url),'utf8'));
  sql.exec(`INSERT INTO learner_words(learner_id,word_id,in_stash,added_at,mode,mode_changed_at) VALUES ('alice','a',1,'2026-01-01','practice','2026-01-01');
    INSERT INTO learner_word_schedules(learner_id,word_id,next_eligible_at,policy_version,scheduler_state_json)
      VALUES ('alice','a','2026-10-20T10:00:00.000Z','test','{"intervalHours":24,"easeFactor":2.5,"enabled":1,"cleanCoveredSessions":0}');`);
  installCaseReviewSchema(sql);
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
async function authoringJob(){
  pending();const processing=worker({isConfigured:()=>false,run:async job=>result(job)});
  await processing.step();await processing.stop();
  return claimVocabularyReflectionJob({kind:'exercise_improvement',now:new Date(clock).toISOString()})!;
}
const keepOutput=()=>({summary:'The original cue works.',source:{decision:'keep',prompt:null},sharedExercise:null,additionalExercises:[]});
test('editorial decisions preserve source identity and permit retirement with target enrichment',async()=>{
  const job=await authoringJob();
  const keep=normalizeVocabularySingleImprovementOutput(job,keepOutput());
  assert.equal(keep.kind,'exercise_improvement');if(keep.kind!=='exercise_improvement')throw new Error('Expected improvement');
  assert.equal(keep.result.proposal,null);
  const revise=normalizeVocabularySingleImprovementOutput(job,{...keepOutput(),source:{decision:'revise',prompt:'A written symbol'}});
  if(revise.kind!=='exercise_improvement')throw new Error('Expected improvement');
  const repair=revise.result.proposal!.operations[0]!;
  assert.equal(repair.strategy,'update_existing');assert.equal(repair.content.contentId,'one');
  assert.equal(repair.learningRole,'source_repair');assert.deepEqual(repair.content.answers,[{wordId:'a',acceptedForms:['字']}]);
  const enriched=normalizeVocabularySingleImprovementOutput(job,{...keepOutput(),source:{decision:'retire',prompt:null},additionalExercises:[{answer:'target',role:'enrichment',prompt:'A separate written symbol',rationale:'A further use surfaced in the assessment.'}]});
  if(enriched.kind!=='exercise_improvement')throw new Error('Expected improvement');
  assert.deepEqual(enriched.result.proposal!.operations.map(op=>[op.strategy,op.learningRole]),[['retire','source_repair'],['create','enrichment']]);
  assert.notEqual(enriched.result.proposal!.operations[1]!.content.contentId,'one');
  assert.equal(alice(()=>getVocabularyContent('one'))!.availability,'active','normalization does not apply the recommendation');
});
test('authoring references preserve unresolved responses without inventing individual word identities',async()=>{
  const job=await authoringJob();
  const sense=createVocabularySense({wordId:'a',description:{label:'written character'}},{kind:'operator',id:'editor'});
  const input=projectVocabularyImprovementInput(job,alice(()=>getVocabularyContent('one'))!,sense);
  assert.deepEqual(input.words.map(word=>[word.ref,word.form,word.canAuthorIndividual]),[['target','字',true],['response_1','wrong',false]]);
  assert.ok(!JSON.stringify(input).includes('wordId'));assert.ok(!JSON.stringify(input).includes('contentId'));
  job.evidence.evidence[0]!.snapshot.body.material={prompt:'Old stored prompt',instruction:'Use the formal register.',reveal:{teachingNote:'The historical note.'}};
  job.evidence.evidence[0]!.snapshot.body.explanation='The explanation actually shown.';
  const historical=projectVocabularyImprovementInput(job,{...alice(()=>getVocabularyContent('one'))!,body:{prompt:'Current source',reveal:{teachingNote:'The current note.'}}},sense);
  assert.equal(historical.encounters[0]!.prompt,'Prompt one');
  assert.equal(historical.encounters[0]!.instruction,'Use the formal register.');
  assert.deepEqual(historical.encounters[0]!.postAnswer,{reveal:{teachingNote:'The historical note.'},explanation:'The explanation actually shown.'});
  assert.deepEqual(historical.source.postAnswer,{reveal:{teachingNote:'The current note.'}});
  assert.throws(()=>normalizeVocabularySingleImprovementOutput(job,{...keepOutput(),source:{decision:'retire',prompt:null},sharedExercise:{answers:['target','response_1'],prompt:'A shared task',rationale:'Both express the task.'}}),/Shared exercise requires supplied unambiguous words/);
  assert.throws(()=>normalizeVocabularySingleImprovementOutput(job,{...keepOutput(),additionalExercises:[{answer:'response_1',role:'enrichment',prompt:'Another task',rationale:'Further practice'}]}),/unambiguous word/);
  sql.prepare('INSERT INTO lexical_words VALUES (?,?,?,?,?)').run('b','wrong',null,'wrong','test response');
  const shared=normalizeVocabularySingleImprovementOutput(job,{...keepOutput(),source:{decision:'retire',prompt:null},sharedExercise:{answers:['target','response_1'],prompt:'A shared task',rationale:'Both express the task.'}});
  if(shared.kind!=='exercise_improvement')throw new Error('Expected improvement');
  assert.deepEqual(shared.result.pureCueReferral!.candidateWords,['字','wrong']);
  assert.equal(shared.result.pureCueReferral!.draft!.semanticAxis,undefined);assert.equal(shared.result.pureCueReferral!.draft!.teachingNote,undefined);
  const resolved=normalizeVocabularySingleImprovementOutput(job,{...keepOutput(),additionalExercises:[{answer:'response_1',role:'refinement',prompt:'Another task',rationale:'A construction contrast'}]});
  if(resolved.kind!=='exercise_improvement')throw new Error('Expected improvement');
  assert.deepEqual(resolved.result.proposal!.operations[0]!.content.answers,[{wordId:'b',acceptedForms:['wrong']}]);
});
test('authoring rejects malformed source decisions, invented refs and answer leakage',async()=>{
  const job=await authoringJob();
  for(const source of [{decision:'keep',prompt:'A rewrite'},{decision:'retire',prompt:''},{decision:'revise',prompt:null}]){
    assert.throws(()=>normalizeVocabularySingleImprovementOutput(job,{...keepOutput(),source}),/prompt/);
  }
  assert.throws(()=>normalizeVocabularySingleImprovementOutput(job,{...keepOutput(),source:{decision:'revise',prompt:'Recall 字'}}),/exposes an accepted answer/);
  assert.throws(()=>normalizeVocabularySingleImprovementOutput(job,{...keepOutput(),additionalExercises:[{answer:'invented',role:'enrichment',prompt:'A task',rationale:'Value'}]}),/Unknown supplied word/);
  const shared={answers:['target','response_9'],prompt:'A task',rationale:'Value'};
  assert.throws(()=>normalizeVocabularySingleImprovementOutput(job,{...keepOutput(),sharedExercise:shared}),/Unknown supplied word/);
  assert.throws(()=>normalizeVocabularySingleImprovementOutput(job,{...keepOutput(),sharedExercise:{...shared,answers:['response_1','response_1']}}),/target and distinct/);
  sql.prepare('INSERT INTO lexical_words VALUES (?,?,?,?,?)').run('b','wrong',null,'wrong','test response');
  assert.throws(()=>normalizeVocabularySingleImprovementOutput(job,{...keepOutput(),sharedExercise:{...shared,answers:['target','response_1'],prompt:'Recall wrong'}}),/exposes an accepted answer/);
});
function worker(provider:{isConfigured():boolean;run(job:VocabularyReflectionJob):Promise<VocabularyReflectionResult>},controls=()=>({maintenanceMode:false,providerWorkEnabled:true})) {
  return createVocabularyProcessingWorker({provider,now:()=>clock,controls,providerWork:permitted});
}

test('idle dispatch polling uses active indexes with large retained evidence and preserves lease expiry',async()=>{
  const evidence=JSON.stringify({retained:'x'.repeat(512*1024)});
  const seed=(id:string,status:string,expiresAt:string|null=null)=>{
    sql.prepare(`INSERT INTO vocabulary_sessions VALUES(?,'alice',1,'{}',?,?,'closed')`).run(id,at,at);
    sql.prepare(`INSERT INTO vocabulary_session_completions VALUES(?,'alice',?,1,0,?,?,'closed','{}','{}','fixture',?,NULL)`).run(id,id,at,at,at);
    sql.prepare(`INSERT INTO vocabulary_post_session_dispatches(dispatch_id,learner_id,session_id,completion_id,evidence_json,status,created_at,active_token,expires_at)
      VALUES(?,'alice',?,?,?,?,?,?,?)`).run(id,id,id,evidence,status,at,status==='running'?`token-${id}`:null,expiresAt);
  };
  for(let i=0;i<16;i++)seed(`history-${i}`,i%2?'succeeded':'failed');
  seed('expired','running',new Date(clock).toISOString());
  seed('live','running',new Date(clock+60_000).toISOString());
  const before=sql.prepare("SELECT * FROM vocabulary_post_session_dispatches WHERE status IN ('succeeded','failed') ORDER BY dispatch_id").all();
  const statements=new Set<string>();
  const prepare=sql.prepare.bind(sql);
  sql.prepare=(query:string)=>{if(query.includes('vocabulary_post_session_dispatches'))statements.add(query);return prepare(query);};
  const processing=worker({isConfigured:()=>false,run:async()=>{throw new Error('Unexpected provider call');}});
  try {
    assert.equal(await processing.step(),true);
    assert.equal(await processing.step(),false);
  } finally {await processing.stop();sql.prepare=prepare;}
  assert.equal(statements.size,2,'Check the actual worker expiry UPDATE and queue SELECT');
  for(const query of statements) {
    const plan=prepare(`EXPLAIN QUERY PLAN ${query}`).all(...Array.from(query.matchAll(/\?/g),()=>new Date(clock).toISOString())) as {detail:string}[];
    const expected=query.trimStart().startsWith('UPDATE')?'idx_vocabulary_dispatch_running_expiry':'idx_vocabulary_dispatch_queued';
    assert.ok(plan.some(row=>row.detail.includes(expected)),JSON.stringify(plan));
    assert.ok(!plan.some(row=>/SCAN (?:d|vocabulary_post_session_dispatches)$/.test(row.detail)),JSON.stringify(plan));
  }
  assert.deepEqual(prepare("SELECT * FROM vocabulary_post_session_dispatches WHERE dispatch_id LIKE 'history-%' ORDER BY dispatch_id").all(),before);
  assert.deepEqual({...prepare("SELECT status,active_token,expires_at,last_error FROM vocabulary_post_session_dispatches WHERE dispatch_id='expired'").get()},
    {status:'failed',active_token:null,expires_at:null,last_error:'ingestion_interrupted'});
  assert.equal(prepare("SELECT status FROM vocabulary_post_session_dispatches WHERE dispatch_id='live'").get()!.status,'running');
});

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
  const first=processing.step();
  await Promise.race([begun,first.then(()=>{throw new Error('Processing step ended before entering the held feedback provider');})]);
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
  let lastRequest: {messages:{role:string;content:string}[]} | undefined;
  let payload:unknown={diagnosis:'An alternate fits',lesson:'The original cue also permits this answer.',unfairEncounterIds:['session-one']};
  const sense=createVocabularySense({wordId:'a',description:{label:'written character'}},{kind:'operator',id:'editor'});
  establishVocabularySenseCatalog('a',getVocabularySenseCatalog('a').version,{kind:'operator',id:'editor'});
  writeVocabularyDefaultUsefulSenses('a',0,[sense.senseId],{kind:'operator',id:'editor'});
  const adapter=createOpenAiCompatibleAdapter({id:'openai',defaultBaseUrl:'https://example.invalid',apiKeyEnvironmentVariable:'KEY',structuredOutputMode:'json_schema',maxTokensField:'max_tokens',
    fetchImplementation:async(_url,init)=>{
      const request=JSON.parse(String(init?.body)) as {messages:Array<{content:string}>;response_format:{json_schema:{name:string}}};
      lastRequest=request as typeof request & {messages:{role:string;content:string}[]};
      const value=request.response_format.json_schema.name.includes('sense_mapping')?{outcome:'single_sense',rationale:'A written character.',senseIds:[JSON.parse(request.messages[1]!.content).senses[0].senseId]}:payload;
      return new Response(JSON.stringify({id:'provider-1',model:'resolved',choices:[{message:{content:JSON.stringify(value)},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:10}}),{status:200});
    }});
  const provider=createVocabularyReflectionProvider({random:()=>0,environment:{OPENAI_API_KEY:'never-save-token'},adapter,
    ensureSenses:async()=>({catalog:getVocabularySenseCatalog('a'),senses:getVocabularySenses('a'),source:'existing'})});
  const output=await provider.run(job);assert.equal(output.kind,'learner_feedback');
  const invocation=sql.prepare('SELECT * FROM model_invocations').get()!;assert.equal(invocation.actor_kind,'service');assert.equal(invocation.learner_id,null);
  assert.equal(invocation.prompt_name,'vocabulary-reflection-feedback');assert.equal(invocation.workflow_id,job.jobId);assert.ok(!JSON.stringify(invocation).includes('never-save-token'));
  assert.equal(invocation.prompt_version,'4');assert.equal(invocation.schema_version,'1');assert.equal(invocation.input_projection_version,'vocabulary-reflection.v3');
  assert.equal(invocation.prompt_template,fs.readFileSync(new URL('../server/vocabulary/reflection-prompts/feedback.md',import.meta.url),'utf8'));
  payload={diagnosis:'Claim',lesson:'Lesson',unfairEncounterIds:['invented']};await assert.rejects(()=>provider.run(job),/supplied rejected/);
  assert.equal(sql.prepare("SELECT count(*) n FROM model_invocations WHERE status='invalid_response'").get()!.n,1);
  const improve=claimVocabularyReflectionJob({kind:'exercise_improvement',now:new Date(clock).toISOString()})!;
  const valid={diagnosis:'Repair the overloaded cue',operations:[{sourceContentId:'one',strategy:'update_existing',rationale:'A faithful wording',prompt:'A written character',acceptedAnswers:['字']}]};
  assert.equal(normalizeVocabularyReflectionOutput(improve,valid).kind,'exercise_improvement');
  payload={summary:valid.diagnosis,source:{decision:'revise',prompt:'A written character'},additionalExercises:[],sharedExercise:null};assert.equal((await provider.run(improve)).kind,'exercise_improvement');
  const improvementInvocation=sql.prepare("SELECT * FROM model_invocations WHERE prompt_name='vocabulary-reflection-single-improvement'").get();
  assert.ok(improvementInvocation,'Selected sense assessment must reach the active single-improvement call');
  assert.equal(improvementInvocation.actor_kind,'service');assert.equal(improvementInvocation.learner_id,null);assert.equal(improvementInvocation.workflow_id,improve.jobId);
  assert.equal(improvementInvocation.prompt_version,'7');assert.equal(improvementInvocation.schema_version,'5');assert.equal(improvementInvocation.input_projection_version,'vocabulary-exercise-authoring.v3');
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
  assert.equal(opinionInvocation.workflow_id,improve.jobId);assert.equal(opinionInvocation.prompt_version,'3');
  assert.equal(opinionInvocation.prompt_template,`${fs.readFileSync(new URL('../server/vocabulary/reflection-prompts/reasoning.md',import.meta.url),'utf8')}\n\n${fs.readFileSync(new URL('../server/vocabulary/reflection-prompts/second-opinion.md',import.meta.url),'utf8')}`);
  const noChangeJob:VocabularyReflectionJob={...improve,secondOpinion:{requestId:'no-change',proposal:null,notes:'Check the answer',diagnosis:'No correction needed'}};
  await provider.run(noChangeJob);
  const input=JSON.parse(lastRequest!.messages.find(item=>item.role==='user')!.content);
  assert.equal(input.proposal,null);assert.equal(input.operatorNotes,'Check the answer');
  assert.equal(input.originalDiagnosis,'No correction needed');assert.equal(input.evidence.sourceContent.contentId,'one');
  assert.equal(input.evidence.sourceContent.version,1);assert.equal(input.evidence.encounters[0].served.body.prompt,'Prompt one');
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
    const proposal=normalizeVocabularyReflectionOutput(job,{diagnosis:'Clarify the productive use',responseExercises:[],pureCueReferral:null,
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
  const unchanged=normalizeVocabularyReflectionOutput(job,{diagnosis:'Retain the existing prompt',responseExercises:[],pureCueReferral:null,
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

test('improvement retains GLM after failure and recreation regardless of recorded learner spend',async()=>{
  const job:VocabularyReflectionJob={...await authoringJob(),secondOpinion:{requestId:'routing-test',proposal:null,notes:'Check the cue',diagnosis:'Keep it'}};
  const requests:import('../server/llm/types.ts').ProviderRunRequest[]=[];
  let fail=true;
  const adapter:import('../server/llm/types.ts').ProviderAdapter={id:'zai',defaultBaseUrl:'https://unused.invalid',apiKeyEnvironmentVariable:'ZAI_API_KEY',structuredOutputMode:'json_object',async run(request){
    requests.push(request);if(fail)throw new Error('temporary failure');
    return {provider:'zai',model:request.model,responseId:null,structuredOutputMode:'json_object',rawText:JSON.stringify({verdict:'support',rationale:'The cue works.'}),finishReason:'stop',rawResponse:null,usage:{inputTokens:null,cachedInputTokens:null,cacheWriteInputTokens:null,outputTokens:null,reasoningTokens:null,totalTokens:null},invocationId:null};
  }};
  const environment={ZAI_API_KEY:'test'};
  sql.prepare(`INSERT INTO model_invocations(id,timestamp,provider,model,invocation_type,spend_usd,spend_source,status,actor_kind,actor_id,requesting_learner_id)
    VALUES ('prior-spend',?,'zai','glm-5.3-flash','vocabulary_reflection_improvement',0.1,'estimated','completed','service','vocabulary-reflection','alice')`).run(new Date().toISOString());
  const first=createVocabularyReflectionProvider({environment,adapter,random:()=>0.5});
  assert.equal(first.isConfigured(),true);
  await assert.rejects(()=>first.run(job),/temporary failure/);
  assert.equal(sql.prepare('SELECT model_choice FROM vocabulary_reflection_jobs WHERE job_id=?').get(job.jobId)!.model_choice,'zai:glm-5.3-flash-high');
  fail=false;
  const retry=createVocabularyReflectionProvider({environment,adapter,random:()=>{throw new Error('Must not reroll');}});
  await retry.run({...job,attemptNumber:2});
  assert.deepEqual(requests.map(request=>request.model),['glm-5.3-flash','glm-5.3-flash']);
  assert.equal(requests[1]!.provenance!.attemptNumber,2);
  sql.prepare("UPDATE model_invocations SET spend_usd=100 WHERE id='prior-spend'").run();
  const highSpend=createVocabularyReflectionProvider({environment,adapter,random:()=>{throw new Error('Must not reroll');}});
  await alice(()=>highSpend.run(job));
  assert.equal(requests.length,3);
  assert.equal(requests[2]!.model,'glm-5.3-flash');
  assert.deepEqual(requests[2]!.invocationActor,{kind:'service',serviceId:'vocabulary-reflection',requestingLearnerId:'alice'});
  assert.equal(sql.prepare("SELECT spend_usd FROM model_invocations WHERE id='prior-spend'").get()!.spend_usd,100);
});


test('new feedback uses schema-constrained OpenAI routes and retains its choice after failure',async()=>{
  pending();const ingestOnly=worker({isConfigured:()=>false,run:async job=>result(job)});await ingestOnly.step();await ingestOnly.stop();
  const job=claimVocabularyReflectionJob({kind:'learner_feedback',now:new Date(clock).toISOString()})!;
  installModelInvocationLedger();
  for(const [ticket,model] of [[0.25,'gpt-6-luna'],[0.75,'gpt-6-sol']] as const){
    sql.prepare('UPDATE vocabulary_reflection_jobs SET model_choice=NULL WHERE job_id=?').run(job.jobId);
    const calls:string[]=[];let fail=true;
    const fetchImplementation:typeof fetch=async(url,init)=>{
      assert.equal(String(url),'https://api.openai.com/v1/chat/completions');
      const body=JSON.parse(String(init?.body));calls.push(body.model);
      assert.equal(body.response_format.type,'json_schema');assert.equal(body.response_format.json_schema.strict,true);
      if(fail)throw new Error('temporary failure');
      return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({diagnosis:'Fair cue',lesson:'Lesson',unfairEncounterIds:[]})},finish_reason:'stop'}]}),{status:200});
    };
    const options={environment:{OPENAI_API_KEY:'test'},fetchImplementation};
    const first=createVocabularyReflectionProvider({...options,random:()=>ticket});
    await assert.rejects(()=>first.run(job),/temporary failure/);fail=false;
    const retry=createVocabularyReflectionProvider({...options,random:()=>assert.fail('Must retain the feedback route')});
    assert.equal((await retry.run({...job,attemptNumber:2})).kind,'learner_feedback');
    assert.deepEqual(calls,[model,model]);
    assert.equal(sql.prepare('SELECT model_choice FROM vocabulary_reflection_jobs WHERE job_id=?').get(job.jobId)!.model_choice,`openai:${model}-high`);
  }
});

test('feedback pinned to either GLM route uses Luna on retry without rewriting saved provenance',async()=>{
  pending();const ingestOnly=worker({isConfigured:()=>false,run:async job=>result(job)});await ingestOnly.step();await ingestOnly.stop();
  const job=claimVocabularyReflectionJob({kind:'learner_feedback',now:new Date(clock).toISOString()})!;
  installModelInvocationLedger();
  sql.prepare(`INSERT INTO model_invocations(id,timestamp,provider,model,invocation_type,spend_source,status,actor_kind,actor_id,requesting_learner_id,workflow_id)
    VALUES ('original-glm',?,'zai','glm-5.3-flash','vocabulary_reflection_feedback_v1','unknown','invalid_response','service','vocabulary-reflection','alice',?)`).run(at,job.jobId);
  const original=sql.prepare("SELECT * FROM model_invocations WHERE id='original-glm'").get();
  let calls=0;
  const provider=createVocabularyReflectionProvider({environment:{OPENAI_API_KEY:'test'},random:()=>assert.fail('Stored feedback route must resolve deterministically'),
    fetchImplementation:async(url,init)=>{
      calls++;assert.equal(String(url),'https://api.openai.com/v1/chat/completions');
      const body=JSON.parse(String(init?.body));assert.equal(body.model,'gpt-6-luna');
      assert.equal(body.response_format.json_schema.strict,true);
      return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({diagnosis:'Fair cue',lesson:'Lesson',unfairEncounterIds:[]})},finish_reason:'stop'}]}),{status:200});
    }});
  for(const choice of ['zai:glm-5.3-flash-high','zai:glm-5.3-flash-max']){
    sql.prepare('UPDATE vocabulary_reflection_jobs SET model_choice=? WHERE job_id=?').run(choice,job.jobId);
    assert.equal((await provider.run({...job,attemptNumber:2})).kind,'learner_feedback');
    assert.equal(sql.prepare('SELECT model_choice FROM vocabulary_reflection_jobs WHERE job_id=?').get(job.jobId)!.model_choice,choice);
  }
  assert.equal(calls,2);
  assert.deepEqual(sql.prepare("SELECT * FROM model_invocations WHERE id='original-glm'").get(),original);
  const retries=sql.prepare("SELECT provider,model,attempt_number FROM model_invocations WHERE id!='original-glm'").all();
  assert.deepEqual(retries.map(row=>[row.provider,row.model,row.attempt_number]),[['openai','gpt-6-luna',2],['openai','gpt-6-luna',2]]);
});

test('improvement GLM transport uses its credentials, endpoint and JSON-object protocol',async()=>{
  const job:VocabularyReflectionJob={...await authoringJob(),secondOpinion:{requestId:'transport-test',proposal:null,notes:'Check the cue',diagnosis:'Keep it'}};
  installModelInvocationLedger();
  const provider=createVocabularyReflectionProvider({environment:{ZAI_API_KEY:'zai-test'},random:()=>0.5,
    fetchImplementation:async(url,init)=>{
      assert.equal(String(url),'https://api.z.ai/api/paas/v4/chat/completions');
      assert.equal(new Headers(init?.headers).get('authorization'),'Bearer zai-test');
      const body=JSON.parse(String(init?.body));
      assert.equal(body.model,'glm-5.3-flash');assert.deepEqual(body.response_format,{type:'json_object'});
      assert.equal(body.max_tokens,131072);assert.equal(body.max_completion_tokens,undefined);
      return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({verdict:'support',rationale:'The cue works.'})},finish_reason:'stop'}]}),{status:200});
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
  assert.equal(mappingJobRow().failures,0);
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

test('other assessment conflicts do not masquerade as superseded sources',async()=>{
  pending();
  const processing=worker({isConfigured:()=>true,run:async job=>{
    if(job.kind==='exercise_improvement')throw new VocabularyReflectionConflict('source changed');
    return result(job);
  }});
  await processing.step();
  assert.equal(sql.prepare("SELECT last_error FROM vocabulary_reflection_jobs WHERE kind='exercise_improvement'").get()!.last_error,'assessment_conflict');
  assert.equal(sql.prepare("SELECT state FROM vocabulary_case_reviews").get()!.state,'open');
  await processing.stop();
});

test('a confirmed superseded source closes an unreviewed case while retaining its failed job',async()=>{
  pending();
  const processing=worker({isConfigured:()=>true,run:async job=>{
    if(job.kind==='exercise_improvement'){
      const source=getVocabularyContentForMaintenance('one')!;
      updateVocabularyContent('one',source.version,{...source,body:{prompt:'Revised cue'}},{kind:'operator',id:'editor'});
      throw new VocabularyReflectionSourceConflict('Source was superseded');
    }
    return result(job);
  }});
  await processing.step();
  const failed=sql.prepare("SELECT job_id,last_error,status FROM vocabulary_reflection_jobs WHERE kind='exercise_improvement'").get()!;
  assert.equal(failed.status,'failed');assert.equal(failed.last_error,'source_conflict');
  assert.equal(sql.prepare('SELECT state FROM vocabulary_case_reviews').get()!.state,'resolved');
  const closure=sql.prepare("SELECT data_json FROM backend_events WHERE name='vocabulary.reflection.case_source_conflict_resolved'").get()!;
  assert.equal(JSON.parse(String(closure.data_json)).jobId,failed.job_id);
  await processing.stop();
});

test('a source conflict is not enough to close a case without confirmed supersession',async()=>{
  pending();
  const processing=worker({isConfigured:()=>true,run:async job=>{
    if(job.kind==='exercise_improvement')throw new VocabularyReflectionSourceConflict('Unverified source change');
    return result(job);
  }});
  await processing.step();
  assert.equal(sql.prepare('SELECT state FROM vocabulary_case_reviews').get()!.state,'open');
  await processing.stop();
});


function mappingTrial(reply:(attempt:number)=>{status?:number;value?:unknown;rawText?:string},repairFailsOnce=false) {
  const models:string[]=[];
  const requests:Array<{model:string;response_format:{type:string};reasoning_effort:string}>=[];
  let repairs=0;
  const sense=createVocabularySense({wordId:'a',description:{label:'written character'}},{kind:'operator',id:'editor'});
  establishVocabularySenseCatalog('a',getVocabularySenseCatalog('a').version,{kind:'operator',id:'editor'});
  const fetchImplementation:typeof fetch=async(_url,init)=>{
    const request=JSON.parse(String(init?.body)) as {model:string;messages:Array<{role:string;content:string}>;response_format:{type:string;json_schema:{name:string}};reasoning_effort:string};requests.push(request);
    const input=JSON.parse(request.messages.find(message=>message.role==='user')!.content) as {senses?:Array<{senseId:string}>};
    let value:unknown={diagnosis:'Fair cue',lesson:'A useful lesson',unfairEncounterIds:[]};
    let rawText:string|undefined;
    if(Array.isArray(input.senses)) {
      models.push(request.model);
      const response=reply(models.length);
      if(response.status)return new Response('Provider unavailable',{status:response.status});
      assert.equal(input.senses.length,1);assert.notEqual(input.senses[0]!.senseId,sense.senseId);
      value=response.value??{outcome:'single_sense',rationale:'A written character.',senseIds:[input.senses[0]!.senseId]};
      rawText=response.rawText;
    } else if(request.response_format.json_schema.name.includes('single_improvement')) {
      if(repairFailsOnce&&++repairs===1)return new Response('Authoring unavailable',{status:503});
      value={summary:'Keep this exercise',source:{decision:'keep',prompt:null},additionalExercises:[],sharedExercise:null};
    }
    return new Response(JSON.stringify({model:request.model,choices:[{message:{content:rawText??JSON.stringify(value)},finish_reason:'stop'}]}),{status:200});
  };
  const create=()=>createVocabularyReflectionProvider({random:()=>0,environment:{OPENAI_API_KEY:'fake-openai',ZAI_API_KEY:'fake-zai'},fetchImplementation,
    ensureSenses:async()=>({catalog:getVocabularySenseCatalog('a'),senses:getVocabularySenses('a'),source:'existing'})});
  return {models,requests,create};
}
function mappingJobRow() {
  return sql.prepare("SELECT job_id,status,sense_mapping_availability_failures AS failures,next_attempt_at,last_error FROM vocabulary_reflection_jobs WHERE kind='exercise_improvement'").get()!;
}

test('mapping exhausts three Luna attempts then three ZAI attempts with durable independent backoff',async()=>{
  pending();installModelInvocationLedger();
  const trial=mappingTrial(()=>({status:503}));
  let processing=worker(trial.create());
  try {
    for(const [index,delay] of [0,30_000,60_000,0,30_000,60_000].entries()) {
      if(delay){clock+=delay-1;await processing.step();assert.equal(trial.models.length,index);clock++;}
      await processing.step();
      assert.equal(trial.models.length,index+1);
      assert.equal(mappingJobRow().failures,index+1);
      assert.equal(mappingJobRow().status,index===5?'failed':'queued');
      if(index===1){await processing.stop();processing=worker(trial.create());}
    }
    assert.deepEqual(trial.models,['gpt-6-luna','gpt-6-luna','gpt-6-luna','glm-5.3-flash','glm-5.3-flash','glm-5.3-flash']);
    assert.equal(mappingJobRow().last_error,'sense_mapping_unavailable');
    clock+=120_000;await processing.step();assert.equal(trial.models.length,6);
    assert.equal(alice(listOwnVocabularyMessages).length,1);
    assert.deepEqual(sql.prepare("SELECT provider,model FROM model_invocations WHERE step_name='sense_mapping' ORDER BY rowid").all().map(row=>[row.provider,row.model]),
      trial.models.map(model=>[model==='gpt-6-luna'?'openai':'zai',model]));
    const zai=trial.requests.find(request=>request.model==='glm-5.3-flash')!;
    assert.equal(zai.response_format.type,'json_object');assert.equal(zai.reasoning_effort,'high');
    retryVocabularyReflectionJob(String(mappingJobRow().job_id),'editor',new Date(clock).toISOString());
    assert.equal(mappingJobRow().failures,0);
    await processing.step();assert.equal(trial.models.at(-1),'gpt-6-luna');assert.equal(mappingJobRow().failures,1);
  } finally {await processing.stop();}
});

test('successful fallback mapping is reused when later authoring needs explicit retry',async()=>{
  pending();installModelInvocationLedger();
  const trial=mappingTrial(attempt=>attempt<=3?{status:429}:{},true);
  const processing=worker(trial.create());
  try {
    await processing.step();clock+=30_000;await processing.step();clock+=60_000;await processing.step();await processing.step();
    assert.equal(mappingJobRow().status,'failed');assert.equal(mappingJobRow().failures,3);
    assert.equal(trial.models.length,4);
    const mappingStage=sql.prepare("SELECT input_json,result_json,input_hash FROM vocabulary_improvement_stages WHERE stage='sense_mapping'").get()!;
    const stored=JSON.parse(String(mappingStage.input_json));
    assert.equal(stored.contract.model,'glm-5.3-flash');assert.equal(stored.contract.provider,'zai');
    const wireInput=JSON.parse(stored.contract.modelInput);
    assert.equal(wireInput.senses[0].senseId,'s1');
    assert.notEqual(stored.input.senses[0].senseId,wireInput.senses[0].senseId);
    assert.deepEqual(JSON.parse(String(mappingStage.result_json)).senseIds,[stored.input.senses[0].senseId]);
    retryVocabularyReflectionJob(String(mappingJobRow().job_id),'editor',new Date(clock).toISOString());
    await processing.step();assert.equal(mappingJobRow().status,'succeeded');assert.equal(trial.models.length,4);
    const reused=sql.prepare("SELECT input_hash FROM vocabulary_improvement_stages WHERE stage='sense_mapping'").all();
    assert.equal(reused.length,1);assert.equal(reused[0]!.input_hash,mappingStage.input_hash);
  } finally {await processing.stop();}
});

for(const response of [{value:{outcome:'single_sense',rationale:'Unknown sense',senseIds:['invented']}},{rawText:'invalid JSON'},{status:400}]) {
  test(`mapping response failure stays manual: ${JSON.stringify(response)}`,async()=>{
    pending();installModelInvocationLedger();const trial=mappingTrial(()=>response);
    const processing=worker(trial.create());
    try {
      await processing.step();assert.equal(mappingJobRow().status,'failed');assert.equal(mappingJobRow().failures,0);
      clock+=120_000;await processing.step();assert.deepEqual(trial.models,['gpt-6-luna']);
    } finally {await processing.stop();}
  });
}

test('maintenance and disabled learners stop queued mapping retries',async()=>{
  pending();installModelInvocationLedger();const trial=mappingTrial(()=>({status:503}));
  let state={maintenanceMode:false,providerWorkEnabled:true};
  const processing=worker(trial.create(),()=>state);
  try {
    await processing.step();clock+=30_000;
    state={maintenanceMode:true,providerWorkEnabled:true};await processing.step();assert.equal(trial.models.length,1);
    state={maintenanceMode:false,providerWorkEnabled:false};await processing.step();assert.equal(trial.models.length,1);
    state={maintenanceMode:false,providerWorkEnabled:true};
    sql.exec("UPDATE learners SET disabled_at='disabled' WHERE learner_id='alice'");await processing.step();assert.equal(trial.models.length,1);
    sql.exec("UPDATE learners SET disabled_at=NULL WHERE learner_id='alice'");await processing.step();assert.equal(trial.models.length,2);
  } finally {await processing.stop();}
});


test('manual recovery from invalid mapping output resets partial availability failures',async()=>{
  pending();installModelInvocationLedger();
  const trial=mappingTrial(attempt=>attempt===1?{status:503}:{rawText:'invalid JSON'});
  const processing=worker(trial.create());
  try {
    await processing.step();clock+=30_000;await processing.step();
    assert.equal(mappingJobRow().status,'failed');assert.equal(mappingJobRow().failures,1);
    retryVocabularyReflectionJob(String(mappingJobRow().job_id),'editor',new Date(clock).toISOString());
    assert.equal(mappingJobRow().failures,0);
    await processing.step();assert.equal(trial.models.at(-1),'gpt-6-luna');
  } finally {await processing.stop();}
});


test('undo during the completion window keeps an accidental production response out of feedback after retry',async()=>{
  const started=new Date(clock-16_000).toISOString();
  const withinWindow=new Date(Date.parse(started)+1000).toISOString();
  const sessionId='boundary';
  const first=alice(()=>{
    const snapshot={contentId:'one',contentVersion:1,kind:'production' as const,role:'general' as const,
      body:{prompt:'Prompt one',material:getVocabularyContent('one')!.body},assessment:{acceptedAnswers:['字'],criteria:{match:'exact'}}};
    createVocabularySession({sessionId,words:[{wordId:'a',mode:'practice'}]},started);
    const inputs=[
      {kind:'presentation' as const,payload:{encounterId:'boundary-one',wordId:'a',snapshot}},
      {kind:'finish_for_now' as const,payload:{}},
      {kind:'response' as const,payload:{encounterId:'boundary-one',response:'accidental',outcome:'rejected' as const}},
      {kind:'word_wrap' as const,payload:{wordId:'a',reason:'enough' as const}},
    ];
    const actions=inputs.map((input,index)=>({...input,protocolVersion:1 as const,actionId:`boundary-${index}`,clientActionId:`boundary-c-${index}`,sequence:index+1,occurredAt:started,transitionId:index>=2?'submit':undefined}));
    appendVocabularySessionActions(sessionId,actions,started);
    return stageVocabularySessionCompletion(sessionId,actions.length,started);
  });
  const cancelled=alice(()=>cancelVocabularySessionCompletion(sessionId,first.completionId,withinWindow));
  assert.equal(cancelled.status,'cancelled');
  alice(()=>{
    const inputs=[
      {kind:'undo' as const,payload:{undoesActionId:'boundary-3'}},
      {kind:'response' as const,payload:{encounterId:'boundary-one',response:'kept-miss',outcome:'rejected' as const}},
      {kind:'word_wrap' as const,payload:{wordId:'a',reason:'enough' as const}},
    ];
    const actions=inputs.map((input,index)=>({...input,protocolVersion:1 as const,actionId:`boundary-next-${index}`,clientActionId:`boundary-next-c-${index}`,sequence:index+5,occurredAt:withinWindow}));
    appendVocabularySessionActions(sessionId,actions,withinWindow);
    stageVocabularySessionCompletion(sessionId,7,withinWindow);
  });
  assert.throws(()=>alice(()=>closeVocabularySessionCompletion(sessionId,first.completionId,new Date(clock).toISOString())),/cancelled/);
  assert.equal(sql.prepare('SELECT count(*) n FROM vocabulary_post_session_dispatches WHERE completion_id=?').get(first.completionId)!.n,0);
  sql.exec(`CREATE TABLE learner_owned_word_study_admission_state(
    learner_id TEXT NOT NULL REFERENCES learners(learner_id) ON DELETE CASCADE,
    word_id TEXT NOT NULL REFERENCES lexical_words(id) ON DELETE CASCADE,
    study_phase TEXT NOT NULL,earliest_next_study_at TEXT,PRIMARY KEY(learner_id,word_id));`);
  sql.exec("CREATE TRIGGER fail_boundary_case BEFORE INSERT ON reflection_cases BEGIN SELECT RAISE(ABORT,'test ingestion fault'); END;");
  const processing=worker({isConfigured:()=>false,run:async job=>result(job)});
  await processing.step();
  const dispatch=sql.prepare('SELECT dispatch_id,status,evidence_json,completion_id FROM vocabulary_post_session_dispatches').get()!;
  assert.equal(dispatch.status,'failed');
  assert.notEqual(dispatch.completion_id,first.completionId);
  const stored=JSON.parse(String(dispatch.evidence_json)) as {projection:{undoneActionIds:string[];encounters:{responses:{actionId:string;payload:{response:string}}[]}[]}};
  assert.ok(stored.projection.undoneActionIds.includes('boundary-2'));
  assert.equal(stored.projection.encounters[0]?.responses.some(action=>action.payload.response==='accidental'),true);
  assert.equal(Number(sql.prepare('SELECT count(*) n FROM reflection_cases').get()!.n),0);
  sql.exec('DROP TRIGGER fail_boundary_case');
  retryVocabularyPostSessionDispatch(String(dispatch.dispatch_id),'editor',new Date(clock).toISOString());
  await processing.step();
  const lessons=sql.prepare("SELECT evidence_snapshot_json FROM reflection_cases WHERE kind='learner_feedback'").all() as {evidence_snapshot_json:string}[];
  assert.equal(lessons.length,1);
  assert.equal(lessons[0]!.evidence_snapshot_json.includes('accidental'),false);
  assert.equal(lessons[0]!.evidence_snapshot_json.includes('kept-miss'),true);
  const before=Number(sql.prepare('SELECT count(*) n FROM reflection_cases').get()!.n);
  assert.throws(()=>retryVocabularyPostSessionDispatch(String(dispatch.dispatch_id),'editor',new Date(clock).toISOString()),/failed evidence/);
  await processing.step();
  assert.equal(Number(sql.prepare('SELECT count(*) n FROM reflection_cases').get()!.n),before);
  const schedule=JSON.parse(String(sql.prepare("SELECT scheduler_state_json FROM learner_word_schedules WHERE word_id='a'").get()!.scheduler_state_json)) as {easeFactor:number;intervalHours:number};
  assert.equal(schedule.easeFactor,2.35);
  assert.equal(schedule.intervalHours,6);
  await processing.stop();
});

test('an expired mapping lease cannot consume retry budget or revive unknown work',async()=>{
  pending();installModelInvocationLedger();
  const trial=mappingTrial(()=>{clock+=31*60_000;return {status:503};});
  const processing=worker(trial.create());
  try {
    await processing.step();assert.equal(mappingJobRow().failures,0);
    await processing.step();assert.equal(mappingJobRow().status,'failed');
    assert.equal(mappingJobRow().last_error,'provider_outcome_unknown');assert.equal(trial.models.length,1);
  } finally {await processing.stop();}
});

test('model-empty inventory attention does not revoke a live mapped single-sense repair',async()=>{
  sql.exec(`CREATE TABLE lexical_word_meanings(id TEXT PRIMARY KEY,word_id TEXT,text TEXT,position INTEGER);
    CREATE TABLE word_introduction_preparation(word_id TEXT PRIMARY KEY,content_id TEXT,package_id TEXT,preparation_epoch INTEGER,active_stage TEXT,lease_token TEXT,lease_expires_at TEXT);`);
  pending();let release!:()=>void,entered!:(job:VocabularyReflectionJob)=>void;
  const held=new Promise<void>(resolve=>{release=resolve;});
  const started=new Promise<VocabularyReflectionJob>(resolve=>{entered=resolve;});
  const processing=worker({isConfigured:()=>true,run:async job=>{
    if(job.kind==='learner_feedback')return result(job);
    const ready=await ensureVocabularySenses('a',{workflowId:job.jobId,now:()=>new Date(clock).toISOString(),provider:{isConfigured:()=>true,generate:async()=>({senses:[{label:'written character',notes:[],defaultUseful:false}]})}});
    const sense=ready.senses[0]!,mappingAt=new Date(clock).toISOString();
    mapVocabularyContentSense({contentId:'one',wordId:'a',expectedContentVersion:1,expectedMapping:{senseId:null,establishedAt:null},senseId:sense.senseId,establishedAt:mappingAt},{kind:'service',id:'test'});
    entered(job);await held;
    return {kind:'exercise_improvement',result:{diagnosis:'The mapped use remains valuable despite unknown default usefulness.',proposal:null,
      admission:{outcome:'single_sense',rationale:'Written character.',wordId:'a',sourceContentId:'one',sourceContentVersion:1,catalogVersion:ready.catalog.version,senseIds:[sense.senseId],sourceMapping:{senseId:sense.senseId,establishedAt:mappingAt},generationScope:{selectionEstablished:true,senseIds:[sense.senseId],source:{kind:'mapped_source'}}}}};
  }});
  const flight=processing.step();const job=await started;
  try{
    assert.equal(sql.prepare("SELECT status FROM vocabulary_default_selection_readiness WHERE word_id='a'").get()!.status,'failed');
    await processing.step();
    const live=sql.prepare('SELECT status,lease_token FROM vocabulary_reflection_jobs WHERE job_id=?').get(job.jobId)!;
    assert.equal(live.status,'running');assert.equal(live.lease_token,job.leaseToken);
  }finally{release();await flight;await processing.stop();}
  assert.equal(sql.prepare('SELECT status FROM vocabulary_reflection_jobs WHERE job_id=?').get(job.jobId)!.status,'succeeded');
});

for(const kind of ['sense','selection'] as const)for(const state of ['queued','failed'] as const)test(`${kind} ${state} prerequisite cannot revoke a live caller but its expired caller is recovered`,async()=>{
  pending();const ingest=worker({isConfigured:()=>false,run:async job=>result(job)});await ingest.step();await ingest.stop();
  const job=claimVocabularyReflectionJob({kind:'exercise_improvement',now:new Date(clock).toISOString(),leaseMs:1000})!;
  const table=kind==='sense'?'vocabulary_sense_readiness':'vocabulary_default_selection_readiness';
  sql.prepare(`INSERT INTO ${table}(word_id,status,attempt_count,total_attempt_count,expected_catalog_version,workflow_id,created_at,updated_at) VALUES ('a',?,1,1,0,?,?,?)`).run(state,job.jobId,at,at);
  assert.equal(recoverVocabularySenseDependencies(new Date(clock).toISOString()),0);
  assert.equal(sql.prepare('SELECT lease_token FROM vocabulary_reflection_jobs WHERE job_id=?').get(job.jobId)!.lease_token,job.leaseToken);
  clock+=1000;assert.equal(recoverVocabularySenseDependencies(new Date(clock).toISOString()),1);
  const recovered=sql.prepare('SELECT status,lease_token,attempt_number FROM vocabulary_reflection_jobs WHERE job_id=?').get(job.jobId)!;
  assert.equal(recovered.status,kind==='selection'||state==='queued'?'queued':'failed');assert.equal(recovered.lease_token,null);assert.equal(recovered.attempt_number,1);
  assert.equal(sql.prepare(`SELECT attempt_count FROM ${table} WHERE word_id='a'`).get()!.attempt_count,1);
});

test('expired selector lease still recovers its crashed caller before the caller lease expires',async()=>{
  pending();const ingest=worker({isConfigured:()=>false,run:async job=>result(job)});await ingest.step();await ingest.stop();
  const job=claimVocabularyReflectionJob({kind:'exercise_improvement',now:new Date(clock).toISOString(),leaseMs:30*60_000})!;
  sql.prepare(`INSERT INTO vocabulary_default_selection_readiness(word_id,status,attempt_count,total_attempt_count,active_token,expires_at,expected_catalog_version,workflow_id,created_at,updated_at)
    VALUES ('a','running',1,1,'selector-old',?,0,?,?,?)`).run(new Date(clock+300_000).toISOString(),job.jobId,at,at);
  clock+=300_000;assert.equal(recoverVocabularySenseDependencies(new Date(clock).toISOString()),1);
  const waiting=sql.prepare('SELECT status,lease_token,next_attempt_at FROM vocabulary_reflection_jobs WHERE job_id=?').get(job.jobId)!;
  assert.equal(waiting.status,'queued');assert.equal(waiting.lease_token,null);assert.equal(waiting.next_attempt_at,new Date(clock+30_000).toISOString());
  const selector=sql.prepare('SELECT status,active_token,attempt_count,total_attempt_count FROM vocabulary_default_selection_readiness').get()!;
  assert.equal(selector.status,'queued');assert.equal(selector.active_token,null);assert.equal(selector.attempt_count,1);assert.equal(selector.total_attempt_count,1);
});
