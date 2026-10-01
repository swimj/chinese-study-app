import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, test } from 'node:test';
import type { PureCueAssessmentEvent } from '../src/domain/pure-cues.ts';

const now = '2026-09-18T00:00:00.000Z';
let dataDir: string;
let sqlite: DatabaseSync;
let db: typeof import('../server/db.ts');
before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pure-cue-restore-'));
  process.env.APP_MODE = 'study';
  process.env.APP_DATA_DIR = dataDir;
  process.env.APP_LEARNER_ID = 'restore-learner';
  db = await import('../server/db.ts');
  sqlite = new DatabaseSync(path.join(dataDir, 'app.db'));
  sqlite.function('current_learner_id', () => 'restore-learner');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const [id, hanzi] of [['a', '撒谎'], ['b', '说谎']]) {
    sqlite.prepare(`INSERT INTO lexical_words
      (id, hanzi, pinyin, meaning, meanings_json, examples_json, priority, created_at)
      VALUES (?, ?, 'pinyin', 'meaning', '[]', '[]', 1, ?)`).run(id, hanzi, now);
  }
});
after(() => { sqlite?.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

function fixture(id: string, firstAccepted = false, schedule?: { strong: boolean; nextDueAt: string }): string {
  db.createPureCueWithoutTransaction({ id, stimulus: 'to tell an untruth', acceptedWordIds: ['a', 'b'], createdAt: now });
  sqlite.prepare(`INSERT INTO shared_content_publications VALUES (?, 'pure_cue', ?, ?, 'shared_trial', ?, ?)`)
    .run(`pub-${id}`, id, `pure:${id}`, now, now);
  sqlite.prepare(`INSERT INTO learner_pure_cue_state VALUES
    ('restore-learner', ?, 900, 2.65, '2026-09-10T00:00:00.000Z', ?, '2026-09-01T00:00:00.000Z', 7, ?)`)
    .run(id, now, now);
  if (schedule) {
    sqlite.prepare(`UPDATE learner_pure_cue_state SET interval_hours = ?, strong_since = ?, next_due_at = ?
      WHERE learner_id = 'restore-learner' AND pure_cue_id = ?`)
      .run(schedule.strong ? 900 : 24, schedule.strong ? '2026-09-01T00:00:00.000Z' : null,
        schedule.nextDueAt, id);
  }
  sqlite.prepare(`INSERT OR IGNORE INTO learner_word_state (learner_id, word_id, status)
    VALUES ('restore-learner', 'a', 'review')`).run();
  sqlite.prepare(`INSERT OR IGNORE INTO learner_owned_word_study_admission_state
    (learner_id, word_id, study_phase) VALUES ('restore-learner', 'a', 'review')`).run();
  const snapshot = db.issuePureCueServedSnapshot({ pureCueId: id, servedAt: now });
  const events: PureCueAssessmentEvent[] = firstAccepted ? [{ eventId: 'first', occurredAt: now,
    response: '撒谎', outcome: 'accepted', submittedWordId: 'a', rating: 'good' }] :
    ['骗人', 'wrong reinforcement', '撒谎', '撒谎', '撒谎'].map((response, index) => ({
      eventId: `event-${index}`, occurredAt: now, response,
      outcome: index < 2 ? 'rejected' : 'accepted', submittedWordId: index < 2 ? null : 'a',
      rating: index < 2 ? 'forgot' : 'good',
    }));
  const input = { attemptId: `attempt-${id}`, snapshotId: snapshot.snapshotId,
    sessionId: `session-${id}`, sessionActionId: id, events, committedAt: now };
  db.recordPureCueAssessment(input);
  db.recordPureCueAssessment(input);
  return input.attemptId;
}
function authorize(id: string, attemptId: string, cueId: string): void {
  sqlite.prepare(`INSERT INTO reflection_operation_invocations (
    invocation_id, created_at, origin_kind, operation_kind, operation_version, operation_json,
    application_state, application_updated_at, effect_refs_json, satisfying_effect_refs_json
  ) VALUES (?, ?, 'manual', 'reconcile_pure_cue_response', 1, ?, 'pending', ?, '[]', '[]')`)
    .run(id, now, JSON.stringify({ operation: { sourceAttemptId: attemptId, pureCueId: cueId } }), now);
}

test('restores the whole pre-lapse cue schedule once despite invalid reinforcement; preserves history and owner boundary', () => {
  const sourceAttemptId = fixture('restore');
  assert.equal(db.getPureCue('restore')?.strongSince, null);
  authorize('restore-op', sourceAttemptId, 'restore');
  const input = { sourceAttemptId, compensationInvocationId: 'restore-op', restoredAt: '2026-09-18T02:00:00.000Z' };
  const history = sqlite.prepare('SELECT * FROM pure_cue_attempts').all();
  const result = db.restorePureCueSchedulerSnapshotWithoutTransaction(input);
  assert.equal(result.kind, 'restored');
  const cue = db.getPureCue('restore')!;
  assert.deepEqual([cue.intervalHours, cue.easeFactor, cue.strongSince, cue.strongSuccesses, cue.lastStudiedAt, cue.nextDueAt],
    [900, 2.65, '2026-09-01T00:00:00.000Z', 7, '2026-09-10T00:00:00.000Z', '2026-09-18T08:00:00.000Z']);
  assert.equal(db.restorePureCueSchedulerSnapshotWithoutTransaction({ ...input,
    restoredAt: '2026-09-20T02:00:00.000Z' }).kind, 'already_restored');
  assert.deepEqual(db.getPureCue('restore'), cue);
  assert.equal(db.selectStoredPureCuesForSession({ ordinaryReviewCount: 10,
    now: '2026-09-18T07:59:00.000Z' }).selected.some(item => item.id === 'restore'), false);
  assert.equal(db.selectStoredPureCuesForSession({ ordinaryReviewCount: 10,
    now: '2026-09-18T08:00:00.000Z' }).selected.some(item => item.id === 'restore'), true);
  assert.deepEqual(sqlite.prepare('SELECT * FROM pure_cue_attempts').all(), history);
  assert.throws(() => db.runWithLearnerId('other', () => db.restorePureCueSchedulerSnapshotWithoutTransaction(input)), /current learner/);
});

for (const scenario of [
  { id: 'fragile-delay', strong: false, nextDueAt: now, deadline: '2026-09-18T08:00:00.000Z' },
  { id: 'fragile-later-due', strong: false, nextDueAt: '2026-09-19T00:00:00.000Z', deadline: '2026-09-19T00:00:00.000Z' },
  { id: 'strong-delay', strong: true, nextDueAt: now, deadline: '2026-09-18T08:00:00.000Z' },
]) {
  test(`session composition honors restoration eligibility: ${scenario.id}`, (t) => {
    const restoredAt = '2026-09-18T02:00:00.000Z';
    t.mock.timers.enable({ apis: ['Date'], now: new Date(restoredAt) });
    // Isolate sampling from cues created by earlier tests.
    sqlite.prepare(`UPDATE learner_pure_cue_state SET strong_since = NULL, next_due_at = '2027-01-01T00:00:00.000Z'`).run();
    const sourceAttemptId = fixture(scenario.id, false, scenario);
    authorize(`op-${scenario.id}`, sourceAttemptId, scenario.id);
    db.restorePureCueSchedulerSnapshotWithoutTransaction({ sourceAttemptId,
      compensationInvocationId: `op-${scenario.id}`, restoredAt });

    // A due fragile control both proves composition works and supplies a strong
    // sampling slot with random=0, so absence cannot be a sampling false positive.
    const controlId = `control-${scenario.id}`;
    fixture(controlId);
    sqlite.prepare(`UPDATE learner_pure_cue_state SET next_due_at = ? WHERE pure_cue_id = ?`)
      .run(now, controlId);
    const assertAdmission = (at: string, expected: boolean) => {
      t.mock.timers.setTime(new Date(at).getTime());
      const items = db.getSessionPayload(at.slice(0, 10), { random: () => 0 }).buckets.review;
      const cueIds = items.flatMap(item => item.itemType === 'pure_cue_production' ? [item.snapshot.pureCueId] : []);
      assert.ok(cueIds.includes(controlId), 'due control must be served');
      assert.equal(cueIds.includes(scenario.id), expected, `restored cue admission at ${at}`);
    };
    assertAdmission(restoredAt, false);
    assertAdmission(new Date(new Date(scenario.deadline).getTime() - 1).toISOString(), false);
    assertAdmission(scenario.deadline, true);
  });
}

test('rejects incorrect authorization and accepted first attempts', () => {
  const sourceAttemptId = fixture('unauthorized');
  authorize('wrong-op', sourceAttemptId, 'different-cue');
  assert.throws(() => db.restorePureCueSchedulerSnapshotWithoutTransaction({ sourceAttemptId,
    compensationInvocationId: 'wrong-op', restoredAt: now }), /pending learner-authorized/);
  assert.equal(db.getPureCue('unauthorized')?.intervalHours, 6);
  const accepted = fixture('accepted', true);
  assert.throws(() => db.restorePureCueSchedulerSnapshotWithoutTransaction({ sourceAttemptId: accepted,
    compensationInvocationId: 'wrong-op', restoredAt: now }), /first rejected/);
});

test('historical rejected assessments without captured state are unavailable', () => {
  const id = 'historical';
  db.createPureCueWithoutTransaction({ id, stimulus: 'to tell an untruth', acceptedWordIds: ['a', 'b'], createdAt: now });
  sqlite.prepare(`INSERT INTO pure_cue_served_snapshots
    (learner_id, snapshot_id, pure_cue_id, served_at, stimulus, axis_note, accepted_answers_json)
    VALUES ('restore-learner', 'historical-snapshot', ?, ?, 'cue', '', '[]')`).run(id, now);
  sqlite.prepare(`INSERT INTO pure_cue_attempts VALUES
    ('restore-learner', 'historical-attempt', ?, 'historical-snapshot', 'old-session', 'old-action', ?, ?, 1, NULL)`)
    .run(id, now, JSON.stringify([{ outcome: 'rejected' }]));
  assert.deepEqual(db.restorePureCueSchedulerSnapshotWithoutTransaction({ sourceAttemptId: 'historical-attempt',
    compensationInvocationId: 'unused', restoredAt: now }), { kind: 'unavailable', reason: 'pre_release_snapshot_unavailable' });
});

test('migration upgrades populated history without inventing snapshots and reopens idempotently', async () => {
  const { createBaselineFixture } = await import('./helpers/baseline-database.ts');
  const { migrateDatabase, schemaMigrations, assertSchemaCurrent } = await import('../server/db/migrations.ts');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pure-restore-migration-'));
  createBaselineFixture(dir);
  const file = path.join(dir, 'app.db');
  let connection = new DatabaseSync(file);
  try {
    connection.function('current_learner_id', () => 'legacy');
    connection.exec('PRAGMA foreign_keys=ON');
    const index = schemaMigrations.findIndex(m => m.id === 'app_schema:0014_pure_cue_reflection');
    migrateDatabase(connection, schemaMigrations.slice(0, index));
    connection.exec(`INSERT INTO learners (learner_id, display_name, created_at) VALUES ('legacy', 'Learner', 'now');
      INSERT INTO pure_cues (id, stimulus, axis_note, created_at) VALUES ('legacy-cue', 'cue', '', 'now');
      INSERT INTO pure_cue_served_snapshots
        (learner_id, snapshot_id, pure_cue_id, served_at, stimulus, axis_note, accepted_answers_json)
        VALUES ('legacy', 'legacy-snapshot', 'legacy-cue', 'now', 'cue', '', '[]');
      INSERT INTO pure_cue_attempts VALUES
        ('legacy', 'legacy-attempt', 'legacy-cue', 'legacy-snapshot', 'session', 'action', 'now', '[{"outcome":"rejected"}]', 1, NULL);`);
    const history = connection.prepare('SELECT * FROM pure_cue_attempts').all();
    assert.deepEqual(migrateDatabase(connection), ['app_schema:0014_pure_cue_reflection', 'app_schema:0015_pure_cue_stimulus_repair', 'app_schema:0016_word_introduction_content']);
    assert.deepEqual(connection.prepare('SELECT * FROM pure_cue_attempts').all(), history);
    assert.equal(connection.prepare('SELECT COUNT(*) AS count FROM pure_cue_assessment_scheduler_snapshots').get()?.count, 0);
    assert.deepEqual(connection.prepare('PRAGMA foreign_key_check').all(), []);
    connection.close();
    connection = new DatabaseSync(file);
    connection.function('current_learner_id', () => 'legacy');
    connection.exec('PRAGMA foreign_keys=ON');
    assertSchemaCurrent(connection);
    assert.deepEqual(migrateDatabase(connection), []);
  } finally { connection.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
