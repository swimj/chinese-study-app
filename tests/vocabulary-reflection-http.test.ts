import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach,afterEach,test } from 'node:test';
import type { Express,Request,Response,NextFunction,RequestHandler } from 'express';
import { setDb } from '../server/db/connection.ts';
import { runWithLearnerId } from '../server/db/learner-context.ts';
import { createVocabularyContent,getVocabularyContentForMaintenance } from '../server/db/vocabulary-content.ts';
import { createVocabularySession,appendVocabularySessionActions,stageVocabularySessionCompletion,closeVocabularySessionCompletion } from '../server/db/vocabulary-sessions.ts';
import { ingestVocabularySessionEvidence,claimVocabularyReflectionJob,recordVocabularyFeedbackJudgment,recordVocabularyImprovementResult } from '../server/db/vocabulary-reflection.ts';
import { registerVocabularyReflectionRoutes } from '../server/vocabulary/reflection-routes.ts';
import type { VocabularySessionAction } from '../src/domain/vocabulary-session.ts';
let sql:DatabaseSync,env:Record<string,string|undefined>,handlers:Map<string,RequestHandler[]>,wakes:number;
const at='2026-10-17T10:00:00.000Z',later='2026-10-17T10:00:16.000Z',base='/api/operator/vocabulary',feedback='/api/vocabulary/feedback';
const alice=<T>(work:()=>T)=>runWithLearnerId('alice',work);
let feedbackJob:string,improvementJob:string,caseId:string;
function draft(id='one'){return {contentId:id,kind:'exercise' as const,payloadVersion:1,body:{prompt:'A written character'},exerciseType:'definition',skill:'production',exerciseRole:'general' as const,
  assessment:{match:'exact'},accessScope:'shared' as const,availability:'active' as const,originKind:'human' as const,words:[{wordId:'a',relation:'target' as const}],answers:[{wordId:'a',acceptedForms:['字']}]};}
beforeEach(()=>{
  env=Object.fromEntries(['APP_AUTH_MODE','APP_DATA_DIR','APP_MODE','APP_LEARNER_ID','APP_OPERATOR_CLERK_USER_IDS'].map(key=>[key,process.env[key]]));
  Object.assign(process.env,{APP_AUTH_MODE:'trusted_local',APP_MODE:'study',APP_DATA_DIR:'/tmp/vocabulary-reflection-http',APP_LEARNER_ID:'editor',APP_OPERATOR_CLERK_USER_IDS:'editor'});
  sql=new DatabaseSync(':memory:');setDb(sql);sql.exec(`PRAGMA foreign_keys=ON;CREATE TABLE learners(learner_id TEXT PRIMARY KEY,disabled_at TEXT);
    CREATE TABLE learner_word_reserve_requests(learner_id TEXT PRIMARY KEY, requested_at TEXT NOT NULL);
    CREATE TABLE lexical_words(id TEXT PRIMARY KEY);CREATE TABLE model_invocations(id TEXT PRIMARY KEY);
    INSERT INTO learners VALUES ('alice',NULL),('bob',NULL);INSERT INTO lexical_words VALUES ('a');`);
  sql.exec(fs.readFileSync(new URL('../server/db/migrations/0039_vocabulary_content.sql',import.meta.url),'utf8'));
  sql.exec(fs.readFileSync(new URL('../server/db/migrations/0041_vocabulary_learner_state.sql',import.meta.url),'utf8').split('-- Do not use the words view')[0]!);
  sql.exec(fs.readFileSync(new URL('../server/db/migrations/0047_vocabulary_dismissal.sql',import.meta.url),'utf8'));
  sql.exec(fs.readFileSync(new URL('../server/db/migrations/0052_vocabulary_automatic_promotion_pause.sql',import.meta.url),'utf8'));
  sql.exec(`CREATE TABLE learner_settings(learner_id TEXT,setting_key TEXT,value_json TEXT,updated_at TEXT,PRIMARY KEY(learner_id,setting_key));
    CREATE TABLE learner_owned_review_session_summaries(learner_id TEXT,session_id TEXT,PRIMARY KEY(learner_id,session_id));`);
  sql.exec("ALTER TABLE lexical_words ADD COLUMN hanzi TEXT NOT NULL DEFAULT '字';ALTER TABLE lexical_words ADD COLUMN pinyin TEXT NOT NULL DEFAULT 'zì';");

  for(const name of ['0042_vocabulary_sessions.sql','0044_vocabulary_reflection.sql','0055_vocabulary_feedback_dismissal.sql'])sql.exec(fs.readFileSync(new URL(`../server/db/migrations/${name}`,import.meta.url),'utf8'));
  for(const name of ['0023_session_debrief.sql','0048_vocabulary_connections.sql','0049_vocabulary_sense_readiness.sql','0050_vocabulary_improvement_admission.sql','0051_vocabulary_pure_cue_promotion.sql','0053_vocabulary_second_opinions.sql'])sql.exec(fs.readFileSync(new URL(`../server/db/migrations/${name}`,import.meta.url),'utf8'));
  sql.exec(`INSERT INTO learner_words(learner_id,word_id,in_stash,added_at,mode,mode_changed_at) VALUES ('alice','a',1,'2026-01-01','practice','2026-01-01');
    INSERT INTO learner_word_schedules(learner_id,word_id,next_eligible_at,policy_version,scheduler_state_json) VALUES
    ('alice','a','2026-10-20T10:00:00.000Z','test','{"intervalHours":24,"easeFactor":2.5,"enabled":1,"cleanCoveredSessions":0}');`);
  createVocabularyContent(draft(),{kind:'operator',id:'editor'});
  const completion=alice(()=>{
    createVocabularySession({sessionId:'session',words:[{wordId:'a',mode:'practice'}]},at);
    const inputs=[{kind:'presentation',payload:{encounterId:'encounter-one',wordId:'a',snapshot:{contentId:'one',contentVersion:1,kind:'production',role:'general',
      body:{prompt:'A written character',material:{prompt:'A written character'}},assessment:{acceptedAnswers:['字'],criteria:{match:'exact'}}}}},
      {kind:'response',payload:{encounterId:'encounter-one',response:'private response',outcome:'rejected'}},
      {kind:'feedback',payload:{encounterId:'encounter-one',feedback:'comment',comment:'Private learner comment'}},
      {kind:'finish_for_now',payload:{}},{kind:'finish_immediately',payload:{}}];
    const actions=inputs.map((input,index)=>({...input,protocolVersion:1,actionId:`a-${index}`,clientActionId:`c-${index}`,sequence:index+1,occurredAt:at})) as VocabularySessionAction[];
    appendVocabularySessionActions('session',actions,at);const staged=stageVocabularySessionCompletion('session',actions.length,at);
    return closeVocabularySessionCompletion('session',staged.completionId,later);
  });
  ingestVocabularySessionEvidence('alice',completion.completionId,completion.report,later);
  sql.exec("UPDATE vocabulary_post_session_dispatches SET status='succeeded'");
  feedbackJob=String(sql.prepare("SELECT job_id FROM vocabulary_reflection_jobs WHERE kind='learner_feedback'").get()!.job_id);
  const improvement=sql.prepare("SELECT job_id,case_id FROM vocabulary_reflection_jobs WHERE kind='exercise_improvement'").get()!;
  improvementJob=String(improvement.job_id);caseId=String(improvement.case_id);
  handlers=new Map();wakes=0;
  const app=Object.fromEntries(['get','post','put'].map(method=>[method,(route:string,...callbacks:RequestHandler[])=>{handlers.set(`${method} ${route}`,callbacks);}])) as unknown as Express;
  registerVocabularyReflectionRoutes(app,{wake:()=>{wakes++;}});
});
afterEach(()=>{sql.close();for(const[key,value]of Object.entries(env)){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
function call(method:string,route:string,input:{body?:unknown;params?:Record<string,string>;query?:Record<string,unknown>;learner?:string|null}={}) {
  let status=200,body:unknown;const callbacks=handlers.get(`${method} ${route}`)!;assert.ok(callbacks,route);
  const req={body:input.body??{},params:input.params??{},query:input.query??{}} as unknown as Request;
  const res={locals:{},status(value:number){status=value;return this;},json(value:unknown){body=value;return this;}} as unknown as Response;
  let index=0;const next=()=>{const callback=callbacks[index++];if(callback)callback(req,res,next as NextFunction);};
  if(input.learner===null)next();else runWithLearnerId(input.learner??'alice',next);
  return {status,body:body as Record<string,unknown>};
}
function proposal(){return {operations:[{operationKey:'repair',scope:{kind:'shared'},rationale:'A clearer cue',strategy:'update_existing',sourceContentId:'one',expectedVersion:1,
  content:{...draft(),body:{prompt:'A written symbol used in a language'}}}],rationale:'Improve the exact cue'};}

test('feedback is private and read-only; only own failed feedback can be retried',()=>{
  const job=claimVocabularyReflectionJob({kind:'learner_feedback',now:later})!;
  const result=recordVocabularyFeedbackJudgment(job.jobId,job.leaseToken,{diagnosis:'Fair exercise',message:'Your private lesson',unfairEncounterIds:[]},later);
  const own=call('get',feedback);assert.equal(own.status,200);assert.equal((own.body.messages as unknown[]).length,1);
  assert.ok(!JSON.stringify(own).includes('Private learner comment'));assert.ok(!JSON.stringify(own).includes('private response'));
  assert.equal((call('get',feedback,{learner:'bob'}).body.messages as unknown[]).length,0);
  assert.equal(call('post',`${feedback}/:messageId/seen`,{params:{messageId:result.messageId!},learner:'bob'}).status,403);
  assert.equal(call('post',`${feedback}/:messageId/seen`,{params:{messageId:result.messageId!}}).status,200);
  assert.equal(call('post',`${feedback}/:messageId/seen`,{params:{messageId:result.messageId!},body:{approve:true}}).status,400);
  assert.equal(call('post',`${feedback}/jobs/:jobId/retry`,{params:{jobId:improvementJob}}).status,403);
  process.env.APP_AUTH_MODE='clerk';assert.equal(call('get',feedback,{learner:null}).status,403);
});

test('feedback inbox labels own pending and completed items without exposing case evidence',()=>{
  const queued=call('get',feedback).body.jobs as Record<string,unknown>[];
  assert.equal(queued.length,1);
  const feedbackCase=String(sql.prepare('SELECT case_id FROM vocabulary_reflection_jobs WHERE job_id=?').get(feedbackJob)!.case_id);
  assert.deepEqual(queued[0],{jobId:feedbackJob,caseId:feedbackCase,subjectLabel:'字',status:'queued',createdAt:later,error:null});
  assert.deepEqual(call('get',feedback,{learner:'bob'}).body.jobs,[]);
  const job=claimVocabularyReflectionJob({kind:'learner_feedback',now:later})!;
  assert.equal((call('get',feedback).body.jobs as Record<string,unknown>[])[0]!.status,'running');
  recordVocabularyFeedbackJudgment(job.jobId,job.leaseToken,{diagnosis:'Fair exercise',message:'Your lesson',unfairEncounterIds:[]},later);
  const finished=call('get',feedback).body;
  assert.deepEqual(finished.jobs,[]);
  assert.equal((finished.messages as Record<string,unknown>[])[0]!.subjectLabel,'字');
  assert.equal((finished.messages as Record<string,unknown>[])[0]!.caseId,feedbackCase);
  assert.ok(!JSON.stringify(finished).includes('Private learner comment'));
});

test('shared-expression feedback uses its served cue and sanitizes failed job errors',()=>{
  sql.prepare(`INSERT INTO reflection_cases SELECT 'pure-feedback-case',completion_id,learner_id,kind,'pure-cue/one',NULL,'one',status,evidence_snapshot_json,created_at
    FROM reflection_cases WHERE case_id=(SELECT case_id FROM vocabulary_reflection_jobs WHERE job_id=?)`).run(feedbackJob);
  sql.prepare(`INSERT INTO vocabulary_reflection_jobs(job_id,case_id,kind,dedupe_key,status,next_attempt_at,created_at,last_error)
    VALUES ('pure-feedback-job','pure-feedback-case','learner_feedback','pure-feedback','failed',?,?,'PRIVATE_PROVIDER_TEXT')`).run(later,later);
  const own=call('get',feedback).body;
  const pending=(own.jobs as Record<string,unknown>[]).filter(job=>job.jobId==='pure-feedback-job');
  assert.equal(pending[0]!.subjectLabel,'A written character');
  assert.equal(pending[0]!.status,'failed');
  assert.equal(pending[0]!.error,'Feedback could not finish. You can retry.');
  assert.equal((own.failures as unknown[]).length,1);
  assert.ok(!JSON.stringify(own).includes('PRIVATE_PROVIDER_TEXT'));
  assert.ok(!JSON.stringify(own).includes('private response'));
  assert.deepEqual(call('get',feedback,{learner:'bob'}).body.jobs,[]);
});

test('failed feedback retry is explicit, private, fenced, and contains no raw provider failure',()=>{
  sql.prepare("UPDATE vocabulary_reflection_jobs SET status='failed',last_error='PRIVATE_PROVIDER_TEXT' WHERE job_id=?").run(feedbackJob);
  const failures=call('get',feedback);assert.equal((failures.body.failures as unknown[]).length,1);assert.ok(!JSON.stringify(failures).includes('PRIVATE_PROVIDER_TEXT'));
  assert.equal(call('post',`${feedback}/jobs/:jobId/retry`,{params:{jobId:feedbackJob},learner:'bob'}).status,403);
  assert.equal(call('post',`${feedback}/jobs/:jobId/retry`,{params:{jobId:feedbackJob}}).status,200);assert.equal(wakes,1);
  assert.equal(call('post',`${feedback}/jobs/:jobId/retry`,{params:{jobId:feedbackJob}}).status,409);
});

test('operator gate protects all private case/proposal reads and writes',()=>{
  process.env.APP_OPERATOR_CLERK_USER_IDS='';
  for(const[method,route,params]of [['get',`${base}/cases`,{}],['get',`${base}/cases/:id`,{id:caseId}],['get',`${base}/proposals`,{}],
    ['post',`${base}/proposals`,{}],['post',`${base}/jobs/:id/retry`,{id:improvementJob}]] as const) {
    assert.equal(call(method,route,{params}).status,403);
  }
  process.env.APP_OPERATOR_CLERK_USER_IDS='editor';
  const detail=call('get',`${base}/cases/:id`,{params:{id:caseId}});assert.equal(detail.status,200);
  assert.ok(JSON.stringify(detail).includes('Private learner comment'));
  assert.equal(call('get',`${base}/cases`,{query:{kind:'invented'}}).status,400);
  assert.equal(call('get',`${base}/cases`,{query:{unexpected:'field'}}).status,400);
});

test('operator exact-version approval/application routes reject malformed and stale requests and return idempotent receipts',()=>{
  const created=call('post',`${base}/proposals`,{body:proposal()});assert.equal(created.status,200);const id=String(created.body.proposalId);
  assert.equal(call('post',`${base}/proposals`,{body:{...proposal(),approve:true}}).status,400);
  assert.equal(call('put',`${base}/proposals/:id`,{params:{id},body:{expectedVersion:1,draft:{...proposal(),operations:[{}]}}}).status,400);
  assert.equal(call('post',`${base}/proposals/:id/preview`,{params:{id},body:{expectedVersion:1}}).status,200);
  const first=call('post',`${base}/proposals/:id/approve`,{params:{id},body:{expectedVersion:1}});assert.equal(first.status,200);
  assert.equal(call('put',`${base}/proposals/:id`,{params:{id},body:{expectedVersion:1,draft:proposal()}}).status,200);
  assert.equal(call('post',`${base}/proposals/:id/apply`,{params:{id},body:{expectedVersion:1,reviewId:first.body.reviewId,idempotencyKey:'old'}}).status,409);
  assert.equal(call('post',`${base}/proposals/:id/apply`,{params:{id},body:{expectedVersion:2,reviewId:first.body.reviewId,idempotencyKey:'old'}}).status,409);
  const approval=call('post',`${base}/proposals/:id/approve`,{params:{id},body:{expectedVersion:2}});
  const input={expectedVersion:2,reviewId:approval.body.reviewId,idempotencyKey:'new'};
  const applied=call('post',`${base}/proposals/:id/apply`,{params:{id},body:input});assert.equal(applied.status,200);
  assert.deepEqual(call('post',`${base}/proposals/:id/apply`,{params:{id},body:input}),applied);
  assert.equal(getVocabularyContentForMaintenance('one')!.version,2);
  const appliedAt=sql.prepare('SELECT applied_at FROM proposal_applications WHERE proposal_id=?').get(id)!.applied_at;
  assert.equal(call('get',`${base}/proposals/:id`,{params:{id}}).body.resolvedAt,appliedAt);
  assert.equal((call('get',`${base}/proposals`,{query:{status:'applied'}}).body.items as {resolvedAt:string}[])[0]!.resolvedAt,appliedAt);
  assert.equal(call('get',`${base}/proposals`,{query:{status:'applied'}}).status,200);
  assert.ok(!JSON.stringify(call('get',feedback)).includes('scope'));
});

test('operator dispatch retry is available before cases exist and unexpected database errors are sanitized',()=>{
  sql.exec("UPDATE vocabulary_post_session_dispatches SET status='failed',last_error='evidence_ingestion_failed'");
  const listed=call('get',`${base}/dispatches`);assert.equal(listed.status,200);
  const dispatchId=String((listed.body.items as {dispatchId:string}[])[0]!.dispatchId);
  assert.equal(call('post',`${base}/dispatches/:id/retry`,{params:{id:dispatchId}}).status,200);
  assert.equal(call('post',`${base}/dispatches/:id/retry`,{params:{id:dispatchId}}).status,409);
  sql.exec("CREATE TRIGGER fail_proposal BEFORE INSERT ON content_proposals BEGIN SELECT RAISE(ABORT,'PRIVATE_DATABASE_DETAIL'); END;");
  const failed=call('post',`${base}/proposals`,{body:proposal()});assert.equal(failed.status,500);
  assert.ok(!JSON.stringify(failed.body).includes('PRIVATE_DATABASE_DETAIL'));
  assert.ok(!JSON.stringify(failed.body).includes('stack'));
});

test('feedback attention counts only own unread messages and independent feedback work',()=>{
  const initial=call('get',`${feedback}/attention`);assert.deepEqual(initial.body,{unseenCount:0,hasFailure:false,generating:true});
  assert.deepEqual(call('get',`${feedback}/attention`,{learner:'bob'}).body,{unseenCount:0,hasFailure:false,generating:false});
  const job=claimVocabularyReflectionJob({kind:'learner_feedback',now:later})!;
  const result=recordVocabularyFeedbackJudgment(job.jobId,job.leaseToken,{diagnosis:'Fair',message:'Lesson',unfairEncounterIds:[]},later);
  assert.deepEqual(call('get',`${feedback}/attention`).body,{unseenCount:1,hasFailure:false,generating:false});
  call('post',`${feedback}/:messageId/seen`,{params:{messageId:result.messageId!}});
  assert.equal(call('get',`${feedback}/attention`).body.unseenCount,0);
  sql.prepare("UPDATE vocabulary_reflection_jobs SET status='failed' WHERE job_id=?").run(improvementJob);
  assert.equal(call('get',`${feedback}/attention`).body.hasFailure,false);
  process.env.APP_AUTH_MODE='clerk';assert.equal(call('get',`${feedback}/attention`,{learner:null}).status,403);
});

test('practice preparation diagnostics and explicit retry require allowlisted authority and audit the actor',()=>{
  sql.exec(`CREATE TABLE vocabulary_practice_preparation(work_id TEXT PRIMARY KEY,word_id TEXT,source_content_id TEXT,attempt_count INTEGER,invocation_id TEXT,last_error TEXT,status TEXT,updated_at TEXT,next_attempt_at TEXT);
    INSERT INTO vocabulary_practice_preparation VALUES ('work','a','source',3,'invocation','interrupted_unknown_outcome','failed','2026-10-17','2026-10-17');`);
  const path=`${base}/practice-preparation`;
  process.env.APP_OPERATOR_CLERK_USER_IDS='someone-else';
  assert.equal(call('get',`${path}/failures`).status,403);
  assert.equal(call('post',`${path}/:id/retry`,{params:{id:'work'}}).status,403);
  assert.equal(sql.prepare('SELECT status FROM vocabulary_practice_preparation').get()!.status,'failed');
  process.env.APP_OPERATOR_CLERK_USER_IDS='editor';
  const listed=call('get',`${path}/failures`);assert.equal(listed.status,200);
  assert.equal((listed.body.items as {retryable:boolean}[])[0]!.retryable,true);
  assert.equal(call('post',`${path}/:id/retry`,{params:{id:'work'},body:{operatorId:'forged'}}).status,400);
  assert.equal(call('post',`${path}/:id/retry`,{params:{id:'work'}}).status,200);
  assert.equal(wakes,1);assert.equal(sql.prepare('SELECT status FROM vocabulary_practice_preparation').get()!.status,'queued');
  assert.equal(sql.prepare('SELECT attempt_count FROM vocabulary_practice_preparation').get()!.attempt_count,0);
  const audit=sql.prepare("SELECT actor_kind,actor_id FROM backend_events WHERE name='vocabulary.practice_preparation.retry_requested'").get()!;
  assert.equal(audit.actor_kind,'operator');assert.equal(audit.actor_id,'editor');
  assert.notEqual(call('post',`${path}/:id/retry`,{params:{id:'work'}}).status,200);assert.equal(wakes,1);
});

test('second opinion endpoints require operator authority, current version, and strict request fields',()=>{
  const created=call('post',`${base}/proposals`,{body:{...proposal(),caseId}});
  const id=String(created.body.proposalId),route=`${base}/proposals/:id/second-opinions`;
  assert.equal(call('post',route,{params:{id},body:{expectedVersion:2}}).status,409);
  assert.equal(call('post',route,{params:{id},body:{expectedVersion:1,notes:{}}}).status,400);
  assert.equal(call('post',route,{params:{id},body:{expectedVersion:1,force:true}}).status,400);
  process.env.APP_OPERATOR_CLERK_USER_IDS='someone-else';
  assert.equal(call('get',route,{params:{id}}).status,403);
  assert.equal(call('post',route,{params:{id},body:{expectedVersion:1}}).status,403);
  process.env.APP_OPERATOR_CLERK_USER_IDS='editor';
  const requested=call('post',route,{params:{id},body:{expectedVersion:1,notes:'Check naturalness'}});
  assert.equal(requested.status,200);assert.equal(requested.body.status,'queued');assert.equal(wakes,1);
  assert.deepEqual(call('post',route,{params:{id},body:{expectedVersion:1}}).body,requested.body);
  assert.equal((call('get',route,{params:{id}}).body.items as unknown[]).length,1);
});

test('no-proposal review endpoints enforce operator access and retain the requested opinion',()=>{
  const job=claimVocabularyReflectionJob({kind:'exercise_improvement',now:later})!;
  recordVocabularyImprovementResult(job.jobId,job.leaseToken,{diagnosis:'No change needed',proposal:null},later);
  const list=`${base}/no-proposal-cases`,route=`${base}/cases/:id/second-opinions`,params={id:caseId};
  process.env.APP_OPERATOR_CLERK_USER_IDS='someone-else';
  assert.equal(call('get',list).status,403);
  assert.equal(call('post',route,{params,body:{notes:'Consider the answer'}}).status,403);
  process.env.APP_OPERATOR_CLERK_USER_IDS='editor';
  assert.equal((call('get',list).body.items as unknown[]).length,1);
  assert.equal(call('get',list,{query:{status:'invalid'}}).status,400);
  assert.equal(call('post',route,{params,body:{notes:{}}}).status,400);
  assert.equal(call('post',route,{params,body:{notes:'Consider the answer',force:true}}).status,400);
  assert.equal(call('post',route,{params,body:{notes:'Consider the answer'}}).status,200);
  assert.equal(wakes,1);
  assert.equal(call('post',route,{params}).status,409);
  const workspace=call('get',`${base}/cases/:id`,{params});
  assert.equal((workspace.body.jobs as {secondOpinion:boolean}[]).filter(item=>item.secondOpinion).length,1);
});


test('feedback dismiss and restore are owner-only empty-body commands and retain the lesson',()=>{
  const job=claimVocabularyReflectionJob({kind:'learner_feedback',now:later})!;
  const result=recordVocabularyFeedbackJudgment(job.jobId,job.leaseToken,{diagnosis:'Fair',message:'Keep this lesson',unfairEncounterIds:[]},later);
  const params={messageId:result.messageId!};
  for(const action of ['dismiss','restore']) {
    const route=`${feedback}/:messageId/${action}`;
    assert.equal(call('post',route,{params,learner:'bob'}).status,403);
    assert.equal(call('post',route,{params,body:{learnerId:'bob'}}).status,400);
    assert.equal(call('post',route,{params}).status,200);
    assert.equal(call('post',route,{params}).status,200);
    const messages=call('get',feedback).body.messages as Record<string,unknown>[];
    assert.equal(messages.length,1);
    assert.equal(messages[0]!.seenAt,null);
    assert.equal(messages[0]!.dismissedAt===null,action==='restore');
    assert.equal(call('get',`${feedback}/attention`).body.unseenCount,action==='restore'?1:0);
  }
});


for(const reason of [undefined,'','  ','Reviewed without publishing.'])test(`proposal close accepts optional reason (${JSON.stringify(reason)}) and retains validation`,()=>{
  const created=call('post',`${base}/proposals`,{body:proposal()});const params={id:String(created.body.proposalId)};
  const route=`${base}/proposals/:id/close`;
  assert.equal(call('get',`${base}/proposals/:id`,{params}).body.resolvedAt,null);
  for(const invalid of [null,{},1])assert.equal(call('post',route,{params,body:{expectedVersion:1,reason:invalid}}).status,400);
  assert.equal(call('post',route,{params,body:{expectedVersion:1,reason,unexpected:true}}).status,400);
  assert.equal(call('post',route,{params,body:{expectedVersion:2,reason}}).status,409);
  process.env.APP_OPERATOR_CLERK_USER_IDS='someone-else';
  assert.equal(call('post',route,{params,body:{expectedVersion:1,reason}}).status,403);
  process.env.APP_OPERATOR_CLERK_USER_IDS='editor';
  assert.equal(call('post',route,{params,body:{expectedVersion:1,reason}}).status,200);
  assert.equal(call('get',`${base}/proposals/:id`,{params}).body.status,'closed');
  const closedAt=sql.prepare("SELECT occurred_at FROM backend_events WHERE entity_id=? AND name='vocabulary.reflection.proposal_closed'").get(params.id)!.occurred_at;
  assert.equal(call('get',`${base}/proposals/:id`,{params}).body.resolvedAt,closedAt);
  assert.equal((call('get',`${base}/proposals`,{query:{status:'closed'}}).body.items as {resolvedAt:string}[])[0]!.resolvedAt,closedAt);
  assert.equal(getVocabularyContentForMaintenance('one')!.version,1);
  assert.equal(call('post',route,{params,body:{expectedVersion:1,reason}}).status,409);
});

for(const reason of [undefined,'','  ','Reviewed without a change.'])test(`completed no-change review closes with optional reason (${JSON.stringify(reason)})`,()=>{
  const job=claimVocabularyReflectionJob({kind:'exercise_improvement',now:later})!;
  recordVocabularyImprovementResult(job.jobId,job.leaseToken,{diagnosis:'No change needed',proposal:null},later);
  const params={id:caseId},route=`${base}/cases/:id/close`;
  assert.equal((call('get',`${base}/cases/:id`,{params}).body.case as {resolvedAt:null}).resolvedAt,null);
  for(const invalid of [null,{},1])assert.equal(call('post',route,{params,body:{reason:invalid}}).status,400);
  assert.equal(call('post',route,{params,body:{reason,unexpected:true}}).status,400);
  assert.equal(call('post',route,{params,body:{reason}}).status,200);
  assert.equal((call('get',`${base}/no-proposal-cases`).body.items as unknown[]).length,0);
  const archived=call('get',`${base}/no-proposal-cases`,{query:{status:'closed'}}).body.items as {resolvedAt:string}[];
  assert.equal(archived.length,1);
  const closedAt=sql.prepare("SELECT occurred_at FROM backend_events WHERE entity_id=? AND name='vocabulary.reflection.admission_case_closed'").get(caseId)!.occurred_at;
  assert.equal(archived[0]!.resolvedAt,closedAt);
  assert.equal((call('get',`${base}/cases/:id`,{params}).body.case as {resolvedAt:string}).resolvedAt,closedAt);
  assert.equal(getVocabularyContentForMaintenance('one')!.version,1);
});

for(const outcome of ['inventory_gap','unmappable','needs_operator'] as const)test(`${outcome} assessment closure still requires a reason even without a proposal`,()=>{
  const job=claimVocabularyReflectionJob({kind:'exercise_improvement',now:later})!;
  const unresolved=outcome==='needs_operator'
    ?{pureCuePromotion:{outcome,rationale:'Ambiguous candidate',candidateWordIds:['a'],existingContentId:null}}
    :{admission:{outcome,rationale:'Inspect the intended use',wordId:'a',sourceContentId:'one',sourceContentVersion:1,catalogVersion:1,senseIds:[],sourceMapping:{senseId:null,establishedAt:null}}};
  recordVocabularyImprovementResult(job.jobId,job.leaseToken,{diagnosis:'Manual review needed',proposal:null,...unresolved},later);
  const params={id:caseId},route=`${base}/cases/:id/close`;
  for(const reason of [undefined,'','  '])assert.equal(call('post',route,{params,body:{reason}}).status,400);
  assert.equal((call('get',`${base}/cases/:id`,{params}).body.case as {status:string}).status,'open');
  assert.equal(call('post',route,{params,body:{reason:'Deferred after reviewing the unresolved assessment'}}).status,200);
});
