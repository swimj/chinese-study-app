import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createBaselineFixture } from './helpers/baseline-database.ts';
import { assertSchemaCurrent, migrateDatabase, schemaMigrations } from '../server/db/migrations.ts';

test('new-word migration persists session totals on the summary UTC day without using admission counts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-new-word-migration-'));
  const freshDir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-new-word-fresh-'));
  createBaselineFixture(dir);
  createBaselineFixture(freshDir);
  const db = new DatabaseSync(path.join(dir, 'app.db'));
  const fresh = new DatabaseSync(path.join(freshDir, 'app.db'));
  let learner = 'owner';
  db.function('current_learner_id', () => learner);
  fresh.function('current_learner_id', () => learner);
  try {
    const index = schemaMigrations.findIndex(m => m.id === 'app_schema:0038_usage_new_word_totals');
    migrateDatabase(db, schemaMigrations.slice(0, index));
    db.exec(`INSERT INTO learners (learner_id, display_name, created_at) VALUES ('owner','Owner','now'), ('other','Other','now');
      INSERT INTO lexical_words (id,hanzi,pinyin,meaning,meanings_json,examples_json,priority,created_at)
        VALUES ('a','a','a','a','[]','[]',1,'now'), ('b','b','b','b','[]','[]',1,'now'), ('c','c','c','c','[]','[]',1,'now');
      INSERT INTO learner_owned_daily_new_word_intake (learner_id,day_key,new_study_count)
        VALUES ('owner','2026-10-21',3);
      INSERT INTO learner_owned_review_session_summaries
        (learner_id,session_id,completed_at,day_key,completed_count,failed_count,active_duration_ms,learning_completed_count)
        VALUES ('owner','evening','2026-10-22T02:12:41.686Z','2026-10-22',8,1,1000,11),
          ('other','evening','2026-10-22T03:00:00.000Z','2026-10-22',2,0,1000,1),
          ('owner','practice','2026-10-22T12:00:00.000Z','2026-10-22',0,0,1000,1),
          ('owner','old-unknown','2026-10-21T12:00:00.000Z','2026-10-21',1,0,1000,NULL),
          ('owner','report-only','2026-10-23T12:00:00.000Z','2026-10-23',0,0,1000,0),
          ('owner','known-zero','2026-10-22T13:00:00.000Z','2026-10-22',1,0,1000,0);
      INSERT INTO usage_daily_snapshots
        (day_key,captured_at,dau,sessions_completed,new_words,model_spend_usd,mean_stash_size,
          learners_inactive_7d,sessions_abandoned,learners_spend_without_accepts,study_commit_failures)
        VALUES ('2026-10-21','2026-10-22T00:00:00.000Z',1,1,3,0,42,0,0,0,0),
          ('2026-10-22','2026-10-23T00:00:00.000Z',2,4,0,0,43,0,0,0,0);`);
    const outcome = db.prepare(`INSERT INTO learner_session_word_outcomes
      (learner_id,session_id,word_id,kind,before_status,after_status,word_json,committed_at)
      VALUES (?,?,?,?,?,?,?,?)`);
    for (const [i, word] of ['a', 'b', 'c'].entries()) {
      // Intentionally span UTC midnight: all three belong to the summary day.
      outcome.run('owner', 'evening', word, 'introduction', 'unstudied', 'learning', '{}',
        i === 0 ? '2026-10-21T23:59:59.999Z' : '2026-10-22T01:07:00.000Z');
    }
    outcome.run('other', 'evening', 'a', 'introduction', 'unstudied', 'learning', '{}', '2026-10-22T02:30:00.000Z');
    outcome.run('owner', 'practice', 'a', 'learning', 'learning', 'review', '{}', '2026-10-22T11:00:00.000Z');
    outcome.run('owner', 'unfinished', 'b', 'introduction', 'unstudied', 'learning', '{}', '2026-10-22T14:00:00.000Z');
    const completion = db.prepare(`INSERT INTO learner_session_completions
      (learner_id,session_id,revision_id,staged_at,close_at,input_json,report_json,status,closed_at)
      VALUES ('owner',?,'r1','now','now','{}',?,'closed','now')`);
    completion.run('report-only', JSON.stringify({ newWords: [{ id: 'a' }, { id: 'b' }], graduatedWords: [] }));
    completion.run('known-zero', JSON.stringify({ newWords: [], graduatedWords: [] }));
    const priorSummaries = db.prepare('SELECT * FROM learner_owned_review_session_summaries ORDER BY learner_id,session_id').all();
    const intake = db.prepare('SELECT * FROM learner_owned_daily_new_word_intake').all();
    const snapshots = db.prepare('SELECT * FROM usage_daily_snapshots ORDER BY day_key').all();
    migrateDatabase(db);
    assertSchemaCurrent(db);
    const counts = db.prepare('SELECT learner_id,session_id,new_word_count FROM learner_owned_review_session_summaries ORDER BY learner_id,session_id').all();
    assert.deepEqual(counts.map(r => [r.learner_id,r.session_id,r.new_word_count]), [
      ['other','evening',1], ['owner','evening',3], ['owner','known-zero',0],
      ['owner','old-unknown',null], ['owner','practice',0], ['owner','report-only',2],
    ]);
    assert.deepEqual(db.prepare('SELECT * FROM learner_owned_daily_new_word_intake').all(), intake);
    const after = db.prepare('SELECT * FROM learner_owned_review_session_summaries ORDER BY learner_id,session_id').all();
    assert.deepEqual(after.map(({ new_word_count: _count, ...rest }) => rest), priorSummaries.map(r => ({ ...r })));
    const updatedSnapshots = db.prepare('SELECT * FROM usage_daily_snapshots ORDER BY day_key').all();
    assert.deepEqual(updatedSnapshots.map(r => r.new_words), [0, 4]);
    assert.deepEqual(updatedSnapshots.map(({ new_words: _count, ...rest }) => rest),
      snapshots.map(({ new_words: _count, ...rest }) => rest));
    learner = 'other';
    assert.equal(db.prepare('SELECT new_word_count FROM review_session_summaries').get()?.new_word_count, 1);
    db.exec(`UPDATE review_session_summaries SET new_word_count = 2 WHERE session_id = 'evening'`);
    learner = 'owner';
    assert.equal(db.prepare("SELECT new_word_count FROM review_session_summaries WHERE session_id='evening'").get()?.new_word_count, 3);
    assert.throws(() => db.exec("UPDATE review_session_summaries SET new_word_count=-1"), /CHECK/);
    assert.deepEqual(migrateDatabase(db), []);
    migrateDatabase(fresh);
    const schema = (database: DatabaseSync) => database.prepare(`SELECT name,sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY name`).all();
    assert.deepEqual(schema(db), schema(fresh));
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    db.close(); fresh.close();
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(freshDir, { recursive: true, force: true });
  }
});
