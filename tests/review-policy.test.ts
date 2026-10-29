import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nextReviewSchedule, reviewUrgency, compareReviewCandidates, type RankedReviewCandidate } from '../server/db/review-policy.ts';
import { applyIntervalHourFuzz } from '../server/db/interval-schedule.ts';

// Numeric boundaries retained from the legacy review behavior; both persistence
// paths call this policy rather than keeping independent copies of the arithmetic.
for (const failures of [1, 2, 10]) test(`review lapse counts ${failures} misses and respects the ease floor`, () => {
  assert.deepEqual(nextReviewSchedule({ intervalHours: 72, easeFactor: 2.5 },
    { failureCount: failures, successful: true }, () => { throw new Error('Lapses must not fuzz'); }),
  { intervalHours: 6, easeFactor: failures === 1 ? 2.35 : failures === 2 ? 2.2 : 1.8 });
});
for (const [roll, expected] of [[0.1, 60], [0.5, 61], [0.9, 62]]) test(`good review rounds up before fuzz (${roll})`, () => {
  assert.deepEqual(nextReviewSchedule({ intervalHours: 24.1, easeFactor: 2.5 },
    { failureCount: 0, successful: true }, hours => applyIntervalHourFuzz(hours, () => roll)),
  { intervalHours: expected, easeFactor: 2.5 });
});
test('absence of recall credit retains the schedule without consuming randomness', () => {
  assert.deepEqual(nextReviewSchedule({ intervalHours: 24, easeFactor: 2.5 },
    { failureCount: 0, successful: false }, () => { throw new Error('No growth'); }), { intervalHours: 24, easeFactor: 2.5 });
});
const now = '2026-10-27T12:00:00.000Z';
test('review urgency retains elapsed-over-interval threshold and newly enabled behavior', () => {
  assert.equal(reviewUrgency(24, '2026-10-26T00:00:00.000Z', now), 1.5);
  assert.equal(reviewUrgency(24, '2026-10-26T12:00:00.000Z', now), 1);
  assert.equal(reviewUrgency(24, '2026-10-27T00:00:00.000Z', now), 0.5);
  assert.equal(reviewUrgency(24, null, now), Number.MAX_VALUE);
  assert.throws(() => reviewUrgency(0, null, now));
  assert.throws(() => reviewUrgency(24, 'invalid', now));
});
const candidate = (values: Partial<RankedReviewCandidate>): RankedReviewCandidate => ({wordId:'a',skillId:'production',urgency:2,nextDueAt:null,...values});
test('review ranking preserves urgency, epsilon, due-date, word and skill tie breakers', () => {
  assert.ok(compareReviewCandidates(candidate({urgency:3}), candidate({urgency:2})) < 0);
  // As in the old composition tie case, a 24h/48h recognition and 12h/24h
  // production schedule have equal urgency; the earlier due skill wins.
  assert.ok(compareReviewCandidates(candidate({nextDueAt:'2026-10-27T00:00:00.000Z'}),
    candidate({skillId:'recognition',nextDueAt:'2026-10-27T06:00:00.000Z'})) < 0);
  assert.ok(compareReviewCandidates(candidate({urgency:2.0000001,nextDueAt:null}), candidate({nextDueAt:now})) > 0);
  assert.ok(compareReviewCandidates(candidate({wordId:'a'}),candidate({wordId:'b'})) < 0);
  assert.ok(compareReviewCandidates(candidate({}),candidate({skillId:'recognition'})) < 0);
});
