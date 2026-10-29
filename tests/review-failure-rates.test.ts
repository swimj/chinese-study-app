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

  assert.deepEqual(periods.map(({ days, failureRate }) => ({ days, failureRate })), [
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
    compensatedReviewActionSessions: 0,
    failureRate: null,
    rolling3DayFailureRate: null,
    rolling7DayFailureRate: null,
  };
}


test('subtracts both days before clamping and retains recorded counts', () => {
  const yesterday = reviewFailureRateDay('2026-07-21', 10, 4);
  const today = { ...reviewFailureRateDay('2026-07-22', 2, 0), compensatedReviewActionSessions: 3 };
  const periods = getReviewFailureRatePeriods([yesterday, today], '2026-07-22');
  assert.deepEqual(periods[0], { days: 1, completedCount: 2, failedCount: 0, compensatedCount: 3,
    failureRate: 0, adjustedFailureRate: 0, compensationRate: 1.5 });
  assert.deepEqual(periods[1], { days: 3, completedCount: 12, failedCount: 4, compensatedCount: 3,
    failureRate: 4 / 12, adjustedFailureRate: 1 / 12, compensationRate: 3 / 12 });
  assert.equal(periods[2]?.adjustedFailureRate, 1 / 12);
});

test('compensation-only days retain counts without inventing a rate', () => {
  const day = { ...reviewFailureRateDay('2026-07-22', 0, 0), compensatedReviewActionSessions: 5 };
  for (const period of getReviewFailureRatePeriods([day], '2026-07-22')) {
    assert.equal(period.compensatedCount, 5);
    assert.equal(period.failureRate, null);
    assert.equal(period.adjustedFailureRate, null);
    assert.equal(period.compensationRate, null);
  }
});
