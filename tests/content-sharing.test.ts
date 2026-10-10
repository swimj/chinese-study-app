import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, test } from 'node:test';
import { getContentSharingDigest, parseSharingWeek } from '../server/db/content-sharing.ts';
import { setDb, closeDbConnection } from '../server/db/connection.ts';

let db: DatabaseSync;
const now = new Date('2026-10-10T12:00:00.000Z');
beforeEach(() => {
  db = new DatabaseSync(':memory:');
  setDb(db);
  db.exec(`CREATE TABLE learner_word_introduction_events(package_id, word_id, learner_id, event_kind, occurred_at);
    CREATE TABLE content_quality_items(content_key,kind,source_id,word_id,title);
    CREATE TABLE learner_content_quality_encounters(content_key,learner_id,seen_at);
    CREATE TABLE shared_content_publications(publication_id,content_kind,content_id);
    CREATE TABLE lexical_words(id,hanzi,pinyin);
    CREATE TABLE word_preparation_work(work_id,word_id,stage);
    CREATE TABLE word_preparation_attempts(work_id,outcome);
    CREATE TABLE learner_owned_production_cue_evidence_records(cue_id,learner_id,source_attempt_id,record_kind);
    CREATE TABLE learner_owned_study_attempt_events(id,learner_id,occurred_at,action_kind,projected_at);
    CREATE TABLE pure_cue_attempts(pure_cue_id,learner_id,committed_at);
    CREATE TABLE learner_owned_shared_content_publication_provenance(publication_id,learner_id,source_invocation_id,authorized_at);
    CREATE TABLE learner_owned_reflection_operation_invocations(invocation_id);
    CREATE TABLE learner_word_state(word_id,learner_id,status);
    INSERT INTO lexical_words VALUES ('w','滞后','zhì hòu');`);
});
afterEach(() => closeDbConnection());
const opened = (id: string, learner: string, date: string, kind = 'opened') => db.prepare('INSERT INTO learner_word_introduction_events VALUES (?, ?, ?, ?, ?)').run(id,'w',learner,kind,date);
const encounter = (key: string, learner: string, date: string) => db.prepare('INSERT INTO learner_content_quality_encounters VALUES (?, ?, ?)').run(key,learner,date);

test('week validation uses UTC Mondays and rejects future, malformed and repeated query values', () => {
  assert.equal(parseSharingWeek(undefined, now),'2026-10-05');
  assert.equal(parseSharingWeek(undefined,new Date('2026-10-05T00:00:00Z')),'2026-10-05');
  assert.equal(parseSharingWeek(undefined,new Date('2026-10-04T23:59:59Z')),'2026-09-28');
  for (const value of ['2026-02-30','2026-10-06','2026-10-12','2026-10-5', ['2026-10-05'], {}]) assert.throws(() => parseSharingWeek(value,now));
});

test('reuse counts first second learner once, across previous weeks, excluding third learners and repeats', () => {
  opened('new','a','2026-10-02T08:00:00Z');
  opened('new','a','2026-10-06T08:00:00Z');
  opened('new','b','2026-10-07T08:00:00Z');
  opened('new','b','2026-10-07T09:00:00Z');
  opened('new','c','2026-10-08T08:00:00Z');
  opened('new','a','2026-10-02T09:00:00Z','completed');
  opened('new','b','2026-10-07T09:00:00Z','completed');
  opened('old','a','2026-09-01T08:00:00Z'); opened('old','b','2026-09-02T08:00:00Z'); opened('old','c','2026-10-07T08:00:00Z');
  db.exec(`INSERT INTO word_preparation_work VALUES ('boot','w','bootstrap'),('teach','w','teaching');
    INSERT INTO word_preparation_attempts VALUES ('boot','ready'),('teach','failed'),('teach','ready');
    INSERT INTO learner_word_state VALUES ('w','a','learning'),('w','b','review'),('other','a','unstudied');`);
  const report = getContentSharingDigest(undefined,now);
  assert.deepEqual(report.newlyReused,{introductions:1,rehearsals:0,reviewCues:0});
  assert.equal(report.examples[0].firstUsedAt,'2026-10-02T08:00:00.000Z');
  assert.equal(report.examples[0].learnerCount,3); assert.equal(report.examples[0].completedLearnerCount,2);
  assert.deepEqual(report.examples[0].generation,{bootstrapAttempts:1,teachingAttempts:2,bootstrapSuccessfulAttempts:1,teachingSuccessfulAttempts:1});
  assert.deepEqual(report.overlap,{studiedWords:1,wordsStudiedByMultipleLearners:1});
  assert.equal(getContentSharingDigest('2026-09-28',now).newlyReused.introductions,0);
  assert.equal(JSON.stringify(report).includes('learner_id'),false);
});

test('UTC start is inclusive and next Monday exclusive, including equivalent offset timestamps', () => {
  for (const [id, time] of [['start','2026-10-05T08:00:00+08:00'],['end','2026-10-12T00:00:00Z'],['before','2026-10-04T23:59:59Z']]) {
    opened(id,'a','2026-10-01T00:00:00Z'); opened(id,'b',time);
  }
  assert.equal(getContentSharingDigest(undefined,now).newlyReused.introductions,1);
});

test('capture cutoff excludes future activity and handles chronological first uses and pending generation', () => {
  opened('present','a','2026-10-02T09:00:00+08:00');
  opened('present','a','2026-10-02T02:00:00Z');
  opened('present','b','2026-10-06T00:00:00Z');
  opened('present','c','2026-10-11T00:00:00Z');
  opened('future','a','2026-10-02T00:00:00Z'); opened('future','b','2026-10-11T00:00:00Z');
  db.exec(`INSERT INTO word_preparation_work VALUES ('teach','w','teaching');
    INSERT INTO word_preparation_attempts VALUES ('teach',NULL);
    INSERT INTO content_quality_items VALUES ('future-cue','rehearsal','p/r','w','Future');`);
  encounter('future-cue','a','2026-10-06T00:00:00Z'); encounter('future-cue','b','2026-10-11T00:00:00Z');
  const report = getContentSharingDigest(undefined,now);
  assert.equal(report.newlyReused.introductions,1); assert.equal(report.newlyReused.rehearsals,0);
  assert.equal(report.examples[0].learnerCount,2);
  assert.equal(report.examples[0].firstUsedAt,'2026-10-02T01:00:00.000Z');
  assert.equal(report.examples[0].generation?.teachingSuccessfulAttempts,0);
});

test('exact exercise revisions are distinct; private review content is excluded and responses never returned', () => {
  db.exec(`INSERT INTO content_quality_items VALUES ('r1','rehearsal','p/r','w','Rehearsal: 滞后'),('r2','rehearsal','p/r','w','Rehearsal: 滞后'),
    ('cue','production_cue','c','w','Public cue'),('private','production_cue','secret','w','PRIVATE TEXT'),('pure','pure_cue','pc',NULL,'Shared standalone cue');
    INSERT INTO shared_content_publications VALUES ('pub','production_cue','c'),('purepub','pure_cue','pc');`);
  for (const key of ['r1','cue','private','pure']) { encounter(key,'a','2026-10-01T00:00:00Z'); encounter(key,'b','2026-10-06T00:00:00Z'); encounter(key,'b','2026-10-07T00:00:00Z'); }
  encounter('r2','b','2026-10-06T00:00:00Z');
  let report = getContentSharingDigest(undefined,now);
  assert.deepEqual(report.newlyReused,{introductions:0,rehearsals:1,reviewCues:2});
  assert.equal(JSON.stringify(report).includes('PRIVATE'),false);
  assert.equal(report.examples.find(e => e.kind === 'pure_cue')?.word,null);
  encounter('r2','c','2026-10-07T00:00:00Z');
  report = getContentSharingDigest(undefined,now); assert.equal(report.newlyReused.rehearsals,2);
});

test('reflection use requires published provenance, actual committed attempts, another learner, and authorization before use', () => {
  db.exec(`INSERT INTO shared_content_publications VALUES ('pub','production_cue','c'),('purepub','pure_cue','pc');
    INSERT INTO learner_owned_reflection_operation_invocations VALUES ('inv');
    INSERT INTO learner_owned_shared_content_publication_provenance VALUES ('pub','origin','inv','2026-10-05T00:00:00Z'),('purepub','origin','inv','2026-10-05T00:00:00Z');
    INSERT INTO learner_owned_production_cue_evidence_records VALUES ('c','origin','a','attempt'),('c','other','b','attempt'),('c','other','b','attempt'),('private','other','b','attempt'),('c','other','missing','attempt');
    INSERT INTO learner_owned_study_attempt_events VALUES ('a','origin','2026-10-06T00:00:00Z','production','now'),('b','other','2026-10-06T00:00:00Z','production','now');
    INSERT INTO pure_cue_attempts VALUES ('pc','origin','2026-10-06T00:00:00Z'),('pc','other','2026-10-04T23:00:00Z');`);
  assert.deepEqual(getContentSharingDigest(undefined,now).reflectionCuesAttemptedByOthers,{productionCues:1,pureCues:0,total:1});
  db.exec("INSERT INTO pure_cue_attempts VALUES ('pc','other','2026-10-07T00:00:00Z'),('pc','third','2026-10-08T00:00:00Z')");
  assert.deepEqual(getContentSharingDigest(undefined,now).reflectionCuesAttemptedByOthers,{productionCues:1,pureCues:1,total:2});
  db.exec(`INSERT INTO shared_content_publications VALUES ('pendingpub','production_cue','pending'),('futurepub','pure_cue','future');
    INSERT INTO learner_owned_shared_content_publication_provenance VALUES ('pendingpub','origin','inv','2026-10-05T00:00:00Z'),('futurepub','origin','inv','2026-10-05T00:00:00Z');
    INSERT INTO learner_owned_production_cue_evidence_records VALUES ('pending','other','unprojected','attempt');
    INSERT INTO learner_owned_study_attempt_events VALUES ('unprojected','other','2026-10-06T00:00:00Z','production',NULL);
    INSERT INTO pure_cue_attempts VALUES ('future','other','2026-10-11T00:00:00Z');`);
  assert.deepEqual(getContentSharingDigest(undefined,now).reflectionCuesAttemptedByOthers,{productionCues:1,pureCues:1,total:2});
});
