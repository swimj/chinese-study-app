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
          attempts: progress.attempts.map((attempt) => ({
            ...attempt,
            sampledSkillIds: [...attempt.sampledSkillIds],
            contentRef: attempt.contentRef ? { ...attempt.contentRef } : null,
            metadata: cloneAttemptMetadata(attempt.metadata),
          })),
        },
      ]),
    ),
  };
}

function cloneAttemptMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const production = metadata.production;
  if (typeof production !== 'object' || production === null || Array.isArray(production)) {
    return { ...metadata };
  }
  const acceptedWordIds = (production as Record<string, unknown>).acceptedWordIds;
  return {
    ...metadata,
    production: {
      ...production,
      acceptedWordIds: Array.isArray(acceptedWordIds) ? [...acceptedWordIds] : acceptedWordIds,
    },
  };
}
