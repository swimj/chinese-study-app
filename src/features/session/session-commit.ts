import type { SessionCommitIntent } from '../../lib/session-state';
import {
  completeLearningSession,
  completeUnstudiedSession,
  recordAcceptedReviewAttemptBatch,
} from '../../services/api';

export type DeferredSessionCommit = Exclude<SessionCommitIntent, { type: 'none' }>;

export async function applySessionCommit(commit: DeferredSessionCommit) {
  switch (commit.type) {
    case 'commit-review-item-session': {
      await recordAcceptedReviewAttemptBatch({
        sessionId: commit.sessionId,
        events: commit.events,
        commitIntent: {
          type: commit.type,
          reviewItemId: commit.reviewItemId,
          failureCount: commit.failureCount,
          terminalRating: commit.terminalRating,
        },
      });
      return;
    }
    case 'commit-learning-word-session':
      await completeLearningSession(commit.wordId, commit.success);
      return;
    case 'commit-unstudied-word-session':
      await completeUnstudiedSession(commit.wordId);
      return;
  }
}
