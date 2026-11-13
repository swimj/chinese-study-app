import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { buildRepertoireSnapshot } from '../server/db/repertoire-quality.ts';
import { createRepertoireSnapshotCache, mountRepertoireQualityRoutes } from '../server/operator/repertoire-quality-routes.ts';
import { createBaselineFixture } from './helpers/baseline-database.ts';
import { migrateDatabase } from '../server/db/migrations.ts';
import express from 'express';

const at = '2026-11-10T00:00:00.000Z';
const before = '2026-11-10T01:00:00.000Z';
const applied = '2026-11-11T00:00:00.000Z';
const after = '2026-11-12T00:00:00.000Z';

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'repertoire-quality-'));
  createBaselineFixture(dir);
  const file = path.join(dir,'app.db');
  const db = new DatabaseSync(file);
  db.function('current_learner_id', ()=>'learner');
  db.exec('PRAGMA foreign_keys=ON');
  migrateDatabase(db);
  return { db,file,close() { db.close(); fs.rmSync(dir,{recursive:true,force:true}); } };
}

test('exact bootstrap revisions pool by model and retain independent repair outcomes', () => {
  const {db,close} = fixture();
  try {
    // Focus this fixture on retained projections and publication receipts.
    db.exec('PRAGMA foreign_keys=OFF');
    db.exec(`INSERT INTO lexical_words(id,hanzi,pinyin,meaning,examples_json,priority,created_at)
      VALUES ('w','斟酌','zhēn zhuó','choose wording carefully','[]',1,'${at}')`);
    function revision(id:string,version:number,prompt:string,accessScope='shared',recordedAt=at,availability='active') {
      if (version===1) db.prepare(`INSERT INTO content_items(content_id,kind,payload_version,body_json,exercise_type,skill,
        exercise_role,assessment_json,access_scope,owner_learner_id,availability,origin_kind,version,created_at,updated_at)
        VALUES (?,'exercise',1,'{}','cloze','production','general','{}',?,?,'active','model',1,?,?)`)
        .run(id,accessScope,accessScope==='private'?'secret-learner':null,at,at);
      db.prepare(`INSERT INTO content_revision_history(change_id,content_id,version,previous_version,snapshot_json,change_kind,
        write_strategy,actor_kind,actor_id,recorded_at) VALUES (?,?,?,?,?,?,?,'service','fixture',?)`)
        .run(id+version,id,version,version===1?null:version-1,JSON.stringify({
          body:{prompt,...(id==='reflected'?{source:{kind:'vocabulary_repertoire'}}:{})},accessScope,availability,
          words:[{wordId:'w',relation:'target'}],
        }),version===1?'created':'updated',version===1?'create':'update_existing',recordedAt);
    }
    function invocation(id:string,model:string,actor:string,step:string,prompt:string,spend:number|null,workflowId:string|null=null) {
      db.prepare(`INSERT INTO model_invocations(id,timestamp,provider,model,invocation_type,spend_usd,spend_source,
        status,actor_kind,actor_id,step_name,prompt_name,prompt_version,workflow_id)
        VALUES (?,?,'openai',?,'fixture',?,?,'completed','service',?,?,?,'v5.1',?)`)
        .run(id,at,model,spend,spend===null?'unknown':'estimated',actor,step,prompt,workflowId);
    }
    invocation('sol','gpt-6-sol','vocabulary-bulk-repertoire','general_exercises','vocabulary-general-exercises',0.02);
    invocation('sol-practice','gpt-6-sol','vocabulary-practice-authoring','general_exercises','vocabulary-general-exercises',0.01);
    invocation('luna','gpt-5.6-luna','vocabulary-practice-authoring','general_exercises','vocabulary-general-exercises',null);
    invocation('author','gpt-6-luna','vocabulary-reflection','repertoire','vocabulary-general-exercises',0.003,'bootstrap-job');
    invocation('improver','gpt-6-sol','vocabulary-reflection','single_improvement','vocabulary-reflection-single-improvement',0.01,'repair-job');
    revision('sol-cue',1,'Weigh the decision.');
    revision('sol-cue',2,'Choose the wording carefully.','shared',applied);
    revision('sol-cue',3,'Choose the wording carefully.','shared',after);
    revision('sol-unseen',1,'Consider the phrasing.');
    revision('luna-cue',1,'Think it over.');
    revision('luna-cue',2,'Think it over.','shared',applied,'retired');
    revision('luna-replacement',1,'Think it over before replying.','shared',applied);
    revision('private',1,'Private cue','private');
    revision('reflected',1,'Reflected cue');
    for (const [invocationId,contentId] of [['sol','sol-cue'],['sol-practice','sol-unseen'],['luna','luna-cue']]) {
      db.prepare("INSERT INTO invocation_content_links VALUES (?,?,1,'output')").run(invocationId!,contentId!);
    }

    function proposal(id:string,invocationId:string,outcome:string,op:string,source:string|null,result:string,version:number,applyTime:string,sourceVersion=1) {
      const caseId=id+'-case', jobId=id+'-job';
      db.prepare(`INSERT INTO reflection_cases(case_id,completion_id,learner_id,kind,subject_key,word_id,content_id,status,evidence_snapshot_json,created_at)
        VALUES (?,'fake','secret-learner','exercise_improvement',?,'w',?,'completed','[]',?)`).run(caseId,id,source,at);
      db.prepare(`INSERT INTO vocabulary_reflection_jobs(job_id,case_id,kind,dedupe_key,status,next_attempt_at,result_json,created_at)
        VALUES (?,?,'exercise_improvement',?,'succeeded',?,?,?)`).run(jobId,caseId,id,at,JSON.stringify({input:{admission:{outcome}}}),at);
      db.prepare(`INSERT INTO content_proposals(proposal_id,case_id,version,status,operations_json,rationale,author_kind,author_id,invocation_id,created_at,updated_at,assessment_job_id)
        VALUES (?,?,1,'applied','[]','','service','fixture',?,?,?,?)`).run(id,caseId,invocationId,at,at,jobId);
      db.prepare('INSERT INTO proposal_revision_history VALUES (?,1,?,\'service\',\'fixture\',?)')
        .run(id,JSON.stringify({operations:[{operationKey:'op',content:{body:{prompt:'Unedited draft'}}}]}),at);
      db.prepare(`INSERT INTO proposal_reviews(review_id,proposal_id,proposal_version,operator_id,disposition,notes_json,reviewed_at)
        VALUES (?,?,1,'reviewer','approved',?,?)`).run(id,id,id==='bootstrap'?'{"automatic":"repertoire_bootstrap"}':null,applyTime);
      db.prepare('INSERT INTO proposal_applications VALUES (?,?,1,?,?,\'{}\',?)').run(id,id,id,id,applyTime);
      db.prepare('INSERT INTO application_content_changes VALUES (?,\'op\',?,?,?, ?,?,NULL)')
        .run(id,op,source,source===null?null:sourceVersion,result,version);
    }
    proposal('repair','improver','single_sense','update_existing','sol-cue','sol-cue',2,applied);
    proposal('replacement','improver','single_sense','replace','luna-cue','luna-replacement',1,applied);
    proposal('unchanged','improver','single_sense','update_existing','sol-cue','sol-cue',3,after,2);
    proposal('bootstrap','author','repertoire_bootstrap','create',null,'reflected',1,at);

    function encounter(encounterId:string,contentId:string,contentVersion:number,presentedAt:string,result:'accepted'|'rejected',undone=false) {
      return {encounterId,presentedAt,presentationUndone:undone,
        snapshot:{contentId,contentVersion,kind:'production',role:'general'},
        effectiveResponses:[{payload:{outcome:result,response:'secret-answer'}}],feedback:[],skipped:false};
    }
    function completion(sessionId:string,time:string,encounters:ReturnType<typeof encounter>[]) {
      db.prepare(`INSERT INTO vocabulary_session_completions(completion_id,learner_id,session_id,revision_number,through_sequence,
        staged_at,close_at,status,input_json,report_json,policy_version,closed_at) VALUES (?,'secret-learner',?,1,1,?,?,'closed','{}',?,'fixture',?)`)
        .run(sessionId,sessionId,time,time,JSON.stringify({encounters}),time);
      for (const e of encounters) db.prepare(`INSERT OR IGNORE INTO exercise_encounters(encounter_id,learner_id,session_id,presented_action_id,
        content_id,content_version,context_json,served_snapshot_json,presented_at)
        VALUES (?,'secret-learner',?,?,?,?,'{}','{}',?)`).run(e.encounterId,sessionId,e.encounterId,e.snapshot.contentId,e.snapshot.contentVersion,e.presentedAt);
    }
    completion('before',before,[encounter('unfair','sol-cue',1,before,'rejected'),encounter('undone','luna-cue',1,before,'rejected',true)]);
    completion('after',after,[encounter('late-source','sol-cue',1,after,'accepted'),encounter('after-miss','sol-cue',2,after,'rejected'),
      encounter('other-revision','sol-cue',3,after,'accepted'),encounter('private-miss','private',1,after,'rejected')]);
    db.prepare(`INSERT INTO reflection_cases(case_id,completion_id,learner_id,kind,subject_key,word_id,status,evidence_snapshot_json,created_at)
      VALUES ('feedback-case','before','secret-learner','learner_feedback','word/w','w','completed','[]',?)`).run(at);
    db.prepare(`INSERT INTO vocabulary_reflection_jobs(job_id,case_id,kind,dedupe_key,status,next_attempt_at,result_json,created_at)
      VALUES ('feedback-job','feedback-case','learner_feedback','feedback','succeeded',?,?,?)`)
      .run(at,JSON.stringify({input:{unfairEncounterIds:['unfair'],diagnosis:'private reasoning'}}),at);

    const snapshot=buildRepertoireSnapshot(db,after);
    const sol=snapshot.cohorts.find(cohort=>cohort.model==='sol')!;
    assert.deepEqual({exercises:sol.exercises,served:sol.served,distinct:sol.exercisesServed,first:sol.acceptedFirst,unfair:sol.unfairFirstMisses,spend:sol.authoringSpendUsd},
      {exercises:2,served:2,distinct:1,first:1,unfair:1,spend:0.03});
    const luna=snapshot.cohorts.find(cohort=>cohort.model==='luna')!;
    assert.equal(luna.exercises,2);
    assert.equal(luna.served,0);
    assert.equal(luna.pricedCalls,1);
    const replacedCue=snapshot.cueRows.find(cue=>cue.prompt==='Think it over.')!;
    assert.equal(replacedCue.laterChanges,1);
    assert.deepEqual(snapshot.cues.get(replacedCue.id)!.versions.map(version=>version.change),['published','retirement','replacement']);
    const reflected=snapshot.cueRows.find(cue=>cue.prompt==='Reflected cue')!;
    assert.equal(snapshot.cues.get(reflected.id)!.publication,'automatic');
    assert.equal(snapshot.cues.get(reflected.id)!.generatedPrompt,'Unedited draft');
    const repair=snapshot.repairRows.find(row=>row.kind==='edit')!;
    const replacement=snapshot.repairRows.find(row=>row.kind==='replacement')!;
    assert.equal(replacement.after!.served,0);
    assert.equal(repair.before.served,1);
    assert.equal(repair.after!.unclassifiedFirstMisses,1);
    assert.equal(repair.after!.served,1);
    assert.equal(repair.laterChanges,0);
    assert.equal(snapshot.repairTotals.applied,2);
    assert.equal(snapshot.repairTotals.servedAfter,1);
    assert.equal(snapshot.repairs.get(repair.id)!.versions[0]!.change,'source');
    assert.equal(snapshot.repairs.get(repair.id)!.versions[2]!.change,'metadata');
    assert.equal(snapshot.repairTotals.firstMissAfter,1);
    assert.equal(snapshot.repairTotals.unfairAfter,0);
    assert.doesNotMatch(JSON.stringify([...snapshot.cueRows,...snapshot.cues.values(),...snapshot.repairs.values()]),/secret-|private reasoning|Private cue/);
  } finally {close();}
});

test('operator API builds one cached read-only snapshot in a worker and validates queries', async () => {
  const {file,close} = fixture();
  const keys = ['APP_MODE','APP_AUTH_MODE','APP_DATA_DIR','APP_OPERATOR_CLERK_USER_IDS'] as const;
  const previous = keys.map(key=>process.env[key]);
  process.env.APP_MODE='study';
  process.env.APP_AUTH_MODE='trusted_local';
  process.env.APP_DATA_DIR=path.dirname(file);
  delete process.env.APP_OPERATOR_CLERK_USER_IDS;
  const app = express();
  mountRepertoireQualityRoutes(app,file);
  const server=app.listen(0,'127.0.0.1');
  try {
    await once(server,'listening');
    const address=server.address();
    assert(address && typeof address==='object');
    const base=`http://127.0.0.1:${address.port}/api/operator/repertoire-quality`;
    assert.equal((await fetch(base+'?view=cues&page=1')).status,403);
    process.env.APP_OPERATOR_CLERK_USER_IDS='trusted_local';
    const responses=await Promise.all([fetch(base+'?view=cues&page=1'),fetch(base+'?view=repairs&page=1')]);
    assert.deepEqual(responses.map(response=>response.status),[200,200]);
    const [cues,repairs]=await Promise.all(responses.map(response=>response.json()));
    assert.equal(cues.capturedAt,repairs.capturedAt);
    assert.deepEqual(cues.cohorts.map((cohort:{model:string})=>cohort.model),['sol','luna']);
    assert.equal((await fetch(base+'?view=repairs&page=0')).status,400);
    assert.equal((await fetch(base+'/detail?view=cues&id=missing')).status,404);
  } finally {
    keys.forEach((key,index) => {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key]=previous[index];
    });
    await new Promise<void>(resolve=>server.close(()=>resolve())); close();
  }
});

test('snapshot refresh serves cached data while a single replacement builds', async () => {
  let time=0, builds=0;
  let finish: ((value: ReturnType<typeof buildRepertoireSnapshot>)=>void) | undefined;
  const {db,close}=fixture();
  try {
    const initial=buildRepertoireSnapshot(db,at);
    const next={...initial,capturedAt:after};
    const read=createRepertoireSnapshotCache(()=>++builds===1?Promise.resolve(initial):new Promise(resolve=>{finish=resolve;}),()=>time);
    assert.equal((await read()).capturedAt,at);
    time+=10*60_000;
    assert.equal((await read()).capturedAt,at);
    assert.equal((await read()).capturedAt,at);
    assert.equal(builds,2);
    finish!(next);
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal((await read()).capturedAt,after);
    assert.equal(builds,2);
  } finally {close();}
});
