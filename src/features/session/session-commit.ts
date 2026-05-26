import type { BucketSessionCommitIntent } from '../../lib/session-state';
import {
  completeLearningSession,
  completeUnstudiedSession,
  recordAcceptedContrastSelectionAttempt,
  recordAcceptedReviewAttemptBatch,
} from '../../services/api';

export type DeferredSessionCommit = Exclude<BucketSessionCommitIntent, { type: 'none' }>;

export async function applySessionCommit(commit: DeferredSessionCommit) {
  switch (commit.type) {
    case 'commit-review-action-session': {
      await recordAcceptedReviewAttemptBatch({
        sessionId: commit.sessionId,
        events: commit.events,
        commitIntent: {
          type: commit.type,
          sessionActionId: commit.sessionActionId,
          targetWordId: commit.targetWordId,
          actionKind: commit.actionKind,
          sampledSkillIds: commit.sampledSkillIds,
          failureCount: commit.failureCount,
          terminalRating: commit.terminalRating,
        },
      });
      return;
    }
    case 'commit-contrast-selection-action-session':
      await recordAcceptedContrastSelectionAttempt({
        sessionId: commit.sessionId,
        event: commit.event,
        commitIntent: {
          type: commit.type,
          sessionActionId: commit.sessionActionId,
          targetWordId: commit.targetWordId,
          actionKind: commit.actionKind,
          sampledSkillIds: commit.sampledSkillIds,
          selectedWordId: commit.selectedWordId,
          promptTargetWordId: commit.promptTargetWordId,
          choiceWordIds: commit.choiceWordIds,
          rating: commit.rating,
          practiceMore: commit.practiceMore,
        },
      });
      return;
    case 'commit-learning-word-session':
      await completeLearningSession(commit.wordId, commit.success);
      return;
    case 'commit-unstudied-word-session':
      await completeUnstudiedSession(commit.wordId);
      return;
  }
}
