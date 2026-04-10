import type { ReviewItem, ReviewRating, Word } from '../types';

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

export type SessionPhase = 'active';

export type SessionState = {
  phase: SessionPhase;
  queue: ReviewItem[];
  answeredCount: number;
  startedItemIds: string[];
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

export function createSessionState(items: ReviewItem[]): SessionState {
  return {
    phase: 'active',
    queue: items,
    answeredCount: 0,
    startedItemIds: [],
    learningProgress: {},
    unstudiedProgress: {},
    reviewProgress: {},
  };
}

export function markCurrentItemStarted(state: SessionState): SessionState {
  const currentItem = state.queue[0];
  if (!currentItem || state.startedItemIds.includes(currentItem.id)) {
    return state;
  }

  return {
    ...state,
    startedItemIds: [...state.startedItemIds, currentItem.id],
  };
}

export function beginUnstudiedDrill(state: SessionState, wordId: string): SessionState {
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

export function rateCurrentItem(
  state: SessionState,
  wordsById: Map<string, Word>,
  rating: ReviewRating,
): SessionTransitionResult {
  const currentItem = state.queue[0] ?? assertCurrentItemPresent(state, rating);

  assertCurrentItemStarted(state, currentItem, rating);

  const currentWord = wordsById.get(currentItem.wordId) ?? assertCurrentWordPresent(state, currentItem, rating);

  switch (currentWord.status) {
    case 'review':
      return handleReviewAttempt(state, currentItem, rating);
    case 'learning':
      return handleLearningAttempt(state, currentItem, currentWord, rating);
    case 'unstudied':
      return handleUnstudiedAttempt(state, currentItem, currentWord, rating);
    default:
      return assertUnreachableWordStatus(state, currentItem, currentWord, rating);
  }
}

function handleReviewAttempt(
  state: SessionState,
  item: ReviewItem,
  rating: ReviewRating,
): SessionTransitionResult {
  const currentProgress = state.reviewProgress[item.id] ?? { failureCount: 0, reinforcementStreak: 0 };

  if (currentProgress.failureCount === 0 && rating !== 'forgot') {
    return {
      state: {
        ...state,
        answeredCount: state.answeredCount + 1,
        queue: state.queue.filter((queuedItem) => queuedItem.id !== item.id),
        reviewProgress: removeKey(state.reviewProgress, item.id),
      },
      commit: {
        type: 'commit-review-item-session',
        reviewItemId: item.id,
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
      state: {
        ...state,
        answeredCount: state.answeredCount + 1,
        queue: state.queue.filter((queuedItem) => queuedItem.id !== item.id),
        reviewProgress: removeKey(state.reviewProgress, item.id),
      },
      commit: {
        type: 'commit-review-item-session',
        reviewItemId: item.id,
        failureCount: nextProgress.failureCount,
        terminalRating: null, // rating only needed when item recalled without failureCount of 0
      },
    };
  }

  return {
    state: {
      ...state,
      answeredCount: state.answeredCount + 1,
      queue: rotateCurrentItem(state.queue),
      reviewProgress: {
        ...state.reviewProgress,
        [item.id]: nextProgress,
      },
    },
    commit: { type: 'none' },
  };
}

function handleLearningAttempt(
  state: SessionState,
  item: ReviewItem,
  word: Word,
  rating: ReviewRating,
): SessionTransitionResult {
  const currentProgress = state.learningProgress[word.id] ?? createInitialLearningProgress();
  const direction = item.direction;
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
      state: {
        ...state,
        answeredCount: state.answeredCount + 1,
        queue: rating === 'good' ? state.queue.slice(1) : appendCurrentItem(state.queue),
        learningProgress: {
          ...state.learningProgress,
          [word.id]: nextProgress,
        },
      },
      commit: { type: 'none' },
    };
  }

  return {
    state: {
      ...state,
      answeredCount: state.answeredCount + 1,
      queue: state.queue.filter((queuedItem) => queuedItem.wordId !== word.id),
      learningProgress: removeKey(state.learningProgress, word.id),
    },
    commit: {
      type: 'commit-learning-word-session',
      wordId: word.id,
      success: nextProgress.firstTryGood.forward && nextProgress.firstTryGood.reverse,
    },
  };
}

function handleUnstudiedAttempt(
  state: SessionState,
  item: ReviewItem,
  word: Word,
  rating: ReviewRating,
): SessionTransitionResult {
  const currentProgress = state.unstudiedProgress[word.id] ?? createInitialUnstudiedProgress();
  const direction = item.direction;
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

    return {
      state: {
        ...state,
        answeredCount: state.answeredCount + 1,
        queue: directionCovered
          ? state.queue.filter((queuedItem) => queuedItem.id !== item.id)
          : rotateCurrentItem(state.queue),
        unstudiedProgress: {
          ...state.unstudiedProgress,
          [word.id]: nextProgress,
        },
      },
      commit: { type: 'none' },
    };
  }

  return {
    state: {
      ...state,
      answeredCount: state.answeredCount + 1,
      queue: state.queue.filter((queuedItem) => queuedItem.wordId !== word.id),
      unstudiedProgress: removeKey(state.unstudiedProgress, word.id),
    },
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

function rotateCurrentItem(items: ReviewItem[]) {
  if (items.length <= 1) {
    return items;
  }

  return [...items.slice(1), items[0]];
}

function appendCurrentItem(items: ReviewItem[]) {
  if (items.length <= 1) {
    return items;
  }

  const [currentItem, ...remaining] = items;
  return [...remaining, currentItem];
}

function removeKey<T>(record: Record<string, T>, key: string) {
  const copy = { ...record };
  delete copy[key];
  return copy;
}

function assertCurrentItemStarted(state: SessionState, currentItem: ReviewItem, rating: ReviewRating) {
  if (state.startedItemIds.includes(currentItem.id)) {
    return;
  }

  const debugInfo = {
    message: 'Attempted to rate a session item before it was marked started',
    rating,
    currentItemId: currentItem.id,
    currentWordId: currentItem.wordId,
    queueIds: state.queue.map((item) => item.id),
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
    queueIds: state.queue.map((item) => item.id),
    startedItemIds: state.startedItemIds,
    answeredCount: state.answeredCount,
    phase: state.phase,
  };

  console.error('[session-state] invariant failed', debugInfo);
  throw new Error('Session invariant violated: cannot rate the current item when the queue is empty.');
}

function assertCurrentWordPresent(
  state: SessionState,
  currentItem: ReviewItem,
  rating: ReviewRating,
): never {
  const debugInfo = {
    message: 'Attempted to rate a session item whose word record was missing from the session word map',
    rating,
    currentItemId: currentItem.id,
    currentWordId: currentItem.wordId,
    queueIds: state.queue.map((item) => item.id),
    startedItemIds: state.startedItemIds,
    answeredCount: state.answeredCount,
    phase: state.phase,
  };

  console.error('[session-state] invariant failed', debugInfo);
  throw new Error('Session invariant violated: current item references a missing word record.');
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
    queueIds: state.queue.map((item) => item.id),
    startedItemIds: state.startedItemIds,
    answeredCount: state.answeredCount,
    phase: state.phase,
  };

  console.error('[session-state] invariant failed', debugInfo);
  throw new Error(`Session invariant violated: unsupported current word status "${currentWord.status}".`);
}
