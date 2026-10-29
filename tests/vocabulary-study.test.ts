import type { Express, Request, Response } from 'express';
import { registerVocabularyStudyRoutes } from '../server/vocabulary/study-routes.ts';
import type { VocabularySessionInitialContext } from '../src/domain/vocabulary-session.ts';
import { selectVocabularyPureCueCandidates } from '../server/vocabulary/pure-cue-serving.ts';
import { selectPureCuesForSession } from '../src/domain/pure-cues.ts';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach,afterEach,test } from 'node:test';
import { setDb } from '../server/db/connection.ts';
import { runWithLearnerId } from '../server/db/learner-context.ts';
import { adoptVocabularyPureCues } from '../server/vocabulary/pure-cue-serving.ts';
import { createVocabularyContent,replaceVocabularyContent,updateVocabularyContent,getVocabularyContent,createVocabularySense,establishVocabularySenseCatalog,getVocabularySenseCatalog } from '../server/db/vocabulary-content.ts';
import { createVocabularySession as createStoredSession,stageVocabularySessionCompletion,cancelVocabularySessionCompletion,closeVocabularySessionCompletion } from '../server/db/vocabulary-sessions.ts';
import { addVocabularyWord,dismissVocabularyWord,getVocabularyLearnerWord,getVocabularyWordSchedule,enrollVocabularyDietWord } from '../server/db/vocabulary-learners.ts';
import { startVocabularyStudy as startRuntime,composeVocabularySessionPayload,previewVocabularyStudy as previewRuntime,getVocabularyStudy,nextVocabularyExercise,commandVocabularyStudy } from '../server/vocabulary/study.ts';
import type { VocabularyStudy } from '../src/domain/vocabulary-study-api.ts';
import type { VocabularyContent } from '../src/domain/vocabulary-content.ts';
// These player fixtures isolate composition from shared-provider reserve storage.
const startVocabularyStudy=(options:Parameters<typeof startRuntime>[0]={})=>startRuntime({prepareReserve:()=>{},...options});
const previewVocabularyStudy=(options:Parameters<typeof previewRuntime>[0]={})=>previewRuntime({prepareReserve:()=>{},...options});
let db:DatabaseSync;
const owner=<T>(fn:()=>T)=>runWithLearnerId('alice',fn);
const actor={kind:'operator' as const,id:'test'};
function createVocabularySession(context:VocabularySessionInitialContext) {
  const reviewOrder=context.reviewOrder??selectVocabularyPureCueCandidates({ordinaryReviewCount:context.words.filter(word=>word.mode==='practice'||word.mode==='maintain').length,sessionSeed:context.sessionId})
    .map(cue=>({kind:'pure_cue' as const,id:cue.contentId}));
  const frozen={...context,reviewOrder};
  return createStoredSession({...frozen,payload:composeVocabularySessionPayload(frozen)});
}
function exercise(id:string,wordId:string,role:'teaching'|'general'='general',pure=false):VocabularyContent {
  if(role==='teaching'&&getVocabularySenseCatalog(wordId).establishedAt===null) {
    createVocabularySense({wordId,description:{label:`Use of ${wordId}`}},actor);
    establishVocabularySenseCatalog(wordId,getVocabularySenseCatalog(wordId).version,actor);
  }
  return createVocabularyContent({contentId:id,kind:'exercise',payloadVersion:1,body:{prompt:`Retrieve ${id}`},
    accessScope:'shared',availability:'active',originKind:'human',words:[{wordId,relation:'target'}],exerciseType:pure?'pure_cue':'word',
    skill:'production',exerciseRole:role,assessment:{match:'prepared'},answers:[{wordId,acceptedForms:[wordId==='a'?'甲':wordId==='b'?'乙':'新']}]},actor);
}
beforeEach(()=>{
  db=new DatabaseSync(':memory:');setDb(db);db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE learners(learner_id TEXT PRIMARY KEY);
    CREATE TABLE learner_word_preparation_reserve(learner_id TEXT,word_id TEXT,added_at TEXT,PRIMARY KEY(learner_id,word_id));
    CREATE TABLE learner_word_reserve_requests(learner_id TEXT PRIMARY KEY,requested_at TEXT);
    CREATE TABLE learner_owned_review_session_summaries(learner_id TEXT,session_id TEXT,PRIMARY KEY(learner_id,session_id));
    CREATE TABLE lexical_words(id TEXT PRIMARY KEY,hanzi TEXT,traditional TEXT,pinyin TEXT,meaning TEXT,created_at TEXT,priority INTEGER DEFAULT 0);
    CREATE TABLE learner_settings(learner_id TEXT,setting_key TEXT,value_json TEXT,updated_at TEXT,PRIMARY KEY(learner_id,setting_key));
    CREATE TABLE learner_owned_daily_new_word_intake(learner_id TEXT,day_key TEXT,new_study_count INTEGER);
    INSERT INTO learner_settings VALUES('alice','unstudied_admission_source','"stash_only"','2026-01-01'),('alice','study_introduction_order','"first"','2026-01-01');
    CREATE TABLE learner_word_state(learner_id TEXT,word_id TEXT,status TEXT,learning_streak INTEGER,last_learning_covered_on TEXT);
    CREATE TABLE learner_owned_user_word_priority(learner_id TEXT,word_id TEXT,priority_tier INTEGER,updated_at TEXT);
    CREATE TABLE learner_owned_word_skill_state(learner_id TEXT,word_id TEXT,skill_id TEXT,interval_hours REAL,ease_factor REAL,enabled INTEGER,next_due_at TEXT,last_studied_at TEXT,PRIMARY KEY(learner_id,word_id,skill_id));
    CREATE TABLE learner_owned_word_skill_relevance(learner_id TEXT,word_id TEXT,skill_id TEXT,relevance_state TEXT,PRIMARY KEY(learner_id,word_id,skill_id));
    CREATE TABLE learner_owned_word_study_admission_state(learner_id TEXT,word_id TEXT,study_phase TEXT,earliest_next_study_at TEXT,PRIMARY KEY(learner_id,word_id));
    INSERT INTO learners VALUES('alice'),('bob');
    INSERT INTO lexical_words(id,hanzi,traditional,pinyin,meaning,created_at) VALUES('a','甲',NULL,'jiǎ','first','2026-01-01'),('b','乙',NULL,'yǐ','second','2026-01-02'),('new','新',NULL,'xīn','new','2026-01-03');
    INSERT INTO learner_word_state VALUES('alice','a','learning',2,NULL),('alice','b','review',0,NULL),('alice','new','unstudied',0,NULL);
    ALTER TABLE learner_word_state ADD COLUMN personal_notes TEXT NOT NULL DEFAULT '';
  `);
  for(const file of ['0039_vocabulary_content.sql','0041_vocabulary_learner_state.sql','0042_vocabulary_sessions.sql','0047_vocabulary_dismissal.sql','0052_vocabulary_automatic_promotion_pause.sql','0023_session_debrief.sql','0048_vocabulary_connections.sql'])db.exec(fs.readFileSync(new URL(`../server/db/migrations/${file}`,import.meta.url),'utf8'));
  owner(()=>{
    exercise('general-1','a');exercise('general-2','a');exercise('teach-a','a','teaching');exercise('teach-new','new','teaching');
    for(const [wordId,contentId] of [['a','intro-a'],['new','intro-new']])createVocabularyContent({contentId,kind:'introduction',payloadVersion:1,
      body:{beats:[{kind:'explanation',text:`Introduction ${wordId}`}]},accessScope:'shared',availability:'active',originKind:'human',words:[{wordId,relation:'target'}],
      teachingExercises:[{exerciseId:wordId==='a'?'teach-a':'teach-new',exerciseVersion:1}]},actor);
  });
});
afterEach(()=>db.close());

test('Home preview counts the same final admission as Start without session, enrollment, baseline or schedule writes',()=>owner(()=>{
  addVocabularyWord('new');
  exercise('preview-unadopted','b','general',true);
  const snapshot=()=>JSON.stringify((db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as {name:string}[])
    .map(({name})=>({name,rows:db.prepare(`SELECT * FROM "${name.replaceAll('"','""')}"`).all()})));
  const before=snapshot();const changes=db.prepare('SELECT total_changes() AS n').get()!.n;
  const preview=previewVocabularyStudy({requestTeaching:()=>{}});
  assert.equal(snapshot(),before);assert.equal(db.prepare('SELECT total_changes() AS n').get()!.n,changes);
  const started=startVocabularyStudy({previewSeed:preview.previewSeed,requestTeaching:()=>{}});
  const count=started.session.context.words.length+(started.session.context.reviewOrder??[]).filter((entry)=>entry.kind==='pure_cue').length;
  assert.equal(preview.itemCount,count);assert.ok(count>0);
  assert.notEqual(started.session.sessionId,preview.previewSeed);
}));

test('Home preview refreshes zero readiness and current settings, retaining bounded preparation demand',()=>owner(()=>{
  addVocabularyWord('new');
  db.prepare("UPDATE learner_word_schedules SET next_eligible_at='2999-01-01T00:00:00.000Z' WHERE word_id!='new'").run();
  db.prepare("UPDATE content_items SET availability='retired' WHERE content_id='intro-new'").run();
  const requested:string[]=[];
  const empty=previewVocabularyStudy({requestTeaching:(id)=>requested.push(id)});
  assert.equal(empty.itemCount,0);assert.equal(empty.preparationPending,true);assert.ok(requested.includes('new'));
  const beforeFailure=db.prepare('SELECT total_changes() AS n').get()!.n;
  assert.throws(()=>previewVocabularyStudy({requestTeaching:()=>{throw new Error('Preparation unavailable');}}),/Preparation unavailable/);
  assert.equal(db.prepare('SELECT total_changes() AS n').get()!.n,beforeFailure);
  db.prepare("INSERT OR REPLACE INTO learner_settings VALUES('alice','daily_new_word_limit','0','2026-10-24')").run();
  const limited=previewVocabularyStudy({requestTeaching:()=>{throw new Error('Quota zero must not request preparation');}});
  assert.equal(limited.itemCount,0);assert.equal(limited.preparationPending,false);
}));

test('preview does not count teaching whose generated recognition baseline is deactivated',()=>owner(()=>{
  addVocabularyWord('new');
  db.prepare("UPDATE learner_word_schedules SET next_eligible_at='2999-01-01T00:00:00.000Z' WHERE word_id!='new'").run();
  const id='vocabulary:baseline:v1:shared:recognition:teaching:new';
  createVocabularyContent({contentId:id,kind:'exercise',payloadVersion:1,body:{prompt:'新'},exerciseType:'recognition',skill:'recognition',exerciseRole:'teaching',
    accessScope:'shared',availability:'active',originKind:'human',assessment:{responseMode:'self_assessment'},
    words:[{wordId:'new',relation:'target'}],answers:[{wordId:'new',acceptedForms:['新']}]},actor);
  db.prepare("INSERT INTO learner_content_deactivations VALUES('alice',?,'2026-10-24T00:00:00.000Z')").run(id);
  const preview=previewVocabularyStudy({requestTeaching:()=>{}});
  assert.equal(preview.itemCount,0);
  assert.throws(()=>startVocabularyStudy({previewSeed:preview.previewSeed,requestTeaching:()=>{}}),/introductions are being prepared/);
}));

test('preview and Start reuse the same fractional pure-cue draw without adopting or updating schedules during preview',()=>owner(()=>{
  // Main's daily maintenance gate is stable across session seeds. Choose an
  // actually qualifying identity before exercising only the fractional ceiling.
  let strongId='';const day=new Date().toISOString();
  for(let index=0;index<10000;index++) {
    const id=`preview-strong-${index}`;
    if(selectPureCuesForSession({learnerId:'alice',ordinaryReviewCount:10,now:day,random:()=>0,cues:[{
      id,kind:'pure',stimulus:'',axisNote:'',teachingNote:'',acceptedWordIds:['b'],active:true,intervalHours:24,easeFactor:2.5,
      lastStudiedAt:'2020-01-01T00:00:00.000Z',nextDueAt:'2020-01-01T00:00:00.000Z',strongSince:'2020-01-01T00:00:00.000Z',strongSuccesses:1,
    }]}).strong.length) {strongId=id;break;}
  }
  assert.ok(strongId,'fixture requires a qualifying maintenance candidate');
  exercise('preview-fragile','b','general',true);exercise(strongId,'b','general',true);
  adoptVocabularyPureCues();
  db.prepare("UPDATE learner_pure_cue_schedules SET next_eligible_at='2020-01-01T00:00:00.000Z',last_practised_at='2020-01-01T00:00:00.000Z'").run();
  db.prepare("UPDATE learner_pure_cue_schedules SET scheduler_state_json=json_set(scheduler_state_json,'$.strongSince','2020-01-01T00:00:00.000Z','$.strongSuccesses',1) WHERE content_id=?").run(strongId);
  const before=JSON.stringify(db.prepare('SELECT * FROM learner_pure_cue_schedules ORDER BY content_id').all());
  const counts=new Set<number>();let chosen:ReturnType<typeof previewVocabularyStudy>|undefined;
  for(let index=0;index<50;index++) {
    const seed=`00000000-0000-4000-8000-${String(index).padStart(12,'0')}`;
    const preview=previewVocabularyStudy({previewSeed:seed,requestTeaching:()=>{}});counts.add(preview.itemCount);
    if(chosen===undefined||preview.itemCount>chosen.itemCount)chosen=preview;
  }
  assert.equal(counts.size,2);assert.ok(chosen);
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM learner_pure_cue_schedules ORDER BY content_id').all()),before);
  const started=startVocabularyStudy({previewSeed:chosen.previewSeed,requestTeaching:()=>{}});
  assert.equal(chosen.itemCount,started.session.context.words.length+(started.session.context.reviewOrder??[]).filter((entry)=>entry.kind==='pure_cue').length);
  assert.ok(started.session.context.reviewOrder?.some((entry)=>entry.id===strongId));
}));

function focusedA(mode:'solidify'|'practice'='practice'):VocabularyStudy {
  db.prepare("UPDATE learner_words SET mode=? WHERE word_id='a'").run(mode);
  createVocabularySession({sessionId:'focused-a',words:[{wordId:'a',mode,selectedSkill:'production'}]});
  return nextVocabularyExercise('focused-a','initial');
}
function productionExercise(id:string,key:string):VocabularyStudy {
  let view=nextVocabularyExercise(id,`${key}-next`,{wordId:'a'});
  for(let index=0;index<24&&(view.currentEncounter?.snapshot.kind!=='production'||(view.session.projection.words.a.mode==='solidify'&&view.session.projection.words.a.skillProgress.recognition.acceptedResponses===0));index++) {
    if(view.currentEncounter?.snapshot.kind==='recognition')
      commandVocabularyStudy(id,`${key}-recognize-${index}`,{type:'response',response:null,selfAssessment:'accepted'});
    else assert.ok(view.currentEncounter?.snapshot.kind==='introduction'||view.currentEncounter?.snapshot.kind==='production');
    view=nextVocabularyExercise(id,`${key}-next-${index}`,{wordId:'a'});
  }
  assert.equal(view.currentEncounter?.snapshot.kind,'production');return view;
}

test('study serves current learner personal notes without freezing them into content or sharing them',()=>{
  db.prepare("UPDATE learner_word_state SET personal_notes='Alice remembers this' WHERE learner_id='alice' AND word_id='a'").run();
  db.prepare("INSERT INTO learner_word_state(learner_id,word_id,status,learning_streak,personal_notes) VALUES('bob','a','review',0,'Bob has another note')").run();
  owner(()=>{
    const view=focusedA();
    assert.equal(view.words.find((word)=>word.wordId==='a')?.personalNotes,'Alice remembers this');
    assert.doesNotMatch(JSON.stringify(view.currentEncounter?.snapshot),/Alice remembers this|Bob has another note/);
    db.prepare("UPDATE learner_word_state SET personal_notes='Edited after the encounter' WHERE learner_id='alice' AND word_id='a'").run();
    assert.equal(getVocabularyStudy(view.session.sessionId).words.find((word)=>word.wordId==='a')?.personalNotes,'Edited after the encounter');
  });
  runWithLearnerId('bob',()=>{
    enrollVocabularyDietWord('a');
    createVocabularySession({sessionId:'bob-notes',words:[{wordId:'a',mode:'practice'}]});
    const view=getVocabularyStudy('bob-notes');
    assert.equal(view.words[0]?.personalNotes,'Bob has another note');
  });
});


test('Solidify primes once, then serves exclusively general exercises and applies no learning writes before closure',()=>owner(()=>{
  let view=focusedA('solidify');const id=view.session.sessionId;const before=getVocabularyWordSchedule('a');
  assert.equal(view.currentWordId,'a');assert.equal(view.currentEncounter?.snapshot.role,'priming');
  assert.equal(view.currentEncounter?.snapshot.kind,'introduction');
  view=productionExercise(id,'next-1');assert.equal(view.currentEncounter?.snapshot.role,'general');
  assert.ok(['general-1','general-2'].includes(view.currentEncounter!.snapshot.contentId));
  assert.equal(view.session.projection.words.a.skillProgress.recognition.acceptedResponses,1);
  assert.equal(view.session.projection.words.a.covered,false);
  view=commandVocabularyStudy(id,'response-1',{type:'response',response:' 甲！ '});
  assert.equal(view.currentEncounter?.effectiveResponses[0].payload.outcome,'accepted');
  assert.equal(view.session.projection.words.a.workStatus,'wrapped');
  assert.equal(view.session.projection.words.a.recommendedMode,'practice');
  assert.deepEqual(getVocabularyWordSchedule('a'),before);assert.equal(getVocabularyLearnerWord('a')?.mode,'solidify');
  view=commandVocabularyStudy(id,'finish',{type:'finishForNow'});assert.equal(view.session.projection.phase,'completed');
  const staged=stageVocabularySessionCompletion(id,view.session.actions.length);closeVocabularySessionCompletion(id,staged.completionId);
  assert.equal(getVocabularyLearnerWord('a')?.mode,'practice');
}));

test('server command retries preserve evidence once and reject reused IDs with changed input',()=>owner(()=>{
  let view=focusedA();const id=view.session.sessionId;nextVocabularyExercise(id,'next',{wordId:'a'});
  view=commandVocabularyStudy(id,'answer',{type:'response',response:'甲'});const count=view.session.actions.length;
  assert.equal(commandVocabularyStudy(id,'answer',{type:'response',response:'甲'}).session.actions.length,count);
  assert.throws(()=>commandVocabularyStudy(id,'answer',{type:'response',response:'乙'}),/different input/);
  assert.equal(nextVocabularyExercise(id,'next',{wordId:'a'}).session.actions.length,count);
}));

test('skips before answers retain exact encounters and feedback without creating recall success',()=>owner(()=>{
  let view=focusedA();const id=view.session.sessionId;view=nextVocabularyExercise(id,'next',{wordId:'a'});
  const skipped=view.currentEncounter!.encounterId;
  commandVocabularyStudy(id,'feedback',{type:'feedback',feedback:'negative',comment:'Ambiguous'});
  commandVocabularyStudy(id,'skip',{type:'skip'});view=nextVocabularyExercise(id,'another',{another:true});
  const evidence=view.session.projection.encounters.find((entry)=>entry.encounterId===skipped)!;
  assert.equal(evidence.skipped,true);assert.equal(evidence.responses.length,0);assert.equal(evidence.feedback.length,1);
  assert.equal(view.session.projection.words.a.covered,false);
}));

test('rejected work stays open and another accepted general answer ends the default work',()=>owner(()=>{
  let view=focusedA('solidify');const id=view.session.sessionId;view=productionExercise(id,'next-1');
  const first=view.currentEncounter!.snapshot.contentId;commandVocabularyStudy(id,'miss',{type:'response',response:'wrong'});
  view=productionExercise(id,'next-2');assert.notEqual(view.currentEncounter!.snapshot.contentId,first);
  view=commandVocabularyStudy(id,'pass',{type:'response',response:'甲'});
  assert.equal(view.session.projection.words.a.workStatus,'wrapped');assert.equal(view.session.projection.words.a.covered,true);
  assert.equal(view.session.projection.words.a.successfulRecall,true);assert.equal(view.session.projection.words.a.recommendedMode,null);
}));

test('Undo reverses a final answer together with its automatic wrap while retaining raw observations',()=>owner(()=>{
  let view=focusedA('solidify');const id=view.session.sessionId;productionExercise(id,'next-1');
  view=commandVocabularyStudy(id,'answer-1',{type:'response',response:'甲'});assert.equal(view.session.projection.words.a.workStatus,'wrapped');
  view=commandVocabularyStudy(id,'undo',{type:'undo'});assert.equal(view.session.projection.words.a.workStatus,'open');
  assert.equal(view.session.projection.words.a.productionResponses,0);
  assert.equal(view.currentEncounter?.responses.length,1);assert.equal(view.currentEncounter?.effectiveResponses.length,0);
}));

test('word-level baseline keeps Maintain usable without inventing curation or using exploratory pool',()=>owner(()=>{
  db.prepare("UPDATE learner_words SET mode='maintain' WHERE word_id='b'").run();
  createVocabularySession({sessionId:'maintain',words:[{wordId:'b',mode:'maintain'}]});
  let view=nextVocabularyExercise('maintain','next');
  assert.match(view.currentEncounter!.snapshot.contentId,/baseline.*production/);
  assert.equal(db.prepare("SELECT count(*) AS n FROM content_mode_suitability WHERE suitability='curated'").get()?.n,0);
  assert.equal(db.prepare("SELECT count(*) AS n FROM backend_events WHERE name='vocabulary.maintain.baseline_selected'").get()?.n,1);
  view=commandVocabularyStudy('maintain','mode',{type:'mode',mode:'practice'});
  assert.equal(view.session.projection.words.b.mode,'practice');assert.equal(getVocabularyLearnerWord('b')?.mode,'maintain');
}));

test('dictionary baselines are shared across learners without duplicating the repertoire or sharing learner controls',()=>{
  const context=(sessionId:string):VocabularySessionInitialContext=>({sessionId,words:[{wordId:'b',mode:'practice'}]});
  const schedules=db.prepare('SELECT * FROM learner_word_schedules ORDER BY learner_id,word_id').all();
  const alice=owner(()=>composeVocabularySessionPayload(context('alice-baseline')));
  const bob=runWithLearnerId('bob',()=>composeVocabularySessionPayload(context('bob-baseline')));
  const productionId='vocabulary:baseline:v1:shared:production:general:b';
  const recognitionId='vocabulary:baseline:v1:shared:recognition:general:b';
  for(const payload of [alice,bob]) {
    const exercises=payload.words.b.general.practice;
    assert.deepEqual(exercises.map(content=>content.contentId).sort(),[productionId,recognitionId]);
    assert.ok(exercises.every(content=>content.accessScope==='shared'&&content.ownerLearnerId===null));
  }
  assert.equal(db.prepare("SELECT count(*) AS n FROM content_items WHERE json_extract(body_json,'$.source.kind')='dictionary_baseline'").get()?.n,2);
  db.prepare("INSERT INTO learner_content_deactivations VALUES('alice',?,'2026-10-28T00:00:00.000Z')").run(productionId);
  db.prepare("INSERT INTO learner_owned_word_skill_state VALUES('alice','b','recognition',24,2.5,0,NULL,NULL)").run();
  const aliceAfter=owner(()=>composeVocabularySessionPayload(context('alice-disabled')));
  const bobAfter=runWithLearnerId('bob',()=>composeVocabularySessionPayload(context('bob-unchanged')));
  assert.deepEqual(aliceAfter.words.b.general.practice,[]);
  assert.deepEqual(bobAfter.words.b.general.practice.map(content=>content.contentId).sort(),[productionId,recognitionId]);
  assert.deepEqual(db.prepare('SELECT * FROM learner_word_schedules ORDER BY learner_id,word_id').all(),schedules);
});

test('migrated baseline identities preserve deactivation and do not duplicate shared fallback copies',()=>owner(()=>{
  const legacyId='vocabulary:baseline:v1:alice:production:general:b';
  const canonicalId='vocabulary:baseline:v1:shared:production:general:b';
  const draft={kind:'exercise' as const,payloadVersion:1,body:{prompt:'second',source:{kind:'dictionary_baseline',wordId:'b'}},
    accessScope:'shared' as const,availability:'active' as const,originKind:'human' as const,exerciseType:'definition',skill:'production' as const,
    exerciseRole:'general' as const,assessment:{match:'prepared_answer_membership'},words:[{wordId:'b',relation:'target' as const}],answers:[{wordId:'b',acceptedForms:['乙']}]};
  createVocabularyContent({...draft,contentId:legacyId},actor);
  createVocabularyContent({...draft,contentId:canonicalId},actor);
  const context:VocabularySessionInitialContext={sessionId:'migrated-baselines',words:[{wordId:'b',mode:'practice'}]};
  const payload=composeVocabularySessionPayload(context);
  assert.deepEqual(payload.words.b.general.practice.filter(content=>content.kind==='exercise'&&content.skill==='production').map(content=>content.contentId),[legacyId]);
  db.prepare("INSERT INTO learner_content_deactivations VALUES('alice',?,'2026-10-28T00:00:00.000Z')").run(legacyId);
  const disabled=composeVocabularySessionPayload({...context,sessionId:'migrated-disabled'});
  assert.equal(disabled.words.b.general.practice.some(content=>content.kind==='exercise'&&content.skill==='production'),false);
  const bob=runWithLearnerId('bob',()=>composeVocabularySessionPayload({...context,sessionId:'canonical-bob'}));
  assert.deepEqual(bob.words.b.general.practice.filter(content=>content.kind==='exercise'&&content.skill==='production').map(content=>content.contentId),[canonicalId]);
  db.prepare("DELETE FROM learner_content_deactivations WHERE learner_id='alice' AND content_id=?").run(legacyId);
  db.prepare("UPDATE content_items SET availability='retired' WHERE content_id=?").run(legacyId);
  const retired=composeVocabularySessionPayload({...context,sessionId:'migrated-retired'});
  assert.equal(retired.words.b.general.practice.some(content=>content.kind==='exercise'&&content.skill==='production'),false);
}));

test('Unstudied teaching requires delivered introduction, self-assessed recognition and successful teaching production',()=>owner(()=>{
  // Limit this session to the new word while retaining real learner state.
  const recognitionId='vocabulary:baseline:v1:shared:recognition:teaching:new';
  createVocabularySession({sessionId:'new-session',words:[{wordId:'new',mode:'unstudied',teachingRequirements:{introductionContentId:'intro-new',
    requiredExerciseContentIds:[recognitionId,'teach-new'],minimumRecognitionResponses:1,minimumProductionResponses:1}}]});
  let view=nextVocabularyExercise('new-session','intro');assert.equal(view.currentEncounter?.snapshot.kind,'introduction');
  let firstRecognition:VocabularyStudy['currentEncounter']=null;
  for(let index=0;index<6;index++) {
    view=nextVocabularyExercise('new-session',`exercise-${index}`);
    assert.equal(view.currentEncounter?.snapshot.role,'teaching');
    if(view.currentEncounter?.snapshot.kind==='recognition') {
      view=commandVocabularyStudy('new-session',`answer-${index}`,{type:'response',response:null,selfAssessment:'accepted'});
      firstRecognition??=view.currentEncounter;
    } else view=commandVocabularyStudy('new-session',`answer-${index}`,{type:'response',response:'新'});
    assert.equal(view.session.projection.words.new.teachingCompleted,index===5);
  }
  assert.equal(firstRecognition?.effectiveResponses[0].payload.response,null);
  assert.equal(view.session.projection.words.new.teachingCompleted,true);assert.equal(getVocabularyLearnerWord('new')?.mode,'unstudied');
}));

test('independent pure cues expose no selected word and never credit their accepted answer word',()=>owner(()=>{
  const cue=exercise('pure','b','general',true);
  db.prepare(`INSERT INTO learner_pure_cue_schedules(learner_id,content_id,policy_version,scheduler_state_json) VALUES('alice',?,'test',?)`)
    .run(cue.contentId,JSON.stringify({intervalHours:24,easeFactor:2.5,enabled:1,cleanCoveredSessions:0}));
  createVocabularySession({sessionId:'pure-session',words:[]});
  let view=nextVocabularyExercise('pure-session','next');assert.equal(view.currentWordId,null);assert.deepEqual(view.words,[]);
  assert.equal(view.currentEncounter?.snapshot.schedulingScope,'pure_cue');
  view=commandVocabularyStudy('pure-session','response',{type:'response',response:'乙'});
  assert.deepEqual(view.session.projection.coveredWordIds,[]);assert.equal(view.session.projection.pureCueOutcomes[0].covered,true);
}));

test('session ownership stays live while content deactivation and skill suppression affect later admission',()=>{
  const view=owner(()=>{db.prepare("UPDATE learner_words SET mode='practice' WHERE word_id='a'").run();createVocabularySession({sessionId:'access-freeze',words:[{wordId:'a',mode:'practice'},{wordId:'b',mode:'practice'}]});return getVocabularyStudy('access-freeze');});
  runWithLearnerId('bob',()=>assert.throws(()=>getVocabularyStudy(view.session.sessionId),/not found/));
  owner(()=>{
    db.prepare("INSERT INTO learner_owned_word_skill_state VALUES('alice','b','production',24,2.5,0,NULL,NULL)").run();
    db.prepare("INSERT INTO learner_content_deactivations VALUES('alice','general-1','2026-10-17T00:00:00.000Z')").run();
    const next=nextVocabularyExercise(view.session.sessionId,'next',{wordId:'a'});
    assert.equal(next.currentEncounter?.snapshot.contentId,'general-1');
    const retained=nextVocabularyExercise(view.session.sessionId,'b',{wordId:'b'});
    assert.equal(retained.currentWordId,'b');
    const fresh=startVocabularyStudy();
    assert.ok(!fresh.session.context.words.some(word=>word.wordId==='b'));
    assert.notEqual(nextVocabularyExercise(fresh.session.sessionId,'a',{wordId:'a'}).currentEncounter?.snapshot.contentId,'general-1');
  });
});

test('recognition can be due while production is suppressed and produces no production credit',()=>owner(()=>{
  db.prepare("INSERT INTO learner_owned_word_skill_state VALUES('alice','b','production',48,2.5,0,NULL,NULL),('alice','b','recognition',96,2.5,1,NULL,NULL)").run();
  db.prepare("UPDATE learner_word_schedules SET scheduler_state_json=json_set(scheduler_state_json,'$.enabled',0) WHERE word_id='b'").run();
  let view=startVocabularyStudy();const id=view.session.sessionId;
  assert.equal(view.session.context.words.find((word)=>word.wordId==='b')?.selectedSkill,'recognition');
  const before=getVocabularyWordSchedule('b');
  view=nextVocabularyExercise(id,'recognition-only',{wordId:'b'});assert.equal(view.currentEncounter?.snapshot.kind,'recognition');
  view=commandVocabularyStudy(id,'recognized',{type:'response',response:null,selfAssessment:'accepted'});
  assert.equal(view.session.projection.words.b.covered,true);assert.equal(view.session.projection.words.b.workStatus,'wrapped');
  view=commandVocabularyStudy(id,'finish',{type:'finishForNow'});
  if(view.session.projection.phase==='finishing')view=commandVocabularyStudy(id,'immediate',{type:'finishImmediately'});
  const staged=stageVocabularySessionCompletion(id,view.session.actions.length);closeVocabularySessionCompletion(id,staged.completionId);
  assert.deepEqual(getVocabularyWordSchedule('b'),before);
  assert.equal(db.prepare("SELECT count(*) AS n FROM learner_state_effects WHERE kind='recognition_outcome' AND word_id='b'").get()?.n,1);
}));

test('Undo of another restores prior exercise while preserving feedback on the undone presentation',()=>owner(()=>{
  const start=focusedA();const id=start.session.sessionId;
  const first=nextVocabularyExercise(id,'first',{wordId:'a'}).currentEncounter!;
  const second=nextVocabularyExercise(id,'another',{another:true}).currentEncounter!;
  commandVocabularyStudy(id,'feedback',{type:'feedback',feedback:'negative',comment:'Retain this observation'});
  const undone=commandVocabularyStudy(id,'undo',{type:'undo'});
  assert.equal(undone.currentEncounter?.encounterId,first.encounterId);
  assert.equal(undone.currentEncounter?.skipped,false);
  const retained=undone.session.projection.encounters.find((entry)=>entry.encounterId===second.encounterId)!;
  assert.equal(retained.presentationUndone,true);assert.equal(retained.feedback.length,1);
}));


test('dismissed unstudied words cannot re-enter through recognition-only admission',()=>owner(()=>{
  db.prepare("INSERT INTO learner_owned_word_skill_state VALUES('alice','b','recognition',24,2.5,1,NULL,NULL)").run();
  const before=getVocabularyWordSchedule('b');dismissVocabularyWord('b');
  const view=startVocabularyStudy();
  assert.equal(view.session.context.words.some((word)=>word.wordId==='b'),false);
  assert.deepEqual(getVocabularyWordSchedule('b'),before);
  assert.equal(db.prepare("SELECT enabled FROM learner_owned_word_skill_state WHERE word_id='b' AND skill_id='recognition'").get()!.enabled,1);
}));

test('cancel then resume preserves acknowledged answers without opening a replacement completion',()=>owner(()=>{
  let view=focusedA();const id=view.session.sessionId;
  nextVocabularyExercise(id,'first',{wordId:'a'});commandVocabularyStudy(id,'answer',{type:'response',response:'甲'});
  view=commandVocabularyStudy(id,'finish',{type:'finishForNow'});
  if(view.session.projection.phase==='finishing')view=commandVocabularyStudy(id,'immediate',{type:'finishImmediately'});
  const before=view.session.actions.filter((action)=>action.kind==='response');
  const staged=stageVocabularySessionCompletion(id,view.session.actions.length);
  cancelVocabularySessionCompletion(id,staged.completionId);
  view=commandVocabularyStudy(id,'resume',{type:'resume'});
  assert.equal(view.session.projection.phase,'active');assert.equal(view.session.status,'active');
  assert.deepEqual(view.session.actions.filter((action)=>action.kind==='response'),before);
  assert.equal(db.prepare("SELECT count(*) AS n FROM vocabulary_session_completions WHERE status='pending'").get()?.n,0);
}));

function contrastContent(){return createVocabularyContent({contentId:'contrast',kind:'exercise',payloadVersion:1,
  body:{prompt:'Choose the expression for this context.',choices:[{wordId:'a',hanzi:'甲'},{wordId:'b',hanzi:'乙'}],reveal:{correctWordId:'a',explanation:'The first expression fits.'}},
  exerciseType:'contrast',skill:'production',exerciseRole:'general',assessment:{responseMode:'word_choice',correctWordId:'a'},
  accessScope:'shared',availability:'active',originKind:'import',words:[{wordId:'a',relation:'target'},{wordId:'b',relation:'context'}],answers:[{wordId:'a',acceptedForms:['甲']}]},actor);}

test('imported contrast uses selected identity and independent contextual schedule without production credit',()=>owner(()=>{
  contrastContent();db.prepare("INSERT INTO learner_owned_word_skill_state VALUES('alice','a','contextual_selection',6,2.5,1,NULL,NULL)").run();
  db.prepare("UPDATE learner_words SET mode='practice' WHERE word_id='a'").run();
  createVocabularySession({sessionId:'contrast-session',words:[{wordId:'a',mode:'practice',selectedSkill:'contextual_selection'}]});
  const before=getVocabularyWordSchedule('a');let view=nextVocabularyExercise('contrast-session','next');
  assert.equal(view.currentEncounter?.snapshot.kind,'contrast');assert.equal(view.currentEncounter?.snapshot.body.prompt,'Choose the expression for this context.');
  // Even a raw string matching the expected form cannot override the selected word identity.
  view=commandVocabularyStudy('contrast-session','choice',{type:'response',response:'甲',selectedWordId:'b'});
  assert.equal(view.currentEncounter?.effectiveResponses[0].payload.outcome,'rejected');assert.equal(view.currentEncounter?.effectiveResponses[0].payload.selectedWordId,'b');
  assert.equal(view.session.projection.words.a.productionResponses,0);assert.equal(view.session.projection.words.a.covered,false);
  assert.equal(db.prepare("SELECT interval_hours FROM learner_owned_word_skill_state WHERE skill_id='contextual_selection'").get()?.interval_hours,6);
  for(let index=0;index<3;index++) {
    view=nextVocabularyExercise('contrast-session',`reinforce-${index}`);
    assert.equal(view.currentEncounter?.snapshot.kind,'contrast');
    view=commandVocabularyStudy('contrast-session',`correct-${index}`,{type:'response',response:'甲',selectedWordId:'a'});
    assert.equal(view.session.projection.words.a.covered,index===2);
    assert.equal(view.session.projection.words.a.productionResponses,0);
  }
  view=commandVocabularyStudy('contrast-session','finish',{type:'finishForNow'});
  const staged=stageVocabularySessionCompletion('contrast-session',view.session.actions.length);
  const closed=closeVocabularySessionCompletion('contrast-session',staged.completionId,'2026-10-17T12:00:00.000Z');
  assert.deepEqual(getVocabularyWordSchedule('a'),before);
  assert.equal(db.prepare("SELECT next_due_at FROM learner_owned_word_skill_state WHERE skill_id='contextual_selection'").get()?.next_due_at,'2026-10-17T18:00:00.000Z');
  assert.equal(db.prepare("SELECT count(*) AS n FROM learner_state_effects WHERE kind='contextual_selection_outcome'").get()?.n,1);
  closeVocabularySessionCompletion('contrast-session',closed.completionId,'2026-10-18T12:00:00.000Z');
  assert.equal(db.prepare("SELECT count(*) AS n FROM learner_state_effects WHERE kind='contextual_selection_outcome'").get()?.n,1);
}));

test('contrast choices require learned eligible cluster members and a due contextual objective',()=>owner(()=>{
  contrastContent();db.prepare("UPDATE learner_words SET mode='practice' WHERE word_id='a'").run();
  let view=startVocabularyStudy();assert.notEqual(view.session.context.words.find((word)=>word.wordId==='a')?.selectedSkill,'contextual_selection');
  db.prepare("INSERT INTO learner_owned_word_skill_state VALUES('alice','a','contextual_selection',6,2.5,1,NULL,NULL)").run();
  db.prepare("UPDATE learner_words SET mode='unstudied' WHERE word_id='b'").run();
  view=startVocabularyStudy();assert.notEqual(view.session.context.words.find((word)=>word.wordId==='a')?.selectedSkill,'contextual_selection');
}));

test('fresh diet enrollment admits only selected ready words, honors quota and records introduction preferences',()=>owner(()=>{
  db.prepare("INSERT INTO learner_settings VALUES('alice','daily_new_word_limit','1','2026-01-01'),('alice','stash_diet_split','0','2026-01-01')").run();
  db.prepare("UPDATE learner_settings SET value_json='\"mixed\"' WHERE setting_key='unstudied_admission_source'").run();
  db.prepare("INSERT INTO lexical_words VALUES('fresh','丁',NULL,'dīng','fourth','2026-01-01',100),('not-ready','戊',NULL,'wù','fifth','2026-01-01',200)").run();
  exercise('teach-fresh','fresh','teaching');createVocabularyContent({contentId:'intro-fresh',kind:'introduction',payloadVersion:1,body:{beats:[{text:'Introduce 丁'}]},
    accessScope:'shared',availability:'active',originKind:'human',words:[{wordId:'fresh',relation:'target'}],teachingExercises:[{exerciseId:'teach-fresh',exerciseVersion:1}]},actor);
  const requested:string[]=[];const view=startVocabularyStudy({requestTeaching:(id)=>{requested.push(id);}});
  assert.equal(view.currentWordId,'fresh');assert.equal(view.currentEncounter?.snapshot.kind,'introduction');
  assert.equal(view.session.context.words.filter((entry)=>entry.mode==='unstudied').length,1);
  assert.equal(getVocabularyLearnerWord('fresh')?.inStash,false);assert.equal(getVocabularyLearnerWord('not-ready'),null);
  assert.equal(view.session.context.composition?.introductionOrder,'first');assert.deepEqual(requested,['not-ready']);
}));

test('new and replacement pure cues adopt independently after an eligible accepted member, without copying state or deactivation',()=>owner(()=>{
  const old=exercise('old-pure','b','general',true);
  const adoptedAt=new Date(Date.now()-7*3_600_000).toISOString();adoptVocabularyPureCues(adoptedAt);
  db.prepare("UPDATE learner_pure_cue_schedules SET scheduler_state_json='{\"intervalHours\":999,\"easeFactor\":1.9,\"enabled\":1,\"cleanCoveredSessions\":8}' WHERE content_id='old-pure'").run();
  db.prepare("INSERT INTO learner_content_deactivations VALUES('alice','old-pure',?)").run(new Date().toISOString());
  replaceVocabularyContent('old-pure',1,{...old,contentId:'replacement-pure'},actor);adoptVocabularyPureCues(adoptedAt);
  const state=JSON.parse(String(db.prepare("SELECT scheduler_state_json FROM learner_pure_cue_schedules WHERE content_id='replacement-pure'").get()?.scheduler_state_json));
  assert.equal(state.intervalHours,24);assert.equal(state.easeFactor,2.5);assert.equal(state.cleanCoveredSessions,0);
  assert.equal(db.prepare("SELECT count(*) AS n FROM learner_content_deactivations WHERE content_id='replacement-pure'").get()?.n,0);
  createVocabularySession({sessionId:'replacement-session',words:[]});const view=nextVocabularyExercise('replacement-session','next');
  assert.equal(view.currentEncounter?.snapshot.contentId,'replacement-pure');assert.equal(view.currentWordId,null);
}));

test('a pure cue with multiple accepted members retains all forms and credits none of their word schedules',()=>owner(()=>{
  const cue=createVocabularyContent({contentId:'multiple-pure',kind:'exercise',payloadVersion:1,body:{prompt:'One of these expressions fits.'},exerciseType:'pure_cue',skill:'production',exerciseRole:'general',
    assessment:{match:'prepared'},accessScope:'shared',availability:'active',originKind:'human',words:[{wordId:'a',relation:'target'},{wordId:'b',relation:'target'}],
    answers:[{wordId:'a',acceptedForms:['甲']},{wordId:'b',acceptedForms:['乙']}]},actor);
  const beforeA=getVocabularyWordSchedule('a'),beforeB=getVocabularyWordSchedule('b');
  adoptVocabularyPureCues(new Date(Date.now()-7*3_600_000).toISOString());
  createVocabularySession({sessionId:'multi-session',words:[]});let view=nextVocabularyExercise('multi-session','next');
  assert.equal(view.currentEncounter?.snapshot.contentId,cue.contentId);assert.deepEqual(view.currentEncounter?.snapshot.assessment?.acceptedAnswers,['甲','乙']);
  view=commandVocabularyStudy('multi-session','answer',{type:'response',response:'甲'});assert.deepEqual(view.session.projection.coveredWordIds,[]);
  view=commandVocabularyStudy('multi-session','finish',{type:'finishForNow'});
  const staged=stageVocabularySessionCompletion('multi-session',view.session.actions.length);closeVocabularySessionCompletion('multi-session',staged.completionId);
  assert.deepEqual(getVocabularyWordSchedule('a'),beforeA);assert.deepEqual(getVocabularyWordSchedule('b'),beforeB);
}));

test('resetting any established mode stops current work and defers teaching to a fresh session',()=>owner(()=>{
  for(const mode of ['solidify','practice','maintain'] as const) {
    db.prepare('UPDATE learner_words SET mode=? WHERE word_id=?').run(mode,'a');
    const id=`reset-${mode}`;createVocabularySession({sessionId:id,words:[{wordId:'a',mode}]});
    nextVocabularyExercise(id,`${id}-next`);
    let view=commandVocabularyStudy(id,`${id}-reset`,{type:'mode',mode:'unstudied'});
    assert.equal(view.session.projection.words.a.workStatus,'skipped');assert.equal(view.controls.canMore,false);
    assert.equal(view.session.projection.words.a.teachingCompleted,false);assert.match(view.notice!,/next session/);
    assert.throws(()=>commandVocabularyStudy(id,`${id}-more`,{type:'more'}),/next session/);
    view=commandVocabularyStudy(id,`${id}-finish`,{type:'finishForNow'});
    const staged=stageVocabularySessionCompletion(id,view.session.actions.length);closeVocabularySessionCompletion(id,staged.completionId);
    assert.equal(getVocabularyLearnerWord('a')?.mode,'unstudied');
    assert.equal(db.prepare('SELECT count(*) AS n FROM teaching_completions WHERE word_id=?').get('a')?.n,0);
  }
}));

test('explicit Unstudied to Practice override uses general work without fabricating teaching completion',()=>owner(()=>{
  createVocabularySession({sessionId:'override',words:[{wordId:'new',mode:'unstudied',teachingRequirements:{introductionContentId:'intro-new',
    requiredExerciseContentIds:['teach-new'],minimumRecognitionResponses:0,minimumProductionResponses:1}}]});
  let view=nextVocabularyExercise('override','intro');assert.equal(view.currentEncounter?.snapshot.role,'teaching');
  commandVocabularyStudy('override','override-mode',{type:'mode',mode:'practice'});
  view=nextVocabularyExercise('override','general');assert.equal(view.currentEncounter?.snapshot.role,'general');
  commandVocabularyStudy('override','enough',{type:'enough'});view=commandVocabularyStudy('override','finish',{type:'finishForNow'});
  assert.equal(view.session.projection.words.new.teachingCompleted,false);
  const staged=stageVocabularySessionCompletion('override',view.session.actions.length);closeVocabularySessionCompletion('override',staged.completionId);
  assert.equal(getVocabularyLearnerWord('new')?.mode,'practice');
  assert.equal(db.prepare('SELECT count(*) AS n FROM teaching_completions WHERE word_id=?').get('new')?.n,0);
}));

test('Word skip keeps unanswered work uncovered while Enough explicitly covers with no invented response',()=>owner(()=>{
  let view=focusedA();const id=view.session.sessionId;
  view=commandVocabularyStudy(id,'leave',{type:'skip',scope:'word'});
  assert.equal(view.session.projection.words.a.covered,false);assert.equal(view.session.projection.words.a.workStatus,'skipped');
  view=nextVocabularyExercise(id,'return',{wordId:'a'});
  view=commandVocabularyStudy(id,'enough',{type:'enough'});
  assert.equal(view.session.projection.words.a.covered,true);assert.equal(view.session.projection.words.a.successfulRecall,false);
  assert.equal(view.session.projection.encounters.flatMap((entry)=>entry.responses).length,0);
}));

test('earlier covered word extra practice preserves coverage and returns to interrupted open word',()=>owner(()=>{
  db.prepare("UPDATE learner_words SET mode='practice' WHERE word_id='a'").run();
  createVocabularySession({sessionId:'extra',words:[{wordId:'a',mode:'practice',selectedSkill:'production'},{wordId:'b',mode:'practice',selectedSkill:'production'}]});
  let view=nextVocabularyExercise('extra','initial',{wordId:'a'});const id=view.session.sessionId;
  nextVocabularyExercise(id,'first',{wordId:'a'});commandVocabularyStudy(id,'answer',{type:'response',response:'甲'});
  view=nextVocabularyExercise(id,'next-word');assert.equal(view.currentWordId,'b');
  view=nextVocabularyExercise(id,'revisit',{wordId:'a'});assert.equal(view.session.projection.words.a.covered,true);
  assert.equal(view.currentEncounter?.snapshot.kind,'production');
  view=commandVocabularyStudy(id,'extra-answer',{type:'response',response:'甲'});
  assert.equal(view.session.projection.words.a.workStatus,'open');assert.equal(view.session.projection.words.a.covered,true);
  commandVocabularyStudy(id,'satisfied',{type:'enough'});
  view=nextVocabularyExercise(id,'return-interrupted',{wordId:'b'});
  assert.equal(view.currentWordId,'b');assert.equal(view.session.projection.words.b.covered,false);
  assert.equal(view.session.projection.words.a.workStatus,'wrapped');
}));

test('covered requeue preserves the current encounter, rejects duplicates, and Undo restores the prior queue',()=>owner(()=>{
  db.prepare("UPDATE learner_words SET mode='practice' WHERE word_id='a'").run();
  createVocabularySession({sessionId:'requeue',words:[{wordId:'a',mode:'practice',selectedSkill:'production'},{wordId:'b',mode:'practice',selectedSkill:'production'}]});
  nextVocabularyExercise('requeue','a',{wordId:'a'});
  commandVocabularyStudy('requeue','a-accepted',{type:'response',response:'甲'});
  const before=nextVocabularyExercise('requeue','b');assert.equal(before.currentWordId,'b');
  const queued=commandVocabularyStudy('requeue','shuffle',{type:'requeue',wordId:'a'});
  assert.deepEqual(queued.currentEncounter,before.currentEncounter);
  assert.equal(queued.session.projection.words.a.workStatus,'open');
  assert.equal(queued.session.projection.words.a.workNumber,2);
  assert.equal(queued.session.projection.words.a.covered,true);
  assert.equal(queued.session.projection.words.a.successfulRecall,true);
  assert.equal(commandVocabularyStudy('requeue','shuffle',{type:'requeue',wordId:'a'}).session.actions.length,queued.session.actions.length);
  assert.throws(()=>commandVocabularyStudy('requeue','duplicate',{type:'requeue',wordId:'a'}),/already queued/);
  assert.throws(()=>commandVocabularyStudy('requeue','uncovered',{type:'requeue',wordId:'b'}),/Only covered/);
  const undone=commandVocabularyStudy('requeue','undo-shuffle',{type:'undo'});
  assert.equal(undone.session.projection.words.a.workStatus,'wrapped');
  assert.equal(undone.session.projection.words.a.workNumber,1);
  assert.equal(undone.session.projection.words.a.covered,true);
  assert.deepEqual(undone.currentEncounter,before.currentEncounter);
}));

test('requeued covered work uses ordinary interleaving and Finish for now drains it before completion',()=>owner(()=>{
  db.prepare("UPDATE learner_words SET mode='practice' WHERE word_id='a'").run();
  createVocabularySession({sessionId:'queued-drain',words:[{wordId:'a',mode:'practice',selectedSkill:'production'},{wordId:'b',mode:'practice',selectedSkill:'production'}]});
  nextVocabularyExercise('queued-drain','a',{wordId:'a'});
  commandVocabularyStudy('queued-drain','a-accepted',{type:'response',response:'甲'});
  const before=nextVocabularyExercise('queued-drain','b');assert.equal(before.currentWordId,'b');
  commandVocabularyStudy('queued-drain','shuffle',{type:'requeue',wordId:'a'});
  let view=commandVocabularyStudy('queued-drain','finish',{type:'finishForNow'});
  assert.equal(view.session.projection.phase,'finishing');
  assert.throws(()=>stageVocabularySessionCompletion('queued-drain',view.session.actions.length),/Finish session work/);
  // The current response still belongs to b after the shuffle request.
  view=commandVocabularyStudy('queued-drain','b-accepted',{type:'response',response:'乙'});
  assert.equal(view.session.projection.words.b.covered,true);
  assert.equal(view.session.projection.phase,'finishing');
  view=nextVocabularyExercise('queued-drain','ordinary-next');
  assert.equal(view.currentWordId,'a');assert.equal(view.currentEncounter?.workNumber,2);
  assert.equal(view.currentEncounter?.snapshot.role,'general');
  view=commandVocabularyStudy('queued-drain','extra-accepted',{type:'response',response:'甲'});
  assert.equal(view.session.projection.words.a.workStatus,'open');
  view=commandVocabularyStudy('queued-drain','satisfied',{type:'enough'});
  assert.equal(view.session.projection.phase,'completed');
  const staged=stageVocabularySessionCompletion('queued-drain',view.session.actions.length);
  assert.equal(staged.status,'pending');
  assert.equal(view.session.projection.words.a.covered,true);
}));

test('finishing permits an explicit covered requeue and immediate finish preserves its earlier coverage',()=>owner(()=>{
  db.prepare("UPDATE learner_words SET mode='practice' WHERE word_id='a'").run();
  createVocabularySession({sessionId:'finishing-requeue',words:[{wordId:'a',mode:'practice',selectedSkill:'production'},{wordId:'b',mode:'practice',selectedSkill:'production'}]});
  nextVocabularyExercise('finishing-requeue','a',{wordId:'a'});
  commandVocabularyStudy('finishing-requeue','a-accepted',{type:'response',response:'甲'});
  const before=nextVocabularyExercise('finishing-requeue','b');
  commandVocabularyStudy('finishing-requeue','finish',{type:'finishForNow'});
  let view=commandVocabularyStudy('finishing-requeue','shuffle',{type:'requeue',wordId:'a'});
  assert.equal(view.session.projection.phase,'finishing');
  assert.deepEqual(view.currentEncounter,before.currentEncounter);
  assert.equal(view.session.projection.words.a.workStatus,'open');
  view=commandVocabularyStudy('finishing-requeue','stop',{type:'finishImmediately'});
  assert.equal(view.session.projection.phase,'completed');
  assert.equal(view.session.projection.words.a.covered,true);
  assert.equal(view.session.projection.words.a.successfulRecall,true);
}));

test('summary mode change replaces pending completion revision while preserving its evidence',()=>owner(()=>{
  let view=focusedA('solidify');const id=view.session.sessionId;productionExercise(id,'first');
  view=commandVocabularyStudy(id,'answer',{type:'response',response:'甲'});
  view=commandVocabularyStudy(id,'finish',{type:'finishForNow'});
  const before=view.session.projection.encounters;const first=stageVocabularySessionCompletion(id,view.session.actions.length);
  cancelVocabularySessionCompletion(id,first.completionId);commandVocabularyStudy(id,'resume',{type:'resume'});
  commandVocabularyStudy(id,'summary-mode',{type:'mode',wordId:'a',mode:'maintain'});
  view=commandVocabularyStudy(id,'finish-again',{type:'finishForNow'});
  const second=stageVocabularySessionCompletion(id,view.session.actions.length);
  assert.equal(second.revisionNumber,2);assert.notEqual(second.completionId,first.completionId);
  assert.deepEqual(second.report.encounters,before);assert.equal(second.report.words.a.mode,'maintain');
  assert.equal(getVocabularyLearnerWord('a')?.mode,'solidify');closeVocabularySessionCompletion(id,second.completionId);
  assert.equal(getVocabularyLearnerWord('a')?.mode,'maintain');
}));

test('dismissed learned words cannot enter the independently due recognition lane',()=>owner(()=>{
  db.prepare("INSERT INTO learner_owned_word_skill_state VALUES('alice','b','recognition',24,2.5,1,NULL,NULL)").run();
  db.prepare("UPDATE learner_words SET dismissed_at='2026-10-17T00:00:00.000Z',mode='practice' WHERE word_id='b'").run();
  assert.equal(startVocabularyStudy().session.context.words.some((word)=>word.wordId==='b'),false);
}));

test('introductions first presents every pending introduction before any recall',()=>owner(()=>{
  db.prepare("UPDATE learner_words SET mode='unstudied' WHERE word_id='a'").run();
  createVocabularySession({sessionId:'rotation',words:[
    {wordId:'new',mode:'unstudied',teachingRequirements:{introductionContentId:'intro-new',requiredExerciseContentIds:['teach-new'],minimumRecognitionResponses:3,minimumProductionResponses:3}},
    {wordId:'a',mode:'unstudied',teachingRequirements:{introductionContentId:'intro-a',requiredExerciseContentIds:['teach-a'],minimumRecognitionResponses:3,minimumProductionResponses:3}},
    {wordId:'b',mode:'practice',selectedSkill:'production'},
  ],composition:{introductionOrder:'first',introductionSpacing:3}});
  let view=nextVocabularyExercise('rotation','intro-1');
  assert.equal(view.currentEncounter?.snapshot.kind,'introduction');
  view=nextVocabularyExercise('rotation','intro-2');
  assert.equal(view.currentEncounter?.snapshot.kind,'introduction');
  assert.deepEqual(new Set(view.session.projection.encounters.map((entry)=>entry.wordId)),new Set(['a','new']));
  view=nextVocabularyExercise('rotation','recall');
  assert.notEqual(view.currentEncounter?.snapshot.kind,'introduction');
  assert.equal(view.session.projection.words.a.teachingCompleted,false);
  assert.equal(view.session.projection.words.new.teachingCompleted,false);
}));

test('another way buries a word and excludes exercise identity across versions and revisits, until Undo',()=>owner(()=>{
  db.prepare("UPDATE learner_words SET mode='practice' WHERE word_id='a'").run();
  createVocabularySession({sessionId:'exclude',words:[{wordId:'a',mode:'practice'},{wordId:'b',mode:'practice'}]});
  const first=nextVocabularyExercise('exclude','first',{wordId:'a'}).currentEncounter!;
  commandVocabularyStudy('exclude','miss',{type:'response',response:null});
  const buried=nextVocabularyExercise('exclude','another',{another:true});
  assert.equal(buried.currentWordId,'b');
  assert.deepEqual(buried.session.projection.excludedContentIds,[first.snapshot.contentId]);
  assert.equal(buried.session.projection.words.a.covered,false);
  const retried=nextVocabularyExercise('exclude','another',{another:true});
  assert.equal(retried.session.actions.length,buried.session.actions.length);
  const undone=commandVocabularyStudy('exclude','undo',{type:'undo'});
  assert.deepEqual(undone.session.projection.excludedContentIds,[]);
  assert.equal(undone.currentEncounter?.encounterId,first.encounterId);
  nextVocabularyExercise('exclude','another-again',{another:true});
  const old=getVocabularyContent(first.snapshot.contentId)!;
  updateVocabularyContent(old.contentId,old.version,{...old,body:{prompt:'An edited version of the same exercise'}},actor);
  const revisit=nextVocabularyExercise('exclude','revisit',{wordId:'a'});
  assert.notEqual(revisit.currentEncounter?.snapshot.contentId,first.snapshot.contentId);
  createVocabularySession({sessionId:'fresh-exclusion',words:[{wordId:'a',mode:'practice'}]});
  assert.equal(nextVocabularyExercise('fresh-exclusion','first').currentEncounter?.snapshot.contentId,first.snapshot.contentId);
}));

test('exhausted production moves on without coverage, including after a manual revisit',()=>owner(()=>{
  db.prepare("UPDATE learner_words SET mode='practice' WHERE word_id='a'").run();
  createVocabularySession({sessionId:'exhaust',words:[{wordId:'a',mode:'practice'},{wordId:'b',mode:'practice'}]});
  nextVocabularyExercise('exhaust','first',{wordId:'a'});
  nextVocabularyExercise('exhaust','exclude-first',{another:true});
  const alternate=nextVocabularyExercise('exhaust','return',{wordId:'a'});
  assert.equal(alternate.currentEncounter?.snapshot.contentId,'general-2');
  let view=nextVocabularyExercise('exhaust','exclude-second',{another:true});
  view=nextVocabularyExercise('exhaust','revisit',{wordId:'a'});
  assert.equal(view.currentWordId,'b');assert.equal(view.session.projection.words.a.workStatus,'skipped');
  assert.equal(view.session.projection.words.a.covered,false);
  assert.deepEqual(new Set(view.session.projection.excludedContentIds),new Set(['general-1','general-2']));
  commandVocabularyStudy('exhaust','pass',{type:'response',response:'乙'});
  view=nextVocabularyExercise('exhaust','finish');assert.equal(view.session.projection.phase,'completed');
  assert.equal(view.session.projection.words.a.successfulRecall,false);
}));

test('another way is rejected for teaching and recognition; ordinary Skip does not exclude content',()=>owner(()=>{
  createVocabularySession({sessionId:'recognition-guard',words:[{wordId:'b',mode:'practice',recognitionOnly:true}]});
  const view=nextVocabularyExercise('recognition-guard','first');
  assert.equal(view.currentEncounter?.snapshot.kind,'recognition');
  assert.throws(()=>nextVocabularyExercise('recognition-guard','another',{another:true}),/does not support/);
  commandVocabularyStudy('recognition-guard','skip',{type:'skip'});
  assert.deepEqual(getVocabularyStudy('recognition-guard').session.projection.excludedContentIds,[]);
  createVocabularySession({sessionId:'teach-guard',words:[{wordId:'new',mode:'unstudied',teachingRequirements:{introductionContentId:'intro-new',
    requiredExerciseContentIds:['teach-new'],minimumRecognitionResponses:0,minimumProductionResponses:1}}]});
  nextVocabularyExercise('teach-guard','intro');
  nextVocabularyExercise('teach-guard','recognize');
  assert.throws(()=>nextVocabularyExercise('teach-guard','another',{another:true}),/does not support/);
}));

test('an excluded pure cue never returns, and a one-word queue can continue with its remaining exercise',()=>owner(()=>{
  db.prepare("UPDATE learner_words SET mode='practice' WHERE word_id='a'").run();
  createVocabularySession({sessionId:'one-word',words:[{wordId:'a',mode:'practice'}]});
  nextVocabularyExercise('one-word','first');
  const alternative=nextVocabularyExercise('one-word','another',{another:true});
  assert.equal(alternative.currentWordId,'a');assert.equal(alternative.currentEncounter?.snapshot.contentId,'general-2');
  for(const id of ['pure-a','pure-b']) {
    exercise(id,'b','general',true);
    db.prepare("INSERT INTO learner_pure_cue_schedules(learner_id,content_id,policy_version,scheduler_state_json) VALUES('alice',?,'test',?)")
      .run(id,JSON.stringify({intervalHours:24,easeFactor:2.5,enabled:1,cleanCoveredSessions:0}));
  }
  createVocabularySession({sessionId:'pure-exclusion',words:[]});
  const first=nextVocabularyExercise('pure-exclusion','first').currentEncounter!.snapshot.contentId;
  const next=nextVocabularyExercise('pure-exclusion','another',{another:true});
  assert.notEqual(next.currentEncounter?.snapshot.contentId,first);
  commandVocabularyStudy('pure-exclusion','answer',{type:'response',response:'乙'});
  const done=nextVocabularyExercise('pure-exclusion','finish');
  assert.equal(done.session.projection.phase,'completed');
  assert.equal(done.session.projection.encounters.filter((entry)=>entry.snapshot.contentId===first).length,1);
}));

test('both-due review freezes one selected skill across command retries and cancelled completion resume',()=>owner(()=>{
  db.prepare("UPDATE learner_words SET dismissed_at='2026-10-17T00:00:00.000Z' WHERE word_id IN ('a','new')").run();
  const now=Date.now();
  const hoursAgo=(hours:number)=>new Date(now-hours*3_600_000).toISOString();
  db.prepare("UPDATE learner_word_schedules SET last_practised_at=?,next_eligible_at=?,scheduler_state_json=? WHERE learner_id='alice' AND word_id='b'")
    .run(hoursAgo(48),hoursAgo(24),JSON.stringify({intervalHours:24,easeFactor:2.5,enabled:1,cleanCoveredSessions:0}));
  db.prepare("INSERT INTO learner_owned_word_skill_state VALUES('alice','b','recognition',24,2.5,1,?,?)").run(hoursAgo(72),hoursAgo(96));
  const productionBefore=getVocabularyWordSchedule('b');
  let view=startVocabularyStudy();const id=view.session.sessionId;
  assert.deepEqual(view.session.context.words.map(({wordId,selectedSkill})=>({wordId,selectedSkill})),[{wordId:'b',selectedSkill:'recognition'}]);
  assert.equal(view.currentEncounter?.snapshot.kind,'recognition');
  view=commandVocabularyStudy(id,'miss',{type:'response',response:null,selfAssessment:'rejected'});
  const count=view.session.actions.length;
  assert.equal(commandVocabularyStudy(id,'miss',{type:'response',response:null,selfAssessment:'rejected'}).session.actions.length,count);
  view=commandVocabularyStudy(id,'finish',{type:'finishForNow'});
  view=commandVocabularyStudy(id,'immediate',{type:'finishImmediately'});
  const staged=stageVocabularySessionCompletion(id,view.session.actions.length);
  cancelVocabularySessionCompletion(id,staged.completionId);
  commandVocabularyStudy(id,'resume',{type:'resume'});
  for(let index=0;index<3;index++) {
    view=nextVocabularyExercise(id,`retry-${index}`);
    const encounterId=view.currentEncounter?.encounterId;
    assert.equal(view.currentEncounter?.snapshot.kind,'recognition');
    assert.equal(nextVocabularyExercise(id,`retry-${index}`).currentEncounter?.encounterId,encounterId);
    view=commandVocabularyStudy(id,`accepted-${index}`,{type:'response',response:null,selfAssessment:'accepted'});
    assert.equal(view.session.projection.words.b.covered,index===2);
  }
  view=nextVocabularyExercise(id,'done');
  assert.equal(view.session.projection.phase,'completed');
  assert.equal(view.session.projection.encounters.some((entry)=>entry.snapshot.kind==='production'),false);
  assert.deepEqual(getVocabularyWordSchedule('b'),productionBefore);
}));

test('teaching rejection resets only that direction and requires three subsequent consecutive successes',()=>owner(()=>{
  createVocabularySession({sessionId:'teaching-reset',words:[{wordId:'new',mode:'unstudied',teachingRequirements:{introductionContentId:'intro-new',
    requiredExerciseContentIds:['teach-new'],minimumRecognitionResponses:3,minimumProductionResponses:3}}]});
  let view=nextVocabularyExercise('teaching-reset','intro');
  let resetSkill:'recognition'|'production'|null=null;
  for(let index=0;index<24&&!view.session.projection.words.new.teachingCompleted;index++) {
    view=nextVocabularyExercise('teaching-reset',`next-${index}`);
    const kind=view.currentEncounter?.snapshot.kind;assert.ok(kind==='recognition'||kind==='production');
    const before=view.session.projection.words.new.skillProgress;
    const reject=resetSkill===null&&before[kind].consecutiveAccepted===2;
    view=commandVocabularyStudy('teaching-reset',`answer-${index}`,kind==='recognition'
      ?{type:'response',response:null,selfAssessment:reject?'rejected':'accepted'}
      :{type:'response',response:reject?'wrong':'新'});
    if(reject) {
      resetSkill=kind;
      const other=kind==='recognition'?'production':'recognition';
      assert.equal(view.session.projection.words.new.skillProgress[kind].consecutiveAccepted,0);
      assert.deepEqual(view.session.projection.words.new.skillProgress[other],before[other]);
      assert.equal(view.session.projection.words.new.teachingCompleted,false);
    }
  }
  assert.ok(resetSkill);
  assert.equal(view.session.projection.words.new.teachingCompleted,true);
  assert.equal(view.session.projection.words.new.skillProgress.recognition.consecutiveAccepted,3);
  assert.equal(view.session.projection.words.new.skillProgress.production.consecutiveAccepted,3);
  assert.equal(view.session.projection.words.new.hasRejectedResponse,true);
}));

test('independent pure cue shares the review queue and completes lapse reinforcement while finishing',()=>owner(()=>{
  db.prepare("UPDATE learner_words SET dismissed_at='2026-10-17T00:00:00.000Z' WHERE word_id IN ('a','new')").run();
  exercise('queue-pure','b','general',true);
  exercise('queue-targeted','b'); // Both queues require a real word-specific cue, not proxied fallback.
  db.prepare("INSERT INTO learner_pure_cue_schedules(learner_id,content_id,policy_version,scheduler_state_json) VALUES('alice','queue-pure','test',?)")
    .run(JSON.stringify({intervalHours:24,easeFactor:2.5,enabled:1,cleanCoveredSessions:0}));
  const before=getVocabularyWordSchedule('b');
  let view=startVocabularyStudy();const id=view.session.sessionId;
  assert.deepEqual(new Set(view.session.context.reviewOrder?.map((entry)=>`${entry.kind}/${entry.id}`)),new Set(['word/b','pure_cue/queue-pure']));
  let cueMissed=false;
  if(view.currentEncounter?.snapshot.schedulingScope==='pure_cue') {
    view=commandVocabularyStudy(id,'initial-cue-miss',{type:'response',response:'wrong'});cueMissed=true;
    view=nextVocabularyExercise(id,'word',{wordId:'b'});
  }
  assert.equal(view.currentWordId,'b');
  commandVocabularyStudy(id,'word-miss',{type:'response',response:'wrong'});
  view=nextVocabularyExercise(id,'cue-between-word-retries');
  assert.equal(view.currentEncounter?.snapshot.contentId,'queue-pure');
  assert.equal(view.session.projection.words.b.workStatus,'open');
  assert.equal(view.session.projection.words.b.covered,false);
  if(!cueMissed)view=commandVocabularyStudy(id,'cue-miss',{type:'response',response:'wrong'});
  // Leave the ordinary word unfinished. The independent cue remains open work.
  commandVocabularyStudy(id,'leave-word',{type:'skip',scope:'word',wordId:'b'});
  view=commandVocabularyStudy(id,'finish',{type:'finishForNow'});
  assert.equal(view.session.projection.phase,'finishing');
  for(let index=0;index<3;index++) {
    // If the cue was already returned after the word miss, its current unanswered
    // encounter must be answered before asking for another appearance.
    if(index>0||view.currentEncounter?.effectiveResponses.length)
      view=nextVocabularyExercise(id,`reinforcement-${index}`);
    assert.equal(view.currentEncounter?.snapshot.contentId,'queue-pure');
    assert.equal(view.session.projection.phase,'finishing');
    view=commandVocabularyStudy(id,`cue-pass-${index}`,{type:'response',response:'乙'});
    assert.equal(view.session.projection.pureCueOutcomes[0].covered,index===2);
    assert.equal(view.session.projection.words.b.covered,false);
  }
  if(view.session.projection.phase!=='completed')view=nextVocabularyExercise(id,'finished');
  assert.equal(view.session.projection.phase,'completed');
  assert.deepEqual(view.session.projection.coveredWordIds,[]);
  assert.equal(view.session.projection.pureCueOutcomes[0].rejectedResponses,1);
  const staged=stageVocabularySessionCompletion(id,view.session.actions.length);
  closeVocabularySessionCompletion(id,staged.completionId);
  assert.deepEqual(getVocabularyWordSchedule('b'),before);
  assert.equal(db.prepare("SELECT count(*) AS n FROM learner_state_effects WHERE kind='production_schedule_applied'").get()?.n,0);
  assert.equal(db.prepare("SELECT count(*) AS n FROM learner_pure_cue_schedules WHERE content_id='queue-pure' AND last_practised_at IS NOT NULL").get()?.n,1);
}));

test('teaching retains admission-time skill availability when later settings change',()=>owner(()=>{
  createVocabularyContent({contentId:'authored-recognition',kind:'exercise',payloadVersion:1,body:{prompt:'新'},
    exerciseType:'recognition',skill:'recognition',exerciseRole:'teaching',assessment:{responseMode:'self_assessment'},
    accessScope:'shared',availability:'active',originKind:'human',words:[{wordId:'new',relation:'target'}],
    answers:[{wordId:'new',acceptedForms:['新']}]},actor);
  const intro=getVocabularyContent('intro-new')!;
  updateVocabularyContent(intro.contentId,intro.version,{...intro,
    teachingExercises:[{exerciseId:'authored-recognition',exerciseVersion:1},{exerciseId:'teach-new',exerciseVersion:1}]},actor);
  for(const skill of ['recognition','production'] as const)for(const restriction of ['disabled','suppressed'] as const) {
    db.prepare("DELETE FROM learner_owned_word_skill_state WHERE learner_id='alice' AND word_id='new'").run();
    db.prepare("DELETE FROM learner_owned_word_skill_relevance WHERE learner_id='alice' AND word_id='new'").run();
    const id=`teaching-${skill}-${restriction}`;
    createVocabularySession({sessionId:id,words:[{wordId:'new',mode:'unstudied',teachingRequirements:{introductionContentId:'intro-new',
      requiredExerciseContentIds:['authored-recognition','teach-new'],minimumRecognitionResponses:3,minimumProductionResponses:3}}]});
    const introduced=nextVocabularyExercise(id,'intro');
    assert.equal(introduced.currentEncounter?.snapshot.kind,'introduction');
    if(restriction==='disabled')db.prepare("INSERT INTO learner_owned_word_skill_state VALUES('alice','new',?,24,2.5,0,NULL,NULL)").run(skill);
    else db.prepare("INSERT INTO learner_owned_word_skill_relevance VALUES('alice','new',?,'suppressed')").run(skill);
    const stopped=nextVocabularyExercise(id,'next');
    assert.equal(stopped.notice,null);
    assert.equal(stopped.session.projection.encounters.length,2);
    assert.notEqual(stopped.currentEncounter?.snapshot.kind,'introduction');
    assert.equal(composeVocabularySessionPayload({sessionId:'later',words:[{wordId:'new',mode:'unstudied'}]}).words.new.teaching,null);
    assert.equal(stopped.session.projection.words.new.workStatus,'open');
    assert.equal(stopped.session.projection.words.new.covered,false);
    assert.equal(stopped.session.projection.words.new.teachingCompleted,false);
    assert.equal(getVocabularyLearnerWord('new')?.mode,'unstudied');
  }
}));

test('Solidify with suppressed production covers recognition only without automatic graduation',()=>owner(()=>{
  db.prepare("UPDATE learner_words SET dismissed_at='2026-10-17T00:00:00.000Z' WHERE word_id IN ('b','new')").run();
  db.prepare("INSERT INTO learner_owned_word_skill_relevance VALUES('alice','a','production','suppressed')").run();
  db.prepare("UPDATE learner_word_schedules SET scheduler_state_json=json_set(scheduler_state_json,'$.enabled',0) WHERE word_id='a'").run();
  let view=startVocabularyStudy();const id=view.session.sessionId;
  assert.deepEqual(view.session.context.words.find((word)=>word.wordId==='a')?.solidifySkills,['recognition']);
  // Priming may be unavailable once a required teaching direction is suppressed.
  if(view.currentEncounter?.snapshot.kind==='introduction')view=nextVocabularyExercise(id,'recognition');
  assert.equal(view.currentEncounter?.snapshot.kind,'recognition');
  view=commandVocabularyStudy(id,'recognized',{type:'response',response:null,selfAssessment:'accepted'});
  assert.equal(view.session.projection.words.a.covered,true);
  assert.equal(view.session.projection.words.a.recommendedMode,null);
  assert.equal(view.session.projection.encounters.some((entry)=>entry.snapshot.kind==='production'),false);
  view=commandVocabularyStudy(id,'finish',{type:'finishForNow'});
  const staged=stageVocabularySessionCompletion(id,view.session.actions.length,'2026-10-23T10:00:00.000Z');
  closeVocabularySessionCompletion(id,staged.completionId,'2026-10-23T10:00:16.000Z');
  assert.equal(getVocabularyLearnerWord('a')?.mode,'solidify');
  assert.equal(getVocabularyWordSchedule('a')?.schedulerState.cleanCoveredSessions,0);
  assert.equal(getVocabularyWordSchedule('a')?.nextEligibleAt,'2026-10-24T00:00:00.000Z');
  assert.equal(view.session.projection.words.a.productionResponses,0);
  assert.equal(getVocabularyWordSchedule('a')?.schedulerState.enabled,0);
}));

test('Solidify with disabled recognition covers production only and cannot automatically graduate',()=>owner(()=>{
  db.prepare("UPDATE learner_words SET dismissed_at='2026-10-17T00:00:00.000Z' WHERE word_id IN ('b','new')").run();
  db.prepare("INSERT INTO learner_owned_word_skill_state VALUES('alice','a','recognition',24,2.5,0,NULL,NULL)").run();
  let view=startVocabularyStudy();const id=view.session.sessionId;
  assert.deepEqual(view.session.context.words.find((word)=>word.wordId==='a')?.solidifySkills,['production']);
  if(view.currentEncounter?.snapshot.kind==='introduction')view=nextVocabularyExercise(id,'production');
  assert.equal(view.currentEncounter?.snapshot.kind,'production');
  view=commandVocabularyStudy(id,'produced',{type:'response',response:'甲'});
  assert.equal(view.session.projection.words.a.covered,true);
  assert.equal(view.session.projection.words.a.recommendedMode,null);
  assert.equal(view.session.projection.encounters.some((entry)=>entry.snapshot.kind==='recognition'),false);
  view=commandVocabularyStudy(id,'finish',{type:'finishForNow'});
  const staged=stageVocabularySessionCompletion(id,view.session.actions.length,'2026-10-23T10:00:00.000Z');
  closeVocabularySessionCompletion(id,staged.completionId,'2026-10-23T10:00:16.000Z');
  assert.equal(getVocabularyLearnerWord('a')?.mode,'solidify');
  assert.equal(getVocabularyWordSchedule('a')?.schedulerState.cleanCoveredSessions,0);
  assert.equal(getVocabularyWordSchedule('a')?.nextEligibleAt,'2026-10-24T00:00:00.000Z');
}));

test('Solidify with both recall directions disabled is excluded instead of creating unfinishable work',()=>owner(()=>{
  db.prepare("INSERT INTO learner_owned_word_skill_state VALUES('alice','a','recognition',24,2.5,0,NULL,NULL),('alice','a','production',24,2.5,0,NULL,NULL)").run();
  const view=startVocabularyStudy();
  assert.equal(view.session.context.words.some((word)=>word.wordId==='a'),false);
}));


for(const mode of ['solidify','practice','maintain'] as const)test(`${mode} excludes persisted dictionary production when an eligible authored cue exists`,()=>owner(()=>{
  // Materialize a baseline before authored content exists, as a previous session can.
  createVocabularySession({sessionId:'before-authored',words:[{wordId:'b',mode:'maintain',selectedSkill:'production'}]});
  const fallbackId=nextVocabularyExercise('before-authored','next').currentEncounter!.snapshot.contentId;
  const fallback=getVocabularyContent(fallbackId)!;
  updateVocabularyContent(fallbackId,fallback.version,{...fallback,body:{...(fallback.body as object),explanation:'An enriched fallback is still fallback.'}},actor);
  exercise('z-authored-b','b');
  db.prepare("UPDATE learner_words SET mode=? WHERE word_id='b'").run(mode);
  if(mode==='maintain')db.prepare("INSERT INTO content_mode_suitability VALUES('z-authored-b','maintain','curated',1)").run();
  const session=createVocabularySession({sessionId:'after-authored',words:[{wordId:'b',mode,selectedSkill:'production'}]});
  const pool=session.context.payload!.words.b.general[mode];
  assert.ok(pool.some(content=>content.contentId==='z-authored-b'));
  assert.ok(!pool.some(content=>content.contentId===fallbackId));
  assert.equal(nextVocabularyExercise('after-authored','next').currentEncounter?.snapshot.contentId,'z-authored-b');
  // Retirement/deactivation can make dictionary fallback necessary again.
  db.prepare("INSERT INTO learner_content_deactivations VALUES('alice','z-authored-b','2026-10-28T00:00:00.000Z')").run();
  const later=createVocabularySession({sessionId:'after-deactivation',words:[{wordId:'b',mode,selectedSkill:'production'}]});
  assert.ok(later.context.payload!.words.b.general[mode].some(content=>content.contentId===fallbackId));
}));

test('recognition and contrast do not displace a Practice production fallback',()=>owner(()=>{
  db.prepare("UPDATE learner_words SET mode='practice' WHERE word_id='a'").run();
  contrastContent();
  for(const id of ['general-1','general-2'])db.prepare("INSERT INTO learner_content_deactivations VALUES('alice',?,'2026-10-28T00:00:00.000Z')").run(id);
  db.prepare("INSERT INTO learner_owned_word_skill_state VALUES('alice','a','contextual_selection',6,2.5,1,NULL,NULL)").run();
  const session=createVocabularySession({sessionId:'independent-objectives',words:[{wordId:'a',mode:'practice',selectedSkill:'production'}]});
  const pool=session.context.payload!.words.a.general.practice;
  assert.ok(pool.some(content=>content.contentId==='contrast'));
  assert.ok(pool.some(content=>content.skill==='recognition'));
  assert.equal(nextVocabularyExercise(session.sessionId,'next').currentEncounter?.snapshot.contentId,'vocabulary:baseline:v1:shared:production:general:a');
}));

test('pure coverage excludes dictionary production from preview and Start even while the cue is not due',()=>owner(()=>{
  db.prepare("UPDATE learner_words SET dismissed_at='2026-10-01' WHERE word_id!='b'").run();
  // First materialize the fallback, then add coverage: existing baseline content
  // must not become an apparent authored targeted cue.
  const initial=startVocabularyStudy();
  assert.equal(initial.currentEncounter?.snapshot.contentId,'vocabulary:baseline:v1:shared:production:general:b');
  exercise('proxy-pure','b','general',true);
  adoptVocabularyPureCues();
  db.prepare("UPDATE learner_pure_cue_schedules SET next_eligible_at='2999-01-01T00:00:00.000Z'").run();
  const schedules=db.prepare('SELECT * FROM learner_word_schedules ORDER BY learner_id,word_id').all();
  assert.equal(previewVocabularyStudy().itemCount,0);
  assert.throws(()=>startVocabularyStudy(),/No ready study material is available/);
  // The earlier session retains its admitted fallback; proxy coverage applies at the next Start.
  const continued=nextVocabularyExercise(initial.session.sessionId,'retry-after-proxy',{wordId:'b'});
  assert.equal(continued.session.projection.encounters.length,initial.session.projection.encounters.length+1);
  assert.equal(continued.currentEncounter?.snapshot.contentId,initial.currentEncounter?.snapshot.contentId);
  assert.equal(continued.session.projection.words.b.covered,false);
  assert.deepEqual(db.prepare('SELECT * FROM learner_word_schedules ORDER BY learner_id,word_id').all(),schedules);
  assert.equal(db.prepare("SELECT count(*) AS n FROM learner_owned_word_skill_relevance WHERE relevance_state='proxied'").get()?.n,0);
}));

test('pure coverage preserves independently due recognition and usable private production',()=>owner(()=>{
  db.prepare("UPDATE learner_words SET dismissed_at='2026-10-01' WHERE word_id!='b'").run();
  exercise('proxy-pure','b','general',true);
  db.prepare("INSERT INTO learner_owned_word_skill_state VALUES('alice','b','recognition',24,2.5,1,'2026-01-02T00:00:00.000Z','2026-01-01T00:00:00.000Z')").run();
  let view=startVocabularyStudy();
  assert.equal(view.session.context.words[0].selectedSkill,'recognition');
  assert.equal(view.currentEncounter?.snapshot.kind,'recognition');
  db.prepare("UPDATE learner_owned_word_skill_state SET enabled=0 WHERE skill_id='recognition'").run();
  createVocabularyContent({contentId:'private-targeted-b',kind:'exercise',payloadVersion:1,body:{prompt:'A distinctive private use'},
    accessScope:'private',ownerLearnerId:'alice',availability:'active',originKind:'human',words:[{wordId:'b',relation:'target'}],
    exerciseType:'word',skill:'production',exerciseRole:'general',assessment:{match:'prepared'},answers:[{wordId:'b',acceptedForms:['乙']}]},actor);
  view=startVocabularyStudy();
  assert.equal(view.currentEncounter?.snapshot.contentId,'private-targeted-b');
  assert.equal(view.session.context.words[0].selectedSkill,'production');
  db.prepare("INSERT INTO learner_content_deactivations VALUES('alice','private-targeted-b','2026-10-27T00:00:00.000Z')").run();
  assert.equal(previewVocabularyStudy().itemCount,0);
}));


for(const strategy of ['update','replace'] as const)test(`explicit ${strategy} of a fallback prompt restores usable production under pure coverage`,()=>owner(()=>{
  db.prepare("UPDATE learner_words SET dismissed_at='2026-10-01' WHERE word_id!='b'").run();
  const initial=startVocabularyStudy();
  const id=initial.currentEncounter!.snapshot.contentId;
  const baseline=getVocabularyContent(id)!;
  assert.equal(baseline.kind,'exercise');
  exercise('proxy-pure','b','general',true);
  const enriched=updateVocabularyContent(id,baseline.version,{...baseline,body:{...(baseline.body as object),explanation:'Additional usage note'}},actor);
  assert.equal(previewVocabularyStudy().itemCount,0,'explanation alone does not create a targeted prompt');
  const draft={...enriched,body:{...(enriched.body as object),prompt:'Name the second heavenly stem.'}};
  const authored=strategy==='update'?updateVocabularyContent(id,enriched.version,draft,actor)
    :replaceVocabularyContent(id,enriched.version,{...draft,contentId:'authored-replacement'},actor).replacement;
  assert.deepEqual((authored.body as {source:unknown}).source,{kind:'authored_prompt',previous:{kind:'dictionary_baseline',wordId:'b'}});
  const started=startVocabularyStudy();
  assert.equal(started.currentEncounter?.snapshot.contentId,authored.contentId);
  assert.equal(started.session.context.words[0].selectedSkill,'production');
}));


test('publication, edits and retirement cannot change a retained repertoire, including after cache reload',()=>owner(()=>{
  const first=focusedA();
  const original=getVocabularyContent('general-2')!;
  updateVocabularyContent(original.contentId,original.version,{...original,body:{prompt:'Edited after Start'}},actor);
  exercise('general-0-new','a');
  db.prepare("UPDATE content_items SET availability='retired' WHERE content_id='general-2'").run();
  db.prepare("UPDATE lexical_words SET meaning='Edited dictionary fact' WHERE id='a'").run();
  setDb(db); // A new connection wrapper forces cold hydration from durable context.
  const next=nextVocabularyExercise(first.session.sessionId,'another',{another:true});
  assert.equal(next.currentEncounter?.snapshot.contentId,'general-2');
  assert.equal(next.currentEncounter?.snapshot.contentVersion,1);
  assert.equal(next.currentEncounter?.snapshot.body.prompt,'Retrieve general-2');
  assert.equal(next.currentEncounter?.snapshot.body.revealWords?.find(word=>word.wordId==='a')?.meaning,'first');
  assert.equal(next.session.context.payload,undefined,'never transmit the unserved repertoire');
  createVocabularySession({sessionId:'fresh-published',words:[{wordId:'a',mode:'practice'}]});
  const fresh=nextVocabularyExercise('fresh-published','next');
  assert.equal(fresh.currentEncounter?.snapshot.contentId,'general-0-new');
  assert.equal(fresh.words[0].meaning,'Edited dictionary fact');
}));

test('warm live progression reads no session history, payload, content pool, or active-session demand',()=>owner(()=>{
  const first=focusedA();const queries:string[]=[];const prepare=db.prepare.bind(db);
  Object.defineProperty(db,'prepare',{configurable:true,value:(sql:string)=>{queries.push(sql);return prepare(sql);}});
  try {
    commandVocabularyStudy(first.session.sessionId,'answer',{type:'response',response:'甲'});
    nextVocabularyExercise(first.session.sessionId,'more',{wordId:'a'});
  } finally {delete (db as unknown as {prepare?:unknown}).prepare;}
  assert.ok(queries.length>0);
  const forbidden=queries.filter(sql=>/SELECT action_json|SELECT \* FROM vocabulary_sessions|json_each|FROM content_items c|JOIN content_words w|FROM lexical_words w/i.test(sql));
  assert.deepEqual(forbidden,[]);
}));

test('sessions without a retained payload cannot continue after upgrade, but their evidence remains readable',()=>owner(()=>{
  createStoredSession({sessionId:'pre-payload',words:[{wordId:'a',mode:'practice'}]});
  assert.throws(()=>nextVocabularyExercise('pre-payload','next'),/predates the current player/);
  assert.throws(()=>commandVocabularyStudy('pre-payload','finish',{type:'finishForNow'}),/predates the current player/);
  assert.equal(getVocabularyStudy('pre-payload').session.actions.length,0);
}));


test('Maintain recognition retains its baseline even when curated production fills the general pool',()=>owner(()=>{
  db.prepare("UPDATE learner_words SET mode='maintain' WHERE word_id='a'").run();
  db.prepare("INSERT INTO content_mode_suitability(content_id,mode,suitability,assessed_content_version) VALUES('general-1','maintain','curated',1)").run();
  createVocabularySession({sessionId:'maintain-recognition',words:[{wordId:'a',mode:'maintain',selectedSkill:'recognition'}]});
  assert.equal(nextVocabularyExercise('maintain-recognition','next').currentEncounter?.snapshot.kind,'recognition');
}));

test('measure retained-session hot-path scaling', {skip:process.env.RUN_SESSION_BENCHMARK!=='1'},()=>owner(()=>{
  let view=focusedA();const id=view.session.sessionId;
  for(const target of [10,100,500]) {
    while(view.session.projection.encounters.length<target)view=nextVocabularyExercise(id,`grow-${view.session.actions.length}`,{wordId:'a'});
    const samples:number[]=[];const serialization:number[]=[];let bytes=0;
    for(let i=0;i<5;i++) {
      const begin=performance.now();view=nextVocabularyExercise(id,`measure-${target}-${i}`,{wordId:'a'});samples.push(performance.now()-begin);
      const jsonStart=performance.now();const json=JSON.stringify(view);serialization.push(performance.now()-jsonStart);bytes=Buffer.byteLength(json);
    }
    samples.sort((a,b)=>a-b);serialization.sort((a,b)=>a-b);
    console.log(JSON.stringify({sessionBenchmark:{encounters:view.session.projection.encounters.length,actions:view.session.actions.length,nextMedianMs:samples[2],serializeMedianMs:serialization[2],responseBytes:bytes}}));
  }
}));


test('session preview and start reject invalid time zones', () => owner(() => {
  const routes = new Map<string, (req: Request, res: Response) => void>();
  const register = (method: string) => (path: string, handler: (req: Request, res: Response) => void) => routes.set(`${method} ${path}`, handler);
  registerVocabularyStudyRoutes({get: register('GET'), post: register('POST')} as unknown as Express);
  for (const [route, req] of [
    ['GET /api/vocabulary/session-preview', {query:{timeZone:'Invalid/Zone'}, body:{}}],
    ['POST /api/vocabulary/sessions', {query:{}, body:{timeZone:'Invalid/Zone'}}],
  ] as const) {
    let code = 200;
    const response = {status(value:number){code=value;return this;}, json(){return this;}};
    routes.get(route)!(req as unknown as Request, response as unknown as Response);
    assert.equal(code, 400);
  }
}));

test('live HTTP actions never wake background workers; Start schedules a wake after its response',async()=>owner(async()=>{
  db.prepare("INSERT OR REPLACE INTO learner_settings VALUES('alice','daily_new_word_limit','0','2026-10-27')").run();
  const routes=new Map<string,(req:Request,res:Response)=>void>();
  const register=(method:string)=>(path:string,handler:(req:Request,res:Response)=>void)=>{routes.set(`${method} ${path}`,handler);};
  let wakes=0;registerVocabularyStudyRoutes({get:register('GET'),post:register('POST')} as unknown as Express,()=>{wakes++;});
  const call=(route:string,id:string,body:unknown={})=>{
    let result:VocabularyStudy|undefined;let status=200;
    const response={json(value:VocabularyStudy){result=value;return this;},status(value:number){status=value;return this;}};
    routes.get(route)!({params:{id},body} as Request,response as unknown as Response);
    assert.equal(status,200);assert.ok(result);return result;
  };
  const started=call('POST /api/vocabulary/sessions','');
  assert.equal(wakes,0,'no synchronous worker work before response');
  await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(wakes,1);wakes=0;
  const id=started.session.sessionId;
  call('GET /api/vocabulary/sessions/:id',id);
  call('POST /api/vocabulary/sessions/:id/next',id,{clientActionId:'route-next'});
  call('POST /api/vocabulary/sessions/:id/commands',id,{clientActionId:'route-command',command:{type:'skip'}});
  await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(wakes,0);
}));
