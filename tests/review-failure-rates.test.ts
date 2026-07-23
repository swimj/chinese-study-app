import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getReviewFailureRatePeriods } from '../src/lib/review-failure-rates.ts';

test('review failure rate periods are anchored to today and include only 1, 3, and 7 days', () => {
  const periods = getReviewFailureRatePeriods([
    reviewFailureRateDay('2026-07-22', 3, 1),
    reviewFailureRateDay('2026-07-21', 2, 1),
    reviewFailureRateDay('2026-07-19', 4, 2),
    reviewFailureRateDay('2026-07-15', 10, 10),
  ], '2026-07-22');

  assert.deepEqual(periods, [
    { days: 1, failureRate: 1 / 3 },
    { days: 3, failureRate: 2 / 5 },
    { days: 7, failureRate: 4 / 9 },
  ]);
});

function reviewFailureRateDay(dayKey: string, completedReviewActionSessions: number, failedReviewActionSessions: number) {
  return {
    dayKey,
    completedReviewActionSessions,
    failedReviewActionSessions,
    failureRate: null,
    rolling3DayFailureRate: null,
    rolling7DayFailureRate: null,
  };
}
