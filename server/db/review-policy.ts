import { applyIntervalHourFuzz } from './interval-schedule.ts';
import { REVIEW_SKILL_URGENCY_TIE_EPSILON } from './types.ts';

export type ReviewSchedule = { intervalHours: number; easeFactor: number };

/** Ordinary good/lapse arithmetic, independent of lifecycle and persistence. */
export function nextReviewSchedule(
  before: ReviewSchedule,
  outcome: { failureCount: number; successful: boolean },
  fuzz: (hours: number) => number = applyIntervalHourFuzz,
): ReviewSchedule {
  if (outcome.failureCount > 0) {
    return {
      intervalHours: 6,
      easeFactor: Math.max(1.8, Number((before.easeFactor - 0.15 * outcome.failureCount).toFixed(2))),
    };
  }
  return {
    intervalHours: outcome.successful ? fuzz(Math.max(1, Math.ceil(before.intervalHours * before.easeFactor))) : before.intervalHours,
    easeFactor: before.easeFactor,
  };
}

export type RankedReviewCandidate = {
  wordId: string; skillId: string; urgency: number; nextDueAt: string | null;
};

/** Eligibility (due date, suppression, content readiness) remains the caller's policy. */
export function reviewUrgency(intervalHours: number, lastStudiedAt: string | null, now: string): number {
  if (!Number.isFinite(intervalHours) || intervalHours <= 0) throw new Error('Review urgency requires a positive interval');
  const nowTime = Date.parse(now);
  if (!Number.isFinite(nowTime)) throw new Error('Review urgency requires a valid timestamp');
  if (lastStudiedAt === null) return Number.MAX_VALUE;
  const lastTime = Date.parse(lastStudiedAt);
  if (!Number.isFinite(lastTime)) throw new Error('Review urgency requires a valid last-studied timestamp');
  return (nowTime - lastTime) / 3_600_000 / intervalHours;
}

export function compareReviewCandidates(left: RankedReviewCandidate, right: RankedReviewCandidate): number {
  const urgency = right.urgency - left.urgency;
  if (Math.abs(urgency) > REVIEW_SKILL_URGENCY_TIE_EPSILON) return urgency;
  if (left.nextDueAt !== right.nextDueAt) {
    if (left.nextDueAt === null) return 1;
    if (right.nextDueAt === null) return -1;
    const due = left.nextDueAt.localeCompare(right.nextDueAt);
    if (due) return due;
  }
  return left.wordId.localeCompare(right.wordId) || left.skillId.localeCompare(right.skillId);
}
