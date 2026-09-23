import {
  DEFAULT_CHARACTER_PRESENTATION,
  formatCardCharacters,
  type CharacterPresentation,
} from '../../domain/card-characters';
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
  activeDurationMs: number;
  initialQueueLength: number;
  answeredCount: number;
  completedReviewActions: number;
  completedPureCueActions: number;
  lapsedPureCueActions: number;
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
    activeDurationMs: 0,
    initialQueueLength,
    answeredCount: 0,
    completedReviewActions: 0,
    completedPureCueActions: 0,
    lapsedPureCueActions: 0,
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
  characterPresentation = DEFAULT_CHARACTER_PRESENTATION,
}: {
  summary: SessionSummary | null;
  transition: SessionSummaryTransition;
  rating: ReviewRating;
  activeWord: Word;
  activeItem: SessionStudyItem;
  previousPhase: SessionPhase;
  characterPresentation?: CharacterPresentation;
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
          formatReviewEncounterLabel(activeItem, activeWord, characterPresentation),
        ];
      }
      break;
    case 'commit-contrast-selection-action-session':
      nextSummary.completedReviewActions += 1;
      if (transition.commit.event.outcome === 'incorrect') {
        nextSummary.lapsedReviewActions += 1;
        nextSummary.lapsedReviewLabels = [
          ...nextSummary.lapsedReviewLabels,
          formatReviewEncounterLabel(activeItem, activeWord, characterPresentation),
        ];
        nextSummary.lapsedReviewActionIds = [...nextSummary.lapsedReviewActionIds, activeItem.sessionActionId];
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

export function updateSessionSummaryForPureCueRating({
  summary,
  transition,
  previousPhase,
}: {
  summary: SessionSummary | null;
  transition: SessionSummaryTransition;
  previousPhase: SessionPhase;
}): SessionSummary | null {
  if (!summary) return summary;
  const nextSummary: SessionSummary = {
    ...summary,
    answeredCount: transition.state.answeredCount,
    completedAt: transition.state.phase === 'completed' && summary.completedAt === null
      ? new Date().toISOString()
      : summary.completedAt,
    completionMode: transition.state.phase === 'completed' && previousPhase === 'draining'
      ? 'drain'
      : summary.completionMode,
  };
  if (transition.commit.type === 'commit-pure-cue-production-session') {
    nextSummary.completedPureCueActions += 1;
    if (transition.commit.events.some((event) => event.rating === 'forgot')) {
      nextSummary.lapsedPureCueActions += 1;
    }
  }
  return nextSummary;
}

function formatReviewEncounterLabel(
  item: SessionStudyItem,
  word: Word,
  characterPresentation: CharacterPresentation,
) {
  if (item.actionKind === 'contrast_selection') {
    const target = item.contrastSelection?.choices.find((choice) => (
      choice.word.id === item.contrastSelection?.promptTargetWordId
    ));
    const characters = target
      ? formatCardCharacters(target.word, characterPresentation)
      : formatCardCharacters(word, characterPresentation);
    return target
      ? `${item.contrastSelection?.prompt.promptText} -> ${characters}`
      : `${characters} contrast`;
  }

  const characters = formatCardCharacters(word, characterPresentation);
  return item.actionKind === 'recognition'
    ? `${characters} -> ${word.meaning}`
    : `${word.meaning} -> ${characters}`;
}
