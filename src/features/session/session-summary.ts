import type { ReviewItem, ReviewRating, SessionItemWithWord, Word } from '../../types';
import type { SessionCommitIntent, SessionState } from '../../lib/session-state';

export type SessionSummary = {
  sessionId: string;
  startedAt: string;
  completedAt: string | null;
  initialQueueLength: number;
  answeredCount: number;
  completedReviewItems: number;
  encounteredReviewItemIds: string[];
  lapsedReviewItems: number;
  lapsedReviewLabels: string[];
  lapsedReviewItemIds: string[];
  completedLearningWords: number;
  completedUnstudiedWords: number;
  completionMode: 'natural' | 'drain';
};

export function createSessionSummary({
  sessionId,
  startedAt,
  initialQueueLength,
}: {
  sessionId: string;
  startedAt: string;
  initialQueueLength: number;
}): SessionSummary {
  return {
    sessionId,
    startedAt,
    completedAt: null,
    initialQueueLength,
    answeredCount: 0,
    completedReviewItems: 0,
    encounteredReviewItemIds: [],
    lapsedReviewItems: 0,
    lapsedReviewLabels: [],
    lapsedReviewItemIds: [],
    completedLearningWords: 0,
    completedUnstudiedWords: 0,
    completionMode: 'natural',
  };
}

export function beginDrainSessionSummary({
  summary,
  drainedState,
}: {
  summary: SessionSummary | null;
  drainedState: SessionState;
}): SessionSummary | null {
  if (!summary) {
    return summary;
  }

  return {
    ...summary,
    answeredCount: drainedState.answeredCount,
    completionMode: 'drain',
    completedAt:
      drainedState.phase === 'completed' && summary.completedAt === null
        ? new Date().toISOString()
        : summary.completedAt,
  };
}

export function updateSessionSummaryForRating({
  summary,
  transition,
  rating,
  activeWord,
  activeItem,
  previousPhase,
}: {
  summary: SessionSummary | null;
  transition: { state: SessionState; commit: SessionCommitIntent };
  rating: ReviewRating;
  activeWord: Word;
  activeItem: SessionItemWithWord;
  previousPhase: SessionState['phase'];
}): SessionSummary | null {
  if (!summary) {
    return summary;
  }

  const nextSummary: SessionSummary = {
    ...summary,
    answeredCount: transition.state.answeredCount,
    completedAt:
      transition.state.phase === 'completed' && summary.completedAt === null
        ? new Date().toISOString()
        : summary.completedAt,
    completionMode:
      transition.state.phase === 'completed'
        ? previousPhase === 'draining'
          ? 'drain'
          : summary.completionMode
        : summary.completionMode,
  };

  if (
    activeWord.status === 'review' &&
    rating === 'forgot' &&
    !nextSummary.lapsedReviewItemIds.includes(activeItem.reviewItem.id)
  ) {
    nextSummary.lapsedReviewItemIds = [...nextSummary.lapsedReviewItemIds, activeItem.reviewItem.id];
  }

  switch (transition.commit.type) {
    case 'commit-review-item-session':
      nextSummary.completedReviewItems += 1;
      if (!nextSummary.encounteredReviewItemIds.includes(transition.commit.reviewItemId)) {
        nextSummary.encounteredReviewItemIds = [
          ...nextSummary.encounteredReviewItemIds,
          transition.commit.reviewItemId,
        ];
      }
      if (transition.commit.terminalRating === null) {
        nextSummary.lapsedReviewItems += 1;
        nextSummary.lapsedReviewLabels = [
          ...nextSummary.lapsedReviewLabels,
          formatReviewEncounterLabel(activeItem.reviewItem, activeWord),
        ];
      }
      break;
    case 'commit-learning-word-session':
      nextSummary.completedLearningWords += 1;
      break;
    case 'commit-unstudied-word-session':
      nextSummary.completedUnstudiedWords += 1;
      break;
    case 'none':
      break;
  }

  return nextSummary;
}

function formatReviewEncounterLabel(item: ReviewItem, word: Word) {
  return item.direction === 'forward'
    ? `${word.hanzi} -> ${word.meaning}`
    : `${word.meaning} -> ${word.hanzi}`;
}
