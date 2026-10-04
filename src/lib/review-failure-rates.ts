import type { ReviewFailureRateDay } from '../types';

export type ReviewFailureRatePeriod = {
  days: 1 | 3 | 7;
  failureRate: number | null;
  adjustedFailureRate: number | null;
  compensationRate: number | null;
  completedCount: number;
  failedCount: number;
  compensatedCount: number;
};

export function getReviewFailureRatePeriods(
  reviewFailureRateDays: ReviewFailureRateDay[],
  todayKey = new Date().toISOString().slice(0, 10),
): ReviewFailureRatePeriod[] {
  const countsByDay = new Map(
    reviewFailureRateDays.map((day) => [
      day.dayKey,
      {
        completedCount: day.completedReviewActionSessions,
        failedCount: day.failedReviewActionSessions,
        compensatedCount: day.compensatedReviewActionSessions,
      },
    ]),
  );

  return [1, 3, 7].map((days) => {
    let completedCount = 0;
    let failedCount = 0;
    let compensatedCount = 0;

    for (let offset = 0; offset < days; offset += 1) {
      const counts = countsByDay.get(addDaysToDateKey(todayKey, -offset));
      if (!counts) {
        continue;
      }

      completedCount += counts.completedCount;
      failedCount += counts.failedCount;
      compensatedCount += counts.compensatedCount;
    }

    return {
      days: days as 1 | 3 | 7,
      failureRate: completedCount === 0 ? null : failedCount / completedCount,
      // Clamp after summing the window so delayed compensation can offset earlier failures.
      adjustedFailureRate: completedCount === 0 ? null : Math.max(0, failedCount - compensatedCount) / completedCount,
      compensationRate: completedCount === 0 ? null : compensatedCount / completedCount,
      completedCount,
      failedCount,
      compensatedCount,
    };
  });
}

function addDaysToDateKey(dayKey: string, offset: number): string {
  const date = new Date(`${dayKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
