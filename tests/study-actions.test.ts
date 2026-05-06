import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildLegacyReviewStudyAction,
  mapReviewDirectionToStudySkill,
  mapStudySkillToDefaultActionKind,
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
