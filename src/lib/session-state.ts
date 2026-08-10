import type { ReviewRating, Word } from '../types';
import type {
  ProductionResponseResolution,
  SessionStudyItemBuckets,
  StudyAttemptEvent,
  StudySkillId,
} from '../domain/study-actions';
import {
  createBucketSessionScheduler,
  createInitialBucketLearningProgress,
  createInitialBucketUnstudiedProgress,
  getBucketSchedulerActiveUnit,
  getBucketSchedulerBucketCounts,
  getBucketSchedulerCandidateWordIds,
  pruneBucketSchedulerWords,
  removeBucketSchedulerWord,
  syncBucketScheduler,
  type ActiveBucketSchedulerUnit,
  type BucketSchedulerLearningProgress,
  type BucketSchedulerProgress,
  type BucketSchedulerUnstudiedProgress,
  type BucketSessionScheduler,
  type BucketSessionSchedulerPolicy,
} from './session-scheduler';

type Direction = 'forward' | 'reverse';

export type LearningWordProgress = {
  coveredDirections: Record<Direction, boolean>;
  firstTryGood: Record<Direction, boolean>;
  attempts: Record<Direction, number>;
};

export type UnstudiedWordProgress = {
  introComplete: boolean;
  consecutiveSuccesses: Record<Direction, number>;
};

export type ReviewActionProgress = {
  failureCount: number;
  reinforcementStreak: number;
  attempts: StudyAttemptEvent[];
};

export type SessionPhase = 'active' | 'draining' | 'completed';

type ReviewStudySkillId = Extract<StudySkillId, 'recognition' | 'production'>;
type ContrastSelectionRating = ReviewRating;

export type BucketSessionState = {
  sessionId: string;
  phase: SessionPhase;
  scheduler: BucketSessionScheduler;
  answeredCount: number;
  startedActionIds: string[];
  progress: BucketSchedulerProgress;
  reviewProgress: Record<string, ReviewActionProgress>;
};

export type BucketSessionCommitIntent =
  | { type: 'none' }
  | {
      type: 'commit-review-action-session';
      sessionId: string;
      sessionActionId: string;
      targetWordId: string;
      actionKind: Extract<StudyAttemptEvent['actionKind'], 'recognition' | 'production'>;
      sampledSkillIds: ReviewStudySkillId[];
      failureCount: number;
      terminalRating: 'hard' | 'good' | 'easy' | null;
      events: StudyAttemptEvent[];
    }
  | {
      type: 'commit-contrast-selection-action-session';
      sessionId: string;
      sessionActionId: string;
      targetWordId: string;
      actionKind: 'contrast_selection';
      sampledSkillIds: ['contextual_selection'];
      selectedWordId: string;
      promptTargetWordId: string;
      choiceWordIds: string[];
      rating: ContrastSelectionRating;
      practiceMore: boolean;
      event: StudyAttemptEvent;
    }
  | { type: 'commit-learning-word-session'; wordId: string; success: boolean }
  | { type: 'commit-unstudied-word-session'; wordId: string };

export type BucketSessionTransitionResult = {
  state: BucketSessionState;
  commit: BucketSessionCommitIntent;
};

export type RateActiveSessionUnitOptions = {
  /**
   * The learner's response exactly as entered. This is currently meaningful
   * only for typed production actions; other action kinds keep a null response.
   */
  response?: string | null;
  productionResponse?: ProductionResponseResolution | null;
};

export type SessionDismissIntent =
  | { type: 'none' }
  | {
      type: 'dismiss-word-from-study';
      wordId: string;
      status: Word['status'];
    };

export type SessionDismissTransitionResult = {
  state: BucketSessionState;
  dismiss: SessionDismissIntent;
};

export type BucketSessionDismissTransitionResult = SessionDismissTransitionResult;

export function createBucketSessionState({
  buckets,
  sessionId,
  schedulerPolicy,
  seed,
}: {
  buckets: SessionStudyItemBuckets;
  sessionId: string;
  schedulerPolicy?: Partial<BucketSessionSchedulerPolicy>;
  seed?: number;
}): BucketSessionState {
  const progress: BucketSchedulerProgress = {
    learning: {},
    unstudied: {},
  };

  return {
    sessionId,
    phase: 'active',
    scheduler: createBucketSessionScheduler({
      buckets,
      policy: schedulerPolicy,
      progress,
      seed,
    }),
    answeredCount: 0,
    startedActionIds: [],
    progress,
    reviewProgress: {},
  };
}

export function getActiveSessionUnit(state: BucketSessionState): ActiveBucketSchedulerUnit {
  return getBucketSchedulerActiveUnit(state.scheduler);
}

export function getBucketSessionProgress(state: BucketSessionState): BucketSchedulerProgress {
  return state.progress;
}

export function getBucketSessionUnitCounts(state: BucketSessionState) {
  return getBucketSchedulerBucketCounts(state.scheduler, state.progress);
}

export function getBucketSessionCandidateWordIds(
  state: BucketSessionState,
  bucket: 'learning' | 'unstudied',
): string[] {
  return getBucketSchedulerCandidateWordIds(state.scheduler, bucket, state.progress);
}

export function markActiveSessionUnitStarted(state: BucketSessionState): BucketSessionState {
  const active = getActiveSessionUnit(state);
  if (active.type !== 'study') {
    return state;
  }

  if (state.startedActionIds.includes(active.item.sessionActionId)) {
    return state;
  }

  return {
    ...state,
    startedActionIds: [...state.startedActionIds, active.item.sessionActionId],
  };
}

export function completeActiveUnstudiedIntro(state: BucketSessionState): BucketSessionTransitionResult {
  const active = getActiveSessionUnit(state);

  if (active.type !== 'unstudied_intro') {
    throw new Error('Session invariant violated: cannot complete an unstudied intro when the active unit is not an intro.');
  }

  const wordId = active.word.id;
  const currentProgress = state.progress.unstudied[wordId] ?? createInitialBucketUnstudiedProgress();
  const progress = {
    ...state.progress,
    unstudied: {
      ...state.progress.unstudied,
      [wordId]: {
        ...currentProgress,
        introComplete: true,
      },
    },
  };

  return {
    state: refreshBucketSessionScheduler({
      ...state,
      progress,
    }),
    commit: { type: 'none' },
  };
}

export function rateActiveSessionUnit(
  state: BucketSessionState,
  rating: ReviewRating,
  options: RateActiveSessionUnitOptions = {},
): BucketSessionTransitionResult {
  const active = getActiveSessionUnit(state);
  if (active.type !== 'study') {
    throw new Error('Session invariant violated: cannot rate an unstudied intro unit.');
  }

  assertActiveSessionUnitStarted(state, active, rating);

  switch (active.bucket) {
    case 'learning':
      return handleBucketLearningAttempt(state, active, rating);
    case 'unstudied':
      return handleBucketUnstudiedAttempt(state, active, rating);
    case 'review':
      if (active.item.actionKind === 'contrast_selection') {
        throw new Error('Session invariant violated: contrast selection must be completed with a selected choice.');
      }
      return handleBucketReviewAttempt(
        state,
        active,
        rating,
        options.response ?? null,
        options.productionResponse ?? null,
      );
    default:
      return assertUnreachableBucket(active.bucket);
  }
}

export function rateActiveContrastSelectionUnit({
  state,
  selectedWordId,
  rating,
  practiceMore,
}: {
  state: BucketSessionState;
  selectedWordId: string;
  rating: ContrastSelectionRating;
  practiceMore: boolean;
}): BucketSessionTransitionResult {
  const active = getActiveSessionUnit(state);
  if (active.type !== 'study' || active.bucket !== 'review' || active.item.actionKind !== 'contrast_selection') {
    throw new Error('Session invariant violated: cannot complete contrast selection when the active unit is not contrast review.');
  }

  assertActiveSessionUnitStarted(state, active, rating);

  const item = active.item;
  const contrastSelection = item.contrastSelection;
  if (!contrastSelection) {
    throw new Error('Session invariant violated: contrast selection review item is missing contrast content.');
  }

  const choiceWordIds = contrastSelection.choices.map((choice) => choice.word.id);
  if (!choiceWordIds.includes(selectedWordId)) {
    throw new Error('Session invariant violated: selected contrast choice is not part of the active contrast item.');
  }

  const selectedCorrect = selectedWordId === contrastSelection.promptTargetWordId;
  if (selectedCorrect && rating === 'forgot') {
    throw new Error('Session invariant violated: correct contrast selection must use a passing rating.');
  }
  if (!selectedCorrect && rating !== 'forgot') {
    throw new Error('Session invariant violated: incorrect contrast selection must be rated forgot.');
  }

  const event = buildContrastSelectionAttemptEvent({
    state,
    item,
    selectedWordId,
    rating,
    practiceMore,
  });

  return {
    state: refreshBucketSessionScheduler({
      ...state,
      answeredCount: state.answeredCount + 1,
      scheduler: removeCompletedReviewAction(state.scheduler),
      reviewProgress: removeKey(state.reviewProgress, item.sessionActionId),
    }),
    commit: {
      type: 'commit-contrast-selection-action-session',
      sessionId: state.sessionId,
      sessionActionId: item.sessionActionId,
      targetWordId: item.targetWordId,
      actionKind: 'contrast_selection',
      sampledSkillIds: ['contextual_selection'],
      selectedWordId,
      promptTargetWordId: contrastSelection.promptTargetWordId,
      choiceWordIds,
      rating,
      practiceMore,
      event,
    },
  };
}

export function beginBucketDrainSession(state: BucketSessionState): BucketSessionState {
  assertBucketDrainablePhase(state);

  const openLearningWordIds = new Set(Object.keys(state.progress.learning));
  const openUnstudiedWordIds = new Set(Object.keys(state.progress.unstudied));
  const openReviewActionIds = new Set(Object.keys(state.reviewProgress));
  const scheduler = pruneBucketSchedulerWords(state.scheduler, (unit) => {
    if (unit.type === 'study' && unit.bucket === 'review') {
      return openReviewActionIds.has(unit.item.sessionActionId);
    }

    if (unit.type !== 'candidate_word') {
      return false;
    }

    if (unit.bucket === 'learning') {
      return openLearningWordIds.has(unit.word.id);
    }

    return openUnstudiedWordIds.has(unit.word.id);
  });

  return refreshBucketSessionScheduler({
    ...state,
    phase: 'draining',
    scheduler,
  });
}

export function dismissActiveBucketSessionUnit(state: BucketSessionState): BucketSessionDismissTransitionResult {
  const active = getActiveSessionUnit(state);
  const word = active.type === 'unstudied_intro' ? active.word : active.item.word;
  const scheduler =
    word.status === 'review'
      ? removeCompletedReviewAction(state.scheduler)
      : removeBucketSchedulerWord(state.scheduler, word.status, word.id);
  const nextState = refreshBucketSessionScheduler({
    ...state,
    scheduler,
    progress: {
      learning: removeKey(state.progress.learning, word.id),
      unstudied: removeKey(state.progress.unstudied, word.id),
    },
    reviewProgress: removeReviewProgressForWord(state.reviewProgress, word.id, state.scheduler.reviewQueue),
  });

  return {
    state: {
      ...nextState,
      phase: getBucketSessionTotalCount(nextState) === 0 ? 'completed' : nextState.phase,
    },
    dismiss: {
      type: 'dismiss-word-from-study',
      wordId: word.id,
      status: word.status,
    },
  };
}

export function dropActiveReviewSessionAction(state: BucketSessionState): BucketSessionState {
  const active = getActiveSessionUnit(state);
  if (active.type !== 'study' || active.bucket !== 'review') {
    throw new Error('Session invariant violated: cannot drop active review action when the active unit is not review.');
  }

  const nextState = refreshBucketSessionScheduler({
    ...state,
    scheduler: removeCompletedReviewAction(state.scheduler),
    reviewProgress: removeReviewProgressForWord(state.reviewProgress, active.item.word.id, state.scheduler.reviewQueue),
  });

  return {
    ...nextState,
    phase: getBucketSessionTotalCount(nextState) === 0 ? 'completed' : nextState.phase,
  };
}

export function cancelRatedReviewSessionAction(state: BucketSessionState, sessionActionId: string): BucketSessionState {
  const actionExists =
    state.scheduler.reviewQueue.some((item) => item.sessionActionId === sessionActionId) ||
    state.reviewProgress[sessionActionId] !== undefined;

  if (!actionExists) {
    throw new Error(`Session invariant violated: review action "${sessionActionId}" is not in the active session.`);
  }

  const nextState = refreshBucketSessionScheduler({
    ...state,
    answeredCount: Math.max(0, state.answeredCount - 1),
    scheduler: {
      ...state.scheduler,
      reviewQueue: state.scheduler.reviewQueue.filter((item) => item.sessionActionId !== sessionActionId),
    },
    reviewProgress: removeKey(state.reviewProgress, sessionActionId),
  });

  return {
    ...nextState,
    phase: getBucketSessionTotalCount(nextState) === 0 ? 'completed' : nextState.phase,
  };
}

export function dismissBucketSessionWordFromSnapshot(state: BucketSessionState, wordId: string): BucketSessionState {
  const nextReviewProgress = Object.fromEntries(
    Object.entries(state.reviewProgress).filter(([, progress]) => progress.attempts[0]?.targetWordId !== wordId),
  );
  const nextState = refreshBucketSessionScheduler({
    ...state,
    scheduler: {
      ...state.scheduler,
      reviewQueue: state.scheduler.reviewQueue.filter((item) => item.targetWordId !== wordId),
      learningPool: state.scheduler.learningPool.filter((word) => word.id !== wordId),
      unstudiedPool: state.scheduler.unstudiedPool.filter((word) => word.id !== wordId),
    },
    progress: {
      learning: removeKey(state.progress.learning, wordId),
      unstudied: removeKey(state.progress.unstudied, wordId),
    },
    reviewProgress: nextReviewProgress,
  });

  return {
    ...nextState,
    phase: getBucketSessionTotalCount(nextState) === 0 ? 'completed' : nextState.phase,
  };
}

function removeReviewProgressForWord(
  reviewProgress: Record<string, ReviewActionProgress>,
  wordId: string,
  reviewQueue: BucketSessionScheduler['reviewQueue'],
) {
  const actionIdsForWord = new Set(
    reviewQueue
      .filter((item) => item.targetWordId === wordId)
      .map((item) => item.sessionActionId),
  );

  return Object.fromEntries(
    Object.entries(reviewProgress).filter(([sessionActionId]) => !actionIdsForWord.has(sessionActionId)),
  );
}

function handleBucketLearningAttempt(
  state: BucketSessionState,
  active: Extract<ActiveBucketSchedulerUnit, { type: 'study' }>,
  rating: ReviewRating,
): BucketSessionTransitionResult {
  const wordId = active.item.targetWordId;
  const skillId = onlyReviewStudySkill(active.item.sampledSkillIds[0]);
  const currentProgress = state.progress.learning[wordId] ?? createInitialBucketLearningProgress();
  const nextProgress: BucketSchedulerLearningProgress = {
    coveredSkills: { ...currentProgress.coveredSkills },
    firstTryGood: { ...currentProgress.firstTryGood },
    attempts: { ...currentProgress.attempts },
  };

  nextProgress.attempts[skillId] += 1;

  if (rating === 'good') {
    nextProgress.coveredSkills[skillId] = true;
    if (nextProgress.attempts[skillId] === 1) {
      nextProgress.firstTryGood[skillId] = true;
    }
  }

  const bothCovered = nextProgress.coveredSkills.recognition && nextProgress.coveredSkills.production;

  if (bothCovered) {
    const progress = {
      ...state.progress,
      learning: removeKey(state.progress.learning, wordId),
    };
    return {
      state: refreshBucketSessionScheduler({
        ...state,
        answeredCount: state.answeredCount + 1,
        progress,
        scheduler: removeBucketSchedulerWord(state.scheduler, 'learning', wordId),
      }),
      commit: {
        type: 'commit-learning-word-session',
        wordId,
        success: nextProgress.firstTryGood.recognition && nextProgress.firstTryGood.production,
      },
    };
  }

  const progress = {
    ...state.progress,
    learning: {
      ...state.progress.learning,
      [wordId]: nextProgress,
    },
  };

  return {
    state: refreshBucketSessionScheduler({
      ...state,
      answeredCount: state.answeredCount + 1,
      progress,
    }),
    commit: { type: 'none' },
  };
}

function handleBucketReviewAttempt(
  state: BucketSessionState,
  active: Extract<ActiveBucketSchedulerUnit, { type: 'study' }>,
  rating: ReviewRating,
  response: string | null,
  productionResponse: ProductionResponseResolution | null,
): BucketSessionTransitionResult {
  const item = active.item;
  const currentProgress = state.reviewProgress[item.sessionActionId] ?? createInitialReviewProgress();
  const attemptEvent = buildBucketReviewAttemptEvent({
    state,
    item,
    rating,
    actionAttemptSequence: currentProgress.attempts.length + 1,
    response,
    productionResponse,
  });
  const nextAttempts = [...currentProgress.attempts, attemptEvent];

  if (currentProgress.failureCount === 0 && rating !== 'forgot') {
    return {
      state: refreshBucketSessionScheduler({
        ...state,
        answeredCount: state.answeredCount + 1,
        scheduler: removeCompletedReviewAction(state.scheduler),
        reviewProgress: removeKey(state.reviewProgress, item.sessionActionId),
      }),
      commit: {
        type: 'commit-review-action-session',
        sessionId: state.sessionId,
        sessionActionId: item.sessionActionId,
        targetWordId: item.targetWordId,
        actionKind: item.actionKind as Extract<StudyAttemptEvent['actionKind'], 'recognition' | 'production'>,
        sampledSkillIds: item.sampledSkillIds.map(onlyReviewStudySkill),
        failureCount: 0,
        terminalRating: rating,
        events: nextAttempts,
      },
    };
  }

  const nextProgress: ReviewActionProgress = {
    failureCount: currentProgress.failureCount + (rating === 'forgot' ? 1 : 0),
    reinforcementStreak: rating === 'forgot' ? 0 : currentProgress.reinforcementStreak + 1,
    attempts: nextAttempts,
  };

  if (nextProgress.reinforcementStreak >= 3) {
    return {
      state: refreshBucketSessionScheduler({
        ...state,
        answeredCount: state.answeredCount + 1,
        scheduler: removeCompletedReviewAction(state.scheduler),
        reviewProgress: removeKey(state.reviewProgress, item.sessionActionId),
      }),
      commit: {
        type: 'commit-review-action-session',
        sessionId: state.sessionId,
        sessionActionId: item.sessionActionId,
        targetWordId: item.targetWordId,
        actionKind: item.actionKind as Extract<StudyAttemptEvent['actionKind'], 'recognition' | 'production'>,
        sampledSkillIds: item.sampledSkillIds.map(onlyReviewStudySkill),
        failureCount: nextProgress.failureCount,
        terminalRating: null,
        events: nextAttempts,
      },
    };
  }

  return {
    state: refreshBucketSessionScheduler({
      ...state,
      answeredCount: state.answeredCount + 1,
      scheduler: rotateActiveReviewAction(state.scheduler),
      reviewProgress: {
        ...state.reviewProgress,
        [item.sessionActionId]: nextProgress,
      },
    }),
    commit: { type: 'none' },
  };
}

function buildBucketReviewAttemptEvent({
  state,
  item,
  rating,
  actionAttemptSequence,
  response,
  productionResponse,
}: {
  state: BucketSessionState;
  item: Extract<ActiveBucketSchedulerUnit, { type: 'study' }>['item'];
  rating: ReviewRating;
  actionAttemptSequence: number;
  response: string | null;
  productionResponse: ProductionResponseResolution | null;
}): StudyAttemptEvent {
  const metadata = item.actionKind === 'production'
    ? buildProductionAttemptMetadata(item, response, rating, productionResponse)
    : {};
  return {
    id: `${state.sessionId}/${item.sessionActionId}/attempt-${actionAttemptSequence}`,
    occurredAt: new Date().toISOString(),
    sessionId: state.sessionId,
    sessionActionId: item.sessionActionId,
    sessionEventSequence: state.answeredCount + 1,
    actionAttemptSequence,
    actionKind: item.actionKind,
    targetWordId: item.targetWordId,
    sampledSkillIds: [...item.sampledSkillIds],
    response: item.actionKind === 'production' ? response : null,
    outcome: rating === 'forgot' ? 'incorrect' : 'correct',
    rating,
    contentRef: item.contentRef,
    metadata,
  };
}

function buildProductionAttemptMetadata(
  item: Extract<ActiveBucketSchedulerUnit, { type: 'study' }>['item'],
  response: string | null,
  rating: ReviewRating,
  resolution: ProductionResponseResolution | null,
): Record<string, unknown> {
  const production = item.production;
  if (!production || !resolution) {
    throw new Error('Session invariant violated: review production attempt is missing its frozen response evidence.');
  }
  if (resolution.responseKind !== 'no_clue' && resolution.submittedText !== response) {
    throw new Error('Session invariant violated: production response evidence does not match the submitted response.');
  }
  if (
    resolution.responseKind === 'no_clue'
    && (response !== null || resolution.submittedText !== null || resolution.submittedWordId !== null)
  ) {
    throw new Error('Session invariant violated: no-clue production evidence must not contain a response.');
  }
  if (resolution.result === 'rejected' && rating !== 'forgot') {
    throw new Error('Session invariant violated: production response result does not match its rating.');
  }
  return {
    production: {
      taskId: production.taskId,
      cueId: production.cueId,
      cueType: production.cueType,
      text: production.text,
      acceptedWordIds: [...production.acceptedWordIds],
      anchorWordId: item.targetWordId,
      ...(resolution.responseKind === 'no_clue' ? { responseKind: 'no_clue' } : {}),
      submittedText: resolution.submittedText,
      submittedWordId: resolution.submittedWordId,
      result: resolution.result,
      recheckDemandId: production.recheckDemandId,
    },
  };
}

function buildContrastSelectionAttemptEvent({
  state,
  item,
  selectedWordId,
  rating,
  practiceMore,
}: {
  state: BucketSessionState;
  item: Extract<ActiveBucketSchedulerUnit, { type: 'study' }>['item'];
  selectedWordId: string;
  rating: ContrastSelectionRating;
  practiceMore: boolean;
}): StudyAttemptEvent {
  const contrastSelection = item.contrastSelection ?? assertContrastSelectionContentPresent();
  const choiceWordIds = contrastSelection.choices.map((choice) => choice.word.id);
  const outcome = selectedWordId === contrastSelection.promptTargetWordId ? 'correct' : 'incorrect';

  return {
    id: `${state.sessionId}/${item.sessionActionId}/attempt-1`,
    occurredAt: new Date().toISOString(),
    sessionId: state.sessionId,
    sessionActionId: item.sessionActionId,
    sessionEventSequence: state.answeredCount + 1,
    actionAttemptSequence: 1,
    actionKind: 'contrast_selection',
    targetWordId: item.targetWordId,
    sampledSkillIds: ['contextual_selection'],
    response: selectedWordId,
    outcome,
    rating,
    contentRef: item.contentRef,
    metadata: {
      promptTargetWordId: contrastSelection.promptTargetWordId,
      choiceWordIds,
      practiceMore,
    },
  };
}

function handleBucketUnstudiedAttempt(
  state: BucketSessionState,
  active: Extract<ActiveBucketSchedulerUnit, { type: 'study' }>,
  rating: ReviewRating,
): BucketSessionTransitionResult {
  const wordId = active.item.targetWordId;
  const skillId = onlyReviewStudySkill(active.item.sampledSkillIds[0]);
  const currentProgress = state.progress.unstudied[wordId] ?? createInitialBucketUnstudiedProgress();
  const nextProgress: BucketSchedulerUnstudiedProgress = {
    introComplete: currentProgress.introComplete,
    successStreaks: { ...currentProgress.successStreaks },
  };

  if (rating === 'good') {
    nextProgress.successStreaks[skillId] += 1;
  } else {
    nextProgress.successStreaks[skillId] = 0;
  }

  const done = nextProgress.successStreaks.recognition >= 3 && nextProgress.successStreaks.production >= 3;

  if (done) {
    const progress = {
      ...state.progress,
      unstudied: removeKey(state.progress.unstudied, wordId),
    };
    return {
      state: refreshBucketSessionScheduler({
        ...state,
        answeredCount: state.answeredCount + 1,
        progress,
        scheduler: removeBucketSchedulerWord(state.scheduler, 'unstudied', wordId),
      }),
      commit: {
        type: 'commit-unstudied-word-session',
        wordId,
      },
    };
  }

  const progress = {
    ...state.progress,
    unstudied: {
      ...state.progress.unstudied,
      [wordId]: nextProgress,
    },
  };

  return {
    state: refreshBucketSessionScheduler({
      ...state,
      answeredCount: state.answeredCount + 1,
      progress,
    }),
    commit: { type: 'none' },
  };
}

function refreshBucketSessionScheduler(state: BucketSessionState): BucketSessionState {
  const scheduler = syncBucketScheduler(state.scheduler, state.progress);

  return {
    ...state,
    phase: (state.phase === 'active' || state.phase === 'draining') && getBucketSessionTotalCount({ ...state, scheduler }) === 0
      ? 'completed'
      : state.phase,
    scheduler,
  };
}

function removeCompletedReviewAction(scheduler: BucketSessionScheduler): BucketSessionScheduler {
  const active = getBucketSchedulerActiveUnit(scheduler);

  if (active.type !== 'study' || active.bucket !== 'review') {
    throw new Error('Session invariant violated: cannot remove a completed review action when the active unit is not review.');
  }

  return {
    ...scheduler,
    reviewQueue: scheduler.reviewQueue.slice(1),
  };
}

function rotateActiveReviewAction(scheduler: BucketSessionScheduler): BucketSessionScheduler {
  const active = getBucketSchedulerActiveUnit(scheduler);

  if (active.type !== 'study' || active.bucket !== 'review') {
    throw new Error('Session invariant violated: cannot rotate a lapsed review action when the active unit is not review.');
  }

  const [head, ...tail] = scheduler.reviewQueue;
  if (!head) {
    throw new Error('Session invariant violated: cannot rotate a lapsed review action when the review queue is empty.');
  }

  if (head.sessionActionId !== active.item.sessionActionId) {
    throw new Error(
      `Session invariant violated: active review action is not the review bucket head (${active.item.sessionActionId} !== ${head.sessionActionId}).`,
    );
  }

  if (tail.length === 0) {
    return scheduler;
  }

  return {
    ...scheduler,
    reviewQueue: [...tail, head],
  };
}

export function getBucketSessionTotalCount(state: BucketSessionState) {
  const counts = getBucketSchedulerBucketCounts(state.scheduler, state.progress);
  return counts.review + counts.learning + counts.unstudied;
}

function assertActiveSessionUnitStarted(
  state: BucketSessionState,
  active: Extract<ActiveBucketSchedulerUnit, { type: 'study' }>,
  rating: ReviewRating,
) {
  if (state.startedActionIds.includes(active.item.sessionActionId)) {
    return;
  }

  const debugInfo = {
    message: 'Attempted to rate a bucket session unit before it was marked started',
    rating,
    currentActionId: active.item.sessionActionId,
    currentWordId: active.item.targetWordId,
    startedActionIds: state.startedActionIds,
    answeredCount: state.answeredCount,
    phase: state.phase,
  };

  console.error('[session-state] invariant failed', debugInfo);
  throw new Error('Session invariant violated: current bucket unit must be marked started before rating.');
}

function assertBucketDrainablePhase(state: BucketSessionState) {
  if (state.phase === 'active') {
    return;
  }

  throw new Error(`Session invariant violated: cannot begin bucket drain mode from phase "${state.phase}".`);
}

function onlyReviewStudySkill(skillId: StudySkillId | undefined): ReviewStudySkillId {
  if (skillId === 'recognition' || skillId === 'production') {
    return skillId;
  }

  throw new Error(`Session invariant violated: expected a recognition or production skill, got "${String(skillId)}".`);
}

function assertUnreachableBucket(bucket: never): never {
  throw new Error(`Unsupported bucket "${String(bucket)}".`);
}

function assertContrastSelectionContentPresent(): never {
  throw new Error('Session invariant violated: contrast selection content is missing.');
}

function createInitialReviewProgress(): ReviewActionProgress {
  return {
    failureCount: 0,
    reinforcementStreak: 0,
    attempts: [],
  };
}

function removeKey<T>(record: Record<string, T>, key: string) {
  const copy = { ...record };
  delete copy[key];
  return copy;
}
