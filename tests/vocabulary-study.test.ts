import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach,afterEach,test } from 'node:test';
import { setDb } from '../server/db/connection.ts';
import { runWithLearnerId } from '../server/db/learner-context.ts';
import { adoptVocabularyPureCues } from '../server/vocabulary/pure-cue-serving.ts';
import { createVocabularyContent,replaceVocabularyContent } from '../server/db/vocabulary-content.ts';
import { createVocabularySession,stageVocabularySessionCompletion,cancelVocabularySessionCompletion,closeVocabularySessionCompletion } from '../server/db/vocabulary-sessions.ts';
import { dismissVocabularyWord,getVocabularyLearnerWord,getVocabularyWordSchedule } from '../server/db/vocabulary-learners.ts';
import { startVocabularyStudy,getVocabularyStudy,nextVocabularyExercise,commandVocabularyStudy } from '../server/vocabulary/study.ts';
import type { VocabularyContent } from '../src/domain/vocabulary-content.ts';
let db:DatabaseSync;
const owner=<T>(fn:()=>T)=>runWithLearnerId('alice',fn);
const actor={kind:'operator' as const,id:'test'};
function exercise(id:string,wordId:string,role:'teaching'|'general'='general',pure=false):VocabularyContent {
  return createVocabularyContent({contentId:id,kind:'exercise',payloadVersion:1,body:{prompt:`Retrieve ${id}`},
    accessScope:'shared',availability:'active',originKind:'human',words:[{wordId,relation:'target'}],exerciseType:pure?'pure_cue':'word',
    skill:'production',exerciseRole:role,assessment:{match:'prepared'},answers:[{wordId,acceptedForms:[wordId==='a'?'甲':wordId==='b'?'乙':'新']}]},actor);
}
beforeEach(()=>{
  db=new DatabaseSync(':memory:');setDb(db);db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE learners(learner_id TEXT PRIMARY KEY);
    CREATE TABLE learner_owned_review_session_summaries(learner_id TEXT,session_id TEXT,PRIMARY KEY(learner_id,session_id));
    CREATE TABLE lexical_words(id TEXT PRIMARY KEY,hanzi TEXT,traditional TEXT,pinyin TEXT,meaning TEXT,created_at TEXT,priority INTEGER DEFAULT 0);
    CREATE TABLE learner_settings(learner_id TEXT,setting_key TEXT,value_json TEXT,updated_at TEXT,PRIMARY KEY(learner_id,setting_key));
    CREATE TABLE learner_owned_daily_new_word_intake(learner_id TEXT,day_key TEXT,new_study_count INTEGER);
    INSERT INTO learner_settings VALUES('alice','unstudied_admission_source','"stash_only"','2026-01-01'),('alice','study_introduction_order','"first"','2026-01-01');
    CREATE TABLE learner_word_state(learner_id TEXT,word_id TEXT,status TEXT,learning_streak INTEGER,last_learning_covered_on TEXT);
    CREATE TABLE learner_owned_user_word_priority(learner_id TEXT,word_id TEXT,priority_tier INTEGER,updated_at TEXT);
    CREATE TABLE learner_owned_word_skill_state(learner_id TEXT,word_id TEXT,skill_id TEXT,interval_hours REAL,ease_factor REAL,enabled INTEGER,next_due_at TEXT,last_studied_at TEXT,PRIMARY KEY(learner_id,word_id,skill_id));
    CREATE TABLE learner_owned_word_skill_relevance(learner_id TEXT,word_id TEXT,skill_id TEXT,relevance_state TEXT,PRIMARY KEY(learner_id,word_id,skill_id));
    CREATE TABLE learner_owned_word_study_admission_state(learner_id TEXT,word_id TEXT,earliest_next_study_at TEXT);
    INSERT INTO learners VALUES('alice'),('bob');
    INSERT INTO lexical_words(id,hanzi,traditional,pinyin,meaning,created_at) VALUES('a','甲',NULL,'jiǎ','first','2026-01-01'),('b','乙',NULL,'yǐ','second','2026-01-02'),('new','新',NULL,'xīn','new','2026-01-03');
    INSERT INTO learner_word_state VALUES('alice','a','learning',2,NULL),('alice','b','review',0,NULL),('alice','new','unstudied',0,NULL);
  `);
  for(const file of ['0039_vocabulary_content.sql','0041_vocabulary_learner_state.sql','0042_vocabulary_sessions.sql','0047_vocabulary_dismissal.sql','0023_session_debrief.sql','0048_vocabulary_connections.sql'])db.exec(fs.readFileSync(new URL(`../server/db/migrations/${file}`,import.meta.url),'utf8'));
  owner(()=>{
    exercise('general-1','a');exercise('general-2','a');exercise('teach-a','a','teaching');exercise('teach-new','new','teaching');
    for(const [wordId,contentId] of [['a','intro-a'],['new','intro-new']])createVocabularyContent({contentId,kind:'introduction',payloadVersion:1,
      body:{beats:[{kind:'explanation',text:`Introduction ${wordId}`}]},accessScope:'shared',availability:'active',originKind:'human',words:[{wordId,relation:'target'}],
      teachingExercises:[{exerciseId:wordId==='a'?'teach-a':'teach-new',exerciseVersion:1}]},actor);
  });
});
afterEach(()=>db.close());

test('Solidify primes once, then serves exclusively general exercises and applies no learning writes before closure',()=>owner(()=>{
  let view=startVocabularyStudy();const id=view.session.sessionId;const before=getVocabularyWordSchedule('a');
  assert.equal(view.currentWordId,'a');assert.equal(view.currentEncounter?.snapshot.role,'priming');
  assert.equal(view.currentEncounter?.snapshot.kind,'introduction');
  view=nextVocabularyExercise(id,'next-1');assert.equal(view.currentEncounter?.snapshot.role,'general');
  assert.equal(view.currentEncounter?.snapshot.contentId,'general-1');
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
  let view=startVocabularyStudy();const id=view.session.sessionId;nextVocabularyExercise(id,'next');
  view=commandVocabularyStudy(id,'answer',{type:'response',response:'甲'});const count=view.session.actions.length;
  assert.equal(commandVocabularyStudy(id,'answer',{type:'response',response:'甲'}).session.actions.length,count);
  assert.throws(()=>commandVocabularyStudy(id,'answer',{type:'response',response:'乙'}),/different input/);
  assert.equal(nextVocabularyExercise(id,'next').session.actions.length,count);
}));

test('skips before answers retain exact encounters and feedback without creating recall success',()=>owner(()=>{
  let view=startVocabularyStudy();const id=view.session.sessionId;view=nextVocabularyExercise(id,'next');
  const skipped=view.currentEncounter!.encounterId;
  commandVocabularyStudy(id,'feedback',{type:'feedback',feedback:'negative',comment:'Ambiguous'});
  commandVocabularyStudy(id,'skip',{type:'skip'});view=nextVocabularyExercise(id,'another',{another:true});
  const evidence=view.session.projection.encounters.find((entry)=>entry.encounterId===skipped)!;
  assert.equal(evidence.skipped,true);assert.equal(evidence.responses.length,0);assert.equal(evidence.feedback.length,1);
  assert.equal(view.session.projection.words.a.covered,false);
}));

test('rejected work stays open and another accepted general answer ends the default work',()=>owner(()=>{
  let view=startVocabularyStudy();const id=view.session.sessionId;view=nextVocabularyExercise(id,'next-1');
  const first=view.currentEncounter!.snapshot.contentId;commandVocabularyStudy(id,'miss',{type:'response',response:'wrong'});
  view=nextVocabularyExercise(id,'next-2');assert.notEqual(view.currentEncounter!.snapshot.contentId,first);
  view=commandVocabularyStudy(id,'pass',{type:'response',response:'甲'});
  assert.equal(view.session.projection.words.a.workStatus,'wrapped');assert.equal(view.session.projection.words.a.covered,true);
  assert.equal(view.session.projection.words.a.successfulRecall,true);assert.equal(view.session.projection.words.a.recommendedMode,null);
}));

test('Undo reverses a final answer together with its automatic wrap while retaining raw observations',()=>owner(()=>{
  let view=startVocabularyStudy();const id=view.session.sessionId;nextVocabularyExercise(id,'next-1');
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

test('Unstudied teaching requires delivered introduction, self-assessed recognition and successful teaching production',()=>owner(()=>{
  // Limit this session to the new word while retaining real learner state.
  const recognitionId='vocabulary:baseline:v1:alice:recognition:teaching:new';
  createVocabularySession({sessionId:'new-session',words:[{wordId:'new',mode:'unstudied',teachingRequirements:{introductionContentId:'intro-new',
    requiredExerciseContentIds:[recognitionId,'teach-new'],minimumRecognitionResponses:1,minimumProductionResponses:1}}]});
  let view=nextVocabularyExercise('new-session','intro');assert.equal(view.currentEncounter?.snapshot.kind,'introduction');
  view=nextVocabularyExercise('new-session','recognition');assert.equal(view.currentEncounter?.snapshot.kind,'recognition');
  view=commandVocabularyStudy('new-session','recognized',{type:'response',response:null,selfAssessment:'accepted'});
  assert.equal(view.currentEncounter?.effectiveResponses[0].payload.response,null);
  view=nextVocabularyExercise('new-session','production');assert.equal(view.currentEncounter?.snapshot.role,'teaching');
  view=commandVocabularyStudy('new-session','produced',{type:'response',response:'新'});
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

test('cross-owner sessions are inaccessible and existing learner deactivation/suppression remain effective',()=>{
  const view=owner(()=>startVocabularyStudy());
  runWithLearnerId('bob',()=>assert.throws(()=>getVocabularyStudy(view.session.sessionId),/not found/));
  owner(()=>{
    db.prepare("INSERT INTO learner_owned_word_skill_state VALUES('alice','b','production',24,2.5,0,NULL,NULL)").run();
    db.prepare("INSERT INTO learner_content_deactivations VALUES('alice','general-1','2026-10-17T00:00:00.000Z')").run();
    const next=nextVocabularyExercise(view.session.sessionId,'next');assert.notEqual(next.currentEncounter?.snapshot.contentId,'general-1');
    commandVocabularyStudy(view.session.sessionId,'enough',{type:'enough'});
    const advanced=nextVocabularyExercise(view.session.sessionId,'advance');assert.notEqual(advanced.currentWordId,'b');
  });
});

test('recognition can be due while production is suppressed and produces no production credit',()=>owner(()=>{
  db.prepare("INSERT INTO learner_owned_word_skill_state VALUES('alice','b','production',48,2.5,0,NULL,NULL),('alice','b','recognition',96,2.5,1,NULL,NULL)").run();
  db.prepare("UPDATE learner_word_schedules SET scheduler_state_json=json_set(scheduler_state_json,'$.enabled',0) WHERE word_id='b'").run();
  let view=startVocabularyStudy();const id=view.session.sessionId;
  assert.equal(view.session.context.words.find((word)=>word.wordId==='b')?.recognitionOnly,true);
  const before=getVocabularyWordSchedule('b');
  view=nextVocabularyExercise(id,'recognition-only',{wordId:'b'});assert.equal(view.currentEncounter?.snapshot.kind,'recognition');
  view=commandVocabularyStudy(id,'recognized',{type:'response',response:null,selfAssessment:'accepted'});
  assert.equal(view.session.projection.words.b.covered,false);assert.equal(view.session.projection.words.b.workStatus,'skipped');
  view=commandVocabularyStudy(id,'finish',{type:'finishForNow'});
  if(view.session.projection.phase==='finishing')view=commandVocabularyStudy(id,'immediate',{type:'finishImmediately'});
  const staged=stageVocabularySessionCompletion(id,view.session.actions.length);closeVocabularySessionCompletion(id,staged.completionId);
  assert.deepEqual(getVocabularyWordSchedule('b'),before);
  assert.equal(db.prepare("SELECT count(*) AS n FROM learner_state_effects WHERE kind='recognition_outcome' AND word_id='b'").get()?.n,1);
}));

test('Undo of another restores prior exercise while preserving feedback on the undone presentation',()=>owner(()=>{
  const start=startVocabularyStudy();const id=start.session.sessionId;
  const first=nextVocabularyExercise(id,'first').currentEncounter!;
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
  let view=startVocabularyStudy();const id=view.session.sessionId;
  nextVocabularyExercise(id,'first');commandVocabularyStudy(id,'answer',{type:'response',response:'甲'});
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
  createVocabularySession({sessionId:'contrast-session',words:[{wordId:'a',mode:'solidify',contextualOnly:true}]});
  const before=getVocabularyWordSchedule('a');let view=nextVocabularyExercise('contrast-session','next');
  assert.equal(view.currentEncounter?.snapshot.kind,'contrast');assert.equal(view.currentEncounter?.snapshot.body.prompt,'Choose the expression for this context.');
  // Even a raw string matching the expected form cannot override the selected word identity.
  view=commandVocabularyStudy('contrast-session','choice',{type:'response',response:'甲',selectedWordId:'b'});
  assert.equal(view.currentEncounter?.effectiveResponses[0].payload.outcome,'rejected');assert.equal(view.currentEncounter?.effectiveResponses[0].payload.selectedWordId,'b');
  assert.equal(view.session.projection.words.a.productionResponses,0);assert.equal(view.session.projection.words.a.covered,false);
  assert.equal(db.prepare("SELECT interval_hours FROM learner_owned_word_skill_state WHERE skill_id='contextual_selection'").get()?.interval_hours,6);
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
  contrastContent();let view=startVocabularyStudy();const id=view.session.sessionId;
  view=nextVocabularyExercise(id,'not-due');assert.notEqual(view.currentEncounter?.snapshot.kind,'contrast');
  db.prepare("INSERT INTO learner_owned_word_skill_state VALUES('alice','a','contextual_selection',6,2.5,1,NULL,NULL)").run();
  db.prepare("UPDATE learner_words SET mode='unstudied' WHERE word_id='b'").run();
  view=nextVocabularyExercise(id,'member-unready',{another:true});assert.notEqual(view.currentEncounter?.snapshot.kind,'contrast');
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

test('Leave keeps unanswered word uncovered while Enough explicitly covers with no invented response',()=>owner(()=>{
  let view=startVocabularyStudy();const id=view.session.sessionId;
  view=commandVocabularyStudy(id,'leave',{type:'skip',scope:'word'});
  assert.equal(view.session.projection.words.a.covered,false);assert.equal(view.session.projection.words.a.workStatus,'skipped');
  view=nextVocabularyExercise(id,'return',{wordId:'a'});
  view=commandVocabularyStudy(id,'enough',{type:'enough'});
  assert.equal(view.session.projection.words.a.covered,true);assert.equal(view.session.projection.words.a.successfulRecall,false);
  assert.equal(view.session.projection.encounters.flatMap((entry)=>entry.responses).length,0);
}));

test('earlier covered word extra practice preserves coverage and returns to interrupted open word',()=>owner(()=>{
  let view=startVocabularyStudy();const id=view.session.sessionId;
  nextVocabularyExercise(id,'first');commandVocabularyStudy(id,'answer',{type:'response',response:'甲'});
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

test('summary mode change replaces pending completion revision while preserving its evidence',()=>owner(()=>{
  let view=startVocabularyStudy();const id=view.session.sessionId;nextVocabularyExercise(id,'first');
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
