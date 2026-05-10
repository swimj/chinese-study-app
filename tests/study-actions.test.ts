import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildLegacyReviewStudyAction,
  deriveReviewCommitFieldsFromAttemptEvents,
  mapReviewDirectionToStudySkill,
  mapStudySkillToDefaultActionKind,
  type StudyAttemptEvent,
} from '../src/domain/study-actions.ts';
import type { ReviewItem, Word } from '../src/types.ts';

describe('study action domain adapters', () => {
  test('maps legacy review directions to V0 study skills', () => {
    assert.equal(mapReviewDirectionToStudySkill('forward'), 'recognition');
    assert.equal(mapReviewDirectionToStudySkill('reverse'), 'production');
  });

  test('maps V0 study skills to their default action kinds', () => {
    assert.equal(mapStudySkillToDefaultActionKind('recognition'), 'recognition');
    assert.equal(mapStudySkillToDefaultActionKind('production'), 'production');
    assert.equal(mapStudySkillToDefaultActionKind('contextual_selection'), 'contrast_selection');
  });

  test('builds a recognition action from a forward review item', () => {
    const word = createWord({ id: 'word-1' });
    const reviewItem = createReviewItem({
      id: 'word-1-forward',
      wordId: word.id,
      direction: 'forward',
    });

    assert.deepEqual(
      buildLegacyReviewStudyAction({
        sessionActionId: 'session-1/action-1',
        reviewItem,
        word,
      }),
      {
        sessionActionId: 'session-1/action-1',
        kind: 'recognition',
        targetWordId: word.id,
        sampledSkillIds: ['recognition'],
        contentRef: null,
        legacyReviewItemId: reviewItem.id,
      },
    );
  });

  test('builds a production action from a reverse review item', () => {
    const word = createWord({ id: 'word-2' });
    const reviewItem = createReviewItem({
      id: 'word-2-reverse',
      wordId: word.id,
      direction: 'reverse',
    });

    assert.deepEqual(
      buildLegacyReviewStudyAction({
        sessionActionId: 'session-1/action-2',
        reviewItem,
        word,
      }),
      {
        sessionActionId: 'session-1/action-2',
        kind: 'production',
        targetWordId: word.id,
        sampledSkillIds: ['production'],
        contentRef: null,
        legacyReviewItemId: reviewItem.id,
      },
    );
  });

  test('preserves content refs when adapting legacy review items', () => {
    const word = createWord({ id: 'word-3' });
    const reviewItem = createReviewItem({
      id: 'word-3-forward',
      wordId: word.id,
      direction: 'forward',
    });

    const action = buildLegacyReviewStudyAction({
      sessionActionId: 'session-1/action-3',
      reviewItem,
      word,
      contentRef: { type: 'example_sentence', id: 'example-1' },
    });

    assert.deepEqual(action.contentRef, { type: 'example_sentence', id: 'example-1' });
  });

  test('rejects a review item and word mismatch', () => {
    assert.throws(
      () =>
        buildLegacyReviewStudyAction({
          sessionActionId: 'session-1/action-4',
          reviewItem: createReviewItem({
            id: 'word-4-forward',
            wordId: 'word-4',
            direction: 'forward',
          }),
          word: createWord({ id: 'other-word' }),
        }),
      /review item word "word-4" must match word "other-word"/,
    );
  });
});

describe('review attempt event derivation', () => {
  test('derives a clean review pass from the first successful attempt', () => {
    assert.deepEqual(
      deriveReviewCommitFieldsFromAttemptEvents([
        createAttemptEvent({
          id: 'attempt-1',
          actionAttemptSequence: 1,
          rating: 'hard',
          outcome: 'correct',
        }),
      ]),
      {
        failureCount: 0,
        terminalRating: 'hard',
      },
    );
  });

  test('derives a lapsed review after three successful reinforcement attempts', () => {
    assert.deepEqual(
      deriveReviewCommitFieldsFromAttemptEvents([
        createAttemptEvent({
          id: 'attempt-1',
          actionAttemptSequence: 1,
          rating: 'forgot',
          outcome: 'incorrect',
        }),
        createAttemptEvent({
          id: 'attempt-2',
          actionAttemptSequence: 2,
          rating: 'good',
          outcome: 'correct',
        }),
        createAttemptEvent({
          id: 'attempt-3',
          actionAttemptSequence: 3,
          rating: 'hard',
          outcome: 'correct',
        }),
        createAttemptEvent({
          id: 'attempt-4',
          actionAttemptSequence: 4,
          rating: 'easy',
          outcome: 'correct',
        }),
      ]),
      {
        failureCount: 1,
        terminalRating: null,
      },
    );
  });

  test('counts repeated failures and requires three successes after the latest failure', () => {
    assert.deepEqual(
      deriveReviewCommitFieldsFromAttemptEvents([
        createAttemptEvent({
          id: 'attempt-1',
          actionAttemptSequence: 1,
          rating: 'forgot',
          outcome: 'incorrect',
        }),
        createAttemptEvent({
          id: 'attempt-2',
          actionAttemptSequence: 2,
          rating: 'good',
          outcome: 'correct',
        }),
        createAttemptEvent({
          id: 'attempt-3',
          actionAttemptSequence: 3,
          rating: 'forgot',
          outcome: 'incorrect',
        }),
        createAttemptEvent({
          id: 'attempt-4',
          actionAttemptSequence: 4,
          rating: 'good',
          outcome: 'correct',
        }),
        createAttemptEvent({
          id: 'attempt-5',
          actionAttemptSequence: 5,
          rating: 'good',
          outcome: 'correct',
        }),
        createAttemptEvent({
          id: 'attempt-6',
          actionAttemptSequence: 6,
          rating: 'good',
          outcome: 'correct',
        }),
      ]),
      {
        failureCount: 2,
        terminalRating: null,
      },
    );
  });

  test('sorts by action attempt sequence before deriving review outcome', () => {
    assert.deepEqual(
      deriveReviewCommitFieldsFromAttemptEvents([
        createAttemptEvent({
          id: 'attempt-3',
          actionAttemptSequence: 3,
          sessionEventSequence: 12,
          rating: 'good',
          outcome: 'correct',
        }),
        createAttemptEvent({
          id: 'attempt-1',
          actionAttemptSequence: 1,
          sessionEventSequence: 10,
          rating: 'forgot',
          outcome: 'incorrect',
        }),
        createAttemptEvent({
          id: 'attempt-4',
          actionAttemptSequence: 4,
          sessionEventSequence: 13,
          rating: 'good',
          outcome: 'correct',
        }),
        createAttemptEvent({
          id: 'attempt-2',
          actionAttemptSequence: 2,
          sessionEventSequence: 11,
          rating: 'good',
          outcome: 'correct',
        }),
      ]),
      {
        failureCount: 1,
        terminalRating: null,
      },
    );
  });

  test('rejects incomplete review reinforcement batches', () => {
    assert.throws(
      () =>
        deriveReviewCommitFieldsFromAttemptEvents([
          createAttemptEvent({
            id: 'attempt-1',
            actionAttemptSequence: 1,
            rating: 'forgot',
            outcome: 'incorrect',
          }),
          createAttemptEvent({
            id: 'attempt-2',
            actionAttemptSequence: 2,
            rating: 'good',
            outcome: 'correct',
          }),
        ]),
      /do not represent a covered review action/,
    );
  });

  test('rejects mismatched denormalized outcome and rating', () => {
    assert.throws(
      () =>
        deriveReviewCommitFieldsFromAttemptEvents([
          createAttemptEvent({
            id: 'attempt-1',
            rating: 'forgot',
            outcome: 'correct',
          }),
        ]),
      /outcome "correct" inconsistent with rating "forgot"/,
    );
  });

  test('rejects mixed session actions and action attempt sequence gaps', () => {
    assert.throws(
      () =>
        deriveReviewCommitFieldsFromAttemptEvents([
          createAttemptEvent({
            id: 'attempt-1',
            actionAttemptSequence: 1,
            rating: 'forgot',
            outcome: 'incorrect',
          }),
          createAttemptEvent({
            id: 'attempt-2',
            sessionActionId: 'session-1/action-2',
            actionAttemptSequence: 2,
          }),
        ]),
      /must belong to one session action/,
    );

    assert.throws(
      () =>
        deriveReviewCommitFieldsFromAttemptEvents([
          createAttemptEvent({
            id: 'attempt-1',
            actionAttemptSequence: 1,
          }),
          createAttemptEvent({
            id: 'attempt-2',
            actionAttemptSequence: 2,
          }),
        ]),
      /includes events after the review action was covered/,
    );

    assert.throws(
      () =>
        deriveReviewCommitFieldsFromAttemptEvents([
          createAttemptEvent({
            id: 'attempt-1',
            actionAttemptSequence: 1,
            rating: 'forgot',
            outcome: 'incorrect',
          }),
          createAttemptEvent({
            id: 'attempt-3',
            actionAttemptSequence: 3,
            rating: 'good',
            outcome: 'correct',
          }),
        ]),
      /expected actionAttemptSequence 2, got 3/,
    );
  });

  test('rejects review attempt batches whose accepted event order contradicts attempt order', () => {
    assert.throws(
      () =>
        deriveReviewCommitFieldsFromAttemptEvents([
          createAttemptEvent({
            id: 'attempt-1',
            actionAttemptSequence: 1,
            sessionEventSequence: 10,
            rating: 'forgot',
            outcome: 'incorrect',
          }),
          createAttemptEvent({
            id: 'attempt-2',
            actionAttemptSequence: 2,
            sessionEventSequence: 9,
            rating: 'good',
            outcome: 'correct',
          }),
          createAttemptEvent({
            id: 'attempt-3',
            actionAttemptSequence: 3,
            sessionEventSequence: 11,
            rating: 'good',
            outcome: 'correct',
          }),
          createAttemptEvent({
            id: 'attempt-4',
            actionAttemptSequence: 4,
            sessionEventSequence: 12,
            rating: 'good',
            outcome: 'correct',
          }),
        ]),
      /sessionEventSequence must increase with actionAttemptSequence/,
    );
  });

  test('rejects non-review action kinds', () => {
    assert.throws(
      () =>
        deriveReviewCommitFieldsFromAttemptEvents([
          createAttemptEvent({
            id: 'attempt-1',
            actionKind: 'contrast_selection',
            sampledSkillIds: ['contextual_selection'],
            rating: null,
          }),
        ]),
      /Expected recognition or production review attempt event/,
    );
  });
});

function createWord(overrides: Partial<Word> & Pick<Word, 'id'>): Word {
  return {
    id: overrides.id,
    hanzi: overrides.hanzi ?? '汉字',
    traditional: overrides.traditional ?? null,
    pinyin: overrides.pinyin ?? 'han zi',
    meaning: overrides.meaning ?? 'meaning',
    meanings: overrides.meanings ?? ['meaning'],
    personalNotes: overrides.personalNotes ?? '',
    examples: overrides.examples ?? ['example'],
    status: overrides.status ?? 'review',
    priority: overrides.priority ?? 100,
    createdAt: overrides.createdAt ?? '2026-04-10T00:00:00.000Z',
    learningStreak: overrides.learningStreak ?? 0,
    lastLearningSuccessOn: overrides.lastLearningSuccessOn ?? null,
    lastLearningCoveredOn: overrides.lastLearningCoveredOn ?? null,
  };
}

function createReviewItem(
  overrides: Partial<ReviewItem> & Pick<ReviewItem, 'id' | 'wordId' | 'direction'>,
): ReviewItem {
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

function createAttemptEvent(overrides: Partial<StudyAttemptEvent> & Pick<StudyAttemptEvent, 'id'>): StudyAttemptEvent {
  const actionAttemptSequence = overrides.actionAttemptSequence ?? 1;

  return {
    id: overrides.id,
    occurredAt: overrides.occurredAt ?? '2026-05-10T01:00:00.000Z',
    sessionId: overrides.sessionId ?? 'session-1',
    sessionActionId: overrides.sessionActionId ?? 'session-1/action-1',
    sessionEventSequence: overrides.sessionEventSequence ?? actionAttemptSequence,
    actionAttemptSequence,
    actionKind: overrides.actionKind ?? 'recognition',
    targetWordId: overrides.targetWordId ?? 'word-1',
    sampledSkillIds: overrides.sampledSkillIds ?? ['recognition'],
    response: overrides.response ?? null,
    outcome: overrides.outcome ?? 'correct',
    rating: 'rating' in overrides ? (overrides.rating ?? null) : 'good',
    contentRef: overrides.contentRef ?? null,
    metadata: overrides.metadata ?? {},
  };
}
