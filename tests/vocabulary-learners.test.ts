import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, afterEach, test } from 'node:test';
import { setDb } from '../server/db/connection.ts';
import { runWithLearnerId } from '../server/db/learner-context.ts';
import { addVocabularyWord, getVocabularyLearnerWord, getVocabularyWordSchedule, changeVocabularyMode,
  requestVocabularyRefresh, listVocabularyCandidates } from '../server/db/vocabulary-learners.ts';
let sql: DatabaseSync;
const alice = <T>(fn: () => T) => runWithLearnerId('alice', fn);
beforeEach(() => {
  sql = new DatabaseSync(':memory:'); setDb(sql); sql.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE learners(learner_id TEXT PRIMARY KEY);
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
  sql.exec(fs.readFileSync(new URL('../server/db/migrations/0039_vocabulary_content.sql', import.meta.url),'utf8'));
  sql.exec(fs.readFileSync(new URL('../server/db/migrations/0041_vocabulary_learner_state.sql', import.meta.url),'utf8'));
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
