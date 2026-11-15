import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createBaselineFixture } from './helpers/baseline-database.ts';
import { migrateDatabase } from '../server/db/migrations.ts';
import { setDb } from '../server/db/connection.ts';
import { runWithLearnerId,requireLearnerId } from '../server/db/learner-context.ts';
import { createVocabularyContent, createVocabularySense, establishVocabularySenseCatalog, getVocabularySenseCatalog } from '../server/db/vocabulary-content.ts';
import { writeVocabularyDefaultUsefulSenses } from '../server/db/vocabulary-sense-coverage.ts';
import { teachingSenseSetKey, teachingSenseIds } from '../server/db/teaching-sense-sets.ts';
import { enqueueWordPreparation, getWordPreparationWork, listDueWordPreparation, beginWordPreparationAttempt, recoverExpiredWordPreparation } from '../server/db/preparation-work.ts';
import { getSharedWordIntroductionContent, getSharedWordTeachingPackageId, claimSharedWordIntroductionStage, releaseSharedWordIntroductionStage, getWordIntroductionLibrary } from '../server/db/word-introductions.ts';
import { createWordPreparationWorker } from '../server/word-content/preparation-worker.ts';
import { getBlockedPreparationWordIds } from '../server/db/word-reserve.ts';
import { resolveVocabularyTeaching } from '../server/vocabulary/teaching-readiness.ts';
import type { WordIntroductionProvider } from '../server/word-content/provider.ts';
import { resolveLearnerTeachingSetKey } from '../server/db/learner-teaching.ts';
import { resolveVocabularyLearnerSenseScope, writeVocabularyLearnerSenseScope } from '../server/db/vocabulary-learner-senses.ts';
import { addVocabularyWord, getVocabularyLearnerWord, getVocabularyWordSchedule } from '../server/db/vocabulary-learners.ts';
import { updateVocabularyStashPriority } from '../server/db/vocabulary-stash.ts';
import { reconcileVocabularyPreparationReserve } from '../server/vocabulary/preparation-reserve.ts';
import { pinWordTeachingPackage,completeWordTeachingPackage } from '../server/db/word-introductions.ts';
import { getTeachingSetReport } from '../server/db/teaching-set-report.ts';
import { commandVocabularyStudy, composeVocabularySessionPayload, nextVocabularyExercise, startVocabularyStudy } from '../server/vocabulary/study.ts';
import { closeVocabularySessionCompletion, getVocabularySession, stageVocabularySessionCompletion } from '../server/db/vocabulary-sessions.ts';

let root:string, sql:DatabaseSync;
const owner=<T>(work:()=>T)=>runWithLearnerId('learner',work);
const actor={kind:'service' as const,id:'fixture'};
before(()=>{
  root=fs.mkdtempSync(path.join(os.tmpdir(),'teaching-sets-'));
  process.env.APP_MODE='study';process.env.APP_AUTH_MODE='clerk';process.env.APP_DATA_DIR=root;
  createBaselineFixture(root);sql=new DatabaseSync(path.join(root,'app.db'));
  sql.function('current_learner_id',requireLearnerId);sql.exec('PRAGMA foreign_keys=ON');migrateDatabase(sql);setDb(sql);
  sql.exec(`INSERT INTO learners(learner_id,display_name,created_at) VALUES('learner','Learner','2026-11-15'),('other','Other','2026-11-15'),('exact','Exact','2026-11-15');
    INSERT INTO lexical_words(id,hanzi,pinyin,meaning,meanings_json,examples_json,priority,created_at)
    VALUES('word','挂钩','guà gōu','hook','["hook"]','[]',1,'2026-11-15');`);
  for(const id of ['a','b','c'])createVocabularySense({senseId:id,wordId:'word',description:{label:`Sense ${id}`,notes:[]}},actor);
  establishVocabularySenseCatalog('word',getVocabularySenseCatalog('word').version,actor);
  writeVocabularyDefaultUsefulSenses('word',0,['a','b'],actor);
});
after(()=>{setDb(null);sql.close();fs.rmSync(root,{recursive:true,force:true});});
const seen:string[][]=[];
const provider:WordIntroductionProvider={
  model:'fixture',isConfigured:()=>true,generationKey:async stage=>`fixture-${stage}`,
  generateBootstrap:async input=>{
    const senses=input.canonicalSenses!;seen.push(senses.map(s=>s.senseId));
    return {uses:senses.map((sense,i)=>({id:sense.senseId,label:sense.label,notes:sense.notes,exampleIds:[`e${i}`]})),
      examples:senses.map((_,i)=>({id:`e${i}`,text:'奖金与业绩挂钩。',translation:'The bonus is tied to performance.',pronunciation:null}))};
  },
  generateTeaching:async()=>({beats:[{id:'beat',parts:[{kind:'text',text:'These uses connect things.'}]}]}),
  generatePractice:async()=>({rehearsals:[{id:'practice',stimulus:{kind:'direct_text',text:'Tie the bonus to performance.'}}]}),
  generateReview:async()=>{throw new Error('Custom teaching must not generate word-wide review');},
};

test('canonical sets reject malformed identities and invalid sense ownership',()=>{
  assert.equal(teachingSenseSetKey(['b','a','b']),'["a","b"]');
  assert.throws(()=>teachingSenseSetKey([]),/nonempty/);
  assert.throws(()=>teachingSenseIds('["b","a"]'),/canonical/);
  assert.throws(()=>owner(()=>enqueueWordPreparation('word','teaching',undefined,'["missing"]')),/another word/);
});

test('worker prepares coherent sets independently and preserves the default package after defaults change',async()=>{
  const custom=teachingSenseSetKey(['c','b']);
  const defaults=owner(()=>enqueueWordPreparation('word','teaching'));
  const customWork=owner(()=>enqueueWordPreparation('word','teaching',undefined,custom));
  assert.notEqual(defaults.workId,customWork.workId);
  assert.equal(runWithLearnerId('other',()=>enqueueWordPreparation('word','teaching',undefined,custom)).workId,customWork.workId,'learners requesting the same set share its work');
  assert.equal(owner(()=>enqueueWordPreparation('word','teaching',undefined,teachingSenseSetKey(['b','c']))).workId,customWork.workId);
  assert.deepEqual(listDueWordPreparation().map(work=>work.stage),['bootstrap','bootstrap']);
  const worker=createWordPreparationWorker({provider,providerWork:async work=>work(),controls:()=>({maintenanceMode:false,providerWorkEnabled:true})});
  try{await worker.drain();}finally{await worker.stop();}
  assert.deepEqual(seen.sort(),[['a','b'],['b','c']]);
  const source=getSharedWordIntroductionContent('word')!;
  const customSource=getSharedWordIntroductionContent('word',custom)!;
  assert.notEqual(source.id,customSource.id);
  assert.throws(()=>sql.prepare("UPDATE word_introduction_preparation SET content_id=? WHERE word_id='word' AND teaching_set_key='default'").run(customSource.id),/FOREIGN KEY/,'the database rejects cross-set source pointers');
  assert.deepEqual(source.uses.map(use=>use.id),['a','b']);
  assert.deepEqual(customSource.uses.map(use=>use.id),['b','c']);
  const defaultPackage=getSharedWordTeachingPackageId('word');
  const customPackage=getSharedWordTeachingPackageId('word',custom);
  assert(defaultPackage);assert(customPackage);assert.notEqual(defaultPackage,customPackage);
  assert.equal(getWordPreparationWork('word','teaching')?.status,'ready');
  assert.equal(getWordPreparationWork('word','teaching',custom)?.status,'ready');
  owner(()=>{
    assert.equal(resolveVocabularyTeaching('word')?.intro.body && (resolveVocabularyTeaching('word')!.intro.body as {sourcePackageId:string}).sourcePackageId,defaultPackage);
    assert.equal((resolveVocabularyTeaching('word',custom)!.intro.body as {sourcePackageId:string}).sourcePackageId,customPackage);
    assert.deepEqual(getWordIntroductionLibrary('word')!.packages.map(p=>p.teaching.id),[defaultPackage]);
    assert.deepEqual(getWordIntroductionLibrary('word',custom)!.packages.map(p=>p.teaching.id),[customPackage]);
  });
  writeVocabularyDefaultUsefulSenses('word',1,['c'],actor);
  assert.equal(getSharedWordTeachingPackageId('word'),defaultPackage);
  assert.deepEqual(getSharedWordIntroductionContent('word')!.uses.map(use=>use.id),['a','b']);
  assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('leases, dependency readiness, recovery and paused failures cannot cross sets',()=>{
  const custom=teachingSenseSetKey(['a','c']);
  const started=new Date().toISOString(),expiry=new Date(Date.now()+60_000).toISOString();
  const work=owner(()=>enqueueWordPreparation('word','teaching',started,custom));
  assert.equal(listDueWordPreparation().some(row=>row.workId===work.workId),false,'another set source does not satisfy this teaching dependency');
  assert.equal(claimSharedWordIntroductionStage('word','bootstrap','same-token',started,expiry,custom),'claimed');
  releaseSharedWordIntroductionStage('word','same-token');
  assert.equal(claimSharedWordIntroductionStage('word','bootstrap','other-token',started,expiry,custom),'busy','default release does not clear custom lease');
  const bootstrap=getWordPreparationWork('word','bootstrap',custom)!;
  assert(beginWordPreparationAttempt(bootstrap.workId,'same-token',null,started,expiry));
  recoverExpiredWordPreparation(new Date(Date.parse(expiry)+1).toISOString());
  assert.equal(getWordPreparationWork('word','bootstrap',custom)?.status,'queued','ready default source cannot mark unfinished custom work ready');
  sql.prepare("UPDATE word_preparation_work SET status='paused' WHERE work_id=?").run(bootstrap.workId);
  assert.equal(owner(()=>getBlockedPreparationWordIds()).has('word'),false,'custom failure does not block default admission');
  assert.equal(getWordPreparationWork('word','teaching')?.status,'ready');
});

test('repair preserves a concrete set and its mappings while another set is preparing',async()=>{
  const {readPackageImprovementSource,validatePackageImprovement,applyPackageImprovement}=await import('../server/db/content-improvement-packages.ts');
  const {createSharedWordPreparation}=await import('../server/word-content/shared-preparation.ts');
  const custom=teachingSenseSetKey(['b','c']);
  const original=getSharedWordIntroductionContent('word',custom)!;
  const packageId=getSharedWordTeachingPackageId('word',custom)!;
  const defaultPackage=getSharedWordTeachingPackageId('word');
  sql.prepare("UPDATE word_introduction_preparation SET active_stage='teaching',lease_token='default-repair',lease_expires_at='2099-01-01T00:00:00.000Z' WHERE word_id='word' AND teaching_set_key='default'").run();
  const source=readPackageImprovementSource('teaching_package',packageId);
  const content={...original,examples:original.examples.map(e=>({...e,text:'工资与业绩挂钩。'}))};
  const proposed={content,package:source.editable.package};
  assert.deepEqual(validatePackageImprovement(source,proposed).errors,[]);
  assert.match(validatePackageImprovement(source,{...proposed,content:{...content,uses:content.uses.map((use,i)=>({...use,id:i===0?'different-sense':use.id}))}}).errors.join(' '),/teaching set/);
  sql.prepare("INSERT INTO content_improvement_cases VALUES('repair',1,'draft','teaching_package',?,'{}','2026-11-15')").run(packageId);
  sql.exec('BEGIN IMMEDIATE');
  let replacement:string;
  try{
    replacement=applyPackageImprovement(source,proposed,{actorId:'operator',caseId:'repair',now:new Date().toISOString()}).replacementSourceId!;
    sql.exec('COMMIT');
  }catch(error){sql.exec('ROLLBACK');throw error;}
  assert.notEqual(replacement,packageId);
  assert.equal(getSharedWordTeachingPackageId('word',custom),replacement);
  assert.equal(getSharedWordTeachingPackageId('word'),defaultPackage);
  const next=getSharedWordIntroductionContent('word',custom)!;
  assert.notEqual(next.id,original.id);
  assert.deepEqual(sql.prepare('SELECT source_use_id,sense_id,imported_sense_version FROM legacy_sense_imports WHERE source_content_id=? ORDER BY source_use_id').all(next.id),
    sql.prepare('SELECT source_use_id,sense_id,imported_sense_version FROM legacy_sense_imports WHERE source_content_id=? ORDER BY source_use_id').all(original.id));
  assert.equal(createSharedWordPreparation(provider).validatePreparedSource('word',custom).sourceContentId,next.id);
  owner(()=>assert.equal((resolveVocabularyTeaching('word',custom)!.intro.body as {sourcePackageId:string}).sourcePackageId,replacement));
  releaseSharedWordIntroductionStage('word','default-repair');
});

function choose(senseIds:string[],targetSenseId?:string) {
  const scope=resolveVocabularyLearnerSenseScope('word');
  return writeVocabularyLearnerSenseScope('word',{senseIds,targetSenseId,expectedStateVersion:scope.stateVersion!,
    expectedCatalogVersion:scope.catalogVersion,expectedSelectionVersion:scope.selectionVersion,surface:'test'});
}

test('explicit target uses exact teaching while an unchosen learner retains the old default lesson',()=>{
  owner(()=>{addVocabularyWord('word');choose(['c'],'c');});
  runWithLearnerId('other',()=>addVocabularyWord('word'));
  assert.equal(owner(()=>resolveLearnerTeachingSetKey('word')),'["c"]','default target missing from old source cannot reuse that lesson');
  assert.equal(owner(()=>resolveVocabularyTeaching('word')),null);
  assert.equal(runWithLearnerId('other',()=>resolveLearnerTeachingSetKey('word')),'default');
  assert.ok(runWithLearnerId('other',()=>resolveVocabularyTeaching('word')));
  owner(()=>{
    choose(['a','b'],'a');
    assert.equal(resolveLearnerTeachingSetKey('word'),'["a","b"]');
    assert.equal((resolveVocabularyTeaching('word')?.intro.body as {sourcePackageId:string}).sourcePackageId,getSharedWordTeachingPackageId('word'),
      'the exact requested scope can reuse the current default package');
    choose(['b','c'],'b');
    const packageId=getSharedWordTeachingPackageId('word','["b","c"]')!;
    assert.equal((resolveVocabularyTeaching('word')!.intro.body as {sourcePackageId:string}).sourcePackageId,packageId);
    assert.equal(getWordIntroductionLibrary('word')!.selectedPackageId,packageId);
    pinWordTeachingPackage('word',packageId);
    choose(['a'],'a');
    completeWordTeachingPackage('word',packageId);
    assert.equal(getWordIntroductionLibrary('word')!.selectedPackageId,packageId,'retained pin completes despite a later scope choice');
  });
});

test('reserve queues the learner set, shares its work, and becomes ready only after that package publishes',async()=>{
  const schedule=owner(()=>getVocabularyWordSchedule('word'));
  owner(()=>{
    updateVocabularyStashPriority('word',{forceTop:true});
    reconcileVocabularyPreparationReserve();
    assert.equal(resolveVocabularyTeaching('word'),null);
  });
  const key='["a"]';
  assert.equal(getWordPreparationWork('word','teaching',key)?.status,'queued');
  const first=getWordPreparationWork('word','teaching',key)!.workId;
  runWithLearnerId('other',()=>{
    choose(['a'],'a');updateVocabularyStashPriority('word',{forceTop:true});reconcileVocabularyPreparationReserve();
  });
  assert.equal(getWordPreparationWork('word','teaching',key)!.workId,first);
  const worker=createWordPreparationWorker({provider,providerWork:async work=>work(),controls:()=>({maintenanceMode:false,providerWorkEnabled:true})});
  try{await worker.drain();}finally{await worker.stop();}
  const firstLesson=owner(()=>resolveVocabularyTeaching('word'))!;
  assert.ok(firstLesson);
  assert.equal(firstLesson.intro.contentId,runWithLearnerId('other',()=>resolveVocabularyTeaching('word'))!.intro.contentId);
  owner(()=>{reconcileVocabularyPreparationReserve();assert.deepEqual(getVocabularyWordSchedule('word'),schedule);});
  assert.equal(sql.prepare("SELECT ready_at FROM learner_word_preparation_reserve WHERE learner_id='learner' AND word_id='word'").get()!.ready_at!==null,true);
});

test('operator set report counts shared packages and recorded invocation costs once',()=>{
  const key='["a"]';
  const attempt=sql.prepare(`SELECT a.attempt_id FROM word_preparation_attempts a JOIN word_preparation_work w USING(work_id)
    WHERE w.teaching_set_key=? ORDER BY a.started_at LIMIT 1`).get(key)!;
  const insert=sql.prepare(`INSERT INTO model_invocations(id,timestamp,provider,model,invocation_type,spend_usd,
    spend_source,status,actor_kind,actor_id,workflow_id) VALUES (?,'2026-11-15','fixture','fixture','teaching',?,?,
    'completed','service','fixture',?)`);
  insert.run('priced',0.15,'estimated',attempt.attempt_id);
  insert.run('unpriced',null,'unknown',attempt.attempt_id);
  const report=getTeachingSetReport();
  const row=report.sets.find(set=>set.setKey===key)!;
  assert.equal(row.packageCount,1);assert.equal(row.senseCount,1);assert.equal(row.invocationCount,2);
  assert.equal(row.recordedCostUsd,0.15);assert.equal(row.unpricedInvocationCount,1);
  assert.equal(report.sets.find(set=>set.setKey==='default')!.recordedCostUsd,null);
  assert.equal(report.sets.find(set=>set.setKey==='["b","c"]')!.packageCount,2,'historical repair packages are retained');
});

function resetDefaultTeaching(): void {
  sql.prepare("UPDATE word_introduction_preparation SET content_id=NULL,package_id=NULL WHERE word_id='word' AND teaching_set_key='default'").run();
  sql.prepare(`UPDATE word_preparation_work SET status='queued',source_content_id=NULL,attempt_count=0,last_error=NULL
    WHERE word_id='word' AND teaching_set_key='default'`).run();
}

test('exact default reuse excludes older and native lessons and retains the same source for recognition', async () => {
  const oldPackage=getSharedWordTeachingPackageId('word')!;
  const ownerOfExactChoice=<T>(work:()=>T)=>runWithLearnerId('exact',work);
  ownerOfExactChoice(()=>{ addVocabularyWord('word'); choose(['c'],'c'); updateVocabularyStashPriority('word',{forceTop:true}); });
  resetDefaultTeaching();
  const worker=createWordPreparationWorker({provider,providerWork:work=>work(),controls:()=>({maintenanceMode:false,providerWorkEnabled:true})});
  try {
    assert.equal(await worker.step(),true);
    ownerOfExactChoice(()=>reconcileVocabularyPreparationReserve());
    assert.equal(getWordPreparationWork('word','teaching','["c"]'),null,'matching default work is already queued');
    await worker.drain();
  } finally { await worker.stop(); }
  const currentPackage=getSharedWordTeachingPackageId('word')!;
  const currentSource=getSharedWordIntroductionContent('word')!;
  assert.notEqual(currentPackage,oldPackage);
  ownerOfExactChoice(()=>{
    const exercise=createVocabularyContent({contentId:'zz-native-exercise',kind:'exercise',payloadVersion:1,body:{prompt:'Recall a different use'},
      accessScope:'shared',availability:'active',originKind:'human',words:[{wordId:'word',relation:'target'}],exerciseType:'definition',
      skill:'production',exerciseRole:'teaching',assessment:{match:'prepared'},answers:[{wordId:'word',acceptedForms:['挂钩']}]},actor);
    createVocabularyContent({contentId:'zz-native-introduction',kind:'introduction',payloadVersion:1,body:{beats:[{text:'A different use'}]},
      accessScope:'shared',availability:'active',originKind:'human',words:[{wordId:'word',relation:'target'}],
      teachingExercises:[{exerciseId:exercise.contentId,exerciseVersion:exercise.version}]},actor);
    assert.deepEqual(getWordIntroductionLibrary('word')!.packages.map(entry=>entry.teaching.id),[currentPackage]);
    assert.throws(()=>pinWordTeachingPackage('word',oldPackage),/Eligible teaching package/);
    const teaching=resolveVocabularyTeaching('word');
    assert.equal((teaching?.intro.body as {sourcePackageId:string}).sourcePackageId,currentPackage);
    reconcileVocabularyPreparationReserve();
    const study=startVocabularyStudy();
    const payload=getVocabularySession(study.session.sessionId).context.payload!;
    const recognition=Object.values(payload.snapshots).find(snapshot=>snapshot.kind==='recognition'&&snapshot.role==='teaching');
    assert.equal(recognition?.body.wordReference?.id,currentSource.id);
    assert.deepEqual(recognition?.body.wordReference?.uses.map(use=>use.id),['c']);
    pinWordTeachingPackage('word',currentPackage);
    assert.equal(getWordIntroductionLibrary('word')?.selectedPackageId,currentPackage);
    assert.deepEqual(getWordIntroductionLibrary('word')!.packages.map(entry=>entry.teaching.id),[currentPackage]);
  });
  assert.equal(runWithLearnerId('other',()=>resolveVocabularyTeaching('word','default')?.intro.contentId),'zz-native-introduction');
});

test('a matching default bootstrap and then a paused default package leave ready concrete teaching usable', async () => {
  const key='["a"]';
  const concretePackage=getSharedWordTeachingPackageId('word',key)!;
  writeVocabularyDefaultUsefulSenses('word',2,['a'],actor);
  resetDefaultTeaching();
  const worker=createWordPreparationWorker({provider,providerWork:work=>work(),controls:()=>({maintenanceMode:false,providerWorkEnabled:true})});
  try { assert.equal(await worker.step(),true); } finally { await worker.stop(); }
  assert.deepEqual(getSharedWordIntroductionContent('word')!.uses.map(use=>use.id),['a']);
  assert.equal(getWordPreparationWork('word','teaching')?.status,'queued');
  runWithLearnerId('other',()=>{
    const resolvePackage=()=>(resolveVocabularyTeaching('word')?.intro.body as {sourcePackageId:string}).sourcePackageId;
    assert.equal(resolvePackage(),concretePackage);
    sql.prepare("UPDATE word_preparation_work SET status='paused' WHERE word_id='word' AND teaching_set_key='default' AND stage='teaching'").run();
    reconcileVocabularyPreparationReserve();
    assert.equal(resolvePackage(),concretePackage);
    assert.equal(getWordIntroductionLibrary('word')?.selectedPackageId,concretePackage);
    assert.ok(sql.prepare("SELECT ready_at FROM learner_word_preparation_reserve WHERE learner_id='other' AND word_id='word'").get()!.ready_at);
  });
});

test('sense changes preserve a completed Solidify warmup without requesting new teaching', () => {
  runWithLearnerId('other',()=>{
    const familiar=resolveVocabularyTeaching('word')!.intro;
    sql.exec("UPDATE service_controls SET enabled=0 WHERE control_key='timed_sessions'");
    let study=startVocabularyStudy();
    const sessionId=study.session.sessionId;
    assert.equal(study.currentEncounter?.snapshot.contentId,familiar.contentId);
    for(let index=0;index<6;index+=1) {
      study=nextVocabularyExercise(sessionId,`next-${index}`);
      assert.equal(study.currentEncounter?.snapshot.role,'teaching');
      study=commandVocabularyStudy(sessionId,`answer-${index}`,study.currentEncounter?.snapshot.kind==='recognition'
        ? {type:'response',response:null,selfAssessment:'accepted'} : {type:'response',response:'挂钩'});
    }
    assert.equal(study.session.projection.words.word.teachingCompleted,true);
    study=commandVocabularyStudy(sessionId,'finish',{type:'finishForNow'});
    if(study.session.projection.phase==='finishing') study=commandVocabularyStudy(sessionId,'finish-now',{type:'finishImmediately'});
    const completion=stageVocabularySessionCompletion(sessionId,study.session.actions.length);
    closeVocabularySessionCompletion(sessionId,completion.completionId);
    assert.equal(getVocabularyLearnerWord('word')?.mode,'solidify');
    const schedule=getVocabularyWordSchedule('word');
    const warmup=()=>composeVocabularySessionPayload({sessionId:'familiar-warmup',words:[{wordId:'word',mode:'solidify'}]}).words.word;
    choose(['b','c'],'b');
    assert.notEqual(resolveVocabularyTeaching('word')?.intro.contentId,familiar.contentId,'another lesson is ready for this selection');
    assert.equal(warmup().priming?.contentId,familiar.contentId);
    choose(['c'],'c');
    reconcileVocabularyPreparationReserve();
    const payload=warmup();
    assert.equal(payload.priming?.contentId,familiar.contentId);
    assert.equal(payload.teaching,null);
    assert.equal(getWordPreparationWork('word','teaching','["c"]'),null);
    assert.deepEqual(getVocabularyWordSchedule('word'),schedule);
    sql.prepare('INSERT INTO learner_content_deactivations VALUES (?,?,?)').run('other',familiar.contentId,new Date().toISOString());
    assert.equal(warmup().priming,null,'deactivated material is no longer used for a new warmup');
  });
});
