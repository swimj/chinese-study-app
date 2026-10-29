import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync, backup } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { setDb } from '../server/db/connection.ts';
import { runWithLearnerId } from '../server/db/learner-context.ts';
import { writeVocabularyDefaultUsefulSenses } from '../server/db/vocabulary-sense-coverage.ts';
import { createVocabularyContent,createVocabularySense } from '../server/db/vocabulary-content.ts';
import { changeVocabularyMode, getVocabularyLearnerWord, getVocabularyWordSchedule } from '../server/db/vocabulary-learners.ts';
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
    CREATE TABLE word_introduction_preparation(preparation_epoch INTEGER DEFAULT 0,word_id TEXT PRIMARY KEY, content_id TEXT, package_id TEXT, active_stage TEXT, lease_token TEXT, lease_expires_at TEXT);
    CREATE TABLE word_content_documents(content_id TEXT PRIMARY KEY, word_id TEXT, publication_id TEXT, content_json TEXT);
    CREATE TABLE shared_content_publications(publication_id TEXT PRIMARY KEY, publication_status TEXT);
    CREATE TABLE model_invocations(id TEXT PRIMARY KEY);
    CREATE TABLE learner_word_reserve_requests(learner_id TEXT PRIMARY KEY, requested_at TEXT NOT NULL);
    CREATE TABLE learner_owned_review_session_summaries(learner_id TEXT,session_id TEXT,PRIMARY KEY(learner_id,session_id));
    CREATE TABLE lexical_words(id TEXT PRIMARY KEY,created_at TEXT,hanzi TEXT NOT NULL DEFAULT '字',pinyin TEXT NOT NULL DEFAULT 'zì');
    CREATE TABLE learner_settings(learner_id TEXT,setting_key TEXT,value_json TEXT,updated_at TEXT,PRIMARY KEY(learner_id,setting_key));
    CREATE TABLE learner_word_state(learner_id TEXT,word_id TEXT,status TEXT,learning_streak INTEGER,last_learning_covered_on TEXT);
    CREATE TABLE learner_owned_user_word_priority(learner_id TEXT,word_id TEXT,priority_tier INTEGER,updated_at TEXT);
    CREATE TABLE learner_owned_word_skill_state(learner_id TEXT,word_id TEXT,skill_id TEXT,interval_hours REAL,ease_factor REAL,enabled INTEGER,next_due_at TEXT,last_studied_at TEXT,PRIMARY KEY(learner_id,word_id,skill_id));
    CREATE TABLE learner_owned_word_skill_relevance(learner_id TEXT,word_id TEXT,skill_id TEXT,relevance_state TEXT,PRIMARY KEY(learner_id,word_id,skill_id));
    CREATE TABLE learner_owned_word_study_admission_state(learner_id TEXT,word_id TEXT,study_phase TEXT,earliest_next_study_at TEXT,PRIMARY KEY(learner_id,word_id));
    INSERT INTO learners VALUES ('alice'),('bob');
    INSERT INTO lexical_words(id,created_at) VALUES ('a','2026-01-01T00:00:00.000Z'),('b','2026-01-01T00:00:00.000Z'),('new','2026-01-01T00:00:00.000Z');
    INSERT INTO learner_word_state VALUES ('alice','a','learning',2,NULL),('alice','b','review',0,NULL),('alice','new','unstudied',0,NULL);
  `);
  for (const name of ['0062_vocabulary_sense_coverage.sql','0064_vocabulary_default_useful_senses.sql','0039_vocabulary_content.sql','0041_vocabulary_learner_state.sql','0042_vocabulary_sessions.sql','0047_vocabulary_dismissal.sql','0052_vocabulary_automatic_promotion_pause.sql','0023_session_debrief.sql','0048_vocabulary_connections.sql']) {
    sql.exec(fs.readFileSync(new URL(`../server/db/migrations/${name}`,import.meta.url),'utf8'));
  }
  sql.exec(fs.readFileSync(new URL('../server/db/migrations/0045_vocabulary_provenance_links.sql',import.meta.url),'utf8').split('CREATE TABLE vocabulary_practice_preparation')[1]!.replace(/^/, 'CREATE TABLE vocabulary_practice_preparation'));
  sql.exec("ALTER TABLE vocabulary_practice_preparation ADD COLUMN next_attempt_at TEXT NOT NULL DEFAULT ''; ALTER TABLE vocabulary_practice_preparation ADD COLUMN total_attempt_count INTEGER NOT NULL DEFAULT 0;");
  sql.exec(fs.readFileSync(new URL('../server/db/migrations/0043_vocabulary_import.sql',import.meta.url),'utf8').split('CREATE TRIGGER')[0]!);
  contents = {};
  alice(() => {
    for (const [id, word, skill, role, type] of [
      ['one','a','production','general','word'], ['two','a','production','general','word'],
      ['recognize-a','a','recognition','general','recognition'], ['recognize-b','b','recognition','general','recognition'],
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
function recognitionResponse(id: string,accepted=true): Input {return {kind:'response',payload:{encounterId:id,response:null,selfAssessment:accepted?'accepted':'rejected',outcome:accepted?'accepted':'rejected'}};}
function response(id: string,accepted=true): Input {return {kind:'response',payload:{encounterId:id,response:accepted?'字':'wrong',outcome:accepted?'accepted':'rejected'}};}
const finish: Input={kind:'finish_for_now',payload:{}};
const immediate: Input={kind:'finish_immediately',payload:{}};
function coveredActions(): VocabularySessionAction[] {return actions(present('recognize-a'),recognitionResponse('recognize-a'),present('two'),response('two'),{kind:'word_wrap',payload:{wordId:'a',reason:'policy'}},finish);}
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
  const log=actions(present('recognize-a'),recognitionResponse('recognize-a'),present('one'),response('one',false),present('two'),response('two'),{kind:'word_wrap',payload:{wordId:'a',reason:'policy'}},
    {kind:'mode_change',payload:{wordId:'a',mode:'maintain'}},finish);
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
  const bootstrap={schemaVersion:1,id:'bootstrap-new',word:{wordId:'new',hanzi:'字',traditional:null,pinyin:'zì'},
    uses:[{id:'u1',label:'character',notes:[],exampleIds:['e1']}],examples:[{id:'e1',text:'字',translation:'Character',pronunciation:'zì'}]};
  sql.prepare("INSERT INTO word_introduction_preparation(word_id,content_id) VALUES ('new','bootstrap-new')").run();
  sql.prepare("INSERT INTO shared_content_publications VALUES ('published','available')").run();
  sql.prepare("INSERT INTO word_content_documents VALUES ('bootstrap-new','new','published',?)").run(JSON.stringify(bootstrap));
  const sense=createVocabularySense({senseId:'new-character',wordId:'new',description:{label:'character',notes:[]}},{kind:'service',id:'session-fixture'});
  sql.prepare('INSERT INTO legacy_sense_imports VALUES (?,?,?,?)').run(bootstrap.id,'u1',sense.senseId,sense.version);
  writeVocabularyDefaultUsefulSenses('new',0,[sense.senseId],{kind:'service',id:'session-fixture'});
  createVocabularySession(context(),now);
  const teaching: Input[]=[present('intro','new')];
  for(let index=0;index<3;index++)for(const contentId of ['recognize','produce']) {
    const encounterId=index===0?contentId:`${contentId}-${index}`;
    teaching.push({kind:'presentation',payload:{encounterId,wordId:'new',snapshot:snapshot(contentId)}});
    teaching.push(contentId==='recognize'?recognitionResponse(encounterId):response(encounterId));
  }
  const log=actions(...teaching,{kind:'teaching_complete',payload:{wordId:'new'}},finish);
  appendVocabularySessionActions('session',log,now);assert.equal(count('teaching_completions'),0);
  assert.equal(count('vocabulary_practice_preparation'),0);assert.equal(count('learner_word_reserve_requests'),0);
  const staged=stageVocabularySessionCompletion('session',log.length,now);
  assert.equal(count('vocabulary_practice_preparation'),0);
  sql.exec("CREATE TRIGGER fail_close_event BEFORE INSERT ON backend_events WHEN NEW.name='vocabulary.session.closed' BEGIN SELECT RAISE(ABORT,'closure event failure'); END;");
  assert.throws(()=>closeVocabularySessionCompletion('session',staged.completionId,later),/closure event failure/);
  assert.equal(count('vocabulary_practice_preparation'),0);assert.equal(count('learner_word_reserve_requests'),0);assert.equal(count('teaching_completions'),0);
  sql.exec('DROP TRIGGER fail_close_event');
  closeVocabularySessionCompletion('session',staged.completionId,later);
  assert.equal(count('vocabulary_practice_preparation'),1);assert.equal(count('learner_word_reserve_requests'),1);
  assert.equal(sql.prepare('SELECT status FROM vocabulary_practice_preparation').get()?.status,'queued');
  closeVocabularySessionCompletion('session',staged.completionId,later);
  assert.equal(count('vocabulary_practice_preparation'),1);
  assert.equal(count('teaching_completions'),1);assert.equal(getVocabularyLearnerWord('new')?.mode,'solidify');
  assert.equal(getVocabularyWordSchedule('new')?.schedulerState.cleanCoveredSessions,0);
  assert.equal(getVocabularyLearnerWord('new')?.automaticPromotionPaused,false);
  assert.equal(getVocabularyWordSchedule('new')?.nextEligibleAt,'2026-10-18T00:00:00.000Z');
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

function closeLog(sessionId: string, inputs: Input[], at = now, closedAt = later) {
  createVocabularySession(context(sessionId),at);
  const log=actions(...inputs).map((action): VocabularySessionAction => {
    const retained={...action,actionId:`${sessionId}/${action.actionId}`,clientActionId:`${sessionId}/${action.clientActionId}`};
    if(retained.kind==='undo')return {...retained,payload:{undoesActionId:`${sessionId}/${retained.payload.undoesActionId}`}};
    if('encounterId' in retained.payload)return {...retained,payload:{...retained.payload,encounterId:`${sessionId}/${retained.payload.encounterId}`}} as VocabularySessionAction;
    return retained;
  });
  const session=appendVocabularySessionActions(sessionId,log,at);
  const staged=stageVocabularySessionCompletion(sessionId,log.length,at);
  closeVocabularySessionCompletion(sessionId,staged.completionId,closedAt);
  return session;
}
const cleanWork = (): Input[] => [present('recognize-a'),recognitionResponse('recognize-a'),present('one'),response('one'),{kind:'word_wrap',payload:{wordId:'a',reason:'policy'}}];

test('three clean Solidify sessions graduate automatically while each earlier coverage is next UTC day',()=>alice(()=>{
  const schedule=getVocabularyWordSchedule('a')!;
  sql.prepare("UPDATE learner_word_schedules SET scheduler_state_json=? WHERE learner_id='alice' AND word_id='a'")
    .run(JSON.stringify({...schedule.schedulerState,cleanCoveredSessions:0}));
  for(let index=0;index<3;index++) {
    const session=closeLog(`clean-${index}`,[...cleanWork(),finish],`2026-10-${17+index}T10:00:00.000Z`,`2026-10-${17+index}T10:00:16.000Z`);
    assert.equal(session.projection.words.a.recommendedMode,index===2?'practice':null);
    assert.equal(getVocabularyWordSchedule('a')!.schedulerState.cleanCoveredSessions,index+1);
    assert.equal(getVocabularyLearnerWord('a')!.mode,index===2?'practice':'solidify');
    if(index<2)assert.equal(getVocabularyWordSchedule('a')!.nextEligibleAt,`2026-10-${18+index}T00:00:00.000Z`);
  }
}));

test('same-mode session choice is durable across later sessions and manual advancement clears it',()=>alice(()=>{
  createVocabularySession(context(),now);
  const log=actions(...cleanWork(),{kind:'mode_change',payload:{wordId:'a',mode:'solidify'}},finish);
  appendVocabularySessionActions('session',log,now);
  const staged=stageVocabularySessionCompletion('session',log.length,now);
  assert.equal(getVocabularyLearnerWord('a')!.automaticPromotionPaused,false);
  closeVocabularySessionCompletion('session',staged.completionId,later);
  assert.equal(getVocabularyLearnerWord('a')!.mode,'solidify');
  assert.equal(getVocabularyLearnerWord('a')!.automaticPromotionPaused,true);
  for(let index=0;index<4;index++) {
    const session=closeLog(`held-${index}`,[...cleanWork(),finish]);
    assert.equal(session.context.words[0].automaticPromotionPaused,true);
    assert.equal(session.projection.words.a.recommendedMode,null);
    assert.equal(getVocabularyLearnerWord('a')!.mode,'solidify');
    assert.equal(getVocabularyWordSchedule('a')!.nextEligibleAt,'2026-10-18T00:00:00.000Z');
  }
  closeLog('manual-practice',[...cleanWork(),{kind:'mode_change',payload:{wordId:'a',mode:'practice'}},finish]);
  assert.equal(getVocabularyLearnerWord('a')!.mode,'practice');
  assert.equal(getVocabularyLearnerWord('a')!.automaticPromotionPaused,false);
}));

test('pending cancellation leaves the hold uncommitted and a revised choice commits only at closure',()=>alice(()=>{
  createVocabularySession(context(),now);
  const log=actions(...cleanWork(),{kind:'mode_change',payload:{wordId:'a',mode:'solidify'}},finish);
  appendVocabularySessionActions('session',log,now);
  const staged=stageVocabularySessionCompletion('session',log.length,now);
  cancelVocabularySessionCompletion('session',staged.completionId,'2026-10-17T10:00:01.000Z');
  assert.equal(getVocabularyLearnerWord('a')!.automaticPromotionPaused,false);
  const continuation=actions({kind:'resume',payload:{}},{kind:'mode_change',payload:{wordId:'a',mode:'practice'}},finish)
    .map((action,index)=>({...action,sequence:log.length+1+index,actionId:`revised-${index}`,clientActionId:`revised-${index}`}));
  appendVocabularySessionActions('session',continuation,now);
  const revised=stageVocabularySessionCompletion('session',log.length+3,now);
  assert.equal(getVocabularyLearnerWord('a')!.mode,'solidify');
  closeVocabularySessionCompletion('session',revised.completionId,later);
  assert.equal(getVocabularyLearnerWord('a')!.mode,'practice');
  assert.equal(getVocabularyLearnerWord('a')!.automaticPromotionPaused,false);
}));

test('an undone in-session Solidify choice permits automatic graduation at closure',()=>alice(()=>{
  const session=closeLog('undone',[...cleanWork(),{kind:'mode_change',payload:{wordId:'a',mode:'solidify'}},
    {kind:'undo',payload:{undoesActionId:'action-6'}},finish]);
  assert.equal(session.projection.words.a.explicitModeChoice,null);
  assert.equal(session.projection.words.a.recommendedMode,'practice');
  assert.equal(getVocabularyLearnerWord('a')!.mode,'practice');
  assert.equal(getVocabularyLearnerWord('a')!.automaticPromotionPaused,false);
}));

test('a late external same-mode Solidify choice fences a frozen in-session Practice choice',()=>alice(()=>{
  const held=changeVocabularyMode('a','solidify',getVocabularyLearnerWord('a')!.stateVersion);
  createVocabularySession(context(),now);
  const log=actions(...cleanWork(),{kind:'mode_change',payload:{wordId:'a',mode:'practice'}},finish);
  appendVocabularySessionActions('session',log,now);
  const staged=stageVocabularySessionCompletion('session',log.length,now);
  const latest=changeVocabularyMode('a','solidify',held.stateVersion);
  assert.equal(latest.stateVersion,held.stateVersion+1);
  closeVocabularySessionCompletion('session',staged.completionId,later);
  assert.equal(getVocabularyLearnerWord('a')!.mode,'solidify');
  assert.equal(getVocabularyLearnerWord('a')!.automaticPromotionPaused,true);
}));

test('a late external Practice choice clears a hold and fences a frozen session Solidify choice',()=>alice(()=>{
  changeVocabularyMode('a','solidify',getVocabularyLearnerWord('a')!.stateVersion);
  createVocabularySession(context(),now);
  const log=actions(...cleanWork(),{kind:'mode_change',payload:{wordId:'a',mode:'solidify'}},finish);
  appendVocabularySessionActions('session',log,now);
  const staged=stageVocabularySessionCompletion('session',log.length,now);
  changeVocabularyMode('a','practice',getVocabularyLearnerWord('a')!.stateVersion);
  closeVocabularySessionCompletion('session',staged.completionId,later);
  assert.equal(getVocabularyLearnerWord('a')!.mode,'practice');
  assert.equal(getVocabularyLearnerWord('a')!.automaticPromotionPaused,false);
}));


test('Practice successes do not accumulate a Solidify graduation count when the learner returns manually',()=>alice(()=>{
  const schedule=getVocabularyWordSchedule('b')!;
  sql.prepare("UPDATE learner_word_schedules SET scheduler_state_json=? WHERE learner_id='alice' AND word_id='b'")
    .run(JSON.stringify({...schedule.schedulerState,cleanCoveredSessions:99}));
  closeLog('practice-work',[present('b','b'),response('b'),{kind:'word_wrap',payload:{wordId:'b',reason:'policy'}},finish]);
  assert.equal(getVocabularyWordSchedule('b')!.schedulerState.cleanCoveredSessions,0);
  const returned=changeVocabularyMode('b','solidify',getVocabularyLearnerWord('b')!.stateVersion);
  assert.equal(returned.automaticPromotionPaused,true);
  const session=closeLog('return-work',[present('recognize-b','b'),recognitionResponse('recognize-b'),present('b','b'),response('b'),{kind:'word_wrap',payload:{wordId:'b',reason:'policy'}},finish]);
  assert.equal(getVocabularyWordSchedule('b')!.schedulerState.cleanCoveredSessions,1);
  assert.equal(session.projection.words.b.recommendedMode,null);
  assert.equal(getVocabularyLearnerWord('b')!.mode,'solidify');
}));

test('covered Solidify with a rejection or without successful recall resets its clean-session count',()=>alice(()=>{
  closeLog('rejected',[present('recognize-a'),recognitionResponse('recognize-a'),present('one'),response('one',false),present('two'),response('two'),
    {kind:'word_wrap',payload:{wordId:'a',reason:'policy'}},finish]);
  assert.equal(getVocabularyWordSchedule('a')!.schedulerState.cleanCoveredSessions,0);
  closeLog('clean-again',[...cleanWork(),finish]);
  assert.equal(getVocabularyWordSchedule('a')!.schedulerState.cleanCoveredSessions,1);
  closeLog('enough',[present('one'),{kind:'word_wrap',payload:{wordId:'a',reason:'enough'}},finish]);
  assert.equal(getVocabularyWordSchedule('a')!.schedulerState.cleanCoveredSessions,0);
  assert.equal(getVocabularyLearnerWord('a')!.mode,'solidify');
}));

test('selected recognition completion advances only recognition and applies shared word recency once',()=>alice(()=>{
  sql.prepare("INSERT INTO learner_owned_word_skill_state VALUES('alice','b','recognition',24,2.5,1,'2026-10-16T10:00:00.000Z','2026-10-15T10:00:00.000Z')").run();
  const productionBefore=getVocabularyWordSchedule('b');
  const recognitionBefore=sql.prepare("SELECT * FROM learner_owned_word_skill_state WHERE learner_id='alice' AND word_id='b' AND skill_id='recognition'").get();
  createVocabularySession({sessionId:'selected-recognition',words:[{wordId:'b',mode:'practice',selectedSkill:'recognition'}]},now);
  const log=actions(present('recognize-b','b'),recognitionResponse('recognize-b'),{kind:'word_wrap',payload:{wordId:'b',reason:'policy'}},finish);
  const active=appendVocabularySessionActions('selected-recognition',log,now);
  assert.deepEqual(active.projection.coveredWordIds,['b']);
  assert.equal(active.projection.words.b.successfulRecall,true);
  assert.deepEqual(getVocabularyWordSchedule('b'),productionBefore);
  const staged=stageVocabularySessionCompletion('selected-recognition',log.length,now);
  closeVocabularySessionCompletion('selected-recognition',staged.completionId,later);
  assert.deepEqual(getVocabularyWordSchedule('b'),productionBefore);
  const recognitionAfter=sql.prepare("SELECT * FROM learner_owned_word_skill_state WHERE learner_id='alice' AND word_id='b' AND skill_id='recognition'").get();
  assert.notDeepEqual(recognitionAfter,recognitionBefore);
  assert.equal(recognitionAfter?.last_studied_at,later);
  assert.equal(sql.prepare("SELECT count(*) AS n FROM learner_state_effects WHERE kind='production_schedule_applied'").get()?.n,0);
  const recency=sql.prepare("SELECT * FROM learner_owned_word_study_admission_state WHERE learner_id='alice' AND word_id='b'").get();
  assert.equal(recency?.study_phase,'review');
  assert.ok(String(recency?.earliest_next_study_at)>later);
  closeVocabularySessionCompletion('selected-recognition',staged.completionId,'2026-10-18T10:00:00.000Z');
  assert.deepEqual(sql.prepare("SELECT * FROM learner_owned_word_skill_state WHERE learner_id='alice' AND word_id='b' AND skill_id='recognition'").get(),recognitionAfter);
  assert.deepEqual(sql.prepare("SELECT * FROM learner_owned_word_study_admission_state WHERE learner_id='alice' AND word_id='b'").get(),recency);
  assert.equal(sql.prepare("SELECT count(*) AS n FROM learner_state_effects WHERE kind='review_recency_guard_applied'").get()?.n,1);
}));

// Port the durable-session-completion reopen contract to the action-log backend.
test('pending and closed completion survive database reopen without moving the deadline or applying twice',async()=>alice(async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vocabulary-completion-reopen-'));
  const file=path.join(dir,'session.db');
  try {
    createVocabularySession(context(),now);
    appendVocabularySessionActions('session',coveredActions(),now);
    const staged=stageVocabularySessionCompletion('session',6,now);
    const before=getVocabularyWordSchedule('a');
    await backup(sql,file);
    sql.close();sql=new DatabaseSync(file);sql.exec('PRAGMA foreign_keys=ON');setDb(sql);
    assert.equal(getVocabularySession('session',now).completion?.closeAt,staged.closeAt);
    assert.deepEqual(getVocabularyWordSchedule('a'),before);
    assert.equal(stageVocabularySessionCompletion('session',6,later).closeAt,staged.closeAt);
    const closed=closeVocabularySessionCompletion('session',staged.completionId,later);
    const after=getVocabularyWordSchedule('a'),effects=count('learner_state_effects');
    sql.close();sql=new DatabaseSync(file);sql.exec('PRAGMA foreign_keys=ON');setDb(sql);
    assert.equal(getVocabularySession('session',later).completion?.status,'closed');
    assert.equal(closeVocabularySessionCompletion('session',staged.completionId,'2026-10-18T00:00:00.000Z').completionId,closed.completionId);
    assert.deepEqual(getVocabularyWordSchedule('a'),after);
    assert.equal(count('learner_state_effects'),effects);
    assert.equal(count('vocabulary_post_session_dispatches'),1);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
}));

for(const lapse of [false,true]) test(`strong pure-cue closure ${lapse?'returns to fragile SRS':'preserves dormant SRS fields'} exactly once`,()=>alice(()=>{
  const state={intervalHours:1234,easeFactor:2.65,strongSince:'2026-09-01T00:00:00.000Z',strongSuccesses:7,maintenanceIdentity:'legacy-cue'};
  const due='2030-01-01T00:00:00.000Z';
  sql.prepare(`INSERT INTO learner_pure_cue_schedules(learner_id,content_id,next_eligible_at,last_practised_at,policy_version,scheduler_state_json)
    VALUES('alice','cue',?,'2026-10-01T00:00:00.000Z','test',?)`).run(due,JSON.stringify(state));
  createVocabularySession({sessionId:'strong-session',words:[]},now);
  const inputs:Input[]=(lapse?[false,true,true,true]:[true]).flatMap((accepted,index)=>[
    {kind:'presentation',payload:{encounterId:`cue-${index}`,wordId:null,snapshot:snapshot('cue')}},
    {kind:'response',payload:{encounterId:`cue-${index}`,response:accepted?'字':'wrong',outcome:accepted?'accepted':'rejected'}},
  ] as Input[]);
  const log=actions(...inputs,finish);
  appendVocabularySessionActions('strong-session',log,now);
  const staged=stageVocabularySessionCompletion('strong-session',log.length,now);
  closeVocabularySessionCompletion('strong-session',staged.completionId,later);
  const row=sql.prepare("SELECT * FROM learner_pure_cue_schedules WHERE learner_id='alice' AND content_id='cue'").get()!;
  const next=JSON.parse(String(row.scheduler_state_json));
  assert.equal(next.intervalHours,lapse?6:1234);
  assert.equal(next.easeFactor,lapse?2.5:2.65);
  assert.equal(next.strongSince,lapse?null:state.strongSince);
  assert.equal(next.strongSuccesses,lapse?0:8);
  assert.equal(next.maintenanceIdentity,'legacy-cue');
  assert.equal(row.next_eligible_at,lapse?'2026-10-17T16:00:16.000Z':due);
  assert.equal(row.last_practised_at,later);
  closeVocabularySessionCompletion('strong-session',staged.completionId,'2026-10-18T00:00:00.000Z');
  assert.deepEqual(sql.prepare("SELECT * FROM learner_pure_cue_schedules WHERE learner_id='alice' AND content_id='cue'").get(),row);
  assert.equal(sql.prepare("SELECT count(*) n FROM learner_state_effects WHERE kind='pure_cue_schedule_applied'").get()!.n,1);
}));
