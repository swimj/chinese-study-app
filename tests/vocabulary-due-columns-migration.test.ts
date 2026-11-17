import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, beforeEach, afterEach, test } from 'node:test';
import { createBaselineFixture } from './helpers/baseline-database.ts';
import { migrateDatabase, schemaMigrations } from '../server/db/migrations.ts';
import { mergePureCueSchedulerState, mergeWordSchedulerState } from '../server/db/vocabulary-schedule-columns.ts';

const MIGRATION = 'app_schema:0077_vocabulary_due_columns';
const prior = schemaMigrations.filter((migration) => migration.id < MIGRATION);
const t0 = '2026-11-01T08:00:00.000Z';
let root: string; let baseline: string; let db: DatabaseSync;
before(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'due-columns-')); createBaselineFixture(path.join(root, 'baseline')); baseline = path.join(root, 'baseline', 'app.db'); });
after(() => fs.rmSync(root, { recursive: true, force: true }));
beforeEach(() => {
  const location = path.join(root, `${Math.random()}.db`); fs.copyFileSync(baseline, location);
  db = new DatabaseSync(location); db.exec('PRAGMA foreign_keys=ON'); db.function('current_learner_id', () => 'a');
  migrateDatabase(db, prior);
  db.prepare('INSERT INTO learners(learner_id,display_name,created_at) VALUES (?,?,?)').run('a', 'A', t0);
  for (const id of ['w1', 'w2', 'w3', 'w4', 'w5']) db.prepare(`INSERT INTO lexical_words(id,hanzi,pinyin,meaning,examples_json,priority,created_at)
    VALUES (?,?,'p','m','[]',1,?)`).run(id, id, t0);
});
afterEach(() => db.close());

/** Rows written in the pre-0077 shape, with every scheduling fact in JSON. */
function word(id: string, mode: string, schedule: { next?: string | null; last?: string | null; state: Record<string, unknown> }): void {
  db.prepare(`INSERT INTO learner_words(learner_id,word_id,in_stash,added_at,mode,mode_changed_at) VALUES ('a',?,0,?,?,?)`).run(id, t0, mode, t0);
  db.prepare(`INSERT INTO learner_word_schedules(learner_id,word_id,next_eligible_at,last_practised_at,policy_version,scheduler_state_json)
    VALUES ('a',?,?,?,'vocabulary-v1',?)`).run(id, schedule.next ?? null, schedule.last ?? null, JSON.stringify(schedule.state));
}
function pureCue(id: string, state: Record<string, unknown>, next: string | null): void {
  db.exec('BEGIN');
  db.prepare(`INSERT INTO content_items(content_id,kind,payload_version,body_json,exercise_type,skill,exercise_role,assessment_json,access_scope,
    availability,origin_kind,version,created_at,updated_at) VALUES (?,'exercise',1,'{}','pure_cue','production','general','{}','shared','active','human',1,?,?)`).run(id, t0, t0);
  db.prepare(`INSERT INTO content_revision_history(change_id,content_id,version,snapshot_json,change_kind,write_strategy,actor_kind,actor_id,recorded_at)
    VALUES (?,?,1,'{}','created','create','operator','test',?)`).run(`change-${id}`, id, t0);
  db.exec('COMMIT');
  db.prepare(`INSERT INTO learner_pure_cue_schedules(learner_id,content_id,next_eligible_at,policy_version,scheduler_state_json) VALUES ('a',?,?,'v',?)`)
    .run(id, next, JSON.stringify(state));
}
const row = (table: string, key: string, id: string) => db.prepare(`SELECT * FROM ${table} WHERE learner_id='a' AND ${key}=?`).get(id) as Record<string, unknown>;
const plan = (sql: string) => (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as { detail: string }[]).map((entry) => entry.detail).join(' | ');

test('migration moves scheduling facts into columns, strips them from JSON, and derives due times', () => {
  word('w1', 'practice', { next: '2026-11-02T00:00:00.000Z', last: '2026-11-01T10:00:00.250Z', state: { intervalHours: 30, easeFactor: 2.5, enabled: 1, cleanCoveredSessions: 2 } });
  word('w2', 'practice', { next: '2026-11-03T00:00:00.000Z', last: '2026-11-01T10:00:00.000Z', state: { intervalHours: 6, easeFactor: 2.2 } });
  word('w3', 'maintain', { last: '2026-11-01T10:00:00.000Z', state: { intervalHours: 6, easeFactor: 2.5, enabled: 0, resetUntil: '2026-11-04T00:00:00.000Z',
    postCompensationEarliestCheckAt: '2026-11-09T00:00:00.000Z' } });
  word('w4', 'unstudied', { state: { intervalHours: 24, easeFactor: 2.5, enabled: 1, cleanCoveredSessions: 0 } });
  word('w5', 'practice', { next: '2026-11-04T00:00:00.000Z', state: { intervalHours: 24, easeFactor: 2.5 } });
  db.exec(`INSERT INTO learner_owned_word_skill_state(learner_id,word_id,skill_id,enabled,interval_hours,last_studied_at,next_due_at,ease_factor) VALUES
    ('a','w1','recognition',1,48,'2026-11-01T00:00:00.000Z',NULL,2.5),
    ('a','w2','contextual_selection',1,12,'2026-11-01T00:00:00.000Z','2026-11-05T00:00:00.000Z',2.5)`);
  pureCue('cue-fragile', { intervalHours: 24, easeFactor: 2.5, enabled: 1, resetUntil: '2026-11-06T00:00:00.000Z', adoptedAt: t0 }, '2026-11-02T00:00:00.000Z');
  pureCue('cue-strong', { intervalHours: 720, easeFactor: 2.6, strongSince: t0, strongSuccesses: 2, maintenanceIdentity: 'legacy-1' }, null);
  pureCue('cue-recheck', { intervalHours: 24, easeFactor: 2.5, postCompensationRecheckAt: '2026-11-03T00:00:00.000Z' }, null);
  pureCue('cue-new', { intervalHours: 24, easeFactor: 2.5 }, null);
  const merged = {
    w3: mergeWordSchedulerState(row('learner_word_schedules', 'word_id', 'w3')),
    strong: mergePureCueSchedulerState(row('learner_pure_cue_schedules', 'content_id', 'cue-strong')),
  };

  assert.deepEqual(migrateDatabase(db), [MIGRATION]);
  const w1 = row('learner_word_schedules', 'word_id', 'w1');
  assert.deepEqual({ interval: w1.interval_hours, enabled: w1.enabled, json: JSON.parse(String(w1.scheduler_state_json)), due: w1.review_due_at },
    { interval: 30, enabled: 1, json: { easeFactor: 2.5, cleanCoveredSessions: 2 }, due: '2026-11-02T16:00:00.250Z' });
  assert.equal(row('learner_word_schedules', 'word_id', 'w2').review_due_at, '2026-11-03T00:00:00.000Z');
  const w3 = row('learner_word_schedules', 'word_id', 'w3');
  assert.deepEqual({ enabled: w3.enabled, resetUntil: w3.reset_until, checkAt: w3.post_compensation_check_at, due: w3.review_due_at },
    { enabled: 0, resetUntil: '2026-11-04T00:00:00.000Z', checkAt: '2026-11-09T00:00:00.000Z', due: '2026-11-09T00:00:00.000Z' });
  // History-free schedules are due once their stored dates pass; the read resolves mode.
  assert.equal(row('learner_word_schedules', 'word_id', 'w4').review_due_at, '');
  assert.equal(row('learner_word_schedules', 'word_id', 'w5').review_due_at, '2026-11-04T00:00:00.000Z');
  // The merged state is unchanged by the move; only its storage is.
  assert.deepEqual(mergeWordSchedulerState(w3), { ...merged.w3, enabled: 0 });
  assert.deepEqual(mergePureCueSchedulerState(row('learner_pure_cue_schedules', 'content_id', 'cue-strong')), { ...merged.strong, enabled: 1 });

  assert.equal(row('learner_owned_word_skill_state', 'word_id', 'w1').review_due_at, '2026-11-03T00:00:00.000Z');
  assert.equal(row('learner_owned_word_skill_state', 'word_id', 'w2').review_due_at, '2026-11-05T00:00:00.000Z');
  const strong = row('learner_pure_cue_schedules', 'content_id', 'cue-strong');
  assert.deepEqual({ interval: strong.interval_hours, since: strong.strong_since, successes: strong.strong_successes, identity: strong.maintenance_identity,
    json: JSON.parse(String(strong.scheduler_state_json)) },
  { interval: 720, since: t0, successes: 2, identity: 'legacy-1', json: { easeFactor: 2.6 } });
  assert.equal(row('learner_pure_cue_schedules', 'content_id', 'cue-fragile').reset_until, '2026-11-06T00:00:00.000Z');
  assert.equal(row('learner_pure_cue_schedules', 'content_id', 'cue-recheck').recheck_at, '2026-11-03T00:00:00.000Z');
});

test('triggers keep due times current and guards reject facts written back into JSON', () => {
  word('w1', 'practice', { last: t0, state: { intervalHours: 24, easeFactor: 2.5 } });
  pureCue('cue', { intervalHours: 24, easeFactor: 2.5 }, '2026-11-02T00:00:00.000Z');
  migrateDatabase(db);
  db.prepare(`UPDATE learner_word_schedules SET last_practised_at='2026-11-10T00:00:00.000Z',interval_hours=48 WHERE word_id='w1'`).run();
  assert.equal(row('learner_word_schedules', 'word_id', 'w1').review_due_at, '2026-11-12T00:00:00.000Z');
  db.prepare(`UPDATE learner_word_schedules SET post_compensation_check_at='2026-12-01T00:00:00.000Z' WHERE word_id='w1'`).run();
  assert.equal(row('learner_word_schedules', 'word_id', 'w1').review_due_at, '2026-12-01T00:00:00.000Z');
  db.exec(`INSERT INTO learner_owned_word_skill_state(learner_id,word_id,skill_id,enabled,interval_hours,last_studied_at,next_due_at,ease_factor)
    VALUES ('a','w1','recognition',1,24,'2026-11-01T00:00:00.000Z',NULL,2.5)`);
  assert.equal(row('learner_owned_word_skill_state', 'word_id', 'w1').review_due_at, '2026-11-02T00:00:00.000Z');
  db.prepare(`UPDATE learner_owned_word_skill_state SET interval_hours=72 WHERE word_id='w1'`).run();
  assert.equal(row('learner_owned_word_skill_state', 'word_id', 'w1').review_due_at, '2026-11-04T00:00:00.000Z');

  assert.throws(() => db.prepare(`UPDATE learner_word_schedules SET scheduler_state_json=json_set(scheduler_state_json,'$.intervalHours',6) WHERE word_id='w1'`).run(),
    /scheduling facts belong in their columns/);
  assert.throws(() => db.prepare(`UPDATE learner_word_schedules SET interval_hours=NULL WHERE word_id='w1'`).run(), /scheduling facts belong in their columns/);
  assert.throws(() => db.prepare(`UPDATE learner_pure_cue_schedules SET scheduler_state_json=json_set(scheduler_state_json,'$.strongSince',?) WHERE content_id='cue'`).run(t0),
    /scheduling facts belong in their columns/);
  assert.throws(() => db.prepare(`INSERT INTO learner_word_schedules(learner_id,word_id,policy_version,scheduler_state_json) VALUES ('a','w2','v','{}')`).run(),
    /scheduling facts belong in their columns/);
});

test('each queue read is one covering index range', () => {
  migrateDatabase(db);
  assert.match(plan(`SELECT word_id,enabled,interval_hours,last_practised_at,next_eligible_at,post_compensation_check_at FROM learner_word_schedules
    WHERE learner_id='a' AND review_due_at<='2026-11-10T00:00:00.000Z'`), /SEARCH learner_word_schedules USING COVERING INDEX idx_learner_word_schedules_review_due \(learner_id=\? AND review_due_at<\?\)/);
  assert.match(plan(`SELECT word_id,skill_id,enabled,interval_hours,last_studied_at,next_due_at FROM learner_owned_word_skill_state
    WHERE learner_id='a' AND review_due_at<='2026-11-10T00:00:00.000Z'`), /USING COVERING INDEX idx_word_skill_state_review_due \(learner_id=\? AND review_due_at<\?\)/);
  assert.match(plan(`SELECT content_id,next_eligible_at,last_practised_at,strong_since,strong_successes,maintenance_identity,reset_until,recheck_at,interval_hours
    FROM learner_pure_cue_schedules WHERE learner_id='a' AND enabled=1`), /USING COVERING INDEX idx_learner_pure_cue_schedules_selection \(learner_id=\? AND enabled=\?\)/);
});

test('a schedule whose due time cannot be derived fails the whole batch', () => {
  for (const [label, schedule] of [
    ['non-canonical timestamp', { last: '2026-11-01 10:00:00', state: { intervalHours: 24 } }],
    ['missing interval', { last: t0, state: { enabled: 1 } }],
    ['missing interval without history', { state: { enabled: 1 } }],
    ['non-positive interval', { last: t0, state: { intervalHours: 0 } }],
  ] as const) {
    db.exec('DELETE FROM learner_word_schedules; DELETE FROM learner_words;');
    word('w1', 'practice', schedule);
    assert.throws(() => migrateDatabase(db), /Review due times cannot be computed/, label);
    assert.equal(db.prepare('SELECT count(*) AS n FROM schema_migrations WHERE migration_id=?').get(MIGRATION)!.n, 0, label);
    assert.equal(db.prepare(`SELECT count(*) AS n FROM pragma_table_info('learner_word_schedules') WHERE name='review_due_at'`).get()!.n, 0, label);
    // The rollback restores the pre-0077 JSON.
    assert.deepEqual(JSON.parse(String(row('learner_word_schedules', 'word_id', 'w1').scheduler_state_json)), schedule.state, label);
  }
});
