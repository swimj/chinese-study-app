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
    assert.deepEqual(getReviewFailureRatePeriods(days, '2026-09-19'), [
      { days: 1, failureRate: 3 / 7 },
      { days: 3, failureRate: 4 / 8 },
      { days: 7, failureRate: 4 / 8 },
    ]);
  });
});
