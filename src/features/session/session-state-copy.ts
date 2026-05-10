import type { SessionState } from '../../lib/session-state';
import { cloneSessionScheduler } from '../../lib/session-scheduler';

export function cloneSessionState(state: SessionState): SessionState {
  return {
    ...state,
    scheduler: cloneSessionScheduler(state.scheduler),
    startedItemIds: [...state.startedItemIds],
    dismissedWordIds: [...state.dismissedWordIds],
    learningProgress: Object.fromEntries(
      Object.entries(state.learningProgress).map(([wordId, progress]) => [
        wordId,
        {
          coveredDirections: { ...progress.coveredDirections },
          firstTryGood: { ...progress.firstTryGood },
          attempts: { ...progress.attempts },
        },
      ]),
    ),
    unstudiedProgress: Object.fromEntries(
      Object.entries(state.unstudiedProgress).map(([wordId, progress]) => [
        wordId,
        {
          introComplete: progress.introComplete,
          consecutiveSuccesses: { ...progress.consecutiveSuccesses },
        },
      ]),
    ),
    reviewProgress: Object.fromEntries(
      Object.entries(state.reviewProgress).map(([reviewItemId, progress]) => [
        reviewItemId,
        {
          failureCount: progress.failureCount,
          reinforcementStreak: progress.reinforcementStreak,
          attempts: progress.attempts.map((attempt) => ({ ...attempt })),
        },
      ]),
    ),
  };
}
