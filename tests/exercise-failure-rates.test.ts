import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { getReviewFailureRatePeriods } from '../src/lib/review-failure-rates.ts';
import type { PureCueAssessmentEvent } from '../src/domain/pure-cues.ts';

const now = '2026-09-18T00:00:00.000Z';

describe('exercise failure analytics', { concurrency: false }, () => {
  let dataDir = '';
  let sqlite: DatabaseSync;
  let dbModule: typeof import('../server/db.ts');

  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-study-app-pure-cues-'));
    const previousMode = process.env.APP_MODE;
    const previousDataDir = process.env.APP_DATA_DIR;
    process.env.APP_MODE = 'study';
    process.env.APP_DATA_DIR = dataDir;
    dbModule = await import(`${pathToFileURL(path.resolve('server/db.ts')).href}?exercise-failures=${Date.now()}`);
    if (previousMode === undefined) delete process.env.APP_MODE;
    else process.env.APP_MODE = previousMode;
    if (previousDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousDataDir;

    sqlite = new DatabaseSync(path.join(dataDir, 'app.db'));
    sqlite.function('current_learner_id', () => 'test-learner');
    sqlite.exec('PRAGMA foreign_keys=ON');
    for (const [id, hanzi, traditional] of [
      ['word-a', '撒谎', '撒謊'],
      ['word-b', '说谎', '說謊'],
      ['word-c', '骗人', '騙人'],
      ['word-d', '瞒骗', '瞞騙'],
    ]) {
      sqlite.prepare(`
        INSERT INTO lexical_words (
          id, hanzi, traditional, pinyin, meaning, meanings_json, examples_json, priority, created_at
        ) VALUES (?, ?, ?, 'pinyin', 'meaning', '[]', '[]', 1, ?)
      `).run(id, hanzi, traditional, now);
    }
  });

  after(() => {
    sqlite.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  function publishFixture(id: string, status = 'shared_trial'): void {
    sqlite.prepare(`INSERT INTO shared_content_publications
      (publication_id, content_kind, content_id, learning_purpose_key, publication_status, published_at, status_updated_at)
      VALUES (?, 'pure_cue', ?, ?, ?, ?, ?)`)
      .run(`publication:${id}`, id, `pure:${id}`, status, now, now);
  }

  function reviewMember(learnerId: string, wordId: string): void {
    sqlite.prepare(`INSERT INTO learner_word_state (learner_id, word_id, status)
      VALUES (?, ?, 'review') ON CONFLICT(learner_id, word_id) DO UPDATE SET status = 'review'`)
      .run(learnerId, wordId);
    sqlite.prepare(`INSERT INTO learner_owned_word_study_admission_state
      (learner_id, word_id, study_phase, earliest_next_study_at) VALUES (?, ?, 'review', NULL)
      ON CONFLICT(learner_id, word_id) DO UPDATE SET study_phase = 'review'`).run(learnerId, wordId);
  }

  test('combines historical pure-only and mixed sessions once, scoped to learner and completion day', () => {
    dbModule.createPureCueWithoutTransaction({
      id: 'analytics-cue', stimulus: 'to tell an untruth',
      acceptedWordIds: ['word-a', 'word-b'], createdAt: now,
    });
    publishFixture('analytics-cue');
    for (const learnerId of ['test-learner', 'analytics-other']) {
      if (learnerId !== 'test-learner') {
        sqlite.prepare('INSERT INTO learners (learner_id, display_name, created_at) VALUES (?, ?, ?)')
          .run(learnerId, learnerId, now);
      }
      reviewMember(learnerId, 'word-a');
      dbModule.runWithLearnerId(learnerId, () => dbModule.adoptEligiblePureCuesForCurrentLearner(now));
    }

    function assess(sessionId: string, actionId: string, failures: number) {
      const snapshotId = `snapshot:${actionId}`;
      dbModule.issuePureCueServedSnapshot({ snapshotId, pureCueId: 'analytics-cue', servedAt: now });
      const events: PureCueAssessmentEvent[] = [];
      for (let i = 0; i < failures; i += 1) {
        events.push({ eventId: `${actionId}:failure:${i}`, occurredAt: now,
          response: '', outcome: 'rejected', submittedWordId: null, rating: 'forgot' });
      }
      for (let i = 0; i < (failures > 0 ? 3 : 1); i += 1) {
        events.push({ eventId: `${actionId}:success:${i}`, occurredAt: now,
          response: '说谎', outcome: 'accepted', submittedWordId: 'word-b', rating: 'good' });
      }
      const input = { attemptId: `attempt:${actionId}`, snapshotId, sessionId,
        sessionActionId: actionId, committedAt: now, events };
      dbModule.recordPureCueAssessment(input);
      dbModule.recordPureCueAssessment(input); // A retried commit must still count once.
    }
    function finish(sessionId: string, day: string, completed: number, failed: number) {
      dbModule.recordReviewSessionSummary({ sessionId, completedAt: `${day}T12:00:00.000Z`,
        completedReviewActionCount: completed, failedReviewActionCount: failed, activeDurationMs: 0 });
    }

    assess('pure-only', 'pure-failed', 2);
    assess('mixed', 'mixed-success', 0);
    assess('mixed', 'mixed-failed', 1);
    assess('unfinished', 'unfinished-failed', 1);
    assert.deepEqual(dbModule.getReviewFailureRateDays(), [], 'unfinalized assessments are excluded');

    finish('pure-only', '2026-09-18', 0, 0);
    finish('mixed', '2026-09-19', 3, 1);
    finish('word-only', '2026-09-19', 2, 1);
    finish('empty', '2026-09-20', 0, 0);
    finish('mixed', '2026-09-19', 3, 1); // Summary retries do not duplicate totals.

    dbModule.runWithLearnerId('analytics-other', () => {
      assess('mixed', 'other-failed', 1); // Same session id must not leak across learners.
      finish('mixed', '2026-09-19', 0, 0);
      const days = dbModule.getReviewFailureRateDays();
      assert.equal(days.length, 1);
      assert.equal(days[0]?.completedReviewActionSessions, 1);
      assert.equal(days[0]?.failedReviewActionSessions, 1);
    });

    const days = dbModule.getReviewFailureRateDays();
    assert.deepEqual(days.map(day => [day.dayKey, day.completedReviewActionSessions,
      day.failedReviewActionSessions, day.failureRate]), [
      ['2026-09-18', 1, 1, 1],
      ['2026-09-19', 7, 3, 3 / 7],
      ['2026-09-20', 0, 0, null],
    ]);
    assert.equal(days[1]?.rolling3DayFailureRate, 4 / 8);
    assert.equal(days[1]?.rolling7DayFailureRate, 4 / 8);
    assert.deepEqual(getReviewFailureRatePeriods(days, '2026-09-19').map(({ days, failureRate }) => ({ days, failureRate })), [
      { days: 1, failureRate: 3 / 7 },
      { days: 3, failureRate: 4 / 8 },
      { days: 7, failureRate: 4 / 8 },
    ]);

    function restorePure(learnerId: string, actionId: string, restoredAt: string) {
      const sourceAttemptId = `attempt:${actionId}`;
      const invocationId = `restore:${actionId}`;
      sqlite.prepare(`INSERT INTO learner_owned_reflection_operation_invocations (
        learner_id, invocation_id, created_at, origin_kind, operation_kind, operation_version, operation_json,
        application_state, application_updated_at, effect_refs_json, satisfying_effect_refs_json
      ) VALUES (?, ?, ?, 'manual', 'reconcile_pure_cue_response', 1, ?, 'pending', ?, '[]', '[]')`)
        .run(learnerId, invocationId, now,
          JSON.stringify({ operation: { sourceAttemptId, pureCueId: 'analytics-cue' } }), now);
      dbModule.runWithLearnerId(learnerId, () => {
        const input = { sourceAttemptId, compensationInvocationId: invocationId, restoredAt };
        assert.equal(dbModule.restorePureCueSchedulerSnapshotWithoutTransaction(input).kind, 'restored');
        assert.equal(dbModule.restorePureCueSchedulerSnapshotWithoutTransaction({ ...input,
          restoredAt: '2026-09-23T00:00:00.000Z' }).kind, 'already_restored');
      });
    }
    function wordCompensation(id: string, learnerId: string, restoredAt: string | null) {
      sqlite.prepare(`INSERT INTO pure_cue_scheduler_compensation_snapshots
        (learner_id, session_id, session_action_id, target_word_id, captured_at,
         production_skill_state_json, admission_state_json, compensated_by_invocation_id, compensated_at)
        VALUES (?, ?, ?, 'word-a', ?, '{}', 'null', ?, ?)`)
        .run(learnerId, id, id, now, restoredAt === null ? null : id, restoredAt);
    }
    restorePure('test-learner', 'pure-failed', '2026-09-21T00:00:00.000Z');
    restorePure('analytics-other', 'other-failed', '2026-09-21T00:00:00.000Z');
    wordCompensation('word-restored', 'test-learner', '2026-09-21T23:59:59.000Z');
    wordCompensation('word-next-day', 'test-learner', '2026-09-22T00:00:00.000Z');
    wordCompensation('word-pending', 'test-learner', null);
    wordCompensation('word-other', 'analytics-other', '2026-09-21T00:00:00.000Z');

    const adjustedDays = dbModule.getReviewFailureRateDays();
    assert.deepEqual(adjustedDays.map(day => [day.dayKey, day.compensatedReviewActionSessions]), [
      ['2026-09-18', 0], ['2026-09-19', 0], ['2026-09-20', 0],
      ['2026-09-21', 2], ['2026-09-22', 1],
    ], 'unrestored snapshots and repeated restore attempts do not add compensation');
    assert.equal(dbModule.getReviewFailureRateDays(1)[0]?.dayKey, '2026-09-22');
    const adjusted = getReviewFailureRatePeriods(adjustedDays, '2026-09-21');
    assert.equal(adjusted[0]?.compensatedCount, 2);
    assert.equal(adjusted[0]?.compensationRate, null);
    assert.equal(adjusted[1]?.adjustedFailureRate, 1 / 7);
    assert.equal(adjusted[1]?.compensationRate, 2 / 7);
    assert.equal(adjusted[2]?.adjustedFailureRate, 2 / 8);
    assert.equal(adjusted[2]?.failureRate, 4 / 8, 'recorded failures are preserved');
    const otherDays = dbModule.runWithLearnerId('analytics-other', () => dbModule.getReviewFailureRateDays());
    assert.equal(otherDays.find(day => day.dayKey === '2026-09-21')?.compensatedReviewActionSessions, 2);
  });
});
