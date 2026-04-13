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
import type { ReviewItem, Word } from '../src/types.ts';

describe('session state', () => {
  test('review item with a clean good pass commits immediately and leaves the queue', () => {
    const reviewWord = createWord({ id: 'word-1', status: 'review' });
    const reviewItem = createItem({ id: 'word-1-forward', wordId: reviewWord.id, direction: 'forward' });
    const wordsById = new Map([[reviewWord.id, reviewWord]]);

    const result = rateCurrentItem(markCurrentItemStarted(createSessionState([reviewItem])), wordsById, 'good');

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
    const wordsById = new Map([[reviewWord.id, reviewWord]]);

    let state = markCurrentItemStarted(createSessionState([reviewItem]));

    let result = rateCurrentItem(state, wordsById, 'forgot');
    assert.deepEqual(result.commit, { type: 'none' });
    assert.deepEqual(result.state.reviewProgress[reviewItem.id], {
      failureCount: 1,
      reinforcementStreak: 0,
    });

    state = markCurrentItemStarted(result.state);
    result = rateCurrentItem(state, wordsById, 'good');
    assert.deepEqual(result.commit, { type: 'none' });
    assert.deepEqual(result.state.reviewProgress[reviewItem.id], {
      failureCount: 1,
      reinforcementStreak: 1,
    });

    state = markCurrentItemStarted(result.state);
    result = rateCurrentItem(state, wordsById, 'forgot');
    assert.deepEqual(result.commit, { type: 'none' });
    assert.deepEqual(result.state.reviewProgress[reviewItem.id], {
      failureCount: 2,
      reinforcementStreak: 0,
    });

    state = markCurrentItemStarted(result.state);
    result = rateCurrentItem(state, wordsById, 'good');
    state = markCurrentItemStarted(result.state);
    result = rateCurrentItem(state, wordsById, 'good');
    state = markCurrentItemStarted(result.state);
    result = rateCurrentItem(state, wordsById, 'good');

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
    const wordsById = new Map([[learningWord.id, learningWord]]);

    let state = markCurrentItemStarted(createSessionState([forwardItem, reverseItem]));

    let result = rateCurrentItem(state, wordsById, 'good');
    assert.deepEqual(result.commit, { type: 'none' });
    assert.deepEqual(getQueueItems(result.state.queue).map((item) => item.id), [reverseItem.id]);
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
    result = rateCurrentItem(state, wordsById, 'good');
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
    const wordsById = new Map([[learningWord.id, learningWord]]);

    let state = markCurrentItemStarted(createSessionState([forwardItem, reverseItem]));

    let result = rateCurrentItem(state, wordsById, 'forgot');
    assert.deepEqual(getQueueItems(result.state.queue).map((item) => item.id), [reverseItem.id, forwardItem.id]);

    state = markCurrentItemStarted(result.state);
    result = rateCurrentItem(state, wordsById, 'good');
    assert.deepEqual(result.commit, { type: 'none' });

    state = markCurrentItemStarted(result.state);
    result = rateCurrentItem(state, wordsById, 'good');
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

    let state = createSessionState([forwardItem, reverseItem]);
    assert.equal(state.unstudiedProgress[unstudiedWord.id], undefined);

    state = beginUnstudiedDrill(state, unstudiedWord.id);
    assert.equal(state.unstudiedProgress[unstudiedWord.id]?.introComplete, true);

    const wordsById = new Map([[unstudiedWord.id, unstudiedWord]]);
    state = markCurrentItemStarted(state);
    let result = rateCurrentItem(state, wordsById, 'good');
    state = markCurrentItemStarted(result.state);
    result = rateCurrentItem(state, wordsById, 'good');
    state = markCurrentItemStarted(result.state);
    result = rateCurrentItem(state, wordsById, 'good');
    state = markCurrentItemStarted(result.state);
    result = rateCurrentItem(state, wordsById, 'good');
    state = markCurrentItemStarted(result.state);
    result = rateCurrentItem(state, wordsById, 'good');

    assert.deepEqual(result.commit, { type: 'none' });
    assert.deepEqual(getQueueItems(result.state.queue).map((item) => item.id), [reverseItem.id]);
    assert.equal(result.state.unstudiedProgress[unstudiedWord.id]?.consecutiveSuccesses.forward, 3);
    assert.equal(result.state.unstudiedProgress[unstudiedWord.id]?.consecutiveSuccesses.reverse, 2);
  });

  test('marking the current item started records that it has been shown once', () => {
    const reviewItem = createItem({ id: 'word-6-forward', wordId: 'word-6', direction: 'forward' });
    const state = createSessionState([reviewItem]);

    const nextState = markCurrentItemStarted(state);

    assert.deepEqual(nextState.startedItemIds, [reviewItem.id]);
    assert.deepEqual(markCurrentItemStarted(nextState).startedItemIds, [reviewItem.id]);
  });

  test('beginDrainSession completes immediately when no open work exists', () => {
    const reviewItem = createItem({ id: 'word-drain-forward', wordId: 'word-drain', direction: 'forward' });
    const state = createSessionState([reviewItem]);

    const drainedState = beginDrainSession(state);

    assert.equal(drainedState.phase, 'completed');
    assert.deepEqual(getQueueItems(drainedState.queue), []);
  });

  test('beginDrainSession throws when the session is not active', () => {
    const reviewItem = createItem({ id: 'word-drain-repeat-forward', wordId: 'word-drain-repeat', direction: 'forward' });
    const completedState = {
      ...createSessionState([reviewItem]),
      phase: 'completed' as const,
    };

    assert.throws(
      () => beginDrainSession(completedState),
      /cannot begin drain mode from phase "completed"/i,
    );
  });

  test('beginDrainSession keeps the current shown item but drops untouched later items', () => {
    const reviewWord = createWord({ id: 'word-10', status: 'review' });
    const firstItem = createItem({ id: 'word-10-forward', wordId: reviewWord.id, direction: 'forward' });
    const untouchedSibling = createItem({ id: 'word-10-reverse', wordId: reviewWord.id, direction: 'reverse' });
    const untouchedOtherWord = createItem({ id: 'word-11-forward', wordId: 'word-11', direction: 'forward' });

    const state = markCurrentItemStarted(createSessionState([firstItem, untouchedSibling, untouchedOtherWord]));

    const drainedState = beginDrainSession(state);

    assert.equal(drainedState.phase, 'draining');
    assert.deepEqual(getQueueItems(drainedState.queue).map((item) => item.id), [firstItem.id]);
  });

  test('beginDrainSession keeps a review item that is in reinforcement', () => {
    const reviewWord = createWord({ id: 'word-12', status: 'review' });
    const reviewItem = createItem({ id: 'word-12-forward', wordId: reviewWord.id, direction: 'forward' });
    const untouchedFuture = createItem({ id: 'word-13-forward', wordId: 'word-13', direction: 'forward' });
    const wordsById = new Map([[reviewWord.id, reviewWord]]);

    let state = markCurrentItemStarted(createSessionState([reviewItem, untouchedFuture]));
    const result = rateCurrentItem(state, wordsById, 'forgot');
    state = result.state;

    const drainedState = beginDrainSession(state);

    assert.equal(drainedState.phase, 'draining');
    assert.deepEqual(getQueueItems(drainedState.queue).map((item) => item.id), [reviewItem.id]);
    assert.deepEqual(drainedState.reviewProgress[reviewItem.id], {
      failureCount: 1,
      reinforcementStreak: 0,
    });
  });

  test('beginDrainSession keeps open work for a partially covered learning word', () => {
    const learningWord = createWord({ id: 'word-14', status: 'learning' });
    const forwardItem = createItem({ id: 'word-14-forward', wordId: learningWord.id, direction: 'forward' });
    const reverseItem = createItem({ id: 'word-14-reverse', wordId: learningWord.id, direction: 'reverse' });
    const untouchedFuture = createItem({ id: 'word-15-forward', wordId: 'word-15', direction: 'forward' });
    const wordsById = new Map([[learningWord.id, learningWord]]);

    let state = markCurrentItemStarted(createSessionState([forwardItem, reverseItem, untouchedFuture]));
    const result = rateCurrentItem(state, wordsById, 'good');
    state = markCurrentItemStarted(result.state);

    const drainedState = beginDrainSession(state);

    assert.equal(drainedState.phase, 'draining');
    assert.deepEqual(getQueueItems(drainedState.queue).map((item) => item.id), [reverseItem.id]);
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
    const forwardItem = createItem({ id: 'word-16-forward', wordId: unstudiedWord.id, direction: 'forward' });
    const reverseItem = createItem({ id: 'word-16-reverse', wordId: unstudiedWord.id, direction: 'reverse' });
    const untouchedFuture = createItem({ id: 'word-17-forward', wordId: 'word-17', direction: 'forward' });
    const wordsById = new Map([[unstudiedWord.id, unstudiedWord]]);

    let state = createSessionState([forwardItem, reverseItem, untouchedFuture]);
    state = beginUnstudiedDrill(state, unstudiedWord.id);
    state = markCurrentItemStarted(state);
    const result = rateCurrentItem(state, wordsById, 'good');
    state = markCurrentItemStarted(result.state);

    const drainedState = beginDrainSession(state);

    assert.equal(drainedState.phase, 'draining');
    assert.deepEqual(getQueueItems(drainedState.queue).map((item) => item.id), [reverseItem.id, forwardItem.id]);
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
    const wordsById = new Map([[reviewWord.id, reviewWord]]);

    let state = markCurrentItemStarted(createSessionState([reviewItem]));
    state = beginDrainSession(state);

    const result = rateCurrentItem(state, wordsById, 'good');

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
    const wordsById = new Map([[reviewWord.id, reviewWord]]);

    const state = markCurrentItemStarted(createSessionState([reviewItem]));
    const result = rateCurrentItem(state, wordsById, 'good');

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
    const wordsById = new Map([[reviewWord.id, reviewWord]]);

    assert.throws(
      () => rateCurrentItem(createSessionState([reviewItem]), wordsById, 'good'),
      /current item must be marked started before rating/i,
    );
  });

  test('rating with an empty queue throws loudly', () => {
    const reviewWord = createWord({ id: 'word-8', status: 'review' });
    const wordsById = new Map([[reviewWord.id, reviewWord]]);

    assert.throws(
      () => rateCurrentItem(createSessionState([]), wordsById, 'good'),
      /cannot rate the current item when the queue is empty/i,
    );
  });

  test('rating when the current item references a missing word throws loudly', () => {
    const reviewItem = createItem({ id: 'word-9-forward', wordId: 'word-9', direction: 'forward' });
    const state = markCurrentItemStarted(createSessionState([reviewItem]));

    assert.throws(
      () => rateCurrentItem(state, new Map(), 'good'),
      /current item references a missing word record/i,
    );
  });
});

function createWord(overrides: Partial<Word> & Pick<Word, 'id' | 'status'>): Word {
  return {
    id: overrides.id,
    hanzi: overrides.hanzi ?? '汉字',
    pinyin: overrides.pinyin ?? 'han zi',
    meaning: overrides.meaning ?? 'meaning',
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
