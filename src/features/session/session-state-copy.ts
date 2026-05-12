import type { BucketSessionState } from '../../lib/session-state';
import { cloneBucketSessionScheduler } from '../../lib/session-scheduler';

export function cloneBucketSessionState(state: BucketSessionState): BucketSessionState {
  return {
    ...state,
    scheduler: cloneBucketSessionScheduler(state.scheduler),
    startedActionIds: [...state.startedActionIds],
    progress: {
      learning: Object.fromEntries(
        Object.entries(state.progress.learning).map(([wordId, progress]) => [
          wordId,
          {
            coveredSkills: { ...progress.coveredSkills },
            firstTryGood: { ...progress.firstTryGood },
            attempts: { ...progress.attempts },
          },
        ]),
      ),
      unstudied: Object.fromEntries(
        Object.entries(state.progress.unstudied).map(([wordId, progress]) => [
          wordId,
          {
            introComplete: progress.introComplete,
            successStreaks: { ...progress.successStreaks },
          },
        ]),
      ),
    },
    reviewProgress: Object.fromEntries(
      Object.entries(state.reviewProgress).map(([actionId, progress]) => [
        actionId,
        {
          failureCount: progress.failureCount,
          reinforcementStreak: progress.reinforcementStreak,
          attempts: progress.attempts.map((attempt) => ({ ...attempt })),
        },
      ]),
    ),
  };
}
