import type { ReviewFailureRateDay } from '../types';

export type ReviewFailureRatePeriod = {
  days: 1 | 3 | 7;
  failureRate: number | null;
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
      },
    ]),
  );

  return [1, 3, 7].map((days) => {
    let completedCount = 0;
    let failedCount = 0;

    for (let offset = 0; offset < days; offset += 1) {
      const counts = countsByDay.get(addDaysToDateKey(todayKey, -offset));
      if (!counts) {
        continue;
      }

      completedCount += counts.completedCount;
      failedCount += counts.failedCount;
    }

    return {
      days: days as 1 | 3 | 7,
      failureRate: completedCount === 0 ? null : failedCount / completedCount,
    };
  });
}

function addDaysToDateKey(dayKey: string, offset: number): string {
  const date = new Date(`${dayKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
