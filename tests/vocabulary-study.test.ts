import { createHash } from 'node:crypto';
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
import { writeVocabularyDefaultUsefulSenses } from '../server/db/vocabulary-sense-coverage.ts';
import { selectVocabularyReviewSkills } from '../server/vocabulary/review-selection.ts';
import { createVocabularyContent,replaceVocabularyContent,updateVocabularyContent,getVocabularyContent,createVocabularySense,establishVocabularySenseCatalog,getVocabularySenseCatalog,getVocabularySenses,updateVocabularySense } from '../server/db/vocabulary-content.ts';
import { appendVocabularySessionActions,createVocabularySession as createStoredSession,stageVocabularySessionCompletion,cancelVocabularySessionCompletion,closeVocabularySessionCompletion } from '../server/db/vocabulary-sessions.ts';
import { changeVocabularyMode,addVocabularyWord,dismissVocabularyWord,getVocabularyLearnerWord,getVocabularyWordSchedule,enrollVocabularyDietWord } from '../server/db/vocabulary-learners.ts';
import { startVocabularyStudy as startRuntime,composeVocabularySessionPayload,previewVocabularyStudy as previewRuntime,getVocabularyStudy,nextVocabularyExercise,commandVocabularyStudy,saveVocabularySessionNote } from '../server/vocabulary/study.ts';
import type { VocabularyStudy } from '../src/domain/vocabulary-study-api.ts';
import type { VocabularyContent } from '../src/domain/vocabulary-content.ts';
// These player fixtures isolate composition from shared-provider reserve storage.
const startVocabularyStudy=(options:Parameters<typeof startRuntime>[0]={})=>startRuntime({...options});
const previewVocabularyStudy=(options:Parameters<typeof previewRuntime>[0]={})=>previewRuntime({...options});
let db:DatabaseSync;
const owner=<T>(fn:()=>T)=>runWithLearnerId('alice',fn);
const actor={kind:'operator' as const,id:'test'};
function createVocabularySession(context:VocabularySessionInitialContext) {
  const reviewOrder=context.reviewOrder??selectVocabularyPureCueCandidates({ordinaryReviewCount:context.words.filter(word=>word.mode==='practice'||word.mode==='maintain').length,sessionSeed:context.sessionId})
    .map(cue=>({kind:'pure_cue' as const,id:cue.contentId}));
  const frozen={...context,words:context.words.map(word=>({...word,mode:getVocabularyLearnerWord(word.wordId)!.mode})),reviewOrder};
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
    CREATE TABLE learner_word_preparation_reserve(learner_id TEXT,word_id TEXT,added_at TEXT,ready_at TEXT,checked_at TEXT,PRIMARY KEY(learner_id,word_id));
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
  for(const file of ['0062_vocabulary_sense_coverage.sql','0064_vocabulary_default_useful_senses.sql','0039_vocabulary_content.sql','0041_vocabulary_learner_state.sql','0042_vocabulary_sessions.sql','0047_vocabulary_dismissal.sql','0052_vocabulary_automatic_promotion_pause.sql','0023_session_debrief.sql','0048_vocabulary_connections.sql'])db.exec(fs.readFileSync(new URL(`../server/db/migrations/${file}`,import.meta.url),'utf8'));
  db.exec('CREATE TABLE model_invocations(id TEXT PRIMARY KEY,status TEXT,actor_kind TEXT,learner_id TEXT); CREATE TABLE word_content_documents(content_id TEXT PRIMARY KEY);');
  db.exec(fs.readFileSync(new URL('../server/db/migrations/0045_vocabulary_provenance_links.sql',import.meta.url),'utf8'));
  db.exec("ALTER TABLE vocabulary_practice_preparation ADD COLUMN next_attempt_at TEXT NOT NULL DEFAULT ''; ALTER TABLE vocabulary_practice_preparation ADD COLUMN total_attempt_count INTEGER NOT NULL DEFAULT 0;");
  db.exec(fs.readFileSync(new URL('../server/db/migrations/0069_sense_content_reconciliation.sql',import.meta.url),'utf8'));
  // Classic sessions by default; timed tests switch the operator control on.
  db.exec(`CREATE TABLE service_controls(control_key TEXT PRIMARY KEY,enabled INTEGER NOT NULL,updated_at TEXT NOT NULL,actor_id TEXT NOT NULL);
    INSERT INTO service_controls VALUES('maintenance_mode',0,'1970-01-01','system_default'),('provider_work_enabled',1,'1970-01-01','system_default'),('operator_only',0,'1970-01-01','system_default');`);
  db.exec(fs.readFileSync(new URL('../server/db/migrations/0071_timed_daily_sessions.sql',import.meta.url),'utf8'));
  db.exec("UPDATE service_controls SET enabled=0 WHERE control_key='timed_sessions'");
  owner(()=>{
    exercise('general-1','a');exercise('general-2','a');exercise('teach-a','a','teaching');exercise('teach-new','new','teaching');
    // These teaching members have already passed background readiness before the request under test.
    db.prepare("INSERT INTO learner_word_preparation_reserve VALUES('alice','new',?,?,?),('alice','a',?,?,?)").run('2026-01-01','2026-01-01','2026-01-01','2026-01-01','2026-01-01','2026-01-01');
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
  const preview=previewVocabularyStudy({});
  assert.equal(snapshot(),before);assert.equal(db.prepare('SELECT total_changes() AS n').get()!.n,changes);
  const started=startVocabularyStudy({previewSeed:preview.previewSeed});
  const count=started.session.context.words.length+(started.session.context.reviewOrder??[]).filter((entry)=>entry.kind==='pure_cue').length;
  assert.equal(preview.itemCount,count);assert.ok(count>0);
  assert.notEqual(started.session.sessionId,preview.previewSeed);
}));

test('Home preview refreshes zero readiness and current settings, retaining bounded preparation demand',()=>owner(()=>{
  addVocabularyWord('new');
  db.prepare("UPDATE learner_word_schedules SET next_eligible_at='2999-01-01T00:00:00.000Z' WHERE word_id!='new'").run();
  db.prepare("UPDATE content_items SET availability='retired' WHERE content_id='intro-new'").run();
  const requested:string[]=[];
  const empty=previewVocabularyStudy({});
  assert.equal(empty.itemCount,0);assert.equal(empty.preparationPending,true);assert.deepEqual(requested,[]);
  const beforeFailure=db.prepare('SELECT total_changes() AS n').get()!.n;
  assert.doesNotThrow(()=>previewVocabularyStudy({}));
  assert.equal(db.prepare('SELECT total_changes() AS n').get()!.n,beforeFailure);
  db.prepare("INSERT OR REPLACE INTO learner_settings VALUES('alice','daily_new_word_limit','0','2026-10-24')").run();
  const limited=previewVocabularyStudy({});
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
  const preview=previewVocabularyStudy({});
  assert.equal(preview.itemCount,0);
  assert.throws(()=>startVocabularyStudy({previewSeed:preview.previewSeed}),/introductions are being prepared/);
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
    const preview=previewVocabularyStudy({previewSeed:seed});counts.add(preview.itemCount);
    if(chosen===undefined||preview.itemCount>chosen.itemCount)chosen=preview;
  }
  assert.equal(counts.size,2);assert.ok(chosen);
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM learner_pure_cue_schedules ORDER BY content_id').all()),before);
  const started=startVocabularyStudy({previewSeed:chosen.previewSeed});
  assert.equal(chosen.itemCount,started.session.context.words.length+(started.session.context.reviewOrder??[]).filter((entry)=>entry.kind==='pure_cue').length);
  assert.ok(started.session.context.reviewOrder?.some((entry)=>entry.id===strongId));
}));

test('Start prioritizes a due strong-cue recheck while a word still needs to be due for review',()=>owner(()=>{
  db.exec(`UPDATE learner_words SET mode='practice' WHERE word_id='a';
    UPDATE learner_word_schedules SET scheduler_state_json=json_set(scheduler_state_json,
      '$.intervalHours',720,'$.postCompensationEarliestCheckAt','2020-01-01T00:00:00.000Z'),
      last_practised_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE word_id='a';`);
  exercise('recheck-strong','b','general',true);
  exercise('routine-fragile','b','general',true);
  adoptVocabularyPureCues();
  db.exec(`UPDATE learner_pure_cue_schedules SET next_eligible_at='2020-01-01T00:00:00.000Z';
    UPDATE learner_pure_cue_schedules SET scheduler_state_json=json_set(scheduler_state_json,
      '$.strongSince','2020-01-01T00:00:00.000Z','$.strongSuccesses',3,'$.postCompensationRecheckAt','2020-01-02T00:00:00.000Z'),
      last_practised_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE content_id='recheck-strong';`);
  const preview=previewVocabularyStudy({previewSeed:'required-rechecks'});
  const started=startVocabularyStudy({previewSeed:preview.previewSeed});
  assert.deepEqual(started.session.context.reviewOrder?.[0],{kind:'pure_cue',id:'recheck-strong'});
  assert.ok(started.session.context.reviewOrder?.some(entry=>entry.id==='routine-fragile'));
  assert.equal(started.session.context.words.some(word=>word.wordId==='a'),false);
  assert.equal(preview.itemCount,started.session.context.words.length+
    (started.session.context.reviewOrder??[]).filter(entry=>entry.kind==='pure_cue').length);
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
  assert.throws(()=>commandVocabularyStudy('maintain','mode',{type:'mode',mode:'practice'}),/successful session closure/);
  assert.equal(view.session.projection.words.b.mode,'maintain');
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
  setDb(db); // More still works from the durable narrowed repertoire.
  view=nextVocabularyExercise('new-session','after-teaching-more',{wordId:'new'});
  assert.equal(view.session.projection.words.new.mode,'solidify');assert.equal(view.currentEncounter?.snapshot.role,'general');
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

test('correct hanzi can be marked wrong, while a typed miss cannot be reclassified',()=>owner(()=>{
  let view=focusedA();const id=view.session.sessionId;
  assert.equal(view.currentEncounter?.snapshot.kind,'production');
  view=commandVocabularyStudy(id,'accepted',{type:'response',response:'甲'});
  assert.equal(view.currentEncounter?.effectiveResponses[0]?.payload.outcome,'accepted');
  assert.equal(view.currentEncounter?.effectiveResponses[0]?.payload.selfAssessment,undefined);
  assert.equal(view.session.projection.words.a.covered,true);
  assert.equal(view.session.projection.words.a.successfulRecall,true);
  view=commandVocabularyStudy(id,'undo-accepted',{type:'undo'});
  assert.equal(view.currentEncounter?.effectiveResponses.length,0);
  assert.equal(view.session.projection.words.a.covered,false);
  assert.throws(()=>commandVocabularyStudy(id,'bad-override',{type:'response',response:'错',selfAssessment:'rejected'}),/accepted written answer/);
  assert.throws(()=>commandVocabularyStudy(id,'accept-mark',{type:'response',response:'甲',selfAssessment:'accepted'}),/accepted written answer/);
  view=commandVocabularyStudy(id,'override',{type:'response',response:'甲',selfAssessment:'rejected'});
  const marked=view.currentEncounter?.effectiveResponses[0]?.payload;
  assert.equal(marked?.response,'甲');
  assert.equal(marked?.outcome,'rejected');
  assert.equal(marked?.selfAssessment,'rejected');
  assert.equal(view.session.projection.words.a.covered,false);
  assert.equal(view.session.projection.words.a.hasRejectedResponse,true);
  assert.equal(view.session.projection.words.a.successfulProductionResponses,0);
  assert.equal(view.session.projection.words.a.skillProgress.production.rejectedResponses,1);
  assert.equal(view.session.projection.words.a.skillProgress.production.consecutiveAccepted,0);
  view=commandVocabularyStudy(id,'undo-override',{type:'undo'});
  assert.equal(view.currentEncounter?.effectiveResponses.length,0);
  assert.equal(view.session.projection.words.a.skillProgress.production.rejectedResponses,0);
  view=commandVocabularyStudy(id,'miss',{type:'response',response:'错'});
  assert.equal(view.currentEncounter?.effectiveResponses[0]?.payload.outcome,'rejected');
  assert.equal(view.currentEncounter?.effectiveResponses[0]?.payload.response,'错');
  assert.equal(view.currentEncounter?.effectiveResponses[0]?.payload.selfAssessment,undefined);
}));

test('a pronunciation rejection requires three later accepts before practice coverage',()=>owner(()=>{
  let view=focusedA();const id=view.session.sessionId;
  view=commandVocabularyStudy(id,'override',{type:'response',response:'甲',selfAssessment:'rejected'});
  assert.equal(view.session.projection.words.a.covered,false);
  for(let index=0;index<3;index++){
    view=nextVocabularyExercise(id,`next-${index}`,{wordId:'a'});
    assert.equal(view.currentEncounter?.snapshot.kind,'production');
    view=commandVocabularyStudy(id,`accept-${index}`,{type:'response',response:'甲'});
    assert.equal(view.session.projection.words.a.skillProgress.production.consecutiveAccepted,index+1);
  }
  assert.equal(view.session.projection.words.a.covered,true);
  assert.equal(view.session.projection.words.a.successfulRecall,true);
  assert.equal(view.session.projection.words.a.skillProgress.production.rejectedResponses,1);
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

test('active wrap-up can return to its unstarted due work without changing modes or repeating effects',()=>owner(()=>{
  changeVocabularyMode('a','practice',getVocabularyLearnerWord('a')!.stateVersion);
  addVocabularyWord('new');changeVocabularyMode('new','practice',getVocabularyLearnerWord('new')!.stateVersion);
  exercise('general-b','b');exercise('general-new','new');
  const id='return-all-due';
  createVocabularySession({sessionId:id,words:['a','b','new'].map(wordId=>({wordId,mode:'practice',selectedSkill:'production'}))});
  const schedules=['a','b','new'].map(getVocabularyWordSchedule);
  nextVocabularyExercise(id,'first',{wordId:'a'});
  commandVocabularyStudy(id,'first-answer',{type:'response',response:'甲'});
  nextVocabularyExercise(id,'second',{wordId:'b'});
  const finishing=commandVocabularyStudy(id,'finish',{type:'finishForNow'});
  assert.equal(finishing.session.projection.phase,'finishing');
  assert.equal(finishing.session.projection.words.new.admitted,false);
  const resumed=commandVocabularyStudy(id,'resume',{type:'resume'});
  assert.equal(resumed.session.projection.phase,'active');
  assert.deepEqual(resumed.session.context,finishing.session.context);
  assert.deepEqual(resumed.currentEncounter,finishing.currentEncounter);
  assert.deepEqual(resumed.session.projection.words,finishing.session.projection.words);
  assert.deepEqual(commandVocabularyStudy(id,'resume',{type:'resume'}).session.actions,resumed.session.actions);
  const undone=commandVocabularyStudy(id,'undo-resume',{type:'undo'});
  assert.equal(undone.session.projection.phase,'finishing');
  assert.deepEqual(undone.session.projection.words,resumed.session.projection.words);
  commandVocabularyStudy(id,'resume-again',{type:'resume'});
  commandVocabularyStudy(id,'second-answer',{type:'response',response:'乙'});
  let view=nextVocabularyExercise(id,'third');
  assert.equal(view.currentWordId,'new');
  view=commandVocabularyStudy(id,'third-answer',{type:'response',response:'新'});
  view=nextVocabularyExercise(id,'done');
  assert.equal(view.session.projection.phase,'completed');
  assert.deepEqual([...view.session.projection.coveredWordIds].sort(),['a','b','new']);
  assert.equal(view.session.actions.filter(action=>action.kind==='mode_change').length,0);
  assert.equal(view.session.actions.filter(action=>action.kind==='response').length,3);
  assert.deepEqual(['a','b','new'].map(getVocabularyWordSchedule),schedules);
  const staged=stageVocabularySessionCompletion(id,view.session.actions.length);
  assert.throws(()=>commandVocabularyStudy(id,'resume-pending',{type:'resume'}),/Cancel the completion/);
  closeVocabularySessionCompletion(id,staged.completionId);
  const effects=db.prepare('SELECT * FROM learner_state_effects ORDER BY rowid').all();
  assert.ok(effects.length>0);
  closeVocabularySessionCompletion(id,staged.completionId);
  assert.deepEqual(db.prepare('SELECT * FROM learner_state_effects ORDER BY rowid').all(),effects);
  assert.throws(()=>commandVocabularyStudy(id,'resume-closed',{type:'resume'}),/Cancel the completion/);
}));

test('return from wrap-up restores unstarted independent cues and ordinary exhaustion completes',()=>owner(()=>{
  changeVocabularyMode('a','practice',getVocabularyLearnerWord('a')!.stateVersion);exercise('unstarted-cue','b','general',true);
  const id='return-cue';
  createVocabularySession({sessionId:id,words:[{wordId:'a',mode:'practice',selectedSkill:'production'}],
    reviewOrder:[{kind:'word',id:'a'},{kind:'pure_cue',id:'unstarted-cue'}]});
  nextVocabularyExercise(id,'first',{wordId:'a'});
  assert.equal(commandVocabularyStudy(id,'finish',{type:'finishForNow'}).session.projection.phase,'finishing');
  commandVocabularyStudy(id,'resume',{type:'resume'});
  commandVocabularyStudy(id,'answer',{type:'response',response:'甲'});
  let view=nextVocabularyExercise(id,'cue');
  assert.equal(view.currentEncounter?.snapshot.schedulingScope,'pure_cue');
  assert.equal(view.currentEncounter?.snapshot.contentId,'unstarted-cue');
  commandVocabularyStudy(id,'cue-answer',{type:'response',response:'乙'});
  view=nextVocabularyExercise(id,'done');
  assert.equal(view.session.projection.phase,'completed');
  assert.equal(view.session.projection.pureCueOutcomes[0].covered,true);
}));

test('return from wrap-up with no unstarted work finishes through ordinary Next',()=>owner(()=>{
  changeVocabularyMode('a','practice',getVocabularyLearnerWord('a')!.stateVersion);
  const id='return-last';createVocabularySession({sessionId:id,words:[{wordId:'a',mode:'practice',selectedSkill:'production'}],reviewOrder:[]});
  nextVocabularyExercise(id,'first');
  commandVocabularyStudy(id,'finish',{type:'finishForNow'});
  commandVocabularyStudy(id,'resume',{type:'resume'});
  commandVocabularyStudy(id,'answer',{type:'response',response:'甲'});
  const view=nextVocabularyExercise(id,'done');
  assert.equal(view.session.projection.phase,'completed');
  assert.equal(view.session.projection.finishReason,'wrapped_up');
  assert.equal(view.session.actions.filter(action=>action.kind==='response').length,1);
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
  db.exec("DELETE FROM learner_word_preparation_reserve; INSERT INTO learner_word_preparation_reserve VALUES('alice','fresh','2026-01-01','2026-01-01','2026-01-01')");
  const requestsBefore=db.prepare('SELECT * FROM learner_word_reserve_requests').all();
  const requested:string[]=[];const view=startVocabularyStudy({});
  assert.deepEqual(db.prepare('SELECT * FROM learner_word_reserve_requests').all(),requestsBefore);
  assert.equal(view.currentWordId,'fresh');assert.equal(view.currentEncounter?.snapshot.kind,'introduction');
  assert.equal(view.session.context.words.filter((entry)=>entry.mode==='unstudied').length,1);
  assert.equal(getVocabularyLearnerWord('fresh')?.inStash,false);assert.equal(getVocabularyLearnerWord('not-ready'),null);
  assert.equal(view.session.context.composition?.introductionOrder,'first');assert.deepEqual(requested,[]);
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

test('a frozen pure cue with reordered accepted answers serves and retries, retaining all forms and crediting no word schedules',()=>owner(()=>{
  const cue=createVocabularyContent({contentId:'multiple-pure',kind:'exercise',payloadVersion:1,body:{prompt:'One of these expressions fits.'},exerciseType:'pure_cue',skill:'production',exerciseRole:'general',
    assessment:{match:'prepared'},accessScope:'shared',availability:'active',originKind:'human',words:[{wordId:'a',relation:'target'},{wordId:'b',relation:'target'}],
    answers:[{wordId:'a',acceptedForms:['甲']},{wordId:'b',acceptedForms:['乙']}]},actor);
  const beforeA=getVocabularyWordSchedule('a'),beforeB=getVocabularyWordSchedule('b');
  adoptVocabularyPureCues(new Date(Date.now()-7*3_600_000).toISOString());
  const context:VocabularySessionInitialContext={sessionId:'multi-session',words:[],reviewOrder:[{kind:'pure_cue',id:cue.contentId}]};
  const payload=composeVocabularySessionPayload(context);
  const retained=payload.snapshots[`${cue.contentId}/general`];assert.ok(retained.assessment);
  // An already-open session can retain a different enumeration of the same answer set.
  retained.assessment={...retained.assessment,acceptedAnswers:['乙','甲']};
  createStoredSession({...context,payload});let view=nextVocabularyExercise('multi-session','next');
  assert.equal(view.currentEncounter?.snapshot.contentId,cue.contentId);assert.deepEqual(view.currentEncounter?.snapshot.assessment?.acceptedAnswers,['乙','甲']);
  const presented=view.session.actions;
  view=nextVocabularyExercise('multi-session','next');assert.deepEqual(view.session.actions,presented);
  view=commandVocabularyStudy('multi-session','answer',{type:'response',response:'甲'});assert.deepEqual(view.session.projection.coveredWordIds,[]);
  view=commandVocabularyStudy('multi-session','finish',{type:'finishForNow'});
  const staged=stageVocabularySessionCompletion('multi-session',view.session.actions.length);closeVocabularySessionCompletion('multi-session',staged.completionId);
  assert.deepEqual(getVocabularyWordSchedule('a'),beforeA);assert.deepEqual(getVocabularyWordSchedule('b'),beforeB);
}));

test('new mode commands cannot alter any active or finishing session mode',()=>owner(()=>{
  for(const mode of ['unstudied','solidify','practice','maintain'] as const) {
    db.prepare('UPDATE learner_words SET mode=? WHERE word_id=?').run(mode,'a');
    const id=`fixed-${mode}`;createVocabularySession({sessionId:id,words:[{wordId:'a',mode}]});
    const before=nextVocabularyExercise(id,`${id}-next`);
    assert.equal(before.controls.canChangeMode,false);
    assert.throws(()=>commandVocabularyStudy(id,'change',{type:'mode',mode:'practice'}),/successful session closure/);
    assert.deepEqual(getVocabularyStudy(id).session.actions,before.session.actions);
    const finishing=before.session.projection.phase==='completed'?before:commandVocabularyStudy(id,'finish',{type:'finishForNow'});
    assert.throws(()=>commandVocabularyStudy(id,'change-finishing',{type:'mode',mode:'unstudied'}),/successful session closure/);
    assert.deepEqual(getVocabularyStudy(id).session.actions,finishing.session.actions);
  }
}));

test('retained historical mode actions replay and acknowledged retries stay idempotent',()=>owner(()=>{
  const initial=focusedA();const id=initial.session.sessionId;
  const command={type:'mode' as const,wordId:'a',mode:'solidify' as const};
  appendVocabularySessionActions(id,[{protocolVersion:1,actionId:'historical-mode',clientActionId:'historical-mode',
    sequence:initial.session.actions.length+1,occurredAt:'2026-11-01T00:00:00.000Z',kind:'mode_change',payload:{wordId:'a',mode:'solidify'},commandInput:command}]);
  setDb(db);
  const replay=getVocabularyStudy(id);assert.equal(replay.session.projection.words.a.mode,'solidify');
  assert.deepEqual(commandVocabularyStudy(id,'historical-mode',command).session.actions,replay.session.actions);
  assert.throws(()=>commandVocabularyStudy(id,'new-mode',command),/successful session closure/);
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

test('pending and failed completion reject mode edits; closed future edits preserve session evidence',()=>owner(()=>{
  let view=focusedA('solidify');const id=view.session.sessionId;productionExercise(id,'first');
  view=commandVocabularyStudy(id,'answer',{type:'response',response:'甲'});
  view=commandVocabularyStudy(id,'finish',{type:'finishForNow'});
  const staged=stageVocabularySessionCompletion(id,view.session.actions.length);
  assert.throws(()=>commandVocabularyStudy(id,'pending-mode',{type:'mode',wordId:'a',mode:'maintain'}),/completion revision/);
  db.prepare("UPDATE vocabulary_session_completions SET status='failed' WHERE completion_id=?").run(staged.completionId);setDb(db);
  assert.throws(()=>commandVocabularyStudy(id,'failed-mode',{type:'mode',wordId:'a',mode:'maintain'}),/completion revision/);
  closeVocabularySessionCompletion(id,staged.completionId);
  const closed=getVocabularyStudy(id).session;
  const learner=getVocabularyLearnerWord('a')!;
  assert.equal(learner.mode,'practice');assert.equal(learner.automaticPromotionPaused,false);
  const held=changeVocabularyMode('a','solidify',learner.stateVersion);assert.equal(held.automaticPromotionPaused,true);
  const heldAgain=changeVocabularyMode('a','solidify',held.stateVersion);
  assert.equal(heldAgain.automaticPromotionPaused,true);assert.equal(heldAgain.stateVersion,held.stateVersion+1);
  changeVocabularyMode('a','maintain',heldAgain.stateVersion);
  assert.equal(getVocabularyLearnerWord('a')?.mode,'maintain');
  const after=getVocabularyStudy(id).session;
  assert.deepEqual(after.actions,closed.actions);assert.deepEqual(after.context,closed.context);assert.deepEqual(after.projection,closed.projection);
  assert.deepEqual(after.completion?.report,closed.completion?.report);assert.equal(after.completion?.closedAt,closed.completion?.closedAt);
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

test('teaching uses both recall directions despite later review skill settings',()=>owner(()=>{
  createVocabularyContent({contentId:'authored-recognition',kind:'exercise',payloadVersion:1,body:{prompt:'新'},
    exerciseType:'recognition',skill:'recognition',exerciseRole:'teaching',assessment:{responseMode:'self_assessment'},
    accessScope:'shared',availability:'active',originKind:'human',words:[{wordId:'new',relation:'target'}],
    answers:[{wordId:'new',acceptedForms:['新']}]},actor);
  const intro=getVocabularyContent('intro-new');
  assert.ok(intro?.kind==='introduction');
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
    assert.ok(composeVocabularySessionPayload({sessionId:'later',words:[{wordId:'new',mode:'unstudied'}]}).words.new.teaching);
    assert.equal(stopped.session.projection.words.new.workStatus,'open');
    assert.equal(stopped.session.projection.words.new.covered,false);
    assert.equal(stopped.session.projection.words.new.teachingCompleted,false);
    assert.equal(getVocabularyLearnerWord('new')?.mode,'unstudied');
  }
}));

for(const restriction of ['disabled','suppressed'] as const)for(const authored of [true,false])
test(`Solidify retains both directions with ${restriction} review skills and ${authored?'authored':'fallback'} production`,()=>owner(()=>{
  db.prepare("UPDATE learner_words SET dismissed_at='2026-10-17T00:00:00.000Z' WHERE word_id IN ('b','new')").run();
  if(restriction==='disabled')db.prepare("INSERT INTO learner_owned_word_skill_state VALUES('alice','a','recognition',24,2.5,0,NULL,NULL),('alice','a','production',24,2.5,0,NULL,NULL)").run();
  else db.prepare("INSERT INTO learner_owned_word_skill_relevance VALUES('alice','a','recognition','suppressed'),('alice','a','production','suppressed')").run();
  if(!authored)db.prepare("UPDATE content_items SET availability='retired' WHERE content_id IN ('general-1','general-2')").run();
  db.prepare("UPDATE learner_word_schedules SET scheduler_state_json=json_set(scheduler_state_json,'$.enabled',0) WHERE word_id='a'").run();
  let view=startVocabularyStudy();const id=view.session.sessionId;
  assert.deepEqual(view.session.context.words.find(word=>word.wordId==='a')?.solidifySkills,['recognition','production']);
  if(view.currentEncounter?.snapshot.kind==='introduction')view=nextVocabularyExercise(id,'recall');
  const served=new Set<string>();
  for(let step=0;step<4&&!view.session.projection.words.a.covered;step++) {
    const kind=view.currentEncounter!.snapshot.kind;
    assert.ok(kind==='recognition'||kind==='production');served.add(kind);
    view=commandVocabularyStudy(id,`answer-${step}`,kind==='recognition'
      ?{type:'response',response:null,selfAssessment:'accepted'}:{type:'response',response:'甲'});
    if(served.size===1)assert.equal(view.session.projection.words.a.covered,false);
    if(!view.session.projection.words.a.covered)view=nextVocabularyExercise(id,`next-${step}`);
  }
  assert.deepEqual([...served].sort(),['production','recognition']);
  assert.equal(view.session.projection.words.a.covered,true);
  assert.equal(view.session.projection.words.a.recommendedMode,'practice');
  view=commandVocabularyStudy(id,'finish',{type:'finishForNow'});
  const staged=stageVocabularySessionCompletion(id,view.session.actions.length,'2026-10-23T10:00:00.000Z');
  closeVocabularySessionCompletion(id,staged.completionId,'2026-10-23T10:00:16.000Z');
  assert.equal(getVocabularyLearnerWord('a')?.mode,'practice');
  assert.equal(getVocabularyWordSchedule('a')?.schedulerState.enabled,0);
  if(restriction==='disabled')assert.equal(db.prepare("SELECT COUNT(*) AS n FROM learner_owned_word_skill_state WHERE word_id='a' AND enabled=0").get()!.n,2);
  else assert.equal(db.prepare("SELECT COUNT(*) AS n FROM learner_owned_word_skill_relevance WHERE word_id='a' AND relevance_state='suppressed'").get()!.n,2);
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

for (const mode of ['practice', 'maintain'] as const) test(`${mode} with explicitly empty defaults admits recognition and freezes no word production`,()=>owner(()=>{
  db.prepare("UPDATE learner_words SET mode=? WHERE word_id='b'").run(mode);
  const before=createVocabularySession({sessionId:'before-empty-defaults',words:[{wordId:'b',mode,selectedSkill:'production'}]});
  const fallback=before.context.payload!.words.b.general[mode].find(content=>content.skill==='production');
  assert.equal(fallback?.exerciseType,'definition','unknown defaults keep legacy fallback');
  exercise('authored-b','b');
  if(mode==='maintain')db.prepare("INSERT INTO content_mode_suitability VALUES('authored-b','maintain','curated',1)").run();
  createVocabularySense({senseId:'b-sense',wordId:'b',description:'Secondary use'},actor);
  establishVocabularySenseCatalog('b',getVocabularySenseCatalog('b').version,actor);
  const now='2026-11-09T10:00:00.000Z';
  assert.equal(selectVocabularyReviewSkills({now}).find(selection=>selection.wordId==='b')?.skillId,'production');
  writeVocabularyDefaultUsefulSenses('b',0,[],actor);
  db.prepare("INSERT INTO learner_owned_word_skill_state VALUES('alice','b','recognition',6,2.5,1,NULL,NULL)").run();
  assert.equal(selectVocabularyReviewSkills({now}).find(selection=>selection.wordId==='b')?.skillId,'recognition');
  const after=createVocabularySession({sessionId:'after-empty-defaults',words:[{wordId:'b',mode,selectedSkill:'recognition'}]});
  assert.deepEqual(after.context.payload!.words.b.general[mode].map(content=>content.skill),['recognition']);
  assert.equal(nextVocabularyExercise(before.sessionId,'next').currentEncounter?.snapshot.contentId,fallback?.contentId);
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

test('Preview, Start and live HTTP actions never wake background workers',async()=>owner(async()=>{
  db.prepare("INSERT OR REPLACE INTO learner_settings VALUES('alice','daily_new_word_limit','0','2026-10-27')").run();
  const routes=new Map<string,(req:Request,res:Response)=>void>();
  const register=(method:string)=>(path:string,handler:(req:Request,res:Response)=>void)=>{routes.set(`${method} ${path}`,handler);};
  let wakes=0;registerVocabularyStudyRoutes({get:register('GET'),post:register('POST')} as unknown as Express,()=>{wakes++;});
  const call=(route:string,id:string,body:unknown={})=>{
    let result:VocabularyStudy|undefined;let status=200;
    const response={json(value:VocabularyStudy){result=value;return this;},status(value:number){status=value;return this;}};
    // Handlers read only params and body, so a partial request is a deliberate minimal stand-in.
    routes.get(route)!({params:{id},body} as unknown as Request,response as unknown as Response);
    assert.equal(status,200);assert.ok(result);return result;
  };
  const started=call('POST /api/vocabulary/sessions','');
  assert.equal(wakes,0,'no synchronous worker work before response');
  await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(wakes,0);
  const id=started.session.sessionId;
  call('GET /api/vocabulary/sessions/:id',id);
  call('POST /api/vocabulary/sessions/:id/next',id,{clientActionId:'route-next'});
  call('POST /api/vocabulary/sessions/:id/commands',id,{clientActionId:'route-command',command:{type:'skip'}});
  await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(wakes,0);
}));


function makeInventoryEmpty(wordId:string):void {
  for(const sense of getVocabularySenses(wordId).filter(sense=>sense.status==='active')) {
    updateVocabularySense(sense.senseId,sense.version,{description:sense.description,status:'retired'},actor);
  }
  if(getVocabularySenseCatalog(wordId).establishedAt===null)establishVocabularySenseCatalog(wordId,getVocabularySenseCatalog(wordId).version,actor);
}

test('empty inventories block fresh admission while stashes and retained word sessions survive',()=>owner(()=>{
  addVocabularyWord('new');
  const retained=startVocabularyStudy();
  const stashed=getVocabularyLearnerWord('new');
  for(const wordId of ['a','b','new'])makeInventoryEmpty(wordId);
  const requested:string[]=[];
  const preview=previewVocabularyStudy({});
  assert.equal(preview.itemCount,0);assert.equal(preview.preparationPending,false);assert.deepEqual(requested,[]);
  assert.throws(()=>startVocabularyStudy(),/No ready study material/);
  assert.deepEqual(getVocabularyLearnerWord('new'),stashed);
  assert.deepEqual(getVocabularyStudy(retained.session.sessionId).session.context.words,retained.session.context.words);
  assert.ok(nextVocabularyExercise(retained.session.sessionId,'still-retained').currentEncounter);
}));

test('pure cues with an empty-inventory answer stop fresh admission without changing retained cues or schedules',()=>owner(()=>{
  const cue=createVocabularyContent({contentId:'mixed-pure',kind:'exercise',payloadVersion:1,body:{prompt:'Retrieve either'},
    accessScope:'shared',availability:'active',originKind:'human',words:[{wordId:'a',relation:'target'},{wordId:'b',relation:'target'}],exerciseType:'pure_cue',
    skill:'production',exerciseRole:'general',assessment:{match:'prepared'},answers:[{wordId:'a',acceptedForms:['甲']},{wordId:'b',acceptedForms:['乙']}]},actor);
  db.prepare(`INSERT INTO learner_pure_cue_schedules(learner_id,content_id,policy_version,scheduler_state_json) VALUES('alice',?,'test',?)`)
    .run(cue.contentId,JSON.stringify({intervalHours:24,easeFactor:2.5,enabled:1,cleanCoveredSessions:0}));
  createVocabularySession({sessionId:'retained-pure',words:[]});
  const schedules=db.prepare('SELECT * FROM learner_pure_cue_schedules').all();
  makeInventoryEmpty('a');
  assert.deepEqual(selectVocabularyPureCueCandidates({ordinaryReviewCount:20,sessionSeed:'empty'}),[]);
  assert.deepEqual(db.prepare('SELECT * FROM learner_pure_cue_schedules').all(),schedules);
  const retained=nextVocabularyExercise('retained-pure','still-retained');
  assert.equal(retained.currentEncounter?.snapshot.contentId,cue.contentId);
  assert.deepEqual(retained.currentEncounter?.snapshot.assessment?.acceptedAnswers,['甲','乙']);
}));

test('contrast choices with empty inventories cannot enter a fresh session but retained contrasts remain usable',()=>owner(()=>{
  contrastContent();
  db.prepare("INSERT INTO learner_owned_word_skill_state VALUES('alice','a','contextual_selection',6,2.5,1,NULL,NULL)").run();
  db.prepare("UPDATE learner_words SET mode='practice' WHERE word_id='a'").run();
  createVocabularySession({sessionId:'retained-contrast',words:[{wordId:'a',mode:'practice',selectedSkill:'contextual_selection'}]});
  makeInventoryEmpty('b');
  const fresh=startVocabularyStudy();
  assert.equal(fresh.session.context.words.some(word=>word.selectedSkill==='contextual_selection'),false);
  assert.equal(nextVocabularyExercise('retained-contrast','still-retained').currentEncounter?.snapshot.kind,'contrast');
}));


test('shared ordinary cues with an empty-inventory alternative are excluded from fresh pools but retained sessions keep them',()=>owner(()=>{
  const shared=createVocabularyContent({contentId:'shared-alternatives',kind:'exercise',payloadVersion:1,body:{prompt:'Either expression'},
    accessScope:'shared',availability:'active',originKind:'human',words:[{wordId:'a',relation:'target'},{wordId:'b',relation:'target'}],
    exerciseType:'word',skill:'production',exerciseRole:'general',assessment:{match:'prepared'},
    answers:[{wordId:'a',acceptedForms:['甲']},{wordId:'b',acceptedForms:['乙']}]},actor);
  db.prepare("UPDATE learner_words SET mode='practice' WHERE word_id='a'").run();
  db.prepare("UPDATE content_items SET availability='retired' WHERE content_id IN ('general-1','general-2')").run();
  createVocabularySession({sessionId:'retained-shared',words:[{wordId:'a',mode:'practice'}]});
  makeInventoryEmpty('b');
  const fresh=startVocabularyStudy();
  const payload=composeVocabularySessionPayload({sessionId:'fresh-pool',words:[{wordId:'a',mode:'practice'}]});
  assert.equal(JSON.stringify(payload).includes(shared.contentId),false);
  assert.ok(fresh.session.context.words.some(word=>word.wordId==='a'));
  assert.equal(nextVocabularyExercise('retained-shared','next').currentEncounter?.snapshot.contentId,shared.contentId);
}));

function blockReconciledWord(wordId:string):void {
  db.prepare(`INSERT INTO sense_content_reconciliations
    (resolution_id,word_id,version,status,draft_json,snapshot_json,applied_plan_json,authority_json,practice_source_json,actor_id,created_at,updated_at,applied_at)
    VALUES (?, ?, 1, 'applied','{}','{}','{}','{}',?,'test','2026-11-06','2026-11-06','2026-11-06')`).run(`resolution-${wordId}`,wordId,JSON.stringify({source:{word:{wordId,hanzi:'字',traditional:null,pinyin:'zì'},uses:[],examples:[]},senses:[]}));
}
test('failed reconciliation blocks fresh study while retained sessions and learner state survive',()=>owner(()=>{
  addVocabularyWord('new');
  const retained=startVocabularyStudy();
  const learner=db.prepare('SELECT * FROM learner_words ORDER BY word_id').all();
  for(const wordId of ['a','b','new'])blockReconciledWord(wordId);
  const preview=previewVocabularyStudy();
  assert.equal(preview.itemCount,0);
  assert.equal(preview.preparationPending,true);
  assert.throws(()=>startVocabularyStudy(),/Replacement study content/);
  assert.deepEqual(getVocabularyStudy(retained.session.sessionId).session.context.words,retained.session.context.words);
  assert.ok(nextVocabularyExercise(retained.session.sessionId,'retained-during-reconciliation').currentEncounter);
  assert.deepEqual(db.prepare('SELECT * FROM learner_words ORDER BY word_id').all(),learner);
}));
test('reconciliation excludes shared cues with a blocked alternative from fresh pools',()=>owner(()=>{
  const shared=createVocabularyContent({contentId:'recon-alternatives',kind:'exercise',payloadVersion:1,body:{prompt:'Either'},
    accessScope:'shared',availability:'active',originKind:'human',words:[{wordId:'a',relation:'target'},{wordId:'b',relation:'target'}],
    exerciseType:'word',skill:'production',exerciseRole:'general',assessment:{match:'prepared'},
    answers:[{wordId:'a',acceptedForms:['甲']},{wordId:'b',acceptedForms:['乙']}]},actor);
  blockReconciledWord('b');
  const payload=composeVocabularySessionPayload({sessionId:'recon-pool',words:[{wordId:'a',mode:'practice'}]});
  assert.equal(JSON.stringify(payload).includes(shared.contentId),false);
}));

test('ordinary review trusts SQL flags and Solidify ignores review skill flags',()=>owner(()=>{
  addVocabularyWord('b');
  db.prepare("UPDATE learner_words SET dismissed_at='2026-01-01' WHERE word_id!='b'").run();
  db.prepare("UPDATE learner_words SET mode='practice' WHERE word_id='b'").run();
  db.prepare("UPDATE learner_word_schedules SET next_eligible_at=NULL,last_practised_at=NULL WHERE word_id='b'").run();
  db.prepare("INSERT OR REPLACE INTO learner_settings VALUES('alice','daily_new_word_limit','0','2026-01-01')").run();
  const prepare=db.prepare.bind(db);const reads:string[]=[];
  db.prepare=((sql:string)=>{if(/^SELECT (enabled|relevance_state) FROM learner_owned_word_skill_/.test(sql))reads.push(sql);return prepare(sql);}) as typeof db.prepare;
  try {
    const preview=previewVocabularyStudy();
    assert.equal(preview.itemCount,1);
    assert.equal(reads.length,0); // Baseline: two prepared/executed lookups per review objective.
    db.prepare("UPDATE learner_words SET mode='solidify' WHERE word_id='b'").run();
    db.prepare("INSERT INTO learner_owned_word_skill_state VALUES('alice','b','recognition',24,2.5,0,NULL,NULL),('alice','b','production',24,2.5,0,NULL,NULL)").run();
    reads.length=0;
    assert.equal(previewVocabularyStudy().itemCount,1);
    assert.equal(reads.length,0);
  } finally {db.prepare=prepare;}
}));

test('pure cue selection hydrates only scheduled winners while preserving order and frozen content',async(t)=>owner(()=>{
  const now='2026-11-07T12:00:00.000Z';
  const past='2026-01-01T00:00:00.000Z';const future='2027-01-01T00:00:00.000Z';
  const cues:import('../src/domain/pure-cues.ts').PureCue[]=[];
  for(let index=0;index<300;index++) {
    const id=`hydration-${String(index).padStart(3,'0')}`;exercise(id,'b','general',true);
    const strong=index>=9;const reset=index>=6&&index<9;const due=index<3||strong;
    const state={intervalHours:24,easeFactor:2.5,strongSince:strong?past:null,strongSuccesses:0,resetUntil:reset?future:null};
    db.prepare("INSERT INTO learner_pure_cue_schedules(learner_id,content_id,last_practised_at,next_eligible_at,policy_version,scheduler_state_json) VALUES('alice',?,?,?,'test',?)")
      .run(id,past,due?past:future,JSON.stringify(state));
    cues.push({id,kind:'pure',stimulus:'',axisNote:'',teachingNote:'',acceptedWordIds:['b'],active:!reset,
      ...state,lastStudiedAt:past,nextDueAt:due?past:future});
  }
  let draw=0;const seed='fixed-hydration-seed';
  const random=()=>parseInt(createHash('sha256').update(`${seed}/${draw++}`).digest('hex').slice(0,8),16)/0x100000000;
  const expected=selectPureCuesForSession({learnerId:'alice',cues,ordinaryReviewCount:20,now,random}).selected.map(cue=>cue.id);
  assert.ok(expected.length>3,'fixture includes a strong maintenance winner');
  const prepare=db.prepare.bind(db);let contentReads=0;
  db.prepare=((sql:string)=>{if(sql==='SELECT * FROM content_items WHERE content_id = ?')contentReads++;return prepare(sql);}) as typeof db.prepare;
  try {
    const started=performance.now();
    const selected=selectVocabularyPureCueCandidates({ordinaryReviewCount:20,sessionSeed:seed,now,adopt:false});
    assert.deepEqual(selected.map(cue=>cue.contentId),expected);
    assert.equal(contentReads,selected.length); // Baseline: 600 hydrations for these 300 candidates.
    assert.ok(selected.every(cue=>cue.kind==='exercise'&&cue.answers[0]?.acceptedForms[0]==='乙'));
    t.diagnostic(`Pure cues: ${contentReads} full-content hydrations for 300 candidates / ${selected.length} winners; ${(performance.now()-started).toFixed(2)} ms selection`);
  } finally {db.prepare=prepare;}
}));

test('pure cue metadata checks reconciliation for target relationships and alternative answers',()=>owner(()=>{
  createVocabularyContent({contentId:'pure-reconciliation',kind:'exercise',payloadVersion:1,body:{prompt:'Either'},
    accessScope:'shared',availability:'active',originKind:'human',words:[{wordId:'a',relation:'target'},{wordId:'b',relation:'target'}],
    exerciseType:'pure_cue',skill:'production',exerciseRole:'general',assessment:{match:'prepared'},
    answers:[{wordId:'b',acceptedForms:['乙']}]},actor);
  adoptVocabularyPureCues('2026-01-01T00:00:00.000Z');
  const select=()=>selectVocabularyPureCueCandidates({ordinaryReviewCount:20,sessionSeed:'reconciliation',now:'2026-11-07T12:00:00.000Z',adopt:false});
  assert.deepEqual(select().map(cue=>cue.contentId),['pure-reconciliation']);
  for(const wordId of ['a','b']) {
    blockReconciledWord(wordId);
    assert.deepEqual(select(),[]);
    db.prepare('DELETE FROM sense_content_reconciliations WHERE word_id=?').run(wordId);
  }
}));

test('reserve admission resolves newest usable introduction and freezes its coherent binding',()=>owner(()=>{
  addVocabularyWord('new');
  exercise('teach-newer','new','teaching');
  createVocabularyContent({contentId:'intro-newer',kind:'introduction',payloadVersion:1,body:{beats:[{text:'Newer teaching'}]},
    accessScope:'shared',availability:'active',originKind:'human',words:[{wordId:'new',relation:'target'}],
    teachingExercises:[{exerciseId:'teach-newer',exerciseVersion:1}]},actor);
  db.prepare("UPDATE content_items SET updated_at='2026-10-20T00:00:00.000Z' WHERE content_id='intro-newer'").run();
  db.prepare("UPDATE content_items SET updated_at='2026-10-19T00:00:00.000Z' WHERE content_id='intro-new'").run();
  const first=startVocabularyStudy();
  assert.equal(first.currentEncounter?.snapshot.contentId,'intro-newer');
  assert.ok(first.session.context.words.find(w=>w.wordId==='new')?.teachingRequirements?.requiredExerciseContentIds.includes('teach-newer'));
  const prior=getVocabularyContent('intro-new')!;
  updateVocabularyContent(prior.contentId,prior.version,{...prior,body:{beats:[{text:'Most recent revision of older identity'}]}},actor);
  const next=startVocabularyStudy();assert.equal(next.currentEncounter?.snapshot.contentId,'intro-new');
  assert.equal(getVocabularyStudy(first.session.sessionId).currentEncounter?.snapshot.contentId,'intro-newer');
}));


test('a stale ready hint with an unresolved partial sense inventory is skipped and diagnosed',()=>owner(()=>{
  addVocabularyWord('new');
  db.prepare("UPDATE vocabulary_word_catalogs SET senses_established_at=NULL WHERE word_id='new'").run();
  assert.doesNotThrow(()=>previewVocabularyStudy());
  const findings=db.prepare("SELECT entity_id FROM backend_events WHERE name='vocabulary.reserve.stale_hint'").all();
  assert.ok(findings.some(row=>row.entity_id==='new'));
}));

for(const mode of ['unstudied','solidify','practice','maintain'] as const)test(`measure reachable payload ${mode}`, {skip:process.env.RUN_PAYLOAD_BENCHMARK!=='1'},()=>owner(()=>{
  db.prepare("INSERT INTO content_mode_suitability(content_id,mode,suitability,assessed_content_version) VALUES('general-1','maintain','curated',1)").run();
  const context:VocabularySessionInitialContext={sessionId:'payload-measure',words:[{wordId:'a',mode,selectedSkill:'production'}]};
  composeVocabularySessionPayload(context); // Separate one-time baseline creation from retained assembly.
  const prepare=db.prepare.bind(db);let contentReads=0;let calls=0;
  Object.defineProperty(db,'prepare',{configurable:true,value:(sql:string)=>{calls++;if(/FROM content_items|JOIN content_words|FROM content_words|FROM content_answers/i.test(sql))contentReads++;return prepare(sql);}});
  let payload:ReturnType<typeof composeVocabularySessionPayload>;const start=performance.now();
  try{payload=composeVocabularySessionPayload(context);}finally{delete (db as unknown as {prepare?:unknown}).prepare;}
  console.log(JSON.stringify({benchmark:'reachable-payload',mode,bytes:Buffer.byteLength(JSON.stringify(payload)),contentReads,prepareCalls:calls,elapsedMs:Number((performance.now()-start).toFixed(3))}));
}));

for(const mode of ['unstudied','solidify','practice','maintain'] as const)test(`${mode} retains only reachable session material`,()=>owner(()=>{
  const payload=composeVocabularySessionPayload({sessionId:'reachable',words:[{wordId:'a',mode,selectedSkill:'production'}]});
  const word=payload.words.a;const reachable=mode==='unstudied'?'solidify':mode;
  for(const pool of ['solidify','practice','maintain'] as const)if(pool!==reachable)assert.deepEqual(word.general[pool],[]);
  assert.ok(word.general[reachable].length>0);
  assert.equal(word.teaching!==null,mode==='unstudied');assert.equal(word.priming!==null,mode==='solidify');
  const snapshots=Object.values(payload.snapshots);
  assert.equal(snapshots.some(entry=>entry.role==='teaching'),mode==='unstudied');
  assert.equal(snapshots.some(entry=>entry.role==='priming'),mode==='solidify');
}));

test('Solidify preserves current usable priming identity without retaining teaching exercises',()=>owner(()=>{
  createVocabularyContent({contentId:'newer-incomplete',kind:'introduction',payloadVersion:1,body:{beats:[]},accessScope:'shared',availability:'active',originKind:'human',words:[{wordId:'a',relation:'target'}],teachingExercises:[]},actor);
  const payload=composeVocabularySessionPayload({sessionId:'priming-choice',words:[{wordId:'a',mode:'solidify'}]});
  assert.equal(payload.words.a.priming?.contentId,'intro-a');assert.equal(payload.words.a.teaching,null);
  assert.equal(payload.snapshots['teach-a/teaching'],undefined);
}));

// Timed daily practice prototype.
const timedOn=()=>db.exec("UPDATE service_controls SET enabled=1 WHERE control_key='timed_sessions'");
const answers:Record<string,string>={a:'甲',b:'乙',new:'新'};
/** Answers whatever is current correctly; returns the next view. */
function answerCurrent(id:string,key:string,view:VocabularyStudy):VocabularyStudy {
  const encounter=view.currentEncounter;
  if(!encounter||encounter.effectiveResponses.length||encounter.skipped||encounter.snapshot.kind==='introduction')return view;
  if(encounter.snapshot.kind==='recognition')return commandVocabularyStudy(id,`${key}-answer`,{type:'response',response:null,selfAssessment:'accepted'});
  return commandVocabularyStudy(id,`${key}-answer`,{type:'response',response:answers[encounter.wordId!]});
}
function practiceAll(...wordIds:string[]) {
  for(const wordId of wordIds){
    if(!getVocabularyLearnerWord(wordId))addVocabularyWord(wordId);
    changeVocabularyMode(wordId,'practice',getVocabularyLearnerWord(wordId)!.stateVersion);
  }
  exercise('general-b','b');exercise('general-new','new');
}
// The wall-clock bound on client active time reads the record's start.
const backdate=(id:string)=>db.prepare("UPDATE vocabulary_timed_session_records SET started_at='2000-01-01T00:00:00.000Z' WHERE session_id=?").run(id);
const makeDue=(wordId:string)=>{
  db.prepare('UPDATE learner_word_schedules SET next_eligible_at=NULL,last_practised_at=NULL WHERE word_id=?').run(wordId);
  db.prepare('DELETE FROM learner_owned_word_study_admission_state WHERE word_id=?').run(wordId);
};
const today=()=>new Date().toISOString().slice(0,10);

test('timed Start freezes the paradigm and records the day; classic sessions keep their controls',()=>owner(()=>{
  const classic=startVocabularyStudy({});
  assert.equal(classic.session.context.timed,undefined);assert.equal(classic.timed,null);assert.equal(classic.controls.canFinishForNow,true);
  timedOn();
  const view=startVocabularyStudy({});const id=view.session.sessionId;
  assert.equal('timed' in view.session.context,false,'timed facts stay server-side');
  assert.deepEqual(view.timed,{budgetWrapped:false,canStudyMore:false,sessionActiveMs:0,note:null});
  assert.equal(view.controls.canFinishForNow,false);
  const row=db.prepare('SELECT day_key,budget_ms,budget_source,day_active_ms_at_start FROM vocabulary_timed_session_records WHERE session_id=?').get(id);
  assert.deepEqual({...row},{day_key:today(),budget_ms:20*60_000,budget_source:'default',day_active_ms_at_start:0});
  assert.equal(previewVocabularyStudy({}).timed,true);
}));

test('timed selection keeps not-yet-started new words shut while runway work is due, then opens them',()=>owner(()=>{
  addVocabularyWord('new');
  // Classic introduction order "first" serves the new word immediately.
  const classic=startVocabularyStudy({});
  assert.equal(classic.currentWordId,'new');
  timedOn();
  let view=startVocabularyStudy({});const id=view.session.sessionId;
  const firstSeen:string[]=[];let aCoveredAt=-1;
  for(let step=0;step<40&&view.session.projection.phase!=='completed';step++) {
    const wordId=view.currentWordId;if(wordId&&!firstSeen.includes(wordId))firstSeen.push(wordId);
    view=answerCurrent(id,`s${step}`,view);
    if(aCoveredAt<0&&view.session.projection.words.a.covered)aCoveredAt=firstSeen.length;
    view=nextVocabularyExercise(id,`n${step}`,{activeDurationMs:0});
  }
  assert.ok(aCoveredAt>0,'runway word is covered');
  assert.ok(firstSeen.indexOf('new')>=aCoveredAt,`new word began only after runway work cleared: ${firstSeen.join(',')}`);
  assert.equal(view.session.projection.words.new.admitted,true,'the gate opens once pressing work is gone');
  assert.equal(db.prepare('SELECT gate_held FROM vocabulary_timed_session_records WHERE session_id=?').get(id)!.gate_held,1);
}));

test('pressing held items are admitted ahead of ordinary due work and lead the tier',()=>owner(()=>{
  practiceAll('a','b','new');timedOn();
  const ordinary=startVocabularyStudy({});
  assert.equal(ordinary.currentWordId,'a');assert.deepEqual(ordinary.session.context.reviewOrder?.[0],{kind:'word',id:'a'});
  db.prepare("INSERT INTO learner_timed_skip_counts VALUES('alice','word','new',3,'2026-01-01','2026-01-01'),('alice','word','b',2,'2026-01-01','2026-01-01')").run();
  const view=startVocabularyStudy({});
  // The pressing tier takes seven picks in ten; the ordinary draw starts with the most urgent item.
  assert.ok(['new','a'].includes(view.currentWordId!),`first card ${view.currentWordId}`);
  assert.deepEqual(view.session.context.reviewOrder?.[0],{kind:'word',id:'new'});
  const timed=(db.prepare('SELECT context_json FROM vocabulary_sessions WHERE session_id=?').get(view.session.sessionId) as {context_json:string});
  assert.deepEqual((JSON.parse(timed.context_json) as VocabularySessionInitialContext).timed?.pressingKeys,['word:new']);
  assert.deepEqual(db.prepare('SELECT session_id FROM vocabulary_timed_session_records').all().length,2);
}));

test('budget wrap-up is a recorded action, finishes open work, and Study a little more extends by five minutes',()=>owner(()=>{
  practiceAll('a','b','new');timedOn();
  db.prepare("INSERT INTO learner_settings VALUES('alice','daily_study_minutes','10','2026-01-01')").run();
  let view=startVocabularyStudy({});const id=view.session.sessionId;backdate(id);
  assert.equal(view.currentWordId,'a');
  assert.throws(()=>commandVocabularyStudy(id,'early-more',{type:'studyMore',activeDurationMs:1000}),/follows the day's wrap-up/);
  // Reaching the budget mid-word lets that word finish; nothing new begins.
  view=nextVocabularyExercise(id,'over',{activeDurationMs:600_000});
  assert.equal(view.session.projection.phase,'finishing');assert.equal(view.currentWordId,'a');
  assert.deepEqual(view.session.actions.filter(action=>action.kind==='finish_for_now').map(action=>action.payload),[{source:'budget'}]);
  assert.equal(view.notice,null);
  view=answerCurrent(id,'a',view);
  assert.equal(view.session.projection.phase,'completed');
  assert.deepEqual(view.timed,{budgetWrapped:true,canStudyMore:true,sessionActiveMs:600_000,note:null});
  assert.equal(view.session.projection.words.b.admitted,false);
  assert.throws(()=>nextVocabularyExercise(id,'back',{activeDurationMs:1}),/not accepting new work/);
  view=commandVocabularyStudy(id,'more',{type:'studyMore',activeDurationMs:601_000});
  assert.equal(view.session.projection.phase,'active');
  assert.deepEqual(view.session.actions.at(-1)?.payload,{untilDayActiveMs:901_000});
  view=nextVocabularyExercise(id,'after-more',{activeDurationMs:602_000});
  assert.equal(view.currentWordId,'b');
  view=answerCurrent(id,'b',view);
  view=nextVocabularyExercise(id,'second-wrap',{activeDurationMs:901_000});
  assert.equal(view.session.projection.phase,'completed');assert.equal(view.timed?.budgetWrapped,true);
  // The client clock never moves the recorded time backward.
  assert.equal(view.timed?.sessionActiveMs,901_000);
  // Completion time is bounded by the session's own start; the record keeps the larger accepted measure.
  const staged=stageVocabularySessionCompletion(id,view.session.actions.length,undefined,{activeDurationMs:1_000});
  closeVocabularySessionCompletion(id,staged.completionId);
  const row=db.prepare('SELECT * FROM vocabulary_timed_session_records WHERE session_id=?').get(id)!;
  assert.equal(row.session_active_ms,901_000);assert.equal(row.day_active_ms,901_000);assert.equal(row.extensions,1);assert.equal(row.budget_wrapped,1);
  const served=JSON.parse(String(row.served_json)) as {key:string;class:string;outcome:string;priorLapse:boolean|null;classicDueAt:string|null}[];
  assert.deepEqual(served.map(entry=>[entry.key,entry.class,entry.outcome,entry.priorLapse]),[['word:a','held','covered',false],['word:b','held','covered',false]]);
  assert.throws(()=>nextVocabularyExercise(id,'bad-time',{activeDurationMs:-1}),/not accepting|bounded/);
}));

test('an implausible client clock is rejected',()=>owner(()=>{
  timedOn();const view=startVocabularyStudy({});
  assert.throws(()=>nextVocabularyExercise(view.session.sessionId,'future',{activeDurationMs:3_600_000}),/bounded integer activeDurationMs/);
}));

test('a fresh entry into a spent day still runs a little while, counting earlier sessions including abandoned ones',()=>owner(()=>{
  practiceAll('a','b','new');timedOn();
  const first=startVocabularyStudy({});backdate(first.session.sessionId);
  nextVocabularyExercise(first.session.sessionId,'tick',{activeDurationMs:1_500_000});
  // The first session is abandoned without closure; its accepted time still belongs to the day.
  const second=startVocabularyStudy({});
  const timed=db.prepare('SELECT context_json FROM vocabulary_sessions WHERE session_id=?').get(second.session.sessionId) as {context_json:string};
  const context=JSON.parse(timed.context_json) as VocabularySessionInitialContext;
  assert.equal(context.timed?.dayActiveMsAtStart,1_500_000);
  assert.equal(context.timed?.untilDayActiveMs,1_800_000);
  assert.equal(second.session.projection.phase,'active');
}));

test('closure counts one passed-over day for unstarted due held items and clears served ones',()=>owner(()=>{
  practiceAll('a','b','new');timedOn();
  db.prepare("INSERT INTO learner_timed_skip_counts VALUES('alice','word','a',2,'2026-01-01','2026-01-01')").run();
  const close=(key:string)=>{
    let view=startVocabularyStudy({});const id=view.session.sessionId;backdate(id);
    assert.equal(view.currentWordId,'a');
    view=answerCurrent(id,key,view);view=nextVocabularyExercise(id,`${key}-wrap`,{activeDurationMs:1_200_000});
    assert.equal(view.session.projection.phase,'completed');
    const staged=stageVocabularySessionCompletion(id,view.session.actions.length);closeVocabularySessionCompletion(id,staged.completionId);
    return id;
  };
  const counts=()=>db.prepare('SELECT target_id,skip_days,last_skipped_day FROM learner_timed_skip_counts ORDER BY target_id').all().map(row=>({...row}));
  const id=close('first');
  assert.deepEqual(counts(),[{target_id:'b',skip_days:1,last_skipped_day:today()},{target_id:'new',skip_days:1,last_skipped_day:today()}]);
  const row=db.prepare('SELECT new_words_started,unstarted_pressing_json,budget_wrapped FROM vocabulary_timed_session_records WHERE session_id=?').get(id)!;
  assert.deepEqual({...row},{new_words_started:0,unstarted_pressing_json:'[]',budget_wrapped:1});
  // The same local day never counts twice.
  makeDue('a');close('same-day');
  assert.deepEqual(counts().map(entry=>entry.skip_days),[1,1]);
  db.prepare("UPDATE learner_timed_skip_counts SET last_skipped_day='2000-01-01'").run();
  makeDue('a');close('next-day');
  assert.deepEqual(counts().map(entry=>entry.skip_days),[2,2]);
  // Schedules of passed-over items never move.
  assert.equal(getVocabularyWordSchedule('b')?.nextEligibleAt,null);
}));

test('closure counts due held items that never entered the session pool',()=>owner(()=>{
  practiceAll('a','b','new');
  const id='capped-out';
  createVocabularySession({sessionId:id,words:[{wordId:'a',mode:'practice',selectedSkill:'production'}],
    timed:{version:1,dayKey:'2026-11-12',budgetMs:600_000,budgetSource:'default',dayActiveMsAtStart:0,untilDayActiveMs:600_000,pressingKeys:[],facts:{}}});
  db.prepare("INSERT INTO vocabulary_timed_session_records(session_id,learner_id,day_key,budget_ms,budget_source,day_active_ms_at_start,started_at) VALUES(?,?,?,?,?,?,?)")
    .run(id,'alice','2026-11-12',600_000,'default',0,'2000-01-01T00:00:00.000Z');
  let view=nextVocabularyExercise(id,'first');view=answerCurrent(id,'a',view);
  view=nextVocabularyExercise(id,'wrap',{activeDurationMs:600_000});
  const staged=stageVocabularySessionCompletion(id,view.session.actions.length);closeVocabularySessionCompletion(id,staged.completionId);
  assert.deepEqual(db.prepare('SELECT target_id FROM learner_timed_skip_counts ORDER BY target_id').all().map(row=>row.target_id),['b','new']);
}));

test('the optional completion line is stored on timed sessions only, trimmed, bounded and clearable',()=>owner(()=>{
  const classic=startVocabularyStudy({});
  assert.throws(()=>saveVocabularySessionNote(classic.session.sessionId,'hello'),/Only timed sessions/);
  timedOn();const id=startVocabularyStudy({}).session.sessionId;
  assert.deepEqual(saveVocabularySessionNote(id,'  More listening, please.  '),{note:'More listening, please.'});
  assert.equal(getVocabularyStudy(id).timed?.note,'More listening, please.');
  assert.throws(()=>saveVocabularySessionNote(id,'x'.repeat(501)),/under 500/);
  assert.throws(()=>saveVocabularySessionNote(id,7),/Expected note text/);
  assert.deepEqual(saveVocabularySessionNote(id,'  '),{note:null});
  assert.deepEqual({...db.prepare('SELECT note,note_at FROM vocabulary_timed_session_records WHERE session_id=?').get(id)},{note:null,note_at:null});
}));

test('Undo passes over the recorded budget wrap-up and extension to the learner\'s last answer',()=>owner(()=>{
  practiceAll('a','b','new');timedOn();
  let view=startVocabularyStudy({});const id=view.session.sessionId;backdate(id);
  view=answerCurrent(id,'a',view);
  const answered=view.session.actions.at(-1)!;
  view=nextVocabularyExercise(id,'wrap',{activeDurationMs:1_200_000});
  assert.equal(view.session.projection.phase,'completed');
  assert.notEqual(view.session.projection.latestUndoableActionId,view.session.actions.at(-1)!.actionId,'budget wrap-up is not undoable');
  view=commandVocabularyStudy(id,'more',{type:'studyMore',activeDurationMs:1_200_100});
  view=nextVocabularyExercise(id,'after-more',{activeDurationMs:1_200_200});
  assert.equal(view.currentWordId,'b');
  // Undo reaches the answer (and its automatic wrap) rather than the trainer's transitions.
  view=commandVocabularyStudy(id,'undo',{type:'undo'});
  assert.equal(view.session.projection.words.a.covered,false);
  assert.ok(view.session.projection.undoneActionIds.includes(answered.actionId));
  assert.equal(view.session.projection.phase,'active');
  assert.equal(view.timed?.budgetWrapped,false);
}));

test('a missed review is pressing: it returns after a short rest and keeps unstarted new words shut until covered',()=>owner(()=>{
  changeVocabularyMode('a','practice',getVocabularyLearnerWord('a')!.stateVersion);exercise('general-b','b');addVocabularyWord('new');timedOn();
  let view=startVocabularyStudy({});const id=view.session.sessionId;
  let missed:string|null=null;let missAt=-1;let newAdmittedAtMiss=false;let returnedAfter=-1;
  for(let step=0;step<60&&view.session.projection.phase!=='completed';step++) {
    const encounter=view.currentEncounter;const wordId=view.currentWordId;
    const presented=view.session.projection.encounters.filter(entry=>!entry.presentationUndone).length;
    if(!missed&&wordId&&wordId!=='new'&&encounter?.snapshot.kind==='production'&&!encounter.effectiveResponses.length) {
      missed=wordId;missAt=presented;newAdmittedAtMiss=view.session.projection.words.new.admitted;
      view=commandVocabularyStudy(id,`miss`,{type:'response',response:'错'});
    } else {
      if(missed&&wordId===missed&&returnedAfter<0&&presented-1>missAt)returnedAfter=presented-1-missAt;
      view=answerCurrent(id,`s${step}`,view);
    }
    if(missed&&!view.session.projection.words[missed].covered&&!newAdmittedAtMiss)
      assert.equal(view.session.projection.words.new.admitted,false,'a fresh miss keeps new words shut');
    view=nextVocabularyExercise(id,`n${step}`,{activeDurationMs:0});
  }
  assert.ok(missed,'a review word was missed');
  assert.equal(view.session.projection.words[missed!].covered,true);
  assert.ok(returnedAfter>=1,'the miss came back after other cards');
  assert.equal(view.session.projection.words.new.admitted,true,'new words open once pressing work clears');
}));
