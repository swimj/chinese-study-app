import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, afterEach, test } from 'node:test';
import { setDb } from '../server/db/connection.ts';
import { createVocabularyContent,updateVocabularyContent } from '../server/db/vocabulary-content.ts';
import { getCurrentVocabularyPendingCompletionSessionId } from '../server/db/vocabulary-sessions.ts';
import { runWithLearnerId } from '../server/db/learner-context.ts';
import { addVocabularyWord, getVocabularyLearnerWord, getVocabularyWordSchedule, changeVocabularyMode,
  requestVocabularyRefresh, listVocabularyCandidates, listVocabularyLearnerWords, enrollVocabularyDietWord, setVocabularyStashMembership, dismissVocabularyWord } from '../server/db/vocabulary-learners.ts';
let sql: DatabaseSync;
const alice = <T>(fn: () => T) => runWithLearnerId('alice', fn);
beforeEach(() => {
  sql = new DatabaseSync(':memory:'); setDb(sql); sql.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE learners(learner_id TEXT PRIMARY KEY);
    CREATE TABLE learner_word_reserve_requests(learner_id TEXT PRIMARY KEY, requested_at TEXT NOT NULL);
    CREATE TABLE lexical_words(id TEXT PRIMARY KEY, created_at TEXT);
    CREATE TABLE learner_word_state(learner_id TEXT, word_id TEXT, status TEXT, learning_streak INTEGER, last_learning_covered_on TEXT);
    CREATE TABLE learner_owned_user_word_priority(learner_id TEXT, word_id TEXT, priority_tier INTEGER, updated_at TEXT);
    CREATE TABLE learner_owned_word_skill_state(learner_id TEXT, word_id TEXT, skill_id TEXT, interval_hours REAL, ease_factor REAL, enabled INTEGER, next_due_at TEXT, last_studied_at TEXT);
    CREATE TABLE learner_owned_word_study_admission_state(learner_id TEXT, word_id TEXT, earliest_next_study_at TEXT);
    INSERT INTO learners VALUES ('alice'),('bob');
    INSERT INTO lexical_words VALUES ('learning','2026-01-01T00:00:00.000Z'),('review','2026-01-01T00:00:00.000Z'),('stash','2026-01-01T00:00:00.000Z'),('untouched','2026-01-01T00:00:00.000Z');
    INSERT INTO learner_word_state VALUES ('alice','learning','learning',2,'2026-10-16'),('alice','review','review',0,NULL);
    INSERT INTO learner_owned_user_word_priority VALUES ('alice','stash',0,'2026-10-01T00:00:00.000Z');
    INSERT INTO learner_owned_word_skill_state VALUES ('alice','review','production',48,2.7,1,'2026-10-19T00:00:00.000Z','2026-10-17T00:00:00.000Z'),('alice','review','recognition',96,2.6,1,'2026-10-21T00:00:00.000Z','2026-10-17T00:00:00.000Z');
  `);
  sql.exec(`ALTER TABLE lexical_words ADD COLUMN hanzi TEXT NOT NULL DEFAULT '字';
    ALTER TABLE lexical_words ADD COLUMN traditional TEXT;
    ALTER TABLE lexical_words ADD COLUMN pinyin TEXT NOT NULL DEFAULT 'zi';
    ALTER TABLE lexical_words ADD COLUMN meaning TEXT NOT NULL DEFAULT 'character';`);
  sql.exec(fs.readFileSync(new URL('../server/db/migrations/0039_vocabulary_content.sql', import.meta.url),'utf8'));
  sql.exec(fs.readFileSync(new URL('../server/db/migrations/0062_vocabulary_sense_coverage.sql', import.meta.url),'utf8'));
  sql.exec(fs.readFileSync(new URL('../server/db/migrations/0041_vocabulary_learner_state.sql', import.meta.url),'utf8'));
  sql.exec(fs.readFileSync(new URL('../server/db/migrations/0046_vocabulary_pure_cue_guards.sql', import.meta.url),'utf8'));
  sql.exec(fs.readFileSync(new URL('../server/db/migrations/0047_vocabulary_dismissal.sql', import.meta.url),'utf8'));
  sql.exec(fs.readFileSync(new URL('../server/db/migrations/0052_vocabulary_automatic_promotion_pause.sql',import.meta.url),'utf8'));
});
afterEach(() => sql.close());
test('conversion enrolls only explicit learner state/stash and preserves recognition', () => alice(() => {
  assert.equal(getVocabularyLearnerWord('learning')?.mode,'solidify');
  assert.equal(getVocabularyLearnerWord('review')?.mode,'practice');
  assert.equal(getVocabularyLearnerWord('stash')?.inStash,true);
  assert.equal(getVocabularyLearnerWord('untouched'),null);
  assert.equal(getVocabularyWordSchedule('learning')?.nextEligibleAt,'2026-10-17T00:00:00.000Z');
  assert.equal(getVocabularyWordSchedule('review')?.schedulerState.intervalHours,48);
  assert.equal(sql.prepare("SELECT interval_hours FROM learner_owned_word_skill_state WHERE skill_id='recognition'").get()?.interval_hours,96);
  assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);
}));
test('mode choice preserves schedule, history and rejects stale updates', () => alice(() => {
  const before=getVocabularyWordSchedule('review');
  assert.equal(changeVocabularyMode('review','maintain',1).stateVersion,2);
  assert.deepEqual(getVocabularyWordSchedule('review'),before);
  assert.throws(()=>changeVocabularyMode('review','solidify',1),/state changed/);
  assert.equal(sql.prepare("SELECT count(*) AS n FROM backend_events WHERE name='vocabulary.mode.changed'").get()?.n,1);
}));
test('learner isolation applies to reads, mode and refresh', () => runWithLearnerId('bob',()=>{
  assert.equal(getVocabularyLearnerWord('review'),null);
  assert.equal(getVocabularyWordSchedule('review'),null);
  assert.throws(()=>changeVocabularyMode('review','maintain',1),/not in/);
  assert.throws(()=>requestVocabularyRefresh('review'),/not in/);
  assert.deepEqual(listVocabularyCandidates(),[]);
}));
test('refresh is prioritized and bounded without changing mode or scheduler history', () => alice(()=>{
  changeVocabularyMode('review','maintain',1);
  const schedule=requestVocabularyRefresh('review','2026-10-17T00:00:00.000Z');
  assert.equal(schedule.refreshUntil,'2026-10-20T00:00:00.000Z');
  assert.equal(schedule.schedulerState.intervalHours,48);
  assert.equal(listVocabularyCandidates(1,'2026-10-17T00:00:00.000Z')[0]?.wordId,'review');
  assert.equal(getVocabularyLearnerWord('review')?.mode,'maintain');
}));
test('enrollment is idempotent and preserves mode on re-stash', () => alice(()=>{
  addVocabularyWord('untouched','specific use');
  addVocabularyWord('untouched','a later accidental retry');
  assert.equal(getVocabularyLearnerWord('untouched')?.intendedUseText,'specific use');
  changeVocabularyMode('review','maintain',1);
  assert.equal(addVocabularyWord('review').mode,'maintain');
  assert.throws(()=>addVocabularyWord('missing'),/Unknown word/);
}));

test('dismissal removes stash and resets mode while preserving schedules and evidence', () => alice(() => {
  addVocabularyWord('review');const before=getVocabularyWordSchedule('review')!;
  const word=getVocabularyLearnerWord('review')!;
  const dismissed=dismissVocabularyWord('review',word.stateVersion);
  assert.equal(dismissed.mode,'unstudied');assert.equal(dismissed.inStash,false);assert.ok(dismissed.dismissedAt);
  assert.equal(dismissed.stateVersion,word.stateVersion+1);assert.deepEqual(getVocabularyWordSchedule('review'),before);
  assert.equal(sql.prepare("SELECT status FROM learner_word_state WHERE word_id='review'").get()!.status,'review');
  assert.equal(listVocabularyLearnerWords().some((row)=>row.wordId==='review'),false);
  assert.equal(listVocabularyCandidates(30,'2030-01-01T00:00:00.000Z').some((row)=>row.wordId==='review'),false);
  assert.equal(dismissVocabularyWord('review').stateVersion,dismissed.stateVersion);
  assert.equal(sql.prepare("SELECT count(*) AS n FROM backend_events WHERE name='vocabulary.word.dismissed'").get()!.n,1);
  assert.throws(()=>dismissVocabularyWord('review',word.stateVersion),/state changed/);
  const restored=addVocabularyWord('review');assert.equal(restored.mode,'unstudied');assert.equal(restored.inStash,true);assert.equal(restored.dismissedAt,null);
  assert.deepEqual(getVocabularyWordSchedule('review'),before);
}));

test('ordinary stash membership changes preserve mode and maintain eligibility independently', () => alice(() => {
  const before=getVocabularyWordSchedule('review');const word=getVocabularyLearnerWord('review')!;
  const stashed=setVocabularyStashMembership('review',true,word.stateVersion);
  const removed=setVocabularyStashMembership('review',false,stashed.stateVersion);
  assert.equal(removed.mode,'practice');assert.equal(removed.inStash,false);
  assert.deepEqual(getVocabularyWordSchedule('review'),before);
  assert.equal(listVocabularyLearnerWords().some((row)=>row.wordId==='review'),true);
  assert.equal(listVocabularyCandidates(30,'2030-01-01T00:00:00.000Z').some((row)=>row.wordId==='review'),true);
  assert.throws(()=>setVocabularyStashMembership('review',true,stashed.stateVersion),/state changed/);
  assert.equal(setVocabularyStashMembership('untouched',true).mode,'unstudied');
}));

test('word projection and current unfinished completion lookup remain learner-scoped', () => {
  sql.exec(`CREATE TABLE vocabulary_session_completions(completion_id TEXT,session_id TEXT,learner_id TEXT,status TEXT,staged_at TEXT);
    INSERT INTO vocabulary_session_completions VALUES ('a1','alice-pending','alice','pending','2026-10-17T00:00:00.000Z'),
      ('b1','bob-pending','bob','pending','2026-10-18T00:00:00.000Z'),('a2','alice-closed','alice','closed','2026-10-19T00:00:00.000Z');`);
  alice(()=>{
    assert.equal(getCurrentVocabularyPendingCompletionSessionId(),'alice-pending');
    assert.equal(listVocabularyLearnerWords().length,3);
    const before=sql.prepare('SELECT count(*) AS n FROM learner_words').get()!.n;
    listVocabularyLearnerWords();assert.equal(sql.prepare('SELECT count(*) AS n FROM learner_words').get()!.n,before);
  });
  runWithLearnerId('bob',()=>{
    assert.equal(getCurrentVocabularyPendingCompletionSessionId(),'bob-pending');assert.deepEqual(listVocabularyLearnerWords(),[]);
    assert.throws(()=>dismissVocabularyWord('review'),/not found/);
  });
});

test('pure schedule guards protect updates and subsequent authored type edits', () => {
  const actor={kind:'service' as const,id:'test'};
  const common={kind:'exercise' as const,payloadVersion:1,body:'cue',skill:'production',exerciseRole:'general' as const,
    assessment:{},availability:'active' as const,originKind:'human' as const,words:[{wordId:'review',relation:'target' as const}],answers:[{wordId:'review',acceptedForms:['字']}]};
  const pure=createVocabularyContent({...common,contentId:'pure',exerciseType:'pure_cue',accessScope:'shared'},actor);
  createVocabularyContent({...common,contentId:'private-pure',exerciseType:'pure_cue',accessScope:'private',ownerLearnerId:'alice'},actor);
  createVocabularyContent({...common,contentId:'ordinary',exerciseType:'definition',accessScope:'shared'},actor);
  createVocabularyContent({...common,contentId:'teaching-pure',exerciseType:'pure_cue',exerciseRole:'teaching',accessScope:'shared'},actor);
  sql.prepare("INSERT INTO learner_pure_cue_schedules(learner_id,content_id,policy_version,scheduler_state_json) VALUES ('alice','pure','test','{}')").run();
  assert.throws(()=>sql.prepare("UPDATE learner_pure_cue_schedules SET content_id='ordinary'").run(),/accessible general pure cue/);
  assert.throws(()=>sql.prepare("UPDATE learner_pure_cue_schedules SET content_id='teaching-pure'").run(),/accessible general pure cue/);
  sql.prepare("UPDATE learner_pure_cue_schedules SET content_id='private-pure'").run();
  assert.throws(()=>sql.prepare("UPDATE learner_pure_cue_schedules SET learner_id='bob'").run(),/accessible general pure cue/);
  assert.throws(()=>sql.prepare("INSERT INTO learner_pure_cue_schedules(learner_id,content_id,policy_version,scheduler_state_json) VALUES ('bob','teaching-pure','test','{}')").run(),/accessible general pure cue/);
  sql.prepare("UPDATE learner_pure_cue_schedules SET content_id='pure'").run();
  assert.ok(pure.kind==='exercise');
  assert.throws(()=>updateVocabularyContent('pure',1,{...pure,exerciseType:'definition'},actor),/scheduled pure cue identity/);
  assert.equal(sql.prepare("SELECT version FROM content_items WHERE content_id='pure'").get()!.version,1);
});

test('candidate mode and stash filters apply before the bounded selection limit',()=>alice(()=>{
  const now='2030-01-01T00:00:00.000Z';
  assert.equal(listVocabularyCandidates(1,now)[0]!.mode,'solidify');
  assert.equal(listVocabularyCandidates(1,now,{modes:['unstudied'],inStash:true})[0]!.wordId,'stash');
  assert.equal(listVocabularyCandidates(1,now,{modes:['practice']})[0]!.wordId,'review');
  assert.deepEqual(listVocabularyCandidates(1,now,{modes:[]}),[]);
}));


test('diet enrollment is limited to the selected identity and preserves existing stash/mode',()=>alice(()=>{
  const initial=sql.prepare('SELECT count(*) AS n FROM learner_words').get()!.n as number;
  const diet=enrollVocabularyDietWord('untouched');assert.equal(diet.mode,'unstudied');assert.equal(diet.inStash,false);
  assert.equal(sql.prepare('SELECT count(*) AS n FROM learner_words').get()!.n,initial+1);
  assert.equal(getVocabularyWordSchedule('untouched')!.schedulerState.intervalHours,24);
  assert.equal(enrollVocabularyDietWord('untouched').stateVersion,diet.stateVersion);
  const reviewed=getVocabularyLearnerWord('review')!;assert.deepEqual(enrollVocabularyDietWord('review'),reviewed);
  const stashed=getVocabularyLearnerWord('stash')!;assert.deepEqual(enrollVocabularyDietWord('stash'),stashed);
  assert.throws(()=>enrollVocabularyDietWord('missing'),/Unknown word/);
}));


test('unfinished diet enrollment and explicit dismissal retain different dispositions',()=>alice(()=>{
  const diet=enrollVocabularyDietWord('untouched');assert.equal(diet.dismissedAt,null);
  assert.equal(setVocabularyStashMembership('untouched',false).dismissedAt,null);
  const dismissed=dismissVocabularyWord('untouched');assert.ok(dismissed.dismissedAt);
  assert.equal(setVocabularyStashMembership('untouched',false).dismissedAt,dismissed.dismissedAt);
  const restored=changeVocabularyMode('untouched','practice',dismissed.stateVersion);assert.equal(restored.dismissedAt,null);
}));

test('explicit same-mode Solidify choice holds graduation, and other mode choices or dismissal clear it',()=>alice(()=>{
  assert.equal(getVocabularyLearnerWord('learning')!.automaticPromotionPaused,false);
  const schedule=getVocabularyWordSchedule('learning');
  const first=changeVocabularyMode('learning','solidify',1);
  assert.equal(first.automaticPromotionPaused,true);assert.equal(first.stateVersion,2);
  assert.deepEqual(getVocabularyWordSchedule('learning'),schedule);
  const repeated=changeVocabularyMode('learning','solidify',first.stateVersion);
  assert.equal(repeated.automaticPromotionPaused,true);assert.equal(repeated.stateVersion,3);
  assert.equal(repeated.modeChangedAt,first.modeChangedAt);
  const practice=changeVocabularyMode('learning','practice',repeated.stateVersion);
  assert.equal(practice.automaticPromotionPaused,false);
  const returned=changeVocabularyMode('learning','solidify',practice.stateVersion);
  assert.equal(returned.automaticPromotionPaused,true);
  const teachAgain=changeVocabularyMode('learning','unstudied',returned.stateVersion);
  assert.equal(teachAgain.automaticPromotionPaused,false);
  const held=changeVocabularyMode('learning','solidify',teachAgain.stateVersion);
  assert.equal(dismissVocabularyWord('learning',held.stateVersion).automaticPromotionPaused,false);
  assert.deepEqual(getVocabularyWordSchedule('learning'),schedule);
}));

test('membership and mode transitions request deferred reserve reconciliation atomically',()=>alice(()=>{
  const clear=()=>sql.prepare('DELETE FROM learner_word_reserve_requests').run();
  const requested=()=>assert.deepEqual(sql.prepare('SELECT learner_id FROM learner_word_reserve_requests').all().map(row=>row.learner_id),['alice']);
  addVocabularyWord('untouched');requested();clear();
  setVocabularyStashMembership('untouched',false);requested();clear();
  setVocabularyStashMembership('untouched',false);assert.equal(sql.prepare('SELECT count(*) AS n FROM learner_word_reserve_requests').get()?.n,0);
  let word=getVocabularyLearnerWord('untouched')!;
  word=changeVocabularyMode('untouched','solidify',word.stateVersion);requested();clear();
  dismissVocabularyWord('untouched',word.stateVersion);requested();clear();
  sql.exec('BEGIN');
  addVocabularyWord('untouched');requested();
  sql.exec('ROLLBACK');
  assert.equal(sql.prepare('SELECT count(*) AS n FROM learner_word_reserve_requests').get()?.n,0);
  assert.notEqual(getVocabularyLearnerWord('untouched')?.dismissedAt,null);
}));
