import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach,beforeEach,test } from 'node:test';
import { setDb,getDb } from '../server/db/connection.ts';
import { installLearnerContextSqlFunction } from '../server/db/learner-context.ts';
import { createBaselineSchema } from '../server/db/persistence.ts';
import { migrateDatabase } from '../server/db/migrations.ts';
import { createVocabularyContent,getVocabularyContentForMaintenance,updateVocabularyContent } from '../server/db/vocabulary-content.ts';
import { createVocabularyProposal,saveVocabularyProposal } from '../server/db/vocabulary-reflection.ts';
import { listVocabularyCaseQueue,getVocabularyCaseCard,resolveVocabularyCaseReview,reassessVocabularyCaseReview } from '../server/db/vocabulary-case-queue.ts';
import { listVocabularyAttention } from '../server/db/vocabulary-attention.ts';
import type { VocabularyApprovalRequest } from '../src/domain/vocabulary-reflection.ts';
import { registerVocabularyReflectionRoutes } from '../server/vocabulary/reflection-routes.ts';
import type { Express,Request,Response,RequestHandler } from 'express';

const at='2026-11-04T10:00:00.000Z',now='2026-11-04T12:00:00.000Z';
let sql:DatabaseSync,directory:string,environment:Record<string,string|undefined>;
beforeEach(()=>{
  environment=Object.fromEntries(['APP_MODE','APP_AUTH_MODE','APP_DATA_DIR','APP_LEARNER_ID','APP_OPERATOR_CLERK_USER_IDS'].map(k=>[k,process.env[k]]));
  directory=fs.mkdtempSync(path.join(os.tmpdir(),'case-queue-'));
  Object.assign(process.env,{APP_MODE:'study',APP_AUTH_MODE:'trusted_local',APP_DATA_DIR:directory,APP_LEARNER_ID:'editor',APP_OPERATOR_CLERK_USER_IDS:'editor'});
  sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');setDb(sql);installLearnerContextSqlFunction();createBaselineSchema();migrateDatabase(getDb());
  sql.prepare('INSERT INTO learners(learner_id,display_name,created_at) VALUES (?,?,?)').run('editor','Fixture operator',at);
  sql.prepare("INSERT INTO lexical_words(id,hanzi,pinyin,meaning,examples_json,priority,created_at,normalized_hanzi) VALUES ('word','字','zì','character','[]',1,?,'字')").run(at);
  createVocabularyContent({contentId:'source',kind:'exercise',payloadVersion:1,body:{prompt:'Original cue'},exerciseType:'definition',skill:'production',exerciseRole:'general',assessment:{match:'exact'},accessScope:'shared',availability:'active',originKind:'human',words:[{wordId:'word',relation:'target'}],answers:[{wordId:'word',acceptedForms:['字']}]},{kind:'operator',id:'editor'});
  sql.prepare("INSERT INTO vocabulary_sessions VALUES ('session','editor',1,'{}',?,?,'closed')").run(at,at);
  sql.prepare(`INSERT INTO vocabulary_session_completions(completion_id,learner_id,session_id,revision_number,through_sequence,staged_at,close_at,status,input_json,report_json,policy_version,closed_at) VALUES ('completion','editor','session',1,0,?,?,'closed','{}','{}','fixture',?)`).run(at,at,at);
  sql.prepare("INSERT INTO vocabulary_reflection_session_evidence VALUES ('completion','editor','session','{}',?)").run(at);
});
afterEach(()=>{sql.close();setDb(null);fs.rmSync(directory,{recursive:true,force:true});for(const [k,v]of Object.entries(environment)){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
function seed(id:string,kind:'exercise_improvement'|'learner_feedback'|'teaching_review',status:'failed'|'queued'|'succeeded'|null='failed') {
  sql.prepare(`INSERT INTO reflection_cases(case_id,completion_id,learner_id,kind,subject_key,word_id,content_id,status,evidence_snapshot_json,created_at) VALUES (?,'completion','editor',?,?,'word',?,'open','[]',?)`).run(id,kind,id,kind==='learner_feedback'?null:'source',at);
  if(kind!=='learner_feedback'){
    sql.prepare('INSERT INTO vocabulary_case_reviews(case_id,created_at) VALUES (?,?)').run(id,at);
    sql.prepare('INSERT INTO vocabulary_case_lineage VALUES (?,?)').run(id,id);
  }
  if(status){
    sql.prepare(`INSERT INTO vocabulary_reflection_jobs(job_id,case_id,kind,dedupe_key,status,next_attempt_at,created_at,review_case_id,case_sequence,last_error,result_json) VALUES (?,?,?,?,?,?,?,?,1,?,?)`)
      .run(`job-${id}`,id,kind==='learner_feedback'?'learner_feedback':'exercise_improvement',id,status,at,at,kind==='learner_feedback'?null:id,status==='failed'?'provider_failed':null,status==='succeeded'?JSON.stringify({input:{diagnosis:'No repair needed',proposal:null}}):null);
    if(kind!=='learner_feedback'&&status==='succeeded')sql.prepare('UPDATE vocabulary_case_reviews SET current_job_id=? WHERE case_id=?').run(`job-${id}`,id);
  }
}
const dependencies={approvals:[] as VocabularyApprovalRequest[],preparationFailure:()=>{throw new Error('Unexpected preparation hydration');}};
test('attention preserves initial failures, learner feedback and legacy cases without duplicating reviewable judgments',()=>{
  seed('initial','exercise_improvement');seed('feedback','learner_feedback');seed('legacy','exercise_improvement',null);
  seed('running','exercise_improvement','queued');seed('review','exercise_improvement','succeeded');
  const page=listVocabularyAttention('editor',{},dependencies);
  assert.deepEqual(page.items.map(item=>item.id),['case:feedback','case:initial','case:legacy']);
  assert.equal(page.total,3);assert.equal(page.items[0].kind,'case');
  assert.equal(page.items[0].kind==='case'&&page.items[0].retryable,true);
  sql.exec("UPDATE vocabulary_reflection_jobs SET last_error='source_conflict' WHERE case_id='initial'");
  const initial=listVocabularyAttention('editor',{},dependencies).items.find(item=>item.caseId==='initial')!;
  assert.equal(initial.kind==='case'&&initial.retryable,false);
  assert.deepEqual(listVocabularyCaseQueue('editor').items.map(item=>item.caseId),['review']);
});
test('teaching without an assessment gains an ordinary review home and remains closable',()=>{
  seed('teaching','teaching_review',null);
  assert.equal(listVocabularyAttention('editor',{},dependencies).total,0);
  const card=listVocabularyCaseQueue('editor').items[0];assert.equal(card.caseId,'teaching');assert.equal(card.needsDecision,true);
  resolveVocabularyCaseReview('teaching',card.version,'editor');
  assert.equal(listVocabularyCaseQueue('editor').total,0);
  assert.equal(listVocabularyAttention('editor',{},dependencies).total,0);
});
test('failed reassessment stays with the earlier reviewable assessment; queued retry leaves attention',()=>{
  seed('review','exercise_improvement','succeeded');
  sql.prepare(`INSERT INTO vocabulary_reflection_jobs(job_id,case_id,kind,dedupe_key,status,next_attempt_at,created_at,review_case_id,case_sequence,last_error) VALUES ('retry','review','exercise_improvement','retry','failed',?,?,'review',2,'failed')`).run(at,at);
  assert.equal(listVocabularyAttention('editor',{},dependencies).total,0);
  seed('initial','exercise_improvement');assert.equal(listVocabularyAttention('editor',{},dependencies).total,1);
  sql.exec("UPDATE vocabulary_reflection_jobs SET status='queued' WHERE case_id='initial'");
  assert.equal(listVocabularyAttention('editor',{},dependencies).total,0);
});
test('word defaults outlive their case and clear only with an established selection',()=>{
  seed('case','exercise_improvement','succeeded');
  sql.prepare(`INSERT INTO vocabulary_default_selection_readiness(word_id,status,expected_catalog_version,workflow_id,last_error,created_at,updated_at) VALUES ('word','failed',0,'job-case','No useful senses selected',?,?)`).run(at,at);
  const item=listVocabularyAttention('editor',{},dependencies).items[0];assert.equal(item.kind,'defaults');assert.equal(item.caseId,'case');
  resolveVocabularyCaseReview('case',getVocabularyCaseCard('case','editor').version,'editor');
  assert.equal(listVocabularyAttention('editor',{},dependencies).items[0].kind,'defaults');
  sql.prepare(`INSERT INTO vocabulary_word_sense_coverage(word_id,version,excluded_sense_ids_json,default_useful_sense_ids_json,updated_at) VALUES ('word',1,'[]','[]',?)`).run(at);
  assert.equal(listVocabularyAttention('editor',{},dependencies).total,0);
});
test('failed approval retains a standalone proposal and disappears after a superseding revision',()=>{
  const proposal=createVocabularyProposal({rationale:'Standalone repair',operations:[{operationKey:'repair',scope:{kind:'shared'},strategy:'retire',sourceContentId:'source',expectedVersion:1,rationale:'Retire',content:getVocabularyContentForMaintenance('source')!}]},'editor');
  const request:VocabularyApprovalRequest={requestId:'request',proposalId:proposal.proposalId,expectedVersion:1,actorId:'editor',notes:null,status:'attention',attempts:1,createdAt:at,updatedAt:at,error:'temporary failure',application:null};
  const deps={...dependencies,approvals:[request]};
  const item=listVocabularyAttention('editor',{},deps).items[0];assert.equal(item.kind,'approval');assert.equal(item.caseId,null);assert.equal(item.kind==='approval'&&item.retryable,true);
  saveVocabularyProposal(proposal.proposalId,1,{rationale:'Revised repair',operations:proposal.operations},'editor');
  assert.equal(listVocabularyAttention('editor',{},deps).total,0);
});
test('pagination and type filtering retain exact totals without hydrated evidence',()=>{
  for(let i=0;i<25;i++)seed(`failure-${String(i).padStart(2,'0')}`,'learner_feedback');
  const page=listVocabularyAttention('editor',{offset:20,limit:3,kind:'case'},dependencies);
  assert.equal(page.total,25);assert.equal(page.offset,20);assert.equal(page.items.length,3);assert.equal(page.items[0].id,'case:failure-20');
  assert.equal(listVocabularyAttention('editor',{kind:'defaults'},dependencies).total,0);
  assert.equal(JSON.stringify(page).includes('evidence'),false);
  assert.throws(()=>listVocabularyAttention('other',{},dependencies),/Operator/);
  assert.throws(()=>listVocabularyAttention('editor',{limit:51},dependencies),/Invalid/);
  assert.throws(()=>listVocabularyAttention('editor',{offset:-1},dependencies),/Invalid/);
});
test('preparation pagination passes the former fifty-item cap and hydrates only the selected page',()=>{
  sql.prepare(`INSERT INTO shared_content_publications(publication_id,content_kind,content_id,learning_purpose_key,publication_status,published_at,status_updated_at) VALUES ('publication','word_content','document','word','available',?,?)`).run(at,at);
  sql.prepare(`INSERT INTO word_content_documents(content_id,word_id,content_json,model,created_at,publication_id) VALUES ('document','word','{}','fixture',?,'publication')`).run(at);
  for(let index=0;index<65;index++)sql.prepare(`INSERT INTO vocabulary_practice_preparation(work_id,word_id,source_content_id,generation_key,status,created_at,updated_at,last_error) VALUES (?,'word','document',?,'failed',?,?,'generation_failed')`).run(`work-${String(index).padStart(2,'0')}`,`key-${index}`,at,at);
  const hydrated:string[]=[];
  const page=listVocabularyAttention('editor',{offset:60,limit:3},{approvals:[],preparationFailure:workId=>{hydrated.push(workId);return {workId,wordId:'word',sourceContentId:'document',attemptCount:3,invocationId:null,lastError:'generation_failed',retryable:false};}});
  assert.equal(page.total,65);assert.deepEqual(hydrated,['work-60','work-61','work-62']);assert.equal(page.items[0].kind,'preparation');
});
test('failed dispatch remains visible until its durable state changes',()=>{
  sql.prepare(`INSERT INTO vocabulary_post_session_dispatches(dispatch_id,learner_id,session_id,completion_id,evidence_json,status,created_at,last_error) VALUES ('dispatch','editor','session','completion','{}','failed',?,'ingestion failed')`).run(at);
  const item=listVocabularyAttention('editor',{},dependencies).items[0];assert.equal(item.kind,'dispatch');assert.equal(item.reason,'ingestion failed');
  sql.exec("UPDATE vocabulary_post_session_dispatches SET status='queued' WHERE dispatch_id='dispatch'");
  assert.equal(listVocabularyAttention('editor',{},dependencies).total,0);
});
test('HTTP attention endpoint validates pagination and preserves operator authorization',()=>{
  seed('failure','learner_feedback');const handlers=new Map<string,RequestHandler[]>();
  const app=Object.fromEntries(['get','post','put'].map(method=>[method,(route:string,...callbacks:RequestHandler[])=>handlers.set(`${method} ${route}`,callbacks)])) as unknown as Express;
  registerVocabularyReflectionRoutes(app);
  function call(query:Record<string,string>={}){
    let status=200,value:unknown;const request={query,params:{}} as unknown as Request;
    const response={locals:{},status(s:number){status=s;return this;},json(v:unknown){value=v;return this;}} as unknown as Response;
    let n=0;const callbacks=handlers.get('get /api/operator/vocabulary/attention-queue')!;const next=()=>{const callback=callbacks[n++];if(callback)callback(request,response,next);};next();return {status,value};
  }
  assert.equal(call().status,200);assert.equal(call({limit:'51'}).status,400);assert.equal(call({offset:'-1'}).status,400);assert.equal(call({kind:'other'}).status,400);assert.equal(call({unexpected:'field'}).status,400);
  process.env.APP_OPERATOR_CLERK_USER_IDS='someone-else';assert.equal(call().status,403);
});
test('refresh anchors the selected identity after earlier items leave its page',()=>{
  for(let index=0;index<25;index++)seed(`failure-${String(index).padStart(2,'0')}`,'learner_feedback');
  const before=listVocabularyAttention('editor',{offset:20,limit:5},dependencies);assert.equal(before.items[0].id,'case:failure-20');
  sql.exec("UPDATE reflection_cases SET status='completed' WHERE case_id='failure-00'");
  const refreshed=listVocabularyAttention('editor',{offset:20,limit:5,anchorId:'case:failure-20'},dependencies);
  assert.equal(refreshed.offset,15);assert.ok(refreshed.items.some(item=>item.id==='case:failure-20'));
  assert.equal(listVocabularyAttention('editor',{offset:20,limit:5,anchorId:'case:missing'},dependencies).offset,20);
});
test('approval source drift prevents an unchanged retry while preserving the request',()=>{
  const proposal=createVocabularyProposal({rationale:'Standalone repair',operations:[{operationKey:'repair',scope:{kind:'shared'},strategy:'retire',sourceContentId:'source',expectedVersion:1,rationale:'Retire',content:getVocabularyContentForMaintenance('source')!}]},'editor');
  const request:VocabularyApprovalRequest={requestId:'request',proposalId:proposal.proposalId,expectedVersion:1,actorId:'editor',notes:null,status:'attention',attempts:1,createdAt:at,updatedAt:at,error:'source changed',application:null};
  const source=getVocabularyContentForMaintenance('source')!;
  updateVocabularyContent('source',1,{...source,body:{prompt:'Changed cue'}},{kind:'operator',id:'editor'});
  const page=listVocabularyAttention('editor',{}, {...dependencies,approvals:[request]});assert.equal(page.total,1);
  const item=page.items[0];assert.equal(item.kind,'approval');assert.equal(item.kind==='approval'&&item.retryable,false);
});
test('review approval without a retained journal entry remains reachable as a case fallback',()=>{
  seed('orphan','exercise_improvement','succeeded');
  sql.exec("UPDATE vocabulary_case_reviews SET approval_state='attention',approval_request_id='missing-request' WHERE case_id='orphan'");
  const page=listVocabularyAttention('editor',{},dependencies);assert.equal(page.total,1);assert.equal(page.items[0].caseId,'orphan');assert.equal(page.items[0].kind,'case');
});
