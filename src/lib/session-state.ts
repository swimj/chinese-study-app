import type { ReviewItem, ReviewRating, SessionItemBuckets, SessionItemWithWord, Word } from '../types';
import {
  consumeActiveSchedulerItem,
  createSessionScheduler,
  getSchedulerActiveItem,
  getSchedulerItems,
  getSchedulerLength,
  nextScheduler,
  pruneSchedulerItems,
  removeSchedulerWord,
  removeUnstudiedCandidateByReviewItemId,
  rotateActiveSchedulerItem,
  type SessionScheduler,
} from './session-scheduler';

type Direction = ReviewItem['direction'];

export type LearningWordProgress = {
  coveredDirections: Record<Direction, boolean>;
  firstTryGood: Record<Direction, boolean>;
  attempts: Record<Direction, number>;
};

export type UnstudiedWordProgress = {
  introComplete: boolean;
  consecutiveSuccesses: Record<Direction, number>;
};

export type ReviewItemProgress = {
  failureCount: number;
  reinforcementStreak: number;
};

export type SessionPhase = 'active' | 'draining' | 'completed';

export type SessionState = {
  sessionId: string;
  phase: SessionPhase;
  scheduler: SessionScheduler;
  answeredCount: number;
  startedItemIds: string[];
  dismissedWordIds: string[];
  learningProgress: Record<string, LearningWordProgress>;
  unstudiedProgress: Record<string, UnstudiedWordProgress>;
  reviewProgress: Record<string, ReviewItemProgress>;
};

export type SessionCommitIntent =
  | { type: 'none' }
  | {
      type: 'commit-review-item-session';
      reviewItemId: string;
      failureCount: number;
      terminalRating: 'hard' | 'good' | 'easy' | null;
    }
  | {
      type: 'commit-learning-word-session';
      wordId: string;
      success: boolean;
    }
  | {
      type: 'commit-unstudied-word-session';
      wordId: string;
    };

export type SessionTransitionResult = {
  state: SessionState;
  commit: SessionCommitIntent;
};

export type SessionDismissIntent =
  | { type: 'none' }
  | {
      type: 'dismiss-word-from-study';
      wordId: string;
      status: Word['status'];
    };

export type SessionDismissTransitionResult = {
  state: SessionState;
  dismiss: SessionDismissIntent;
};

export function createSessionState(buckets: SessionItemBuckets, sessionId: string): SessionState {
  const scheduler = createSessionScheduler({ buckets });

  return {
    sessionId,
    phase: 'active',
    scheduler,
    answeredCount: 0,
    startedItemIds: [],
    dismissedWordIds: [],
    learningProgress: {},
    unstudiedProgress: {},
    reviewProgress: {},
  };
}

export function markCurrentItemStarted(state: SessionState): SessionState {
  const currentItem = getSchedulerActiveItem(state.scheduler);
  if (!currentItem || state.startedItemIds.includes(currentItem.reviewItem.id)) {
    return state;
  }

  return {
    ...state,
    startedItemIds: [...state.startedItemIds, currentItem.reviewItem.id],
  };
}

export function beginUnstudiedDrill(state: SessionState, wordId: string): SessionState {
  const activeItem = getSchedulerActiveItem(state.scheduler);
  if (!activeItem) {
    throw new Error('Session invariant violated: cannot begin unstudied drill without an active scheduler item.');
  }

  if (activeItem.word.id !== wordId) {
    throw new Error(
      `Session invariant violated: unstudied drill word "${wordId}" must match active word "${activeItem.word.id}".`,
    );
  }

  return {
    ...state,
    unstudiedProgress: {
      ...state.unstudiedProgress,
      [wordId]: {
        ...(state.unstudiedProgress[wordId] ?? createInitialUnstudiedProgress()),
        introComplete: true,
      },
    },
  };
}

export function dismissCurrentItemFromSession(state: SessionState): SessionDismissTransitionResult {
  const currentItem = getSchedulerActiveItem(state.scheduler);

  if (!currentItem) {
    return {
      state,
      dismiss: { type: 'none' },
    };
  }

  const dismissedWordId = currentItem.word.id;
  const dismissRemoval = removeSchedulerWord(state.scheduler, dismissedWordId, currentItem.word.status);
  const dismissedReviewItemIds = new Set(dismissRemoval.removedReviewItemIds);
  const nextScheduler = dismissRemoval.scheduler;

  const nextReviewProgress = Object.fromEntries(
    Object.entries(state.reviewProgress).filter(([reviewItemId]) => !dismissedReviewItemIds.has(reviewItemId)),
  );

  const nextState: SessionState = {
    ...state,
    phase: getSchedulerLength(nextScheduler) === 0 ? 'completed' : state.phase,
    scheduler: nextScheduler,
    startedItemIds: state.startedItemIds.filter((reviewItemId) => !dismissedReviewItemIds.has(reviewItemId)),
    dismissedWordIds: state.dismissedWordIds.includes(dismissedWordId)
      ? state.dismissedWordIds
      : [...state.dismissedWordIds, dismissedWordId],
    learningProgress: removeKey(state.learningProgress, dismissedWordId),
    unstudiedProgress: removeKey(state.unstudiedProgress, dismissedWordId),
    reviewProgress: nextReviewProgress,
  };

  return {
    state: nextState,
    dismiss: {
      type: 'dismiss-word-from-study',
      wordId: dismissedWordId,
      status: currentItem.word.status,
    },
  };
}

export function beginDrainSession(state: SessionState): SessionState {
  assertDrainablePhase(state);

  const openWordIds = new Set<string>([
    ...Object.keys(state.learningProgress),
    ...Object.keys(state.unstudiedProgress),
  ]);
  const openReviewItemIds = new Set<string>(Object.keys(state.reviewProgress));
  const activeReviewItemId = getSchedulerActiveItem(state.scheduler)?.reviewItem.id ?? null;
  const nextScheduler = pruneSchedulerItems(state.scheduler, (item, _index) => {
    if (activeReviewItemId === item.reviewItem.id) {
      return true;
    }

    if (openReviewItemIds.has(item.reviewItem.id)) {
      return true;
    }

    if (openWordIds.has(item.word.id)) {
      return true;
    }

    return false;
  });

  return {
    ...state,
    phase: getSchedulerLength(nextScheduler) === 0 ? 'completed' : 'draining',
    scheduler: nextScheduler,
  };
}

export function rateCurrentItem(
  state: SessionState,
  rating: ReviewRating,
): SessionTransitionResult {
  const currentItem = getSchedulerActiveItem(state.scheduler) ?? assertCurrentItemPresent(state, rating);

  assertCurrentItemStarted(state, currentItem, rating);

  const currentWord = currentItem.word;
  const currentReviewItem = currentItem.reviewItem;

  switch (currentWord.status) {
    case 'review':
      return handleReviewAttempt(state, currentItem, rating);
    case 'learning':
      return handleLearningAttempt(state, currentItem, currentWord, rating);
    case 'unstudied':
      return handleUnstudiedAttempt(state, currentItem, currentWord, rating);
    default:
      return assertUnreachableWordStatus(state, currentReviewItem, currentWord, rating);
  }
}

function handleReviewAttempt(
  state: SessionState,
  item: SessionItemWithWord,
  rating: ReviewRating,
): SessionTransitionResult {
  const reviewItem = item.reviewItem;
  const currentProgress = state.reviewProgress[reviewItem.id] ?? { failureCount: 0, reinforcementStreak: 0 };

  if (currentProgress.failureCount === 0 && rating !== 'forgot') {
    return {
      state: finalizePostRatingState({
        ...state,
        answeredCount: state.answeredCount + 1,
        scheduler: consumeActiveSchedulerItem(state.scheduler),
        reviewProgress: removeKey(state.reviewProgress, reviewItem.id),
      }),
      commit: {
        type: 'commit-review-item-session',
        reviewItemId: reviewItem.id,
        failureCount: 0,
        terminalRating: rating,
      },
    };
  }

  const nextProgress: ReviewItemProgress = {
    failureCount: currentProgress.failureCount + (rating === 'forgot' ? 1 : 0),
    reinforcementStreak: rating === 'forgot' ? 0 : currentProgress.reinforcementStreak + 1,
  };

  if (nextProgress.reinforcementStreak >= 3) {
    return {
      state: finalizePostRatingState({
        ...state,
        answeredCount: state.answeredCount + 1,
        scheduler: consumeActiveSchedulerItem(state.scheduler),
        reviewProgress: removeKey(state.reviewProgress, reviewItem.id),
      }),
      commit: {
        type: 'commit-review-item-session',
        reviewItemId: reviewItem.id,
        failureCount: nextProgress.failureCount,
        terminalRating: null, // rating only needed when item recalled without failureCount of 0
      },
    };
  }

  return {
    state: finalizePostRatingState({
      ...state,
      answeredCount: state.answeredCount + 1,
      scheduler: rotateActiveSchedulerItem(state.scheduler),
      reviewProgress: {
        ...state.reviewProgress,
        [reviewItem.id]: nextProgress,
      },
    }),
    commit: { type: 'none' },
  };
}

function handleLearningAttempt(
  state: SessionState,
  item: SessionItemWithWord,
  word: Word,
  rating: ReviewRating,
): SessionTransitionResult {
  const currentProgress = state.learningProgress[word.id] ?? createInitialLearningProgress();
  const direction = item.reviewItem.direction;
  const nextProgress: LearningWordProgress = {
    coveredDirections: { ...currentProgress.coveredDirections },
    firstTryGood: { ...currentProgress.firstTryGood },
    attempts: { ...currentProgress.attempts },
  };

  nextProgress.attempts[direction] += 1;

  if (rating === 'good') {
    nextProgress.coveredDirections[direction] = true;
    if (nextProgress.attempts[direction] === 1) {
      nextProgress.firstTryGood[direction] = true;
    }
  }

  const bothCovered = nextProgress.coveredDirections.forward && nextProgress.coveredDirections.reverse;

  if (!bothCovered) {
    return {
      state: finalizePostRatingState({
        ...state,
        answeredCount: state.answeredCount + 1,
        scheduler:
          rating === 'good'
            ? consumeActiveSchedulerItem(state.scheduler)
            : rotateActiveSchedulerItem(state.scheduler),
        learningProgress: {
          ...state.learningProgress,
          [word.id]: nextProgress,
        },
      }),
      commit: { type: 'none' },
    };
  }

  return {
    state: finalizePostRatingState({
      ...state,
      answeredCount: state.answeredCount + 1,
      scheduler: consumeActiveSchedulerItem(state.scheduler),
      learningProgress: removeKey(state.learningProgress, word.id),
    }),
    commit: {
      type: 'commit-learning-word-session',
      wordId: word.id,
      success: nextProgress.firstTryGood.forward && nextProgress.firstTryGood.reverse,
    },
  };
}

function handleUnstudiedAttempt(
  state: SessionState,
  item: SessionItemWithWord,
  word: Word,
  rating: ReviewRating,
): SessionTransitionResult {
  const currentProgress = state.unstudiedProgress[word.id] ?? createInitialUnstudiedProgress();
  const direction = item.reviewItem.direction;
  const nextProgress: UnstudiedWordProgress = {
    introComplete: currentProgress.introComplete,
    consecutiveSuccesses: { ...currentProgress.consecutiveSuccesses },
  };

  if (rating === 'good') {
    nextProgress.consecutiveSuccesses[direction] += 1;
  } else {
    nextProgress.consecutiveSuccesses[direction] = 0;
  }

  const done =
    nextProgress.consecutiveSuccesses.forward >= 3 &&
    nextProgress.consecutiveSuccesses.reverse >= 3;

  if (!done) {
    const directionCovered = nextProgress.consecutiveSuccesses[direction] >= 3;
    const schedulerAfterCoverage = directionCovered
      ? removeUnstudiedCandidateByReviewItemId(state.scheduler, item.reviewItem.id)
      : state.scheduler;

    return {
      state: finalizePostRatingState({
        ...state,
        answeredCount: state.answeredCount + 1,
        scheduler: nextScheduler(schedulerAfterCoverage),
        unstudiedProgress: {
          ...state.unstudiedProgress,
          [word.id]: nextProgress,
        },
      }),
      commit: { type: 'none' },
    };
  }

  return {
      state: finalizePostRatingState({
        ...state,
        answeredCount: state.answeredCount + 1,
        scheduler: removeSchedulerWord(state.scheduler, word.id, word.status).scheduler,
        unstudiedProgress: removeKey(state.unstudiedProgress, word.id),
      }),
    commit: {
      type: 'commit-unstudied-word-session',
      wordId: word.id,
    },
  };
}

export function createInitialLearningProgress(): LearningWordProgress {
  return {
    coveredDirections: {
      forward: false,
      reverse: false,
    },
    firstTryGood: {
      forward: false,
      reverse: false,
    },
    attempts: {
      forward: 0,
      reverse: 0,
    },
  };
}

export function createInitialUnstudiedProgress(): UnstudiedWordProgress {
  return {
    introComplete: false,
    consecutiveSuccesses: {
      forward: 0,
      reverse: 0,
    },
  };
}

function removeKey<T>(record: Record<string, T>, key: string) {
  const copy = { ...record };
  delete copy[key];
  return copy;
}

function finalizePostRatingState(state: SessionState): SessionState {
  if ((state.phase === 'active' || state.phase === 'draining') && getSchedulerLength(state.scheduler) === 0) {
    return {
      ...state,
      phase: 'completed',
    };
  }

  return state;
}

function assertCurrentItemStarted(state: SessionState, currentItem: SessionItemWithWord, rating: ReviewRating) {
  if (state.startedItemIds.includes(currentItem.reviewItem.id)) {
    return;
  }

  const debugInfo = {
    message: 'Attempted to rate a session item before it was marked started',
    rating,
    currentItemId: currentItem.reviewItem.id,
    currentWordId: currentItem.word.id,
    queueIds: getSchedulerItems(state.scheduler).map((item) => item.reviewItem.id),
    startedItemIds: state.startedItemIds,
    answeredCount: state.answeredCount,
    phase: state.phase,
  };

  console.error('[session-state] invariant failed', debugInfo);
  throw new Error('Session invariant violated: current item must be marked started before rating.');
}

function assertCurrentItemPresent(state: SessionState, rating: ReviewRating): never {
  const debugInfo = {
    message: 'Attempted to rate a session item when the active queue was empty',
    rating,
    queueIds: getSchedulerItems(state.scheduler).map((item) => item.reviewItem.id),
    startedItemIds: state.startedItemIds,
    answeredCount: state.answeredCount,
    phase: state.phase,
  };

  console.error('[session-state] invariant failed', debugInfo);
  throw new Error('Session invariant violated: cannot rate the current item when the queue is empty.');
}

function assertDrainablePhase(state: SessionState) {
  if (state.phase === 'active') {
    return;
  }

  const debugInfo = {
    message: 'Attempted to begin drain mode from a non-active session phase',
    phase: state.phase,
    queueIds: getSchedulerItems(state.scheduler).map((item) => item.reviewItem.id),
    startedItemIds: state.startedItemIds,
    answeredCount: state.answeredCount,
  };

  console.error('[session-state] invariant failed', debugInfo);
  throw new Error(`Session invariant violated: cannot begin drain mode from phase "${state.phase}".`);
}

function assertUnreachableWordStatus(
  state: SessionState,
  currentItem: ReviewItem,
  currentWord: Word,
  rating: ReviewRating,
): never {
  const debugInfo = {
    message: 'Attempted to rate a session item whose word had an unsupported status',
    rating,
    currentItemId: currentItem.id,
    currentWordId: currentItem.wordId,
    currentWordStatus: currentWord.status,
    queueIds: getSchedulerItems(state.scheduler).map((item) => item.reviewItem.id),
    startedItemIds: state.startedItemIds,
    answeredCount: state.answeredCount,
    phase: state.phase,
  };

  console.error('[session-state] invariant failed', debugInfo);
  throw new Error(`Session invariant violated: unsupported current word status "${currentWord.status}".`);
}
