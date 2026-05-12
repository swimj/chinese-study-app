import type { SessionStudyItem } from '../../domain/study-actions';
import type { ReviewRating, Word } from '../../types';
import type { BucketSessionCommitIntent, SessionPhase } from '../../lib/session-state';

type SessionSummaryState = {
  answeredCount: number;
  phase: SessionPhase;
};

type SessionSummaryTransition = {
  state: SessionSummaryState;
  commit: BucketSessionCommitIntent;
};

export type SessionSummary = {
  sessionId: string;
  startedAt: string;
  completedAt: string | null;
  initialQueueLength: number;
  answeredCount: number;
  completedReviewActions: number;
  lapsedReviewActions: number;
  lapsedReviewLabels: string[];
  lapsedReviewActionIds: string[];
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
    completedReviewActions: 0,
    lapsedReviewActions: 0,
    lapsedReviewLabels: [],
    lapsedReviewActionIds: [],
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
  drainedState: SessionSummaryState;
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
  transition: SessionSummaryTransition;
  rating: ReviewRating;
  activeWord: Word;
  activeItem: SessionStudyItem;
  previousPhase: SessionPhase;
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
    !nextSummary.lapsedReviewActionIds.includes(activeItem.sessionActionId)
  ) {
    nextSummary.lapsedReviewActionIds = [...nextSummary.lapsedReviewActionIds, activeItem.sessionActionId];
  }

  switch (transition.commit.type) {
    case 'commit-review-action-session':
      nextSummary.completedReviewActions += 1;
      if (transition.commit.terminalRating === null) {
        nextSummary.lapsedReviewActions += 1;
        nextSummary.lapsedReviewLabels = [
          ...nextSummary.lapsedReviewLabels,
          formatReviewEncounterLabel(activeItem, activeWord),
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

function formatReviewEncounterLabel(item: SessionStudyItem, word: Word) {
  return item.actionKind === 'recognition'
    ? `${word.hanzi} -> ${word.meaning}`
    : `${word.meaning} -> ${word.hanzi}`;
}
