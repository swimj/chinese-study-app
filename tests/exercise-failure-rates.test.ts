import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { getReviewFailureRatePeriods } from '../src/lib/review-failure-rates.ts';
import { createSessionSummary, getCompletedExerciseCounts } from '../src/features/session/session-summary.ts';

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
  });
  after(() => { sqlite.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

  test('reads saved exercise totals and daily compensation without inspecting attempt history', () => {
    function finish(sessionId: string, day: string, words: number, wordFailures: number,
      pureCues: number, pureFailures: number) {
      const summary = createSessionSummary({ sessionId, startedAt: `${day}T00:00:00.000Z`, initialQueueLength: 0 });
      summary.completedReviewActions = words;
      summary.lapsedReviewActionIds = Array.from({ length: wordFailures }, (_, i) => `word-${i}`);
      summary.completedPureCueActions = pureCues;
      summary.lapsedPureCueActions = pureFailures;
      dbModule.recordReviewSessionSummary({ sessionId, completedAt: `${day}T12:00:00.000Z`,
        ...getCompletedExerciseCounts(summary), activeDurationMs: 0 });
    }
    finish('pure-only', '2026-09-18', 0, 0, 2, 1);
    finish('mixed', '2026-09-19', 3, 1, 2, 1);
    finish('mixed', '2026-09-19', 3, 1, 2, 1); // Retry replaces totals.
    finish('word-only', '2026-09-19', 2, 1, 0, 0);
    finish('empty', '2026-09-20', 0, 0, 0, 0);
    sqlite.prepare(`INSERT INTO learner_exercise_compensation_days VALUES ('test-learner', '2026-09-21', 2)`).run();
    sqlite.prepare(`INSERT INTO learners (learner_id, display_name, created_at) VALUES ('other', 'Other', '2026-09-18')`).run();
    sqlite.prepare(`INSERT INTO learner_exercise_compensation_days VALUES ('other', '2026-09-21', 99)`).run();
    dbModule.runWithLearnerId('other', () => finish('mixed', '2026-09-19', 1, 1, 0, 0));

    const days = dbModule.getReviewFailureRateDays();
    assert.deepEqual(days.map(day => [day.dayKey, day.completedReviewActionSessions,
      day.failedReviewActionSessions, day.compensatedReviewActionSessions]), [
      ['2026-09-18', 2, 1, 0], ['2026-09-19', 7, 3, 0],
      ['2026-09-20', 0, 0, 0], ['2026-09-21', 0, 0, 2],
    ]);
    assert.equal(dbModule.getReviewFailureRateDays(1)[0]?.dayKey, '2026-09-21');
    const periods = getReviewFailureRatePeriods(days, '2026-09-21');
    assert.equal(periods[0]?.adjustedFailureRate, null);
    assert.equal(periods[0]?.compensatedCount, 2);
    assert.equal(periods[1]?.adjustedFailureRate, 1 / 7);
    assert.equal(periods[1]?.compensationRate, 2 / 7);
    assert.equal(periods[2]?.adjustedFailureRate, 2 / 9);
    assert.equal(periods[2]?.failureRate, 4 / 9);
    const other = dbModule.runWithLearnerId('other', () => dbModule.getReviewFailureRateDays());
    assert.equal(other.find(day => day.dayKey === '2026-09-21')?.compensatedReviewActionSessions, 99);
  });
});
