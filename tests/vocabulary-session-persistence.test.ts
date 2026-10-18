import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, test } from 'node:test';
import { setDb } from '../server/db/connection.ts';
import { runWithLearnerId } from '../server/db/learner-context.ts';
import { createVocabularyContent } from '../server/db/vocabulary-content.ts';
import { getVocabularyLearnerWord, getVocabularyWordSchedule } from '../server/db/vocabulary-learners.ts';
import { createVocabularySession, appendVocabularySessionActions, getVocabularySession, stageVocabularySessionCompletion,
  cancelVocabularySessionCompletion, closeVocabularySessionCompletion, listDueVocabularySessionCompletions } from '../server/db/vocabulary-sessions.ts';
import type { VocabularyContent } from '../src/domain/vocabulary-content.ts';
import type { VocabularyEncounterSnapshot, VocabularySessionAction, VocabularySessionInitialContext } from '../src/domain/vocabulary-session.ts';
let sql: DatabaseSync;
let contents: Record<string, VocabularyContent>;
const now = '2026-10-17T10:00:00.000Z';
const later = '2026-10-17T10:00:16.000Z';
const alice = <T>(work: () => T) => runWithLearnerId('alice', work);
type Input = VocabularySessionAction extends infer A ? A extends VocabularySessionAction ? Pick<A, 'kind' | 'payload'> : never : never;
beforeEach(() => {
  sql = new DatabaseSync(':memory:'); setDb(sql); sql.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE learners(learner_id TEXT PRIMARY KEY);
    CREATE TABLE learner_owned_review_session_summaries(learner_id TEXT,session_id TEXT,PRIMARY KEY(learner_id,session_id));
    CREATE TABLE lexical_words(id TEXT PRIMARY KEY,created_at TEXT,hanzi TEXT NOT NULL DEFAULT '字',pinyin TEXT NOT NULL DEFAULT 'zì');
    CREATE TABLE learner_settings(learner_id TEXT,setting_key TEXT,value_json TEXT,updated_at TEXT,PRIMARY KEY(learner_id,setting_key));
    CREATE TABLE learner_word_state(learner_id TEXT,word_id TEXT,status TEXT,learning_streak INTEGER,last_learning_covered_on TEXT);
    CREATE TABLE learner_owned_user_word_priority(learner_id TEXT,word_id TEXT,priority_tier INTEGER,updated_at TEXT);
    CREATE TABLE learner_owned_word_skill_state(learner_id TEXT,word_id TEXT,skill_id TEXT,interval_hours REAL,ease_factor REAL,enabled INTEGER,next_due_at TEXT,last_studied_at TEXT,PRIMARY KEY(learner_id,word_id,skill_id));
    CREATE TABLE learner_owned_word_skill_relevance(learner_id TEXT,word_id TEXT,skill_id TEXT,relevance_state TEXT,PRIMARY KEY(learner_id,word_id,skill_id));
    CREATE TABLE learner_owned_word_study_admission_state(learner_id TEXT,word_id TEXT,earliest_next_study_at TEXT);
    INSERT INTO learners VALUES ('alice'),('bob');
    INSERT INTO lexical_words(id,created_at) VALUES ('a','2026-01-01T00:00:00.000Z'),('b','2026-01-01T00:00:00.000Z'),('new','2026-01-01T00:00:00.000Z');
    INSERT INTO learner_word_state VALUES ('alice','a','learning',2,NULL),('alice','b','review',0,NULL),('alice','new','unstudied',0,NULL);
  `);
  for (const name of ['0037_vocabulary_content.sql','0039_vocabulary_learner_state.sql','0040_vocabulary_sessions.sql','0045_vocabulary_dismissal.sql','0023_session_debrief.sql','0046_vocabulary_connections.sql']) {
    sql.exec(fs.readFileSync(new URL(`../server/db/migrations/${name}`,import.meta.url),'utf8'));
  }
  contents = {};
  alice(() => {
    for (const [id, word, skill, role, type] of [
      ['one','a','production','general','word'], ['two','a','production','general','word'],
      ['b','b','production','general','word'], ['cue','b','production','general','pure_cue'],
      ['recognize','new','recognition','teaching','recognition'], ['produce','new','production','teaching','word'],
    ] as const) {
      contents[id] = createVocabularyContent({contentId:id,kind:'exercise',payloadVersion:1,body:{prompt:`Prompt ${id}`},
        accessScope:'shared',availability:'active',originKind:'human',words:[{wordId:word,relation:'target'}],
        exerciseType:type,skill,exerciseRole:role,assessment:skill==='recognition'?{responseMode:'self_assessment'}:{match:'exact'},
        answers:[{wordId:word,acceptedForms:['字']}]}, {kind:'operator',id:'test'});
    }
    contents.intro = createVocabularyContent({contentId:'intro',kind:'introduction',payloadVersion:1,body:{text:'Introduction'},
      accessScope:'shared',availability:'active',originKind:'human',words:[{wordId:'new',relation:'target'}],
      teachingExercises:[{exerciseId:'recognize',exerciseVersion:1},{exerciseId:'produce',exerciseVersion:1}]}, {kind:'operator',id:'test'});
  });
});
afterEach(() => sql.close());
function context(sessionId = 'session'): VocabularySessionInitialContext {
  return {sessionId,words:[{wordId:'a',mode:'unstudied'},{wordId:'b',mode:'solidify'},{wordId:'new',mode:'unstudied',
    teachingRequirements:{introductionContentId:'intro',requiredExerciseContentIds:['recognize','produce'],minimumRecognitionResponses:1,minimumProductionResponses:1}}]};
}
function actions(...inputs: Input[]): VocabularySessionAction[] {
  return inputs.map((input,index)=>({...input,actionId:`action-${index+1}`,clientActionId:`client-${index+1}`,sequence:index+1,protocolVersion:1,occurredAt:now}));
}
function snapshot(id: string, role?: VocabularyEncounterSnapshot['role']): VocabularyEncounterSnapshot {
  const content=contents[id];
  return {contentId:id,contentVersion:content.version,kind:content.kind==='introduction'?'introduction':content.skill==='recognition'?'recognition':'production',
    role:role??(content.kind==='introduction'?'teaching':content.exerciseRole),body:{prompt:`Prompt ${id}`,material:content.body},
    assessment:content.kind==='introduction'?null:{acceptedAnswers:content.answers.flatMap((answer)=>answer.acceptedForms),criteria:content.assessment},
    ...(content.kind==='exercise'&&content.exerciseType==='pure_cue'?{schedulingScope:'pure_cue' as const}:{}),};
}
function present(id: string,wordId: string|null='a'): Input {return {kind:'presentation',payload:{encounterId:id,wordId,snapshot:snapshot(id)}};}
function response(id: string,accepted=true): Input {return {kind:'response',payload:{encounterId:id,response:accepted?'字':'wrong',outcome:accepted?'accepted':'rejected'}};}
const finish: Input={kind:'finish_for_now',payload:{}};
const immediate: Input={kind:'finish_immediately',payload:{}};
function coveredActions(): VocabularySessionAction[] {return actions(present('one'),response('one'),present('two'),response('two'),{kind:'word_wrap',payload:{wordId:'a',reason:'policy'}},finish);}
function count(table: string): number {return (sql.prepare(`SELECT count(*) AS n FROM ${table}`).get() as {n:number}).n;}

test('log persistence and staging have zero learning effects; close applies all effects once',()=>alice(()=>{
  const schedule=getVocabularyWordSchedule('a');
  const started=createVocabularySession(context(),now);
  assert.equal(started.context.words[0].mode,'solidify');
  assert.equal(started.context.words[1].mode,'practice');
  appendVocabularySessionActions('session',coveredActions(),now);
  assert.deepEqual(getVocabularyWordSchedule('a'),schedule);
  assert.equal(getVocabularyLearnerWord('a')?.mode,'solidify');
  assert.equal(count('session_actions'),6);
  assert.equal(count('exercise_encounters'),2);
  assert.equal(count('learner_state_effects'),0);
  const staged=stageVocabularySessionCompletion('session',6,now);
  assert.equal(staged.closeAt,'2026-10-17T10:00:15.000Z');
  assert.deepEqual(getVocabularyWordSchedule('a'),schedule);
  assert.equal(stageVocabularySessionCompletion('session',6,later).closeAt,staged.closeAt);
  const closed=closeVocabularySessionCompletion('session',staged.completionId,later);
  assert.equal(closed.status,'closed');
  assert.equal(getVocabularyLearnerWord('a')?.mode,'practice');
  assert.equal(getVocabularyWordSchedule('a')?.schedulerState.cleanCoveredSessions,3);
  assert.equal(count('vocabulary_post_session_dispatches'),1);
  const effects=count('learner_state_effects');const after=getVocabularyWordSchedule('a');
  closeVocabularySessionCompletion('session',staged.completionId,'2026-10-18T10:00:00.000Z');
  assert.equal(count('learner_state_effects'),effects);assert.deepEqual(getVocabularyWordSchedule('a'),after);
  assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);
}));

test('identical append retries succeed, changed retries/gaps and frozen-session writes fail',()=>alice(()=>{
  createVocabularySession(context(),now);const log=coveredActions();
  appendVocabularySessionActions('session',log,now);appendVocabularySessionActions('session',log,now);
  assert.equal(count('session_actions'),6);
  assert.throws(()=>appendVocabularySessionActions('session',[{...log[0],occurredAt:later}],now),/different input/);
  assert.throws(()=>appendVocabularySessionActions('session',[{...log[0],actionId:'other',clientActionId:'other',sequence:9}],now),/sequence/);
  const staged=stageVocabularySessionCompletion('session',6,now);
  assert.throws(()=>appendVocabularySessionActions('session',[{...log[0],actionId:'other',clientActionId:'other',sequence:7}],now),/finalizing/);
  assert.equal(appendVocabularySessionActions('session',log,now).status,'finalizing');
  assert.throws(()=>stageVocabularySessionCompletion('session',5,now),/different boundary/);
  closeVocabularySessionCompletion('session',staged.completionId,later);
  assert.throws(()=>appendVocabularySessionActions('session',[{...log[0],actionId:'other',clientActionId:'other',sequence:7}],now),/closed/);
}));

test('cancellation resumes append, creates a fresh revision, and retains fixed server deadline',()=>alice(()=>{
  createVocabularySession(context(),now);const log=coveredActions();appendVocabularySessionActions('session',log,now);
  const first=stageVocabularySessionCompletion('session',6,now);
  cancelVocabularySessionCompletion('session',first.completionId,'2026-10-17T10:00:01.000Z');
  const undo: VocabularySessionAction={kind:'undo',payload:{undoesActionId:'action-6'},actionId:'undo',clientActionId:'undo',sequence:7,protocolVersion:1,occurredAt:now};
  assert.equal(appendVocabularySessionActions('session',[undo],now).projection.phase,'active');
  const refinish: VocabularySessionAction={kind:'finish_for_now',payload:{},actionId:'refinish',clientActionId:'refinish',sequence:8,protocolVersion:1,occurredAt:now};
  appendVocabularySessionActions('session',[refinish],now);
  const second=stageVocabularySessionCompletion('session',8,'2026-10-17T10:00:02.000Z');
  assert.equal(second.revisionNumber,2);assert.notEqual(second.completionId,first.completionId);
  assert.throws(()=>cancelVocabularySessionCompletion('session',second.completionId,'2026-10-17T10:00:17.000Z'),/window has closed/);
  assert.equal(getVocabularySession('session').status,'closed');
}));

test('closure rolls back every learning write when durable dispatch fails and retry applies once',()=>alice(()=>{
  createVocabularySession(context(),now);appendVocabularySessionActions('session',coveredActions(),now);
  const staged=stageVocabularySessionCompletion('session',6,now);const before=getVocabularyWordSchedule('a');
  sql.exec("CREATE TRIGGER fail_dispatch BEFORE INSERT ON vocabulary_post_session_dispatches BEGIN SELECT RAISE(ABORT,'injected failure'); END;");
  assert.throws(()=>closeVocabularySessionCompletion('session',staged.completionId,later),/injected failure/);
  assert.deepEqual(getVocabularyWordSchedule('a'),before);assert.equal(getVocabularyLearnerWord('a')?.mode,'solidify');
  assert.equal(count('learner_state_effects'),0);assert.equal(count('vocabulary_post_session_dispatches'),0);
  assert.equal(getVocabularySession('session').completion?.status,'failed');
  sql.exec('DROP TRIGGER fail_dispatch');
  assert.equal(closeVocabularySessionCompletion('session',staged.completionId,later).status,'closed');
  assert.equal(count('vocabulary_post_session_dispatches'),1);
}));

test('uncovered response and feedback persist into dispatch without fabricated scheduling or covering',()=>alice(()=>{
  createVocabularySession(context(),now);const before=getVocabularyWordSchedule('a');
  const log=actions(present('one'),response('one',false),{kind:'feedback',payload:{encounterId:'one',feedback:'negative',comment:'Another interpretation'}},finish,immediate);
  appendVocabularySessionActions('session',log,now);const staged=stageVocabularySessionCompletion('session',log.length,now);
  closeVocabularySessionCompletion('session',staged.completionId,later);
  assert.deepEqual(getVocabularyWordSchedule('a'),before);assert.equal(count('learner_feedback'),1);
  const evidence=JSON.parse(String(sql.prepare('SELECT evidence_json FROM vocabulary_post_session_dispatches').get()?.evidence_json));
  assert.deepEqual(evidence.projection.uncoveredWordIds,['a']);assert.equal(evidence.projection.encounters[0].responses.length,1);
  assert.equal(evidence.projection.encounters[0].feedback.length,1);
}));

test('explicit Maintain mode wins and a lapse requests bounded refresh without demotion',()=>alice(()=>{
  createVocabularySession(context(),now);
  const log=actions(present('one'),response('one',false),present('two'),response('two'),{kind:'mode_change',payload:{wordId:'a',mode:'maintain'}},
    {kind:'word_wrap',payload:{wordId:'a',reason:'policy'}},finish);
  appendVocabularySessionActions('session',log,now);const staged=stageVocabularySessionCompletion('session',log.length,now);
  closeVocabularySessionCompletion('session',staged.completionId,later);
  assert.equal(getVocabularyLearnerWord('a')?.mode,'maintain');
  assert.equal(getVocabularyWordSchedule('a')?.refreshUntil,'2026-10-20T10:00:16.000Z');
  assert.equal(getVocabularyWordSchedule('a')?.nextEligibleAt,later);
}));

test('pure cues update their independent schedule without crediting any answer word',()=>alice(()=>{
  createVocabularySession({sessionId:'session',words:[]},now);
  const before=getVocabularyWordSchedule('b');const log=actions(present('cue',null),response('cue'),finish);
  appendVocabularySessionActions('session',log,now);const staged=stageVocabularySessionCompletion('session',log.length,now);
  const closed=closeVocabularySessionCompletion('session',staged.completionId,later);
  assert.deepEqual(closed.report.coveredWordIds,[]);assert.deepEqual(getVocabularyWordSchedule('b'),before);
  assert.equal(sql.prepare('SELECT count(*) AS n FROM learner_pure_cue_schedules').get()?.n,1);
}));

test('owner checks and exact snapshot/assessment validation reject cross-learner or forged writes',()=>{
  alice(()=>createVocabularySession(context(),now));
  runWithLearnerId('bob',()=>{
    assert.throws(()=>getVocabularySession('session'),/not found/);
    assert.throws(()=>appendVocabularySessionActions('session',coveredActions(),now),/not found/);
    assert.throws(()=>stageVocabularySessionCompletion('session',0,now),/not found/);
  });
  alice(()=>{
    const forged=actions(present('one'));if(forged[0].kind==='presentation')forged[0].payload.snapshot.body.material={prompt:'forged'};
    assert.throws(()=>appendVocabularySessionActions('session',forged,now),/source body/);
    assert.throws(()=>appendVocabularySessionActions('session',actions(present('one'),{kind:'response',payload:{encounterId:'one',response:'wrong',outcome:'accepted'}}),now),/outcome/);
    assert.equal(count('session_actions'),0);
  });
});

test('teaching requires explicit completion and recognition self-assessment retains null response',()=>alice(()=>{
  createVocabularySession(context(),now);
  const log=actions(present('intro','new'),present('recognize','new'),{kind:'response',payload:{encounterId:'recognize',response:null,selfAssessment:'accepted',outcome:'accepted'}},
    present('produce','new'),response('produce'),{kind:'teaching_complete',payload:{wordId:'new'}},finish);
  appendVocabularySessionActions('session',log,now);assert.equal(count('teaching_completions'),0);
  const staged=stageVocabularySessionCompletion('session',log.length,now);closeVocabularySessionCompletion('session',staged.completionId,later);
  assert.equal(count('teaching_completions'),1);assert.equal(getVocabularyLearnerWord('new')?.mode,'solidify');
  const stored=getVocabularySession('session');assert.equal(stored.projection.encounters[1].effectiveResponses[0].payload.response,null);
  assert.equal(sql.prepare("SELECT count(*) AS n FROM learner_state_effects WHERE kind='recognition_outcome'").get()?.n,1);
}));

test('worker due list is cross-learner metadata only, exact deadline, pending only',()=>alice(()=>{
  createVocabularySession(context(),now);appendVocabularySessionActions('session',coveredActions(),now);
  const staged=stageVocabularySessionCompletion('session',6,now);
  assert.deepEqual(listDueVocabularySessionCompletions(now),[]);
  assert.deepEqual(listDueVocabularySessionCompletions(later),[{learnerId:'alice',sessionId:'session',completionId:staged.completionId}]);
  closeVocabularySessionCompletion('session',staged.completionId,later);assert.deepEqual(listDueVocabularySessionCompletions(later),[]);
}));

test('recognition scheduling applies at close once, preserving production and other learners',()=>alice(()=>{
  sql.prepare("INSERT INTO learner_owned_word_skill_state VALUES('bob','new','recognition',72,2.5,1,NULL,NULL),('alice','new','production',48,2.5,1,NULL,NULL)").run();
  const others=sql.prepare("SELECT * FROM learner_owned_word_skill_state ORDER BY learner_id,skill_id").all();
  createVocabularySession(context(),now);
  const log=actions(present('intro','new'),present('recognize','new'),{kind:'response',payload:{encounterId:'recognize',response:null,selfAssessment:'accepted',outcome:'accepted'}},
    {kind:'word_skip',payload:{wordId:'new'}},finish);
  appendVocabularySessionActions('session',log,now);
  assert.deepEqual(sql.prepare("SELECT * FROM learner_owned_word_skill_state ORDER BY learner_id,skill_id").all(),others);
  const staged=stageVocabularySessionCompletion('session',log.length,now);
  assert.deepEqual(sql.prepare("SELECT * FROM learner_owned_word_skill_state ORDER BY learner_id,skill_id").all(),others);
  closeVocabularySessionCompletion('session',staged.completionId,later);
  const after=sql.prepare("SELECT * FROM learner_owned_word_skill_state WHERE learner_id='alice' AND word_id='new' AND skill_id='recognition'").get();
  assert.equal(after?.interval_hours,24);assert.equal(after?.last_studied_at,later);
  closeVocabularySessionCompletion('session',staged.completionId,'2026-10-18T10:00:00.000Z');
  assert.deepEqual(sql.prepare("SELECT * FROM learner_owned_word_skill_state WHERE learner_id='alice' AND word_id='new' AND skill_id='recognition'").get(),after);
  assert.deepEqual(sql.prepare("SELECT * FROM learner_owned_word_skill_state WHERE learner_id='bob' OR skill_id='production' ORDER BY learner_id,skill_id").all(),others);
}));

test('bounded client active duration is frozen with completion input and does not count summary waiting',()=>alice(()=>{
  createVocabularySession(context(),now);appendVocabularySessionActions('session',coveredActions(),now);
  assert.throws(()=>stageVocabularySessionCompletion('session',6,later,{activeDurationMs:-1}),/bounded integer/);
  assert.throws(()=>stageVocabularySessionCompletion('session',6,later,{activeDurationMs:999999}),/bounded integer/);
  const staged=stageVocabularySessionCompletion('session',6,later,{activeDurationMs:12000});
  assert.deepEqual(staged.metadata,{activeDurationMs:12000,source:'client_visibility_and_focus'});
  assert.equal(stageVocabularySessionCompletion('session',6,'2026-10-17T10:00:20.000Z',{activeDurationMs:12000}).closeAt,staged.closeAt);
  assert.throws(()=>stageVocabularySessionCompletion('session',6,'2026-10-17T10:00:20.000Z',{activeDurationMs:16000}),/different active duration/);
  const closed=closeVocabularySessionCompletion('session',staged.completionId,'2026-10-17T11:00:00.000Z');
  assert.equal(closed.metadata.activeDurationMs,12000);
  const input=JSON.parse(String(sql.prepare('SELECT input_json FROM vocabulary_session_completions').get()?.input_json));assert.equal(input.activeDurationMs,12000);
}));
