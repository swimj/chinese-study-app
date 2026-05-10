import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  beginDrainSession,
  beginUnstudiedDrill,
  createSessionState,
  dismissCurrentItemFromSession,
  markCurrentItemStarted,
  rateCurrentItem,
  type ReviewItemProgress,
  type SessionCommitIntent,
} from '../src/lib/session-state.ts';
import type { ReviewItem, ReviewRating, SessionItemBuckets, SessionItemWithWord, Word } from '../src/types.ts';
import {
  cloneSessionScheduler,
  consumeActiveSchedulerItem,
  getSchedulerActiveItem,
  getSchedulerLength,
} from '../src/lib/session-scheduler.ts';

const testSessionId = 'test-session';

describe('session state', () => {
  test('review item with a clean good pass commits immediately and leaves the queue', () => {
    const reviewWord = createWord({ id: 'word-1', status: 'review' });
    const reviewItem = createItem({ id: 'word-1-forward', wordId: reviewWord.id, direction: 'forward' });

    const result = rateCurrentItem(markCurrentItemStarted(createTestSessionState(toBuckets([joinItem(reviewItem, reviewWord)]))), 'good');

    assertReviewCommit(result.commit, {
      reviewItem,
      word: reviewWord,
      failureCount: 0,
      terminalRating: 'good',
      ratings: ['good'],
    });
    assert.equal(result.state.answeredCount, 1);
    assert.equal(getSchedulerLength(result.state.scheduler), 0);
    assert.deepEqual(result.state.startedItemIds, [reviewItem.id]);
  });

  test('review reinforcement tracks failures and commits after three successful recalls', () => {
    const reviewWord = createWord({ id: 'word-2', status: 'review' });
    const reviewItem = createItem({ id: 'word-2-forward', wordId: reviewWord.id, direction: 'forward' });

    let state = markCurrentItemStarted(createTestSessionState(toBuckets([joinItem(reviewItem, reviewWord)])));

    let result = rateCurrentItem(state, 'forgot');
    assert.deepEqual(result.commit, { type: 'none' });
    assertReviewProgress(result.state.reviewProgress[reviewItem.id], 1, 0, ['forgot']);

    state = markCurrentItemStarted(result.state);
    result = rateCurrentItem(state, 'good');
    assert.deepEqual(result.commit, { type: 'none' });
    assertReviewProgress(result.state.reviewProgress[reviewItem.id], 1, 1, ['forgot', 'good']);

    state = markCurrentItemStarted(result.state);
    result = rateCurrentItem(state, 'forgot');
    assert.deepEqual(result.commit, { type: 'none' });
    assertReviewProgress(result.state.reviewProgress[reviewItem.id], 2, 0, ['forgot', 'good', 'forgot']);

    state = markCurrentItemStarted(result.state);
    result = rateCurrentItem(state, 'good');
    state = markCurrentItemStarted(result.state);
    result = rateCurrentItem(state, 'good');
    state = markCurrentItemStarted(result.state);
    result = rateCurrentItem(state, 'good');

    assertReviewCommit(result.commit, {
      reviewItem,
      word: reviewWord,
      failureCount: 2,
      terminalRating: null,
      ratings: ['forgot', 'good', 'forgot', 'good', 'good', 'good'],
    });
    assert.equal(result.state.answeredCount, 6);
    assert.equal(getSchedulerLength(result.state.scheduler), 0);
    assert.equal(result.state.reviewProgress[reviewItem.id], undefined);
  });

  test('learning word marks one direction covered at a time and commits success only when both were first-try good', () => {
    const learningWord = createWord({ id: 'word-3', status: 'learning' });
    const forwardItem = createItem({ id: 'word-3-forward', wordId: learningWord.id, direction: 'forward' });
    const reverseItem = createItem({ id: 'word-3-reverse', wordId: learningWord.id, direction: 'reverse' });

    let state = markCurrentItemStarted(
      createTestSessionState(toBuckets([joinItem(forwardItem, learningWord), joinItem(reverseItem, learningWord)])),
    );

    let result = rateCurrentItem(state, 'good');
    assert.deepEqual(result.commit, { type: 'none' });
    assert.deepEqual(materializeEffectiveQueue(result.state.scheduler), [reverseItem.id]);
    assert.deepEqual(result.state.learningProgress[learningWord.id], {
      coveredDirections: {
        forward: true,
        reverse: false,
      },
      firstTryGood: {
        forward: true,
        reverse: false,
      },
      attempts: {
        forward: 1,
        reverse: 0,
      },
    });

    state = markCurrentItemStarted(result.state);
    result = rateCurrentItem(state, 'good');
    assert.deepEqual(result.commit, {
      type: 'commit-learning-word-session',
      wordId: learningWord.id,
      success: true,
    });
    assert.equal(getSchedulerLength(result.state.scheduler), 0);
    assert.equal(result.state.learningProgress[learningWord.id], undefined);
  });

  test('learning word commits unsuccessful coverage after a non-first-try path', () => {
    const learningWord = createWord({ id: 'word-4', status: 'learning' });
    const forwardItem = createItem({ id: 'word-4-forward', wordId: learningWord.id, direction: 'forward' });
    const reverseItem = createItem({ id: 'word-4-reverse', wordId: learningWord.id, direction: 'reverse' });

    let state = markCurrentItemStarted(
      createTestSessionState(toBuckets([joinItem(forwardItem, learningWord), joinItem(reverseItem, learningWord)])),
    );

    let result = rateCurrentItem(state, 'forgot');
    assert.deepEqual(materializeEffectiveQueue(result.state.scheduler), [reverseItem.id, forwardItem.id]);

    state = markCurrentItemStarted(result.state);
    result = rateCurrentItem(state, 'good');
    assert.deepEqual(result.commit, { type: 'none' });

    state = markCurrentItemStarted(result.state);
    result = rateCurrentItem(state, 'good');
    assert.deepEqual(result.commit, {
      type: 'commit-learning-word-session',
      wordId: learningWord.id,
      success: false,
    });
    assert.equal(getSchedulerLength(result.state.scheduler), 0);
  });

  test('unstudied flow requires intro completion and removes a covered direction while leaving the other in queue', () => {
    const unstudiedWord = createWord({ id: 'word-5', status: 'unstudied' });
    const forwardItem = createItem({ id: 'word-5-forward', wordId: unstudiedWord.id, direction: 'forward' });
    const reverseItem = createItem({ id: 'word-5-reverse', wordId: unstudiedWord.id, direction: 'reverse' });

    let state = createTestSessionState(toBuckets([joinItem(forwardItem, unstudiedWord), joinItem(reverseItem, unstudiedWord)]));
    assert.equal(state.unstudiedProgress[unstudiedWord.id], undefined);

    state = beginUnstudiedDrill(state, unstudiedWord.id);
    assert.equal(state.unstudiedProgress[unstudiedWord.id]?.introComplete, true);

    state = markCurrentItemStarted(state);
    let result = rateCurrentItem(state, 'good');
    state = markCurrentItemStarted(result.state);
    result = rateCurrentItem(state, 'good');
    state = markCurrentItemStarted(result.state);
    result = rateCurrentItem(state, 'good');
    state = markCurrentItemStarted(result.state);
    result = rateCurrentItem(state, 'good');
    state = markCurrentItemStarted(result.state);
    result = rateCurrentItem(state, 'good');

    assert.deepEqual(result.commit, { type: 'none' });
    const remainingQueue = materializeEffectiveQueue(result.state.scheduler);
    assert.equal(remainingQueue.length, 1);
    assert.ok(remainingQueue[0] === forwardItem.id || remainingQueue[0] === reverseItem.id);
    const forwardSuccesses = result.state.unstudiedProgress[unstudiedWord.id]?.consecutiveSuccesses.forward ?? 0;
    const reverseSuccesses = result.state.unstudiedProgress[unstudiedWord.id]?.consecutiveSuccesses.reverse ?? 0;
    assert.ok(forwardSuccesses === 3 || reverseSuccesses === 3);
    assert.ok(forwardSuccesses + reverseSuccesses === 5);
  });

  test('marking the current item started records that it has been shown once', () => {
    const reviewWord = createWord({ id: 'word-6', status: 'review' });
    const reviewItem = createItem({ id: 'word-6-forward', wordId: reviewWord.id, direction: 'forward' });
    const state = createTestSessionState(toBuckets([joinItem(reviewItem, reviewWord)]));

    const nextState = markCurrentItemStarted(state);

    assert.deepEqual(nextState.startedItemIds, [reviewItem.id]);
    assert.deepEqual(markCurrentItemStarted(nextState).startedItemIds, [reviewItem.id]);
  });

  test('beginDrainSession keeps the currently active item when no open work exists', () => {
    const reviewWord = createWord({ id: 'word-drain', status: 'review' });
    const reviewItem = createItem({ id: 'word-drain-forward', wordId: reviewWord.id, direction: 'forward' });
    const state = createTestSessionState(toBuckets([joinItem(reviewItem, reviewWord)]));

    const drainedState = beginDrainSession(state);

    assert.equal(drainedState.phase, 'draining');
    assert.equal(getSchedulerLength(drainedState.scheduler), 1);
    assert.deepEqual(materializeEffectiveQueue(drainedState.scheduler), [reviewItem.id]);
  });

  test('beginDrainSession throws when the session is not active', () => {
    const reviewWord = createWord({ id: 'word-drain-repeat', status: 'review' });
    const reviewItem = createItem({ id: 'word-drain-repeat-forward', wordId: reviewWord.id, direction: 'forward' });
    const completedState = {
      ...createTestSessionState(toBuckets([joinItem(reviewItem, reviewWord)])),
      phase: 'completed' as const,
    };

    assert.throws(
      () => beginDrainSession(completedState),
      /cannot begin drain mode from phase "completed"/i,
    );
  });

  test('beginDrainSession keeps the current shown item but drops untouched later items', () => {
    const reviewWord = createWord({ id: 'word-10', status: 'review' });
    const siblingWord = createWord({ id: 'word-10', status: 'review' });
    const otherWord = createWord({ id: 'word-11', status: 'review' });
    const firstItem = createItem({ id: 'word-10-forward', wordId: reviewWord.id, direction: 'forward' });
    const untouchedSibling = createItem({ id: 'word-10-reverse', wordId: siblingWord.id, direction: 'reverse' });
    const untouchedOtherWord = createItem({ id: 'word-11-forward', wordId: otherWord.id, direction: 'forward' });

    const state = markCurrentItemStarted(
      createTestSessionState(toBuckets([
        joinItem(firstItem, reviewWord),
        joinItem(untouchedSibling, siblingWord),
        joinItem(untouchedOtherWord, otherWord),
      ])),
    );

    const drainedState = beginDrainSession(state);

    assert.equal(drainedState.phase, 'draining');
    assert.deepEqual(materializeEffectiveQueue(drainedState.scheduler), [firstItem.id]);
  });

  test('beginDrainSession keeps a review item that is in reinforcement', () => {
    const reviewWord = createWord({ id: 'word-12', status: 'review' });
    const futureWord = createWord({ id: 'word-13', status: 'review' });
    const reviewItem = createItem({ id: 'word-12-forward', wordId: reviewWord.id, direction: 'forward' });
    const untouchedFuture = createItem({ id: 'word-13-forward', wordId: futureWord.id, direction: 'forward' });

    let state = markCurrentItemStarted(
      createTestSessionState(toBuckets([joinItem(reviewItem, reviewWord), joinItem(untouchedFuture, futureWord)])),
    );
    const result = rateCurrentItem(state, 'forgot');
    state = result.state;

    const drainedState = beginDrainSession(state);

    assert.equal(drainedState.phase, 'draining');
    assert.deepEqual(materializeEffectiveQueue(drainedState.scheduler), [untouchedFuture.id, reviewItem.id]);
    assertReviewProgress(drainedState.reviewProgress[reviewItem.id], 1, 0, ['forgot']);
  });

  test('beginDrainSession keeps open work for a partially covered learning word', () => {
    const learningWord = createWord({ id: 'word-14', status: 'learning' });
    const futureWord = createWord({ id: 'word-15', status: 'learning' });
    const forwardItem = createItem({ id: 'word-14-forward', wordId: learningWord.id, direction: 'forward' });
    const reverseItem = createItem({ id: 'word-14-reverse', wordId: learningWord.id, direction: 'reverse' });
    const untouchedFuture = createItem({ id: 'word-15-forward', wordId: futureWord.id, direction: 'forward' });

    let state = markCurrentItemStarted(
      createTestSessionState(toBuckets([
        joinItem(forwardItem, learningWord),
        joinItem(reverseItem, learningWord),
        joinItem(untouchedFuture, futureWord),
      ])),
    );
    const result = rateCurrentItem(state, 'good');
    state = markCurrentItemStarted(result.state);

    const drainedState = beginDrainSession(state);

    assert.equal(drainedState.phase, 'draining');
    assert.deepEqual(materializeEffectiveQueue(drainedState.scheduler), [reverseItem.id]);
    assert.deepEqual(drainedState.learningProgress[learningWord.id], {
      coveredDirections: {
        forward: true,
        reverse: false,
      },
      firstTryGood: {
        forward: true,
        reverse: false,
      },
      attempts: {
        forward: 1,
        reverse: 0,
      },
    });
  });

  test('beginDrainSession keeps open work for a partially progressed unstudied word', () => {
    const unstudiedWord = createWord({ id: 'word-16', status: 'unstudied' });
    const futureWord = createWord({ id: 'word-17', status: 'unstudied' });
    const forwardItem = createItem({ id: 'word-16-forward', wordId: unstudiedWord.id, direction: 'forward' });
    const reverseItem = createItem({ id: 'word-16-reverse', wordId: unstudiedWord.id, direction: 'reverse' });
    const untouchedFuture = createItem({ id: 'word-17-forward', wordId: futureWord.id, direction: 'forward' });

    let state = createTestSessionState(toBuckets([
      joinItem(forwardItem, unstudiedWord),
      joinItem(reverseItem, unstudiedWord),
      joinItem(untouchedFuture, futureWord),
    ]));
    state = beginUnstudiedDrill(state, unstudiedWord.id);
    state = markCurrentItemStarted(state);
    const result = rateCurrentItem(state, 'good');
    state = markCurrentItemStarted(result.state);

    const drainedState = beginDrainSession(state);

    assert.equal(drainedState.phase, 'draining');
    const queueAfterDrain = materializeEffectiveQueue(drainedState.scheduler);
    assert.deepEqual(new Set(queueAfterDrain), new Set([forwardItem.id, reverseItem.id]));
    assert.equal(drainedState.unstudiedProgress[unstudiedWord.id]?.introComplete, true);
    const forwardSuccesses = drainedState.unstudiedProgress[unstudiedWord.id]?.consecutiveSuccesses.forward ?? 0;
    const reverseSuccesses = drainedState.unstudiedProgress[unstudiedWord.id]?.consecutiveSuccesses.reverse ?? 0;
    assert.equal(forwardSuccesses + reverseSuccesses, 1);
  });

  test('draining session completes after the last open item is committed', () => {
    const reviewWord = createWord({ id: 'word-18', status: 'review' });
    const reviewItem = createItem({ id: 'word-18-forward', wordId: reviewWord.id, direction: 'forward' });

    let state = markCurrentItemStarted(createTestSessionState(toBuckets([joinItem(reviewItem, reviewWord)])));
    state = beginDrainSession(state);

    const result = rateCurrentItem(state, 'good');

    assertReviewCommit(result.commit, {
      reviewItem,
      word: reviewWord,
      failureCount: 0,
      terminalRating: 'good',
      ratings: ['good'],
    });
    assert.equal(getSchedulerLength(result.state.scheduler), 0);
    assert.equal(result.state.phase, 'completed');
  });

  test('active session completes after the last item is committed naturally', () => {
    const reviewWord = createWord({ id: 'word-19', status: 'review' });
    const reviewItem = createItem({ id: 'word-19-forward', wordId: reviewWord.id, direction: 'forward' });

    const state = markCurrentItemStarted(createTestSessionState(toBuckets([joinItem(reviewItem, reviewWord)])));
    const result = rateCurrentItem(state, 'good');

    assertReviewCommit(result.commit, {
      reviewItem,
      word: reviewWord,
      failureCount: 0,
      terminalRating: 'good',
      ratings: ['good'],
    });
    assert.equal(getSchedulerLength(result.state.scheduler), 0);
    assert.equal(result.state.phase, 'completed');
  });

  test('rating before the current item is marked started throws loudly', () => {
    const reviewWord = createWord({ id: 'word-7', status: 'review' });
    const reviewItem = createItem({ id: 'word-7-forward', wordId: reviewWord.id, direction: 'forward' });

    assert.throws(
      () => rateCurrentItem(createTestSessionState(toBuckets([joinItem(reviewItem, reviewWord)])), 'good'),
      /current item must be marked started before rating/i,
    );
  });

  test('rating with an empty queue throws loudly', () => {
    assert.throws(
      () => rateCurrentItem(createTestSessionState(toBuckets([])), 'good'),
      /cannot rate the current item when the queue is empty/i,
    );
  });

  test('dismissing the current item prunes every queued direction for that word', () => {
    const dismissedWord = createWord({ id: 'word-dismiss', status: 'review' });
    const survivorWord = createWord({ id: 'word-survivor', status: 'learning' });
    const state = createTestSessionState(toBuckets([
      joinItem(createItem({ id: 'word-dismiss-forward', wordId: dismissedWord.id, direction: 'forward' }), dismissedWord),
      joinItem(createItem({ id: 'word-dismiss-reverse', wordId: dismissedWord.id, direction: 'reverse' }), dismissedWord),
      joinItem(createItem({ id: 'word-survivor-forward', wordId: survivorWord.id, direction: 'forward' }), survivorWord),
    ]));

    const result = dismissCurrentItemFromSession(state);

    assert.deepEqual(result.dismiss, {
      type: 'dismiss-word-from-study',
      wordId: 'word-dismiss',
      status: 'review',
    });
    assert.deepEqual(materializeEffectiveQueue(result.state.scheduler), ['word-survivor-forward']);
    assert.deepEqual(result.state.dismissedWordIds, ['word-dismiss']);
  });

  test('dismissing head keeps the next non-dismissed item as the new head even when a later item also matches', () => {
    const dismissedWord = createWord({ id: 'word-r1', status: 'review' });
    const survivorWord = createWord({ id: 'word-r2', status: 'review' });
    const state = createTestSessionState(toBuckets([
      joinItem(createItem({ id: 'r1', wordId: dismissedWord.id, direction: 'forward' }), dismissedWord),
      joinItem(createItem({ id: 'r2', wordId: survivorWord.id, direction: 'forward' }), survivorWord),
      joinItem(createItem({ id: 'r3', wordId: dismissedWord.id, direction: 'reverse' }), dismissedWord),
    ]));

    const result = dismissCurrentItemFromSession(state);

    assert.deepEqual(materializeEffectiveQueue(result.state.scheduler), ['r2']);
  });

  test('dismissing clears in-flight progress for the dismissed word and related item starts', () => {
    const dismissedWord = createWord({ id: 'word-dismiss-progress', status: 'review' });
    const survivorWord = createWord({ id: 'word-survivor-progress', status: 'learning' });
    const dismissedForward = createItem({ id: 'word-dismiss-progress-forward', wordId: dismissedWord.id, direction: 'forward' });
    const dismissedReverse = createItem({ id: 'word-dismiss-progress-reverse', wordId: dismissedWord.id, direction: 'reverse' });
    const survivorItem = createItem({ id: 'word-survivor-progress-forward', wordId: survivorWord.id, direction: 'forward' });

    const state = {
      ...createTestSessionState(toBuckets([joinItem(dismissedForward, dismissedWord), joinItem(dismissedReverse, dismissedWord), joinItem(survivorItem, survivorWord)])),
      startedItemIds: [dismissedForward.id, survivorItem.id],
      learningProgress: {
        'word-dismiss-progress': {
          coveredDirections: { forward: true, reverse: false },
          firstTryGood: { forward: true, reverse: false },
          attempts: { forward: 1, reverse: 0 },
        },
      },
      unstudiedProgress: {
        'word-dismiss-progress': {
          introComplete: true,
          consecutiveSuccesses: { forward: 2, reverse: 0 },
        },
      },
      reviewProgress: {
        [dismissedForward.id]: { failureCount: 1, reinforcementStreak: 0, attempts: [] },
      },
    };

    const result = dismissCurrentItemFromSession(state);

    assert.equal(result.state.learningProgress['word-dismiss-progress'], undefined);
    assert.equal(result.state.unstudiedProgress['word-dismiss-progress'], undefined);
    assert.equal(result.state.reviewProgress[dismissedForward.id], undefined);
    assert.deepEqual(result.state.startedItemIds, [survivorItem.id]);
  });

  test('dismissing the last queued word completes the session phase', () => {
    const dismissedWord = createWord({ id: 'word-dismiss-last', status: 'review' });
    const state = createTestSessionState(toBuckets([
      joinItem(createItem({ id: 'word-dismiss-last-forward', wordId: dismissedWord.id, direction: 'forward' }), dismissedWord),
    ]));

    const result = dismissCurrentItemFromSession(state);

    assert.equal(result.state.phase, 'completed');
    assert.equal(getSchedulerLength(result.state.scheduler), 0);
  });
});

function joinItem(reviewItem: ReviewItem, word: Word): SessionItemWithWord {
  return {
    reviewItem,
    word,
  };
}

function createWord(overrides: Partial<Word> & Pick<Word, 'id' | 'status'>): Word {
  return {
    id: overrides.id,
    hanzi: overrides.hanzi ?? '汉字',
    pinyin: overrides.pinyin ?? 'han zi',
    meaning: overrides.meaning ?? 'meaning',
    meanings: overrides.meanings ?? ['meaning'],
    personalNotes: overrides.personalNotes ?? '',
    traditional: overrides.traditional ?? null,
    examples: overrides.examples ?? ['example'],
    status: overrides.status,
    priority: overrides.priority ?? 100,
    createdAt: overrides.createdAt ?? '2026-04-10T00:00:00.000Z',
    learningStreak: overrides.learningStreak ?? 0,
    lastLearningSuccessOn: overrides.lastLearningSuccessOn ?? null,
    lastLearningCoveredOn: overrides.lastLearningCoveredOn ?? null,
  };
}

function createItem(overrides: Partial<ReviewItem> & Pick<ReviewItem, 'id' | 'wordId' | 'direction'>): ReviewItem {
  return {
    id: overrides.id,
    wordId: overrides.wordId,
    direction: overrides.direction,
    intervalHours: overrides.intervalHours ?? 24,
    lastReviewedAt: overrides.lastReviewedAt ?? null,
    nextDueAt: overrides.nextDueAt ?? null,
    easeFactor: overrides.easeFactor ?? 2.5,
  };
}

function toBuckets(items: SessionItemWithWord[]): SessionItemBuckets {
  return {
    review: items.filter((item) => item.word.status === 'review'),
    learning: items.filter((item) => item.word.status === 'learning'),
    unstudied: items.filter((item) => item.word.status === 'unstudied'),
  };
}

function createTestSessionState(buckets: SessionItemBuckets) {
  return createSessionState(buckets, testSessionId);
}

function assertReviewProgress(
  progress: ReviewItemProgress | undefined,
  failureCount: number,
  reinforcementStreak: number,
  ratings: ReviewRating[],
) {
  assert.ok(progress);
  assert.equal(progress.failureCount, failureCount);
  assert.equal(progress.reinforcementStreak, reinforcementStreak);
  assert.deepEqual(progress.attempts.map((attempt) => attempt.rating), ratings);
}

function assertReviewCommit(
  commit: SessionCommitIntent,
  {
    reviewItem,
    word,
    failureCount,
    terminalRating,
    ratings,
  }: {
    reviewItem: ReviewItem;
    word: Word;
    failureCount: number;
    terminalRating: 'hard' | 'good' | 'easy' | null;
    ratings: ReviewRating[];
  },
) {
  assert.equal(commit.type, 'commit-review-item-session');
  if (commit.type !== 'commit-review-item-session') {
    return;
  }

  assert.equal(commit.sessionId, testSessionId);
  assert.equal(commit.reviewItemId, reviewItem.id);
  assert.equal(commit.failureCount, failureCount);
  assert.equal(commit.terminalRating, terminalRating);
  assert.deepEqual(commit.events.map((event) => event.rating), ratings);

  for (const [index, event] of commit.events.entries()) {
    const sequence = index + 1;
    const expectedKind = reviewItem.direction === 'forward' ? 'recognition' : 'production';

    assert.equal(event.id, `${testSessionId}/${reviewItem.id}/attempt-${sequence}`);
    assert.match(event.occurredAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.equal(event.sessionId, testSessionId);
    assert.equal(event.sessionActionId, `${testSessionId}/${reviewItem.id}`);
    assert.equal(event.sessionEventSequence, sequence);
    assert.equal(event.actionAttemptSequence, sequence);
    assert.equal(event.actionKind, expectedKind);
    assert.equal(event.targetWordId, word.id);
    assert.deepEqual(event.sampledSkillIds, [expectedKind]);
    assert.equal(event.response, null);
    assert.equal(event.outcome, event.rating === 'forgot' ? 'incorrect' : 'correct');
    assert.equal(event.contentRef, null);
    assert.deepEqual(event.metadata, {});
  }
}

function materializeEffectiveQueue(scheduler: Parameters<typeof getSchedulerActiveItem>[0]): string[] {
  const copy = cloneSessionScheduler(scheduler);
  const out: string[] = [];

  while (getSchedulerLength(copy) > 0) {
    const active = getSchedulerActiveItem(copy);
    if (!active) {
      break;
    }

    out.push(active.reviewItem.id);
    consumeActiveSchedulerItem(copy);
  }

  return out;
}
