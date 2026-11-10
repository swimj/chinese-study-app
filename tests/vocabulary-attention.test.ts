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
import { createVocabularySense,createVocabularyContent,getVocabularyContentForMaintenance,updateVocabularyContent } from '../server/db/vocabulary-content.ts';
import { dismissSupersededVocabularyCase,createVocabularyProposal,saveVocabularyProposal,closeVocabularyProposal } from '../server/db/vocabulary-reflection.ts';
import { abandonVocabularyReassessment,listVocabularyCaseQueue,getVocabularyCaseCard,resolveVocabularyCaseReview,reassessVocabularyCaseReview,setVocabularyCaseDeferred } from '../server/db/vocabulary-case-queue.ts';
import { writeVocabularyDefaultUsefulSenses } from '../server/db/vocabulary-sense-coverage.ts';
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
for(const deferred of [false,true])test(`failed reassessment locks the prior review until abandoned, deferred=${deferred}`,()=>{
  seed('review','exercise_improvement','succeeded');
  if(deferred){const card=getVocabularyCaseCard('review','editor');setVocabularyCaseDeferred('review',card.version,'editor',true);}
  sql.prepare(`INSERT INTO vocabulary_reflection_jobs(job_id,case_id,kind,dedupe_key,status,next_attempt_at,created_at,review_case_id,case_sequence,last_error,reassessment_source_job_id) VALUES ('retry','review','exercise_improvement','retry','failed',?,?,'review',2,'validation_failed','job-review')`).run(at,at);
  const item=listVocabularyAttention('editor',{},dependencies).items[0];
  assert.equal(item.id,'case:review');assert.equal(item.kind==='case'&&item.abandonable,true);
  const card=getVocabularyCaseCard('review','editor');assert.equal(card.frozen,true);
  assert.throws(()=>resolveVocabularyCaseReview('review',card.version,'editor'),/frozen/);
  assert.equal(listVocabularyCaseQueue('editor',deferred?{view:'deferred'}:{}).total,1);
  const restored=abandonVocabularyReassessment('review',card.version,'retry','editor');
  assert.equal(restored.frozen,false);assert.equal(restored.currentAssessment?.jobId,'job-review');
  assert.equal(listVocabularyAttention('editor',{},dependencies).total,0);
  assert.equal(listVocabularyCaseQueue('editor',deferred?{view:'deferred'}:{}).total,1);
});
test('abandonment restores an earlier unresolved finding as open',()=>{
  seed('review','exercise_improvement','succeeded');
  sql.prepare("UPDATE vocabulary_reflection_jobs SET result_json=json_set(result_json,'$.input.admission.outcome','inventory_gap') WHERE job_id='job-review'").run();
  sql.prepare(`INSERT INTO vocabulary_reflection_jobs(job_id,case_id,kind,dedupe_key,status,next_attempt_at,created_at,review_case_id,case_sequence,last_error,reassessment_source_job_id) VALUES ('retry','review','exercise_improvement','retry','failed',?,?,'review',2,'validation_failed','job-review')`).run(at,at);
  const card=getVocabularyCaseCard('review','editor');
  abandonVocabularyReassessment('review',card.version,'retry','editor');
  assert.equal(sql.prepare("SELECT status FROM reflection_cases WHERE case_id='review'").get()!.status,'open');
});
test('failed application and failed reassessment remain separately visible',()=>{
  seed('review','exercise_improvement','succeeded');
  const proposal=createVocabularyProposal({caseId:'review',rationale:'Repair',operations:[{operationKey:'repair',scope:{kind:'shared'},strategy:'retire',sourceContentId:'source',expectedVersion:1,rationale:'Retire',content:getVocabularyContentForMaintenance('source')!}]},'editor');
  sql.prepare(`INSERT INTO vocabulary_reflection_jobs(job_id,case_id,kind,dedupe_key,status,next_attempt_at,created_at,review_case_id,case_sequence,last_error) VALUES ('retry','review','exercise_improvement','retry','failed',?,?,'review',2,'validation_failed')`).run(at,at);
  sql.exec("UPDATE vocabulary_case_reviews SET approval_state='attention',approval_request_id='request' WHERE case_id='review'");
  const approval:VocabularyApprovalRequest={requestId:'request',proposalId:proposal.proposalId,expectedVersion:1,actorId:'editor',notes:null,status:'attention',attempts:1,createdAt:at,updatedAt:at,error:'application failed',application:null};
  const items=listVocabularyAttention('editor',{}, {...dependencies,approvals:[approval]}).items;
  assert.deepEqual(items.map(item=>item.kind).sort(),['approval','case']);
  const failed=items.find(item=>item.kind==='case')!;assert.equal(failed.kind==='case'&&failed.retryable,false);assert.match(failed.reason,/Resolve the application/);
});
test('a failed opinion ceases to be actionable when its exact proposal is revised or dismissed',()=>{
  seed('review','exercise_improvement','succeeded');
  const proposal=createVocabularyProposal({caseId:'review',rationale:'Repair',operations:[{operationKey:'repair',scope:{kind:'shared'},strategy:'retire',sourceContentId:'source',expectedVersion:1,rationale:'Retire',content:getVocabularyContentForMaintenance('source')!}]},'editor');
  sql.prepare(`INSERT INTO vocabulary_reflection_jobs(job_id,case_id,kind,dedupe_key,status,next_attempt_at,created_at,review_case_id,case_sequence,last_error,second_opinion_json) VALUES ('opinion','review','exercise_improvement','opinion','failed',?,?,'review',2,'validation_failed',?)`).run(at,at,JSON.stringify({requestId:'opinion',proposal,notes:''}));
  assert.equal(listVocabularyAttention('editor',{},dependencies).items[0].reason,'Second opinion output failed validation.');
  saveVocabularyProposal(proposal.proposalId,1,{rationale:'Revised',operations:proposal.operations},'editor');
  assert.equal(listVocabularyAttention('editor',{},dependencies).total,0);
  closeVocabularyProposal(proposal.proposalId,2,'editor');
  assert.equal(getVocabularyCaseCard('review','editor').state,'resolved');
});
test('a superseded source is visible and dismissible without changing the case on read',()=>{
  seed('obsolete','exercise_improvement');
  const source=getVocabularyContentForMaintenance('source')!;
  sql.prepare('UPDATE vocabulary_reflection_jobs SET reassessment_source_json=? WHERE job_id=?').run(JSON.stringify(source),'job-obsolete');
  let item=listVocabularyAttention('editor',{},dependencies).items[0];
  assert.equal(item.kind==='case'&&item.sourceSuperseded,false);
  assert.equal(item.kind==='case'&&item.retryable,true);
  updateVocabularyContent('source',source.version,{...source,body:{prompt:'Updated cue'}},{kind:'operator',id:'editor'});
  item=listVocabularyAttention('editor',{},dependencies).items[0];
  assert.equal(item.kind==='case'&&item.sourceSuperseded,true);
  assert.equal(item.kind==='case'&&item.dismissible,true);
  assert.equal(item.kind==='case'&&item.retryable,false);
  assert.match(item.reason,/source has changed/i);
  assert.equal(sql.prepare("SELECT state FROM vocabulary_case_reviews WHERE case_id='obsolete'").get()!.state,'open');
  sql.prepare("UPDATE vocabulary_reflection_jobs SET status='queued' WHERE job_id='job-obsolete'").run();
  assert.throws(()=>dismissSupersededVocabularyCase('obsolete','editor'),/active case work/);
  assert.equal(sql.prepare("SELECT state FROM vocabulary_case_reviews WHERE case_id='obsolete'").get()!.state,'open');
  sql.prepare("UPDATE vocabulary_reflection_jobs SET status='failed' WHERE job_id='job-obsolete'").run();
  dismissSupersededVocabularyCase('obsolete','editor');
  assert.equal(listVocabularyAttention('editor',{},dependencies).total,0);
  assert.equal(sql.prepare("SELECT state FROM vocabulary_case_reviews WHERE case_id='obsolete'").get()!.state,'resolved');
  assert.equal(sql.prepare("SELECT status FROM vocabulary_reflection_jobs WHERE job_id='job-obsolete'").get()!.status,'failed');
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

function seedReconciliationSource(contentId='document',current=true):void {
  sql.prepare(`INSERT INTO shared_content_publications(publication_id,content_kind,content_id,learning_purpose_key,publication_status,published_at,status_updated_at)
    VALUES (?,'word_content',?,'word','available',?,?)`).run(`publication-${contentId}`,contentId,at,at);
  sql.prepare(`INSERT INTO word_content_documents(content_id,word_id,content_json,model,created_at,publication_id)
    VALUES (?,'word',?,'fixture',?,?)`).run(contentId,JSON.stringify({uses:[{id:'unmapped'}]}),at,`publication-${contentId}`);
  if(current)sql.prepare(`INSERT INTO word_introduction_preparation(word_id,content_id) VALUES ('word',?)`).run(contentId);
}
function seedPreparation(id:string,source='document',error='source_mapping_requires_operator'):void {
  sql.prepare(`INSERT INTO vocabulary_practice_preparation(work_id,word_id,source_content_id,generation_key,status,created_at,updated_at,last_error)
    VALUES (?,'word',?,?,'failed',?,?,?)`).run(id,source,id,at,at,error);
}
const preparationDependencies={approvals:[] as VocabularyApprovalRequest[],preparationFailure:(workId:string)=>{
  const row=sql.prepare('SELECT source_content_id,last_error FROM vocabulary_practice_preparation WHERE work_id=?').get(workId)!;
  return {workId,wordId:'word',sourceContentId:String(row.source_content_id),attemptCount:1,invocationId:null,lastError:String(row.last_error),retryable:false};
}};
test('reconciliation page hydration batches queries and keeps each word’s failures separate',t=>{
  for(let index=0;index<25;index++){
    const id=`batch-${String(index).padStart(2,'0')}`,source=`document-${id}`,publication=`publication-${id}`;
    sql.prepare('INSERT INTO lexical_words(id,hanzi,pinyin,meaning,examples_json,priority,created_at) VALUES (?,?,?,?,?,1,?)')
      .run(id,id,'zì','character','[]',at);
    sql.prepare(`INSERT INTO shared_content_publications(publication_id,content_kind,content_id,learning_purpose_key,publication_status,published_at,status_updated_at)
      VALUES (?,'word_content',?,?,'available',?,?)`).run(publication,source,id,at,at);
    sql.prepare(`INSERT INTO word_content_documents(content_id,word_id,content_json,model,created_at,publication_id)
      VALUES (?,?,?,'fixture',?,?)`).run(source,id,JSON.stringify({uses:[{id:'unmapped'}]}),at,publication);
    sql.prepare('INSERT INTO word_introduction_preparation(word_id,content_id) VALUES (?,?)').run(id,source);
    sql.prepare(`INSERT INTO vocabulary_practice_preparation(work_id,word_id,source_content_id,generation_key,status,created_at,updated_at,last_error)
      VALUES (?,?,?,?,'failed',?,?,'generation_failed')`).run(`work-${id}`,id,source,id,at,at);
  }
  const statements:string[]=[],prepare=sql.prepare.bind(sql);
  t.mock.method(sql,'prepare',(query:string)=>{statements.push(query);return prepare(query);});
  const page=listVocabularyAttention('editor',{limit:20,anchorId:'reconciliation:batch-22'},dependencies);
  assert.equal(page.total,25);assert.equal(page.offset,20);assert.equal(page.items.length,5);
  for(const [index,item] of page.items.entries()){
    assert.equal(item.kind,'reconciliation');
    if(item.kind!=='reconciliation')throw new Error('Expected reconciliation');
    const id=`batch-${20+index}`;
    assert.equal(item.wordId,id);
    assert.deepEqual(item.children.map(child=>child.id),[`source:document-${id}`,`preparation:work-${id}`]);
  }
  const smallPageQueries=statements.filter(query=>query.startsWith('WITH latest_reconciliations')).length;
  statements.length=0;
  assert.equal(listVocabularyAttention('editor',{limit:20,anchorId:'reconciliation:batch-00'},dependencies).items.length,20);
  const fullPageQueries=statements.filter(query=>query.startsWith('WITH latest_reconciliations')).length;
  assert.equal(fullPageQueries,smallPageQueries,'Corpus classification queries must not grow with the displayed card count');
  assert.ok(fullPageQueries<=5,`Expected bounded classification queries, got ${fullPageQueries}`);
});
test('one reconciliation groups failures by replaced source regardless of error label',()=>{
  seedReconciliationSource();seedReconciliationSource('older-document',false);
  seedPreparation('mapping-a');seedPreparation('mapping-b');seedPreparation('provider-failure','document','generation_failed');seedPreparation('older-mapping','older-document');seedPreparation('older-provider','older-document','generation_failed');
  seed('unrelated-case','exercise_improvement');
  const page=listVocabularyAttention('editor',{},preparationDependencies);
  assert.equal(page.total,4);
  assert.deepEqual(page.items.map(item=>item.id),['case:unrelated-case','preparation:older-mapping','preparation:older-provider','reconciliation:word']);
  const group=page.items.find(item=>item.kind==='reconciliation')!;
  assert.equal(group.kind,'reconciliation');
  if(group.kind!=='reconciliation')throw new Error('Missing group');
  assert.deepEqual(group.children.map(child=>child.id),['source:document','preparation:mapping-a','preparation:mapping-b','preparation:provider-failure']);
  assert.equal(group.progress.status,'not_required');
  const filtered=listVocabularyAttention('editor',{kind:'reconciliation',limit:1,anchorId:group.id},dependencies);
  assert.equal(filtered.total,1);assert.equal(filtered.offset,0);assert.equal(filtered.items[0].id,group.id);
  const last=listVocabularyAttention('editor',{offset:3,limit:1},dependencies);
  assert.equal(last.total,4);assert.equal(last.items[0].id,group.id);
});
test('source divergence is discoverable before any preparation failure exists',()=>{
  seedReconciliationSource();
  const page=listVocabularyAttention('editor',{},dependencies);
  assert.equal(page.total,1);const item=page.items[0];assert.equal(item.kind,'reconciliation');
  assert.equal(item.kind==='reconciliation'&&item.children.length,1);
});
test('pending resolution stays grouped and completion clears only covered failures without deleting evidence',()=>{
  seedReconciliationSource();seedPreparation('mapping');seedPreparation('provider','document','generation_failed');
  sql.prepare(`INSERT INTO sense_content_reconciliations(resolution_id,word_id,version,status,draft_json,snapshot_json,applied_plan_json,authority_json,practice_source_json,actor_id,created_at,updated_at,applied_at)
    VALUES ('resolution','word',2,'applied','{}',?,'{"retireSourceIds":["document"],"replacementTeachingRequired":true,"replacementPracticeRequired":true}','{}','{"source":{"word":{"wordId":"word","hanzi":"字","traditional":null,"pinyin":"zì"},"uses":[],"examples":[]},"senses":[]}','editor',?,?,?)`)
    .run(JSON.stringify({dependencies:{introductionPreparation:[{content_id:'document'}]}}),at,at,at);
  sql.exec("UPDATE word_introduction_preparation SET content_id=NULL WHERE word_id='word'");
  let page=listVocabularyAttention('editor',{},preparationDependencies);
  const group=page.items.find(item=>item.kind==='reconciliation')!;
  assert.equal(group.kind==='reconciliation'&&group.progress.status,'failed');
  assert.equal(group.kind==='reconciliation'&&group.children.some(child=>child.id==='preparation:mapping'),true);
  sql.prepare("UPDATE sense_content_reconciliations SET completed_at=? WHERE resolution_id='resolution'").run(now);
  page=listVocabularyAttention('editor',{},preparationDependencies);
  assert.deepEqual(page.items.map(item=>item.id),[]);
  assert.equal(sql.prepare("SELECT status FROM vocabulary_practice_preparation WHERE work_id='provider'").get()!.status,'failed');
  assert.equal(sql.prepare("SELECT status FROM vocabulary_practice_preparation WHERE work_id='mapping'").get()!.status,'failed');
  assert.equal(sql.prepare('SELECT count(*) n FROM sense_content_reconciliations').get()!.n,1);
  sql.prepare(`INSERT INTO sense_content_reconciliations(resolution_id,word_id,version,status,draft_json,snapshot_json,actor_id,created_at,updated_at)
    VALUES ('next','word',3,'draft','{}',?,'editor',?,?)`).run(JSON.stringify({dependencies:{reconciliationTeachingEvidence:{contentId:'document'}}}),now,now);
  page=listVocabularyAttention('editor',{kind:'reconciliation'},dependencies);
  assert.equal(page.total,1);assert.equal(page.items[0].kind==='reconciliation'&&page.items[0].status,'draft');
});

test('a later draft keeps failures covered by the prior incomplete application grouped',()=>{
  seedReconciliationSource();seedPreparation('old-mapping');seedReconciliationSource('replacement',false);
  sql.prepare(`INSERT INTO sense_content_reconciliations(resolution_id,word_id,version,status,draft_json,snapshot_json,applied_plan_json,authority_json,practice_source_json,actor_id,created_at,updated_at,applied_at)
    VALUES ('applied','word',2,'applied','{}',?,'{"retireSourceIds":["document"],"replacementTeachingRequired":true,"replacementPracticeRequired":true}','{}','{"source":{"word":{"wordId":"word","hanzi":"字","traditional":null,"pinyin":"zì"},"uses":[],"examples":[]},"senses":[]}','editor',?,?,?)`)
    .run(JSON.stringify({dependencies:{introductionPreparation:[{content_id:'document'}]}}),at,at,at);
  sql.exec("UPDATE word_introduction_preparation SET content_id='replacement' WHERE word_id='word'");
  sql.prepare(`INSERT INTO sense_content_reconciliations(resolution_id,word_id,version,status,draft_json,snapshot_json,actor_id,created_at,updated_at)
    VALUES ('draft','word',3,'draft','{}',?,'editor',?,?)`).run(JSON.stringify({dependencies:{introductionPreparation:[{content_id:'replacement'}]}}),now,now);
  const page=listVocabularyAttention('editor',{},dependencies);
  assert.equal(page.total,1);const group=page.items[0];assert.equal(group.kind,'reconciliation');
  assert.equal(group.kind==='reconciliation'&&group.children.some(child=>child.id==='preparation:old-mapping'),true);
  assert.equal(group.kind==='reconciliation'&&group.sourceContentId,'replacement');
});

test('failed preparation without an error label remains ordinary attention',()=>{
  seedReconciliationSource('document',false);seedPreparation('unknown');
  sql.exec("UPDATE vocabulary_practice_preparation SET last_error=NULL WHERE work_id='unknown'");
  const page=listVocabularyAttention('editor',{},preparationDependencies);
  assert.equal(page.total,1);assert.equal(page.items[0].id,'preparation:unknown');
});

test('completed aligned reconciliation leaves attention and a later default mismatch requests a new resolution',()=>{
  seedReconciliationSource();
  const actor={kind:'operator' as const,id:'editor'};
  const first=createVocabularySense({wordId:'word',description:{label:'Existing meaning'}},actor);
  const second=createVocabularySense({wordId:'word',description:{label:'Additional meaning'}},actor);
  sql.prepare("INSERT INTO legacy_sense_imports(source_content_id,source_use_id,sense_id,imported_sense_version) VALUES ('document','unmapped',?,?)").run(first.senseId,first.version);
  const coverage=writeVocabularyDefaultUsefulSenses('word',0,[first.senseId],actor);
  sql.prepare(`INSERT INTO sense_content_reconciliations(resolution_id,word_id,version,status,draft_json,snapshot_json,applied_plan_json,authority_json,practice_source_json,actor_id,created_at,updated_at,applied_at,completed_at)
    VALUES ('done','word',2,'applied','{}','{}','{"retireSourceIds":[],"replacementTeachingRequired":true,"replacementPracticeRequired":true}','{}','{"source":{"word":{"wordId":"word","hanzi":"字","traditional":null,"pinyin":"zì"},"uses":[],"examples":[]},"senses":[]}','editor',?,?,?,?)`).run(at,at,at,now);
  assert.equal(listVocabularyAttention('editor',{},dependencies).total,0);
  writeVocabularyDefaultUsefulSenses('word',coverage.word.version,[first.senseId,second.senseId],actor);
  const page=listVocabularyAttention('editor',{},dependencies);
  assert.equal(page.total,1);const group=page.items[0];assert.equal(group.kind,'reconciliation');
  assert.equal(group.reason,'Teaching and current sense scope differ again; start another resolution.');
  assert.equal(group.kind==='reconciliation'&&group.progress.status,'ready');
  assert.equal(sql.prepare("SELECT completed_at FROM sense_content_reconciliations WHERE resolution_id='done'").get()!.completed_at,now);
});
