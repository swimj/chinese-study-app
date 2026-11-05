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
import { createVocabularyProposal } from '../server/db/vocabulary-reflection.ts';
import { listVocabularyCaseQueue,getVocabularyCaseCard,resolveVocabularyCaseReview,reassessVocabularyCaseReview } from '../server/db/vocabulary-case-queue.ts';
import { startRequestTiming,runWithRequestTiming } from '../server/request-timing.ts';
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
function seedCase(id:string,options:{createdAt?:string;resolvedAt?:string;proposal?:boolean;blob?:string;state?:'open'|'resolved';noAssessment?:boolean;pure?:boolean}={}){
  const createdAt=options.createdAt??at,blob=options.blob??'';
  const response=(actionId:string,text:string)=>({actionId,payload:{response:text,outcome:'rejected'},trace:blob});
  const evidence=[{encounterId:`encounter-${id}`,presentedAt:'2026-11-03T08:00:00.000Z',wordId:'word',snapshot:{...(options.pure?{schedulingScope:'pure_cue'}:{}),contentId:'source',contentVersion:1,kind:'production',role:'general',body:{...(options.pure?{material:{reveal:{axisNote:'Stored axis',teachingNote:'Original note'}}}:{}),prompt:'Served cue',wordReference:{unneededRaw:blob}},assessment:{acceptedAnswers:['字'],criteria:{match:'exact',unneededRaw:blob}}},responses:[response('undone','wrong'),response('effective','字')],effectiveResponses:[response('effective','字')],feedback:[{actionId:'old',payload:{feedback:'negative'}},{actionId:'new',payload:{feedback:'positive'}},{actionId:'comment',payload:{feedback:'comment',comment:'Useful comment'}}],skipped:false}];
  sql.prepare(`INSERT INTO reflection_cases(case_id,completion_id,learner_id,kind,subject_key,word_id,content_id,status,evidence_snapshot_json,created_at) VALUES (?,'completion','editor','exercise_improvement',?,'word','source','completed',?,?)`).run(id,id,JSON.stringify(evidence),createdAt);
  sql.prepare('INSERT INTO vocabulary_case_reviews(case_id,state,created_at,resolved_at) VALUES (?,?,?,?)').run(id,options.state??'open',createdAt,options.resolvedAt??null);
  sql.prepare('INSERT INTO vocabulary_case_lineage VALUES (?,?)').run(id,id);
  if(!options.noAssessment){
    sql.prepare(`INSERT INTO vocabulary_reflection_jobs(job_id,case_id,kind,dedupe_key,status,next_attempt_at,result_json,created_at,review_case_id,case_sequence) VALUES (?,?,'exercise_improvement',?,'succeeded',?,?,?,?,1)`).run(`job-${id}`,id,id,createdAt,JSON.stringify({input:{diagnosis:{assessment:'The cue is acceptable.',rawProviderDocument:blob},proposal:null},providerRaw:blob}),createdAt,id);
    sql.prepare('UPDATE vocabulary_case_reviews SET current_job_id=? WHERE case_id=?').run(`job-${id}`,id);
  }
  if(options.proposal){
    const p=createVocabularyProposal({caseId:id,rationale:`Repair ${id}`,operations:[{operationKey:'repair',scope:{kind:'shared'},strategy:'update_existing',sourceContentId:'source',expectedVersion:1,rationale:'A clearer cue',content:{kind:'exercise',payloadVersion:1,body:{prompt:'Proposed cue'},exerciseType:'definition',skill:'production',exerciseRole:'general',assessment:{match:'exact'},accessScope:'shared',availability:'active',originKind:'human',words:[{wordId:'word',relation:'target'}],answers:[{wordId:'word',acceptedForms:['字']}]}}]},'editor');
    sql.prepare("UPDATE content_proposals SET assessment_job_id=?,author_kind='service' WHERE proposal_id=?").run(`job-${id}`,p.proposalId);
    sql.prepare("UPDATE vocabulary_reflection_jobs SET result_json=json_set(result_json,'$.input.proposal',json(?)) WHERE job_id=?").run(JSON.stringify({rationale:p.rationale,operations:p.operations}),`job-${id}`);
    if(options.state==='resolved'){sql.prepare("UPDATE content_proposals SET status='closed' WHERE proposal_id=?").run(p.proposalId);sql.prepare("UPDATE vocabulary_case_reviews SET state='resolved',resolved_at=? WHERE case_id=?").run(options.resolvedAt??at,id);}
    return p.proposalId;
  }
  return null;
}
test('compact cards retain normal review evidence while excluding raw snapshots and job results',()=>{
  seedCase('a',{proposal:true,blob:'NEVER_SEND_RAW_'.repeat(20_000)});
  const page=listVocabularyCaseQueue('editor',{},now),item=page.items[0];
  assert.equal(page.items.length,1);assert.equal(item.assessment?.diagnosis,'The cue is acceptable.');
  assert.equal(item.served[0].presentedAt,'2026-11-03T08:00:00.000Z');assert.notEqual(item.served[0].presentedAt,item.createdAt);assert.equal(item.served[0].prompt,'Served cue');assert.deepEqual(item.served[0].acceptedAnswers,['字']);
  assert.deepEqual(item.served[0].responses.map(r=>[r.text,r.undone]),[['wrong',true],['字',false]]);
  assert.deepEqual(item.served[0].reactions.map(r=>[r.feedback,r.undone]),[['negative',true],['positive',false],['comment',false]]);
  assert.equal(item.proposal?.operations[0].prompt,'Proposed cue');assert.equal(item.sources[0].prompt,'Original cue');assert.equal(item.stale,false);
  assert.ok(!JSON.stringify(page).includes('NEVER_SEND_RAW'));assert.ok(!JSON.stringify(page).includes('evidence_snapshot_json'));
  assert.ok(Buffer.byteLength(JSON.stringify(page))<5000);
  assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);
});
test('review uses stable oldest-first keyset pages and excludes history, approvals, and unassessed cases',()=>{
  for(const id of ['c','a','b'])seedCase(id);
  seedCase('history',{state:'resolved',resolvedAt:at});seedCase('initial',{noAssessment:true});seedCase('pending');seedCase('attention');
  sql.exec("UPDATE vocabulary_case_reviews SET approval_state='pending' WHERE case_id='pending'; UPDATE vocabulary_case_reviews SET approval_state='attention' WHERE case_id='attention'");
  const first=listVocabularyCaseQueue('editor',{limit:2},now);assert.deepEqual(first.items.map(i=>i.caseId),['a','b']);assert.ok(first.nextCursor);
  resolveVocabularyCaseReview('a',first.items[0].version,'editor');
  const second=listVocabularyCaseQueue('editor',{limit:2,cursor:first.nextCursor!},now);assert.deepEqual(second.items.map(i=>i.caseId),['c']);assert.equal(second.nextCursor,null);
  assert.throws(()=>listVocabularyCaseQueue('editor',{view:'history',cursor:first.nextCursor!},now),/cursor/);
});
test('history is on-demand, newest-resolution first, with literal named-field search outside the default window',()=>{
  seedCase('old',{state:'resolved',resolvedAt:'2026-11-01T10:00:00.000Z'});seedCase('recent-a',{state:'resolved',resolvedAt:at});seedCase('recent-b',{state:'resolved',resolvedAt:at});seedCase('open');
  const first=listVocabularyCaseQueue('editor',{view:'history',limit:1},now);assert.equal(first.items[0].caseId,'recent-b');
  const second=listVocabularyCaseQueue('editor',{view:'history',limit:1,cursor:first.nextCursor!},'2026-11-06T00:00:00.000Z');assert.equal(second.items[0].caseId,'recent-a');
  assert.deepEqual(listVocabularyCaseQueue('editor',{view:'history',search:'old'},now).items.map(i=>i.caseId),['old']);
  assert.equal(listVocabularyCaseQueue('editor',{view:'history',search:'%'},now).items.length,0);
  assert.equal(listVocabularyCaseQueue('editor',{view:'history',search:'Served cue'},now).items.length,3);
});
test('case mutations compare the captured case version atomically and return updated cards',()=>{
  seedCase('a');const before=getVocabularyCaseCard('a','editor');
  sql.exec("UPDATE vocabulary_case_reviews SET version=version+1 WHERE case_id='a'");
  assert.throws(()=>resolveVocabularyCaseReview('a',before.version,'editor'),/Case review changed/);
  assert.throws(()=>reassessVocabularyCaseReview('a',before.version,'editor','openai:gpt-6-sol-high',1),/Case review changed/);
  const current=getVocabularyCaseCard('a','editor');
  const queued=reassessVocabularyCaseReview('a',current.version,'editor','openai:gpt-6-sol-high',1);
  assert.equal(queued.caseId,'a');assert.equal(queued.item.frozen,true);assert.equal(queued.item.activeJob?.sequence,2);assert.ok(queued.item.version>current.version);
  assert.throws(()=>resolveVocabularyCaseReview('a',queued.item.version,'editor'),/frozen/);
  sql.prepare("UPDATE vocabulary_reflection_jobs SET status='failed',last_error='provider_outcome_unknown' WHERE job_id=?").run(queued.jobId);
  const failed=getVocabularyCaseCard('a','editor');assert.equal(failed.frozen,false);assert.equal(failed.currentAssessment?.sequence,1);assert.equal(failed.latestJob?.sequence,2);assert.equal(failed.latestJob?.status,'failed');assert.equal(failed.latestJob?.error,'provider_outcome_unknown');assert.equal(failed.latestJob?.advisory,false);
  seedCase('b');const done=resolveVocabularyCaseReview('b',getVocabularyCaseCard('b','editor').version,'editor');assert.equal(done.state,'resolved');
});
test('alternative cards use their own assessment provenance and cannot cross case boundaries',()=>{
  const older=seedCase('a',{proposal:true})!;const other=seedCase('other',{proposal:true})!;
  sql.prepare(`INSERT INTO vocabulary_reflection_jobs(job_id,case_id,kind,dedupe_key,status,next_attempt_at,result_json,created_at,review_case_id,case_sequence,reassessment_source_job_id,reassessment_source_json) VALUES ('new-job','a','exercise_improvement','new-job','succeeded',?,?,?,'a',2,'job-a',?)`).run(at,JSON.stringify({input:{diagnosis:'New judgment',proposal:null}}),at,JSON.stringify({contentId:'source',version:1}));
  sql.exec("UPDATE vocabulary_case_reviews SET current_job_id='new-job',current_proposal_id=NULL WHERE case_id='a'");
  const current=getVocabularyCaseCard('a','editor');assert.equal(current.assessment?.sequence,2);assert.equal(current.alternatives[0].proposalId,older);
  const alternative=getVocabularyCaseCard('a','editor',older);assert.equal(alternative.currentAssessment?.sequence,2);assert.equal(alternative.assessment?.sequence,1);assert.equal(alternative.proposal?.isCurrent,false);
  assert.throws(()=>getVocabularyCaseCard('a','editor',other),/Unknown vocabulary/);
});
test('case Done cannot silently dismiss an outstanding proposal',()=>{
  seedCase('proposal',{proposal:true});const card=getVocabularyCaseCard('proposal','editor');
  assert.throws(()=>resolveVocabularyCaseReview(card.caseId,card.version,'editor'),/outstanding proposals/);
  sql.prepare("UPDATE vocabulary_reflection_jobs SET result_json=json_set(result_json,'$.input.proposal',NULL) WHERE job_id='job-proposal'").run();
  assert.throws(()=>resolveVocabularyCaseReview(card.caseId,card.version,'editor'),/outstanding proposals/);
  const unchanged=getVocabularyCaseCard(card.caseId,'editor');
  assert.equal(unchanged.state,'open');assert.equal(unchanged.proposal?.status,'awaiting_review');
});
test('card attribution and advisory opinions expose only finalized model metadata and current verdicts',()=>{
  const proposalId=seedCase('a',{proposal:true})!;
  sql.prepare(`INSERT INTO model_invocations(id,timestamp,provider,model,invocation_type,spend_source,status,actor_kind,actor_id,step_name,request_snapshot_json) VALUES ('invocation',?,'openai','fixture-model','fixture','unknown','completed','service','fixture','single_improvement',?)`).run(at,JSON.stringify({raw:'HIDDEN_MODEL_REQUEST'.repeat(1000)}));
  sql.prepare("UPDATE vocabulary_reflection_jobs SET result_json=json_set(result_json,'$.input.invocationId','invocation') WHERE job_id='job-a'").run();
  sql.prepare(`INSERT INTO vocabulary_reflection_jobs(job_id,case_id,kind,dedupe_key,status,next_attempt_at,result_json,created_at,review_case_id,case_sequence,second_opinion_json) VALUES ('opinion','a','exercise_improvement','opinion','succeeded',?,?,?,'a',2,?)`).run(at,JSON.stringify({input:{secondOpinion:{verdict:'support',rationale:'This repair is useful.'}},raw:'HIDDEN_OPINION'.repeat(1000)}),at,JSON.stringify({requestId:'opinion-request',proposal:{proposalId,raw:'HIDDEN_PROPOSAL'.repeat(1000)}}));
  sql.prepare('INSERT INTO vocabulary_second_opinions VALUES (?,?,1,?,?,?)').run('opinion-request',proposalId,'opinion','editor',at);
  const card=getVocabularyCaseCard('a','editor');
  assert.equal(card.assessment?.models[0].model,'fixture-model');assert.equal(card.assessment?.models[0].stage,'single_improvement');
  assert.equal(card.advisoryOpinion?.result?.verdict,'support');assert.equal(card.advisoryOpinion?.sequence,2);
  assert.ok(!JSON.stringify(card).includes('HIDDEN_'));
});
test('source drift is visible without source hydration, and unusual authored bodies require full review',()=>{
  const proposalId=seedCase('a',{proposal:true})!;
  const source=getVocabularyContentForMaintenance('source')!;
  updateVocabularyContent('source',1,{...source,body:{prompt:'New current cue'}},{kind:'operator',id:'editor'});
  const stale=getVocabularyCaseCard('a','editor');assert.equal(stale.stale,true);assert.equal(stale.sources[0].version,2);assert.equal(stale.sources[0].prompt,'New current cue');assert.equal(stale.sources[0].expectedVersion,1);
  sql.prepare("UPDATE content_proposals SET operations_json=json_set(operations_json,'$[0].content.body.additionalTeachingMaterial',?) WHERE proposal_id=?").run('UNREPRESENTED_RAW'.repeat(10000),proposalId);
  const unusual=getVocabularyCaseCard('a','editor');assert.equal(unusual.requiresDetails,true);assert.ok(!JSON.stringify(unusual).includes('UNREPRESENTED_RAW'));
});
test('a fixed twenty-case page has a bounded SQL count and payload as retained history grows',()=>{
  for(let i=0;i<20;i++)seedCase(`open-${String(i).padStart(3,'0')}`,{proposal:true});
  const measure=()=>{const timing=startRequestTiming();const start=performance.now();const page=runWithRequestTiming(timing,()=>listVocabularyCaseQueue('editor',{},now));return {page,calls:timing.statementCount,ms:performance.now()-start,bytes:Buffer.byteLength(JSON.stringify(page))};};
  const before=measure();
  sql.exec('BEGIN');for(let i=0;i<500;i++)seedCase(`history-${i}`,{state:'resolved',resolvedAt:at,blob:'history-only-raw'.repeat(500)});sql.exec('COMMIT');
  const after=measure();assert.equal(after.calls,before.calls);assert.ok(after.calls<=24,`Expected at most 12 prepare/execute pairs, saw ${after.calls}`);assert.equal(after.bytes,before.bytes);assert.deepEqual(after.page,before.page);
  console.log(JSON.stringify({caseQueueBenchmark:{cases:20,additionalHistory:500,before:{ms:before.ms,calls:before.calls,bytes:before.bytes},after:{ms:after.ms,calls:after.calls,bytes:after.bytes}}}));
});
test('HTTP queue validates limits and case versions and keeps operator authorization',()=>{
  seedCase('a');const handlers=new Map<string,RequestHandler[]>();
  const app=Object.fromEntries(['get','post','put'].map(method=>[method,(route:string,...callbacks:RequestHandler[])=>handlers.set(`${method} ${route}`,callbacks)])) as unknown as Express;
  registerVocabularyReflectionRoutes(app);
  function call(method:string,route:string,body:unknown={},query:Record<string,string>={}){
    let status=200,value:unknown;const request={body,query,params:{id:'a'}} as unknown as Request;
    const response={locals:{},status(s:number){status=s;return this;},json(v:unknown){value=v;return this;}} as unknown as Response;
    let n=0;const callbacks=handlers.get(`${method} /api/operator/vocabulary/${route}`)!;const next=()=>{const callback=callbacks[n++];if(callback)callback(request,response,next);};next();return {status,value};
  }
  assert.equal(call('get','case-queue',{},{}).status,200);
  assert.equal(call('get','case-queue',{}, {limit:'51'}).status,400);
  assert.equal(call('post','case-queue/:id/resolve',{}).status,400);
  assert.equal(call('post','case-queue/:id/resolve',{expectedVersion:99}).status,409);
  process.env.APP_OPERATOR_CLERK_USER_IDS='someone-else';assert.equal(call('get','case-queue').status,403);
  assert.throws(()=>listVocabularyCaseQueue('editor'),/Operator access/);
});

test('both keyset directions expose exact filtered totals and global ordinals, with cheap end wrapping',()=>{
  for(const id of ['a','b','c','d','e'])seedCase(id);
  const first=listVocabularyCaseQueue('editor',{limit:2},now);
  assert.equal(first.total,5);assert.equal(first.startIndex,0);assert.equal(first.previousCursor,null);
  const next=listVocabularyCaseQueue('editor',{limit:2,cursor:first.nextCursor!},now);
  assert.deepEqual(next.items.map(item=>item.caseId),['c','d']);assert.equal(next.startIndex,2);assert.equal(next.total,5);
  const back=listVocabularyCaseQueue('editor',{limit:2,cursor:next.previousCursor!,direction:'previous'},now);
  assert.deepEqual(back.items.map(item=>item.caseId),['a','b']);assert.equal(back.startIndex,0);
  const last=listVocabularyCaseQueue('editor',{limit:2,edge:'last'},now);
  assert.deepEqual(last.items.map(item=>item.caseId),['d','e']);assert.equal(last.startIndex,3);assert.equal(last.nextCursor,null);
  const wrap=listVocabularyCaseQueue('editor',{limit:2,cursor:last.previousCursor!,edge:'first'},now);
  assert.deepEqual(wrap.items.map(item=>item.caseId),['a','b']);assert.equal(wrap.total,5);
  resolveVocabularyCaseReview('a',first.items[0].version,'editor');
  const refreshed=listVocabularyCaseQueue('editor',{limit:2,cursor:first.nextCursor!},now);
  assert.equal(refreshed.startIndex,1);assert.equal(refreshed.total,4);
});
test('archive wrapping retains cursor time boundaries and reverse sort including ties',()=>{
  for(const id of ['a','b','c'])seedCase(id,{state:'resolved',resolvedAt:at});
  const first=listVocabularyCaseQueue('editor',{view:'history',limit:1},now);
  const last=listVocabularyCaseQueue('editor',{view:'history',limit:1,cursor:first.nextCursor!,edge:'last'},'2026-11-06T00:00:00.000Z');
  assert.equal(last.items[0].caseId,'a');assert.equal(last.total,3);assert.equal(last.startIndex,2);
  const previous=listVocabularyCaseQueue('editor',{view:'history',limit:1,cursor:last.previousCursor!,direction:'previous'},'2026-11-06T00:00:00.000Z');
  assert.equal(previous.items[0].caseId,'b');assert.equal(previous.startIndex,1);
});

test('review end traversal uses existing ordered index in both directions',()=>{
  seedCase('a');
  const plans=['ASC','DESC'].map(direction=>sql.prepare(`EXPLAIN QUERY PLAN SELECT r.case_id,r.created_at FROM vocabulary_case_reviews r WHERE r.state='open' AND r.approval_state IS NULL AND (r.current_job_id IS NOT NULL OR r.current_proposal_id IS NOT NULL) ORDER BY r.created_at ${direction},r.case_id ${direction} LIMIT 20`).all());
  for(const plan of plans){const details=JSON.stringify(plan);assert.match(details,/idx_vocabulary_case_review_queue/);assert.doesNotMatch(details,/TEMP B-TREE/);}
  console.log(JSON.stringify({caseQueueEndPlans:plans}));
});

test('retired-source unresolved finding remains visible and closes without a fabricated note or source change',()=>{
  seedCase('unresolved');
  sql.prepare("UPDATE vocabulary_reflection_jobs SET result_json=json_set(result_json,'$.input.admission',json(?)) WHERE job_id='job-unresolved'").run(JSON.stringify({outcome:'unmappable',rationale:'The served cue does not identify one intended sense.',sourceContentId:'source'}));
  sql.exec("UPDATE content_items SET availability='retired' WHERE content_id='source'");
  const before=getVocabularyCaseCard('unresolved','editor');
  assert.equal(before.needsDecision,true);assert.deepEqual(before.finding,{kind:'unmappable',message:'The served cue does not identify one intended sense.'});
  assert.equal(before.reassessment.eligible,false);assert.equal(before.reassessment.reason,'The source exercise is retired.');
  assert.throws(()=>reassessVocabularyCaseReview(before.caseId,before.version,'editor','openai:gpt-6-sol-high',1),/unavailable|active|retired/i);
  const after=resolveVocabularyCaseReview(before.caseId,before.version,'editor','');assert.equal(after.state,'resolved');
  const event=sql.prepare("SELECT data_json FROM backend_events WHERE entity_id=? AND name='vocabulary.reflection.admission_case_closed'").get(before.caseId)!;
  const data=JSON.parse(event.data_json as string);assert.equal(data.reason,'');assert.equal(data.outcome,'unmappable');assert.equal(data.context.sourceAvailability,'retired');
  assert.equal(getVocabularyContentForMaintenance('source')!.availability,'retired');assert.equal(getVocabularyContentForMaintenance('source')!.version,1);
});

test('pure cue display projects stored axis and teaching note from evidence and proposed content',()=>{
 const id=seedCase('pure',{proposal:true,pure:true})!;

 sql.prepare("UPDATE content_proposals SET operations_json=json_set(operations_json,'$[0].content.exerciseType','pure_cue','$[0].content.body.reveal.axisNote','Stored axis','$[0].content.body.reveal.teachingNote','Revised note') WHERE proposal_id=?").run(id);
 const item=getVocabularyCaseCard('pure','editor');assert.equal(item.wordLabel,'字');
 assert.deepEqual(item.served[0].pureCue,{axisNote:'Stored axis',teachingNote:'Original note'});
 assert.deepEqual(item.proposal!.operations[0].pureCue,{axisNote:'Stored axis',teachingNote:'Revised note'});
 assert.equal(item.requiresDetails,false);
});

test('shared-cue reuse is read-only context attached to the displayed assessment, including alternatives and drift',()=>{
  const proposalId=seedCase('reuse',{proposal:true})!;
  const cue=createVocabularyContent({contentId:'shared-cue',kind:'exercise',payloadVersion:1,body:{prompt:'四周显得格外____。',reveal:{teachingNote:'Both forms fit this scene.'}},exerciseType:'pure_cue',skill:'production',exerciseRole:'general',assessment:{match:'exact'},accessScope:'shared',availability:'active',originKind:'human',words:[{wordId:'word',relation:'target'}],answers:[{wordId:'word',acceptedForms:['静','宁静']}]},{kind:'operator',id:'editor'});
  const promotion={outcome:'reuse',existingContentId:cue.contentId,rationale:'Existing shared practice already accepts both answers.',raw:'DO_NOT_PROJECT'};
  sql.prepare("UPDATE vocabulary_reflection_jobs SET result_json=json_set(result_json,'$.input.pureCuePromotion',json(?)) WHERE job_id='job-reuse'").run(JSON.stringify(promotion));
  sql.prepare('INSERT INTO proposal_content_bases VALUES (?,?,?)').run(proposalId,cue.contentId,1);
  const item=getVocabularyCaseCard('reuse','editor');
  assert.deepEqual(item.reusedSharedCue,{contentId:'shared-cue',prompt:'四周显得格外____。',acceptedAnswers:['静','宁静'],teachingNote:'Both forms fit this scene.',rationale:promotion.rationale,version:1,expectedVersion:1,availability:'active'});
  assert.equal(item.proposal?.operations.length,1);assert.equal(item.stale,false);assert.ok(!JSON.stringify(item).includes('DO_NOT_PROJECT'));
  assert.deepEqual(listVocabularyCaseQueue('editor',{},now).items[0].reusedSharedCue,item.reusedSharedCue);
  sql.prepare(`INSERT INTO vocabulary_reflection_jobs(job_id,case_id,kind,dedupe_key,status,next_attempt_at,result_json,created_at,review_case_id,case_sequence) VALUES ('new-reuse-job','reuse','exercise_improvement','new-reuse-job','succeeded',?,?,?,'reuse',2)`).run(at,JSON.stringify({input:{diagnosis:'New judgment',proposal:null}}),at);
  sql.exec("UPDATE vocabulary_case_reviews SET current_job_id='new-reuse-job',current_proposal_id=NULL WHERE case_id='reuse'");
  assert.equal(getVocabularyCaseCard('reuse','editor').reusedSharedCue,undefined);
  assert.deepEqual(getVocabularyCaseCard('reuse','editor',proposalId).reusedSharedCue,item.reusedSharedCue);
  updateVocabularyContent(cue.contentId,1,{...cue,body:{prompt:'Updated shared cue'},availability:'retired'},{kind:'operator',id:'editor'});
  const stale=getVocabularyCaseCard('reuse','editor',proposalId);assert.equal(stale.stale,true);
  assert.equal(stale.reusedSharedCue?.version,2);assert.equal(stale.reusedSharedCue?.expectedVersion,1);assert.equal(stale.reusedSharedCue?.availability,'retired');assert.equal(stale.reusedSharedCue?.prompt,'Updated shared cue');
});

test('reuse with unavailable content remains visible, while create and extend are not presented as reuse',()=>{
  seedCase('missing');
  for(const outcome of ['create','extend','reuse']){
    sql.prepare("UPDATE vocabulary_reflection_jobs SET result_json=json_set(result_json,'$.input.pureCuePromotion',json(?)) WHERE job_id='job-missing'").run(JSON.stringify({outcome,existingContentId:'missing-content',rationale:'Retained reuse decision'}));
    const item=getVocabularyCaseCard('missing','editor');
    if(outcome!=='reuse')assert.equal(item.reusedSharedCue,undefined);
    else assert.deepEqual(item.reusedSharedCue,{contentId:'missing-content',prompt:null,acceptedAnswers:[],teachingNote:null,rationale:'Retained reuse decision',version:null,expectedVersion:null,availability:null});
  }
});
