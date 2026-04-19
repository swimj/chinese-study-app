import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  beginDrainSession,
  beginUnstudiedDrill,
  createSessionState,
  getQueueItems,
  markCurrentItemStarted,
  rateCurrentItem,
} from '../src/lib/session-state.ts';
import type { ReviewItem, SessionItemWithWord, Word } from '../src/types.ts';

describe('session state', () => {
  test('review item with a clean good pass commits immediately and leaves the queue', () => {
    const reviewWord = createWord({ id: 'word-1', status: 'review' });
    const reviewItem = createItem({ id: 'word-1-forward', wordId: reviewWord.id, direction: 'forward' });

    const result = rateCurrentItem(markCurrentItemStarted(createSessionState([joinItem(reviewItem, reviewWord)])), 'good');

    assert.deepEqual(result.commit, {
      type: 'commit-review-item-session',
      reviewItemId: reviewItem.id,
      failureCount: 0,
      terminalRating: 'good',
    });
    assert.equal(result.state.answeredCount, 1);
    assert.deepEqual(getQueueItems(result.state.queue), []);
    assert.deepEqual(result.state.startedItemIds, [reviewItem.id]);
  });

  test('review reinforcement tracks failures and commits after three successful recalls', () => {
    const reviewWord = createWord({ id: 'word-2', status: 'review' });
    const reviewItem = createItem({ id: 'word-2-forward', wordId: reviewWord.id, direction: 'forward' });

    let state = markCurrentItemStarted(createSessionState([joinItem(reviewItem, reviewWord)]));

    let result = rateCurrentItem(state, 'forgot');
    assert.deepEqual(result.commit, { type: 'none' });
    assert.deepEqual(result.state.reviewProgress[reviewItem.id], {
      failureCount: 1,
      reinforcementStreak: 0,
    });

    state = markCurrentItemStarted(result.state);
    result = rateCurrentItem(state, 'good');
    assert.deepEqual(result.commit, { type: 'none' });
    assert.deepEqual(result.state.reviewProgress[reviewItem.id], {
      failureCount: 1,
      reinforcementStreak: 1,
    });

    state = markCurrentItemStarted(result.state);
    result = rateCurrentItem(state, 'forgot');
    assert.deepEqual(result.commit, { type: 'none' });
    assert.deepEqual(result.state.reviewProgress[reviewItem.id], {
      failureCount: 2,
      reinforcementStreak: 0,
    });

    state = markCurrentItemStarted(result.state);
    result = rateCurrentItem(state, 'good');
    state = markCurrentItemStarted(result.state);
    result = rateCurrentItem(state, 'good');
    state = markCurrentItemStarted(result.state);
    result = rateCurrentItem(state, 'good');

    assert.deepEqual(result.commit, {
      type: 'commit-review-item-session',
      reviewItemId: reviewItem.id,
      failureCount: 2,
      terminalRating: null,
    });
    assert.equal(result.state.answeredCount, 6);
    assert.deepEqual(getQueueItems(result.state.queue), []);
    assert.equal(result.state.reviewProgress[reviewItem.id], undefined);
  });

  test('learning word marks one direction covered at a time and commits success only when both were first-try good', () => {
    const learningWord = createWord({ id: 'word-3', status: 'learning' });
    const forwardItem = createItem({ id: 'word-3-forward', wordId: learningWord.id, direction: 'forward' });
    const reverseItem = createItem({ id: 'word-3-reverse', wordId: learningWord.id, direction: 'reverse' });

    let state = markCurrentItemStarted(
      createSessionState([joinItem(forwardItem, learningWord), joinItem(reverseItem, learningWord)]),
    );

    let result = rateCurrentItem(state, 'good');
    assert.deepEqual(result.commit, { type: 'none' });
    assert.deepEqual(getQueueItems(result.state.queue).map((item) => item.reviewItem.id), [reverseItem.id]);
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
    assert.deepEqual(getQueueItems(result.state.queue), []);
    assert.equal(result.state.learningProgress[learningWord.id], undefined);
  });

  test('learning word commits unsuccessful coverage after a non-first-try path', () => {
    const learningWord = createWord({ id: 'word-4', status: 'learning' });
    const forwardItem = createItem({ id: 'word-4-forward', wordId: learningWord.id, direction: 'forward' });
    const reverseItem = createItem({ id: 'word-4-reverse', wordId: learningWord.id, direction: 'reverse' });

    let state = markCurrentItemStarted(
      createSessionState([joinItem(forwardItem, learningWord), joinItem(reverseItem, learningWord)]),
    );

    let result = rateCurrentItem(state, 'forgot');
    assert.deepEqual(getQueueItems(result.state.queue).map((item) => item.reviewItem.id), [reverseItem.id, forwardItem.id]);

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
    assert.deepEqual(getQueueItems(result.state.queue), []);
  });

  test('unstudied flow requires intro completion and removes a covered direction while leaving the other in queue', () => {
    const unstudiedWord = createWord({ id: 'word-5', status: 'unstudied' });
    const forwardItem = createItem({ id: 'word-5-forward', wordId: unstudiedWord.id, direction: 'forward' });
    const reverseItem = createItem({ id: 'word-5-reverse', wordId: unstudiedWord.id, direction: 'reverse' });

    let state = createSessionState([joinItem(forwardItem, unstudiedWord), joinItem(reverseItem, unstudiedWord)]);
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
    assert.deepEqual(getQueueItems(result.state.queue).map((item) => item.reviewItem.id), [reverseItem.id]);
    assert.equal(result.state.unstudiedProgress[unstudiedWord.id]?.consecutiveSuccesses.forward, 3);
    assert.equal(result.state.unstudiedProgress[unstudiedWord.id]?.consecutiveSuccesses.reverse, 2);
  });

  test('marking the current item started records that it has been shown once', () => {
    const reviewWord = createWord({ id: 'word-6', status: 'review' });
    const reviewItem = createItem({ id: 'word-6-forward', wordId: reviewWord.id, direction: 'forward' });
    const state = createSessionState([joinItem(reviewItem, reviewWord)]);

    const nextState = markCurrentItemStarted(state);

    assert.deepEqual(nextState.startedItemIds, [reviewItem.id]);
    assert.deepEqual(markCurrentItemStarted(nextState).startedItemIds, [reviewItem.id]);
  });

  test('beginDrainSession completes immediately when no open work exists', () => {
    const reviewWord = createWord({ id: 'word-drain', status: 'review' });
    const reviewItem = createItem({ id: 'word-drain-forward', wordId: reviewWord.id, direction: 'forward' });
    const state = createSessionState([joinItem(reviewItem, reviewWord)]);

    const drainedState = beginDrainSession(state);

    assert.equal(drainedState.phase, 'completed');
    assert.deepEqual(getQueueItems(drainedState.queue), []);
  });

  test('beginDrainSession throws when the session is not active', () => {
    const reviewWord = createWord({ id: 'word-drain-repeat', status: 'review' });
    const reviewItem = createItem({ id: 'word-drain-repeat-forward', wordId: reviewWord.id, direction: 'forward' });
    const completedState = {
      ...createSessionState([joinItem(reviewItem, reviewWord)]),
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
      createSessionState([
        joinItem(firstItem, reviewWord),
        joinItem(untouchedSibling, siblingWord),
        joinItem(untouchedOtherWord, otherWord),
      ]),
    );

    const drainedState = beginDrainSession(state);

    assert.equal(drainedState.phase, 'draining');
    assert.deepEqual(getQueueItems(drainedState.queue).map((item) => item.reviewItem.id), [firstItem.id]);
  });

  test('beginDrainSession keeps a review item that is in reinforcement', () => {
    const reviewWord = createWord({ id: 'word-12', status: 'review' });
    const futureWord = createWord({ id: 'word-13', status: 'review' });
    const reviewItem = createItem({ id: 'word-12-forward', wordId: reviewWord.id, direction: 'forward' });
    const untouchedFuture = createItem({ id: 'word-13-forward', wordId: futureWord.id, direction: 'forward' });

    let state = markCurrentItemStarted(
      createSessionState([joinItem(reviewItem, reviewWord), joinItem(untouchedFuture, futureWord)]),
    );
    const result = rateCurrentItem(state, 'forgot');
    state = result.state;

    const drainedState = beginDrainSession(state);

    assert.equal(drainedState.phase, 'draining');
    assert.deepEqual(getQueueItems(drainedState.queue).map((item) => item.reviewItem.id), [reviewItem.id]);
    assert.deepEqual(drainedState.reviewProgress[reviewItem.id], {
      failureCount: 1,
      reinforcementStreak: 0,
    });
  });

  test('beginDrainSession keeps open work for a partially covered learning word', () => {
    const learningWord = createWord({ id: 'word-14', status: 'learning' });
    const futureWord = createWord({ id: 'word-15', status: 'review' });
    const forwardItem = createItem({ id: 'word-14-forward', wordId: learningWord.id, direction: 'forward' });
    const reverseItem = createItem({ id: 'word-14-reverse', wordId: learningWord.id, direction: 'reverse' });
    const untouchedFuture = createItem({ id: 'word-15-forward', wordId: futureWord.id, direction: 'forward' });

    let state = markCurrentItemStarted(
      createSessionState([
        joinItem(forwardItem, learningWord),
        joinItem(reverseItem, learningWord),
        joinItem(untouchedFuture, futureWord),
      ]),
    );
    const result = rateCurrentItem(state, 'good');
    state = markCurrentItemStarted(result.state);

    const drainedState = beginDrainSession(state);

    assert.equal(drainedState.phase, 'draining');
    assert.deepEqual(getQueueItems(drainedState.queue).map((item) => item.reviewItem.id), [reverseItem.id]);
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
    const futureWord = createWord({ id: 'word-17', status: 'review' });
    const forwardItem = createItem({ id: 'word-16-forward', wordId: unstudiedWord.id, direction: 'forward' });
    const reverseItem = createItem({ id: 'word-16-reverse', wordId: unstudiedWord.id, direction: 'reverse' });
    const untouchedFuture = createItem({ id: 'word-17-forward', wordId: futureWord.id, direction: 'forward' });

    let state = createSessionState([
      joinItem(forwardItem, unstudiedWord),
      joinItem(reverseItem, unstudiedWord),
      joinItem(untouchedFuture, futureWord),
    ]);
    state = beginUnstudiedDrill(state, unstudiedWord.id);
    state = markCurrentItemStarted(state);
    const result = rateCurrentItem(state, 'good');
    state = markCurrentItemStarted(result.state);

    const drainedState = beginDrainSession(state);

    assert.equal(drainedState.phase, 'draining');
    assert.deepEqual(getQueueItems(drainedState.queue).map((item) => item.reviewItem.id), [reverseItem.id, forwardItem.id]);
    assert.deepEqual(drainedState.unstudiedProgress[unstudiedWord.id], {
      introComplete: true,
      consecutiveSuccesses: {
        forward: 1,
        reverse: 0,
      },
    });
  });

  test('draining session completes after the last open item is committed', () => {
    const reviewWord = createWord({ id: 'word-18', status: 'review' });
    const reviewItem = createItem({ id: 'word-18-forward', wordId: reviewWord.id, direction: 'forward' });

    let state = markCurrentItemStarted(createSessionState([joinItem(reviewItem, reviewWord)]));
    state = beginDrainSession(state);

    const result = rateCurrentItem(state, 'good');

    assert.deepEqual(result.commit, {
      type: 'commit-review-item-session',
      reviewItemId: reviewItem.id,
      failureCount: 0,
      terminalRating: 'good',
    });
    assert.deepEqual(getQueueItems(result.state.queue), []);
    assert.equal(result.state.phase, 'completed');
  });

  test('active session completes after the last item is committed naturally', () => {
    const reviewWord = createWord({ id: 'word-19', status: 'review' });
    const reviewItem = createItem({ id: 'word-19-forward', wordId: reviewWord.id, direction: 'forward' });

    const state = markCurrentItemStarted(createSessionState([joinItem(reviewItem, reviewWord)]));
    const result = rateCurrentItem(state, 'good');

    assert.deepEqual(result.commit, {
      type: 'commit-review-item-session',
      reviewItemId: reviewItem.id,
      failureCount: 0,
      terminalRating: 'good',
    });
    assert.deepEqual(getQueueItems(result.state.queue), []);
    assert.equal(result.state.phase, 'completed');
  });

  test('rating before the current item is marked started throws loudly', () => {
    const reviewWord = createWord({ id: 'word-7', status: 'review' });
    const reviewItem = createItem({ id: 'word-7-forward', wordId: reviewWord.id, direction: 'forward' });

    assert.throws(
      () => rateCurrentItem(createSessionState([joinItem(reviewItem, reviewWord)]), 'good'),
      /current item must be marked started before rating/i,
    );
  });

  test('rating with an empty queue throws loudly', () => {
    assert.throws(
      () => rateCurrentItem(createSessionState([]), 'good'),
      /cannot rate the current item when the queue is empty/i,
    );
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
