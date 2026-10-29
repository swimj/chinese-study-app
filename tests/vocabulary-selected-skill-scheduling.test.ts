import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, test } from 'node:test';
import { setDb } from '../server/db/connection.ts';
import { runWithLearnerId } from '../server/db/learner-context.ts';
import { createVocabularyContent } from '../server/db/vocabulary-content.ts';
import { getVocabularyWordSchedule } from '../server/db/vocabulary-learners.ts';
import { createVocabularySession, appendVocabularySessionActions, stageVocabularySessionCompletion, closeVocabularySessionCompletion } from '../server/db/vocabulary-sessions.ts';
import type { VocabularyContent } from '../src/domain/vocabulary-content.ts';
import type { VocabularyEncounterSnapshot, VocabularySessionAction } from '../src/domain/vocabulary-session.ts';
let sql: DatabaseSync;
let contents: Record<string, VocabularyContent>;
const now = '2026-10-17T10:00:00.000Z';
const later = '2026-10-17T10:00:16.000Z';
const alice = <T>(work: () => T) => runWithLearnerId('alice', work);
type Input = VocabularySessionAction extends infer A ? A extends VocabularySessionAction ? Pick<A, 'kind' | 'payload'> : never : never;
beforeEach(() => {
  sql = new DatabaseSync(':memory:'); setDb(sql); sql.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE learners(learner_id TEXT PRIMARY KEY);
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
  for (const name of ['0062_vocabulary_sense_coverage.sql','0039_vocabulary_content.sql','0041_vocabulary_learner_state.sql','0042_vocabulary_sessions.sql','0047_vocabulary_dismissal.sql','0052_vocabulary_automatic_promotion_pause.sql','0023_session_debrief.sql','0048_vocabulary_connections.sql']) {
    sql.exec(fs.readFileSync(new URL(`../server/db/migrations/${name}`,import.meta.url),'utf8'));
  }
  contents = {};
  alice(() => {
    contents.one = createVocabularyContent({contentId:'one',kind:'exercise',payloadVersion:1,body:{prompt:'Recall'},
      accessScope:'shared',availability:'active',originKind:'human',words:[{wordId:'a',relation:'target'}],
      exerciseType:'word',skill:'production',exerciseRole:'general',assessment:{match:'exact'},
      answers:[{wordId:'a',acceptedForms:['字']}]},{kind:'operator',id:'test'});
  });
});
afterEach(() => sql.close());
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
const finish: Input={kind:'finish_for_now',payload:{}};
const immediate: Input={kind:'finish_immediately',payload:{}};
function closeSelected(skill: 'recognition' | 'production' | 'contextual_selection', outcomes: boolean[], uncovered = false) {
  sql.prepare("UPDATE learner_words SET mode='practice' WHERE learner_id='alice' AND word_id='a'").run();
  const contentId = skill === 'production' ? 'one' : 'selected';
  if (skill !== 'production') contents.selected = createVocabularyContent({contentId,kind:'exercise',payloadVersion:1,
    body:skill === 'contextual_selection' ? {prompt:'Choose',choices:[{wordId:'a',label:'字'},{wordId:'b',label:'別'}]} : {prompt:'Recognize'},
    accessScope:'shared',availability:'active',originKind:'human',words:[{wordId:'a',relation:'target'},...(skill === 'contextual_selection' ? [{wordId:'b',relation:'context' as const}] : [])],
    exerciseType:skill === 'recognition' ? 'recognition' : 'contrast',skill,exerciseRole:'general',
    assessment:skill === 'recognition' ? {responseMode:'self_assessment'} : {responseMode:'word_choice',correctWordId:'a'},
    answers:[{wordId:'a',acceptedForms:['字']}]},{kind:'operator',id:'test'});
  createVocabularySession({sessionId:'session',words:[{wordId:'a',mode:'practice',selectedSkill:skill}]},now);
  const inputs: Input[] = outcomes.flatMap((accepted,index) => {
    const encounterId = `encounter-${index}`;
    const served = snapshot(contentId);
    if (skill === 'contextual_selection') served.kind = 'contrast';
    return [{kind:'presentation',payload:{encounterId,wordId:'a',snapshot:served}},
      {kind:'response',payload:{encounterId,response:skill === 'recognition' ? null : accepted ? '字' : 'wrong',
        outcome:accepted ? 'accepted' : 'rejected',
        ...(skill === 'recognition' ? {selfAssessment:accepted ? 'accepted' : 'rejected'} : {}),
        ...(skill === 'contextual_selection' ? {selectedWordId:accepted ? 'a' : 'b'} : {})}}] as Input[];
  });
  inputs.push(...(uncovered ? [finish,immediate] : [{kind:'word_wrap',payload:{wordId:'a',reason:'policy'}},finish]) as Input[]);
  const log = actions(...inputs);
  appendVocabularySessionActions('session',log,now);
  const staged = stageVocabularySessionCompletion('session',log.length,now);
  return closeVocabularySessionCompletion('session',staged.completionId,later);
}

for (const skill of ['recognition','contextual_selection'] as const) test(`completed selected ${skill} retains production schedule and establishes the shared review guard`,()=>alice(()=>{
  const before = getVocabularyWordSchedule('a');
  const completed = closeSelected(skill,[true]);
  assert.equal(completed.report.words.a.covered,true);
  assert.deepEqual(getVocabularyWordSchedule('a'),before);
  assert.equal(sql.prepare("SELECT count(*) n FROM learner_state_effects WHERE kind='production_schedule_applied'").get()!.n,0);
  assert.equal(sql.prepare("SELECT last_studied_at FROM learner_owned_word_skill_state WHERE learner_id='alice' AND word_id='a' AND skill_id=?").get(skill)!.last_studied_at,later);
  assert.equal(sql.prepare("SELECT earliest_next_study_at FROM learner_owned_word_study_admission_state WHERE learner_id='alice' AND word_id='a'").get()!.earliest_next_study_at,'2026-10-17T16:00:16.000Z');
}));

test('selected production counts every miss and schedules six hours with the legacy ease penalty',()=>alice(()=>{
  const completed = closeSelected('production',[false,false,true,true,true]);
  assert.equal(completed.report.words.a.covered,true);
  const after = getVocabularyWordSchedule('a')!;
  assert.equal(after.schedulerState.intervalHours,6);
  assert.equal(after.schedulerState.easeFactor,2.2);
  assert.equal(after.nextEligibleAt,'2026-10-17T16:00:16.000Z');
}));

test('successful production applies the existing fuzz to the multiplied interval',()=>alice(()=>{
  closeSelected('production',[true]);
  const after = getVocabularyWordSchedule('a')!;
  assert.ok(after.schedulerState.intervalHours >= 59 && after.schedulerState.intervalHours <= 61);
  assert.equal(after.schedulerState.easeFactor,2.5);
  assert.equal(after.nextEligibleAt,new Date(Date.parse(later)+after.schedulerState.intervalHours*3_600_000).toISOString());
}));

for (const skill of ['recognition','contextual_selection','production'] as const) test(`uncovered selected ${skill} responses preserve eligibility and do not set a review guard`,()=>alice(()=>{
  const before = getVocabularyWordSchedule('a');
  const completed = closeSelected(skill,[false],true);
  assert.equal(completed.report.words.a.covered,false);
  assert.deepEqual(getVocabularyWordSchedule('a'),before);
  assert.equal(sql.prepare("SELECT count(*) n FROM learner_owned_word_study_admission_state").get()!.n,0);
  assert.equal(sql.prepare("SELECT count(*) n FROM learner_owned_word_skill_state WHERE learner_id='alice' AND word_id='a'").get()!.n,0);
}));


test('Enough without an answer covers Solidify for the day and resets clean progress without recall credit',()=>alice(()=>{
  const before = getVocabularyWordSchedule('a')!;
  assert.equal(before.schedulerState.cleanCoveredSessions,2);
  createVocabularySession({sessionId:'session',words:[{wordId:'a',mode:'solidify',selectedSkill:'production'}]},now);
  const log = actions({kind:'presentation',payload:{encounterId:'unanswered',wordId:'a',snapshot:snapshot('one')}},
    {kind:'word_wrap',payload:{wordId:'a',reason:'enough'}},finish);
  appendVocabularySessionActions('session',log,now);
  const staged = stageVocabularySessionCompletion('session',log.length,now);
  const completed = closeVocabularySessionCompletion('session',staged.completionId,later);
  assert.equal(completed.report.words.a.covered,true);
  assert.equal(completed.report.words.a.successfulRecall,false);
  assert.equal(completed.report.words.a.recommendedMode,null);
  const after = getVocabularyWordSchedule('a')!;
  assert.equal(after.schedulerState.cleanCoveredSessions,0);
  assert.equal(after.nextEligibleAt,'2026-10-18T00:00:00.000Z');
  assert.equal(sql.prepare("SELECT count(*) n FROM learner_owned_word_study_admission_state").get()!.n,0);
}));

// Preserve legacy review arithmetic at the new closure boundary for every skill,
// including multiple misses and long-standing low-ease schedules.
for (const skill of ['recognition','contextual_selection','production'] as const) {
  for (const [ease, expected] of [[2.5, 2.2], [1.9, 1.8]]) test(`${skill} closure retains lapse penalty and floor from ease ${ease}`, () => alice(() => {
    if (skill === 'production') {
      sql.prepare("UPDATE learner_word_schedules SET scheduler_state_json=json_set(scheduler_state_json,'$.intervalHours',72,'$.easeFactor',?) WHERE learner_id='alice' AND word_id='a'").run(ease);
    } else {
      sql.prepare('INSERT INTO learner_owned_word_skill_state VALUES (?,?,?,?,?,?,?,?)')
        .run('alice','a',skill,72,ease,1,now,'2026-10-01T00:00:00.000Z');
    }
    closeSelected(skill,[false,false,true,true,true]);
    const schedule = skill === 'production' ? getVocabularyWordSchedule('a')!.schedulerState : (() => {
      const row = sql.prepare("SELECT interval_hours,ease_factor FROM learner_owned_word_skill_state WHERE learner_id='alice' AND word_id='a' AND skill_id=?").get(skill)!;
      return {intervalHours:row.interval_hours,easeFactor:row.ease_factor};
    })();
    assert.equal(schedule.intervalHours,6);
    assert.equal(schedule.easeFactor,expected);
  }));
  test(`${skill} closure grows the existing interval with the retained good-review policy`, () => alice(() => {
    if (skill === 'production') {
      sql.prepare("UPDATE learner_word_schedules SET scheduler_state_json=json_set(scheduler_state_json,'$.intervalHours',72,'$.easeFactor',2.2) WHERE learner_id='alice' AND word_id='a'").run();
    } else {
      sql.prepare('INSERT INTO learner_owned_word_skill_state VALUES (?,?,?,?,?,?,?,?)')
        .run('alice','a',skill,72,2.2,1,now,'2026-10-01T00:00:00.000Z');
    }
    closeSelected(skill,[true]);
    const interval = skill === 'production' ? getVocabularyWordSchedule('a')!.schedulerState.intervalHours
      : Number(sql.prepare("SELECT interval_hours FROM learner_owned_word_skill_state WHERE learner_id='alice' AND word_id='a' AND skill_id=?").get(skill)!.interval_hours);
    assert.ok(interval >= 158 && interval <= 160);
  }));
}
