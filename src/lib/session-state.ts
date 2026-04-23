import type { ReviewItem, ReviewRating, SessionItemWithWord, Word } from '../types';

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

type SessionQueueNode = {
  item: SessionItemWithWord;
  next: SessionQueueNode | null;
};

export type SessionQueue = {
  head: SessionQueueNode | null;
  tail: SessionQueueNode | null;
  length: number;
};

export type SessionState = {
  phase: SessionPhase;
  queue: SessionQueue;
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

export function createSessionState(items: SessionItemWithWord[]): SessionState {
  return {
    phase: 'active',
    queue: createSessionQueue(items),
    answeredCount: 0,
    startedItemIds: [],
    dismissedWordIds: [],
    learningProgress: {},
    unstudiedProgress: {},
    reviewProgress: {},
  };
}

export function createSessionQueue(items: SessionItemWithWord[]): SessionQueue {
  if (items.length === 0) {
    return {
      head: null,
      tail: null,
      length: 0,
    };
  }

  let head: SessionQueueNode | null = null;
  let tail: SessionQueueNode | null = null;

  for (const item of items) {
    const node: SessionQueueNode = { item, next: null };
    if (!head) {
      head = node;
      tail = node;
      continue;
    }

    tail!.next = node;
    tail = node;
  }

  return {
    head,
    tail,
    length: items.length,
  };
}

export function getCurrentQueueItem(queue: SessionQueue): SessionItemWithWord | undefined {
  return queue.head?.item;
}

export function getQueueItems(queue: SessionQueue): SessionItemWithWord[] {
  const items: SessionItemWithWord[] = [];
  let currentNode = queue.head;

  while (currentNode) {
    items.push(currentNode.item);
    currentNode = currentNode.next;
  }

  return items;
}

export function markCurrentItemStarted(state: SessionState): SessionState {
  const currentItem = getCurrentQueueItem(state.queue);
  if (!currentItem || state.startedItemIds.includes(currentItem.reviewItem.id)) {
    return state;
  }

  return {
    ...state,
    startedItemIds: [...state.startedItemIds, currentItem.reviewItem.id],
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

export function dismissCurrentItemFromSession(state: SessionState): SessionDismissTransitionResult {
  const currentItem = getCurrentQueueItem(state.queue);

  if (!currentItem) {
    return {
      state,
      dismiss: { type: 'none' },
    };
  }

  const dismissedWordId = currentItem.word.id;
  const dismissedReviewItemIds: Record<string, true> = {};
  let nextHead = state.queue.head;
  let nextTail = state.queue.tail;
  let nextLength = state.queue.length;
  let previousNode: SessionQueueNode | null = null;
  let currentNode = state.queue.head;

  // One-pass queue pruning: only unlink nodes that match the dismissed word id.
  while (currentNode) {
    const nextNode = currentNode.next;
    const shouldDismiss = currentNode.item.word.id === dismissedWordId;

    if (!shouldDismiss) {
      previousNode = currentNode;
      currentNode = nextNode;
      continue;
    }

    dismissedReviewItemIds[currentNode.item.reviewItem.id] = true;
    nextLength -= 1;

    // previousNodeNull is the special case when we need to remove the head
    // which actually is every time given the semantics of dismissing the current item,
    // that said no need to be overly fancy
    if (previousNode) {
      previousNode.next = nextNode;
    } else {
      nextHead = nextNode;
    }

    if (currentNode === nextTail) {
      nextTail = previousNode;
    }

    currentNode.next = null;
    currentNode = nextNode;
  }

  const nextReviewProgress = Object.fromEntries(
    Object.entries(state.reviewProgress).filter(([reviewItemId]) => dismissedReviewItemIds[reviewItemId] !== true),
  );

  const nextState: SessionState = {
    ...state,
    phase: nextLength === 0 ? 'completed' : state.phase,
    queue: {
      head: nextHead,
      tail: nextTail,
      length: nextLength,
    },
    startedItemIds: state.startedItemIds.filter((reviewItemId) => dismissedReviewItemIds[reviewItemId] !== true),
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
  const queueItems = getQueueItems(state.queue);
  const filteredQueue = queueItems.filter((item, index) => {
    if (index === 0 && state.startedItemIds.includes(item.reviewItem.id)) {
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
    phase: filteredQueue.length === 0 ? 'completed' : 'draining',
    queue: createSessionQueue(filteredQueue),
  };
}

export function rateCurrentItem(
  state: SessionState,
  rating: ReviewRating,
): SessionTransitionResult {
  const currentItem = getCurrentQueueItem(state.queue) ?? assertCurrentItemPresent(state, rating);

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
        queue: dequeueCurrentItem(state.queue),
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
        queue: dequeueCurrentItem(state.queue),
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
      queue: rotateCurrentItem(state.queue),
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
        queue: rating === 'good' ? dequeueCurrentItem(state.queue) : rotateCurrentItem(state.queue),
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
      queue: dequeueCurrentItem(state.queue),
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

    return {
      state: finalizePostRatingState({
        ...state,
        answeredCount: state.answeredCount + 1,
        queue: directionCovered
          ? dequeueCurrentItem(state.queue)
          : rotateCurrentItem(state.queue),
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
      queue: dequeueCurrentItem(state.queue),
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

function dequeueCurrentItem(queue: SessionQueue): SessionQueue {
  if (queue.length === 0) {
    return queue;
  }

  const currentHead = queue.head;
  if (!currentHead) {
    return queue;
  }

  queue.head = currentHead.next;
  if (queue.head === null) {
    queue.tail = null;
  }
  queue.length -= 1;

  currentHead.next = null;
  return queue;
}

function rotateCurrentItem(queue: SessionQueue): SessionQueue {
  if (queue.length <= 1) {
    return queue;
  }

  const currentHead = queue.head;
  const currentTail = queue.tail;
  if (!currentHead || !currentTail || !currentHead.next) {
    return queue;
  }

  queue.head = currentHead.next;
  currentHead.next = null;
  currentTail.next = currentHead;
  queue.tail = currentHead;

  return queue;
}

function removeKey<T>(record: Record<string, T>, key: string) {
  const copy = { ...record };
  delete copy[key];
  return copy;
}

function finalizePostRatingState(state: SessionState): SessionState {
  if ((state.phase === 'active' || state.phase === 'draining') && state.queue.length === 0) {
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
    queueIds: getQueueItems(state.queue).map((item) => item.reviewItem.id),
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
    queueIds: getQueueItems(state.queue).map((item) => item.reviewItem.id),
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
    queueIds: getQueueItems(state.queue).map((item) => item.reviewItem.id),
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
    queueIds: getQueueItems(state.queue).map((item) => item.reviewItem.id),
    startedItemIds: state.startedItemIds,
    answeredCount: state.answeredCount,
    phase: state.phase,
  };

  console.error('[session-state] invariant failed', debugInfo);
  throw new Error(`Session invariant violated: unsupported current word status "${currentWord.status}".`);
}
