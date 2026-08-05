import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildReviewSessionStudyItem,
  buildWordLifecycleSessionStudyItems,
  deriveReviewCommitFieldsFromAttemptEvents,
  mapStudySkillToDefaultActionKind,
  studyManagementActionRemovesCurrentReviewAction,
  type StudyAttemptEvent,
  type WordSkillState,
} from '../src/domain/study-actions.ts';
import type { Word } from '../src/types.ts';

describe('study action domain adapters', () => {
  test('maps V0 study skills to their default action kinds', () => {
    assert.equal(mapStudySkillToDefaultActionKind('recognition'), 'recognition');
    assert.equal(mapStudySkillToDefaultActionKind('production'), 'production');
    assert.equal(mapStudySkillToDefaultActionKind('contextual_selection'), 'contrast_selection');
  });

  test('keeps plain contrast candidate requests additive to the current review action', () => {
    assert.equal(studyManagementActionRemovesCurrentReviewAction('add_contrast_candidate'), false);
    assert.equal(studyManagementActionRemovesCurrentReviewAction('suppress_skill'), true);
    assert.equal(studyManagementActionRemovesCurrentReviewAction('suppress_skill_and_add_contrast_candidate'), true);
    assert.equal(studyManagementActionRemovesCurrentReviewAction('bad_prompt'), true);
  });
});

describe('session study item domain adapters', () => {
  test('builds a review session study item from word-skill state and joined word data', () => {
    const word = createWord({ id: 'review-word', status: 'review', hanzi: '复习' });
    const wordSkillState = createWordSkillState({
      wordId: word.id,
      skillId: 'recognition',
    });

    assert.deepEqual(
      buildReviewSessionStudyItem({
        wordSkillState,
        word,
      }),
      {
        sessionActionId: 'review/review-word/recognition',
        actionKind: 'recognition',
        targetWordId: word.id,
        sampledSkillIds: ['recognition'],
        contentRef: null,
        intervalHours: 24,
        word,
        contrastSelection: null,
        production: null,
      },
    );
  });

  test('builds a review production session study item with an explicit content ref and action id', () => {
    const word = createWord({ id: 'production-review-word', status: 'review' });
    const wordSkillState = createWordSkillState({
      wordId: word.id,
      skillId: 'production',
    });

    assert.deepEqual(
      buildReviewSessionStudyItem({
        wordSkillState,
        word,
        sessionActionId: 'session-1/action-9',
        contentRef: { type: 'example_sentence', id: 'example-9' },
      }),
      {
        sessionActionId: 'session-1/action-9',
        actionKind: 'production',
        targetWordId: word.id,
        sampledSkillIds: ['production'],
        contentRef: { type: 'example_sentence', id: 'example-9' },
        intervalHours: 24,
        word,
        contrastSelection: null,
        production: null,
      },
    );
  });

  test('builds synthetic learning recognition and production session study items', () => {
    const word = createWord({ id: 'learning-word', status: 'learning' });

    assert.deepEqual(buildWordLifecycleSessionStudyItems({ source: 'learning', word }), [
      {
        sessionActionId: 'learning/learning-word/recognition',
        actionKind: 'recognition',
        targetWordId: word.id,
        sampledSkillIds: ['recognition'],
        contentRef: null,
        intervalHours: 0,
        word,
        contrastSelection: null,
        production: null,
      },
      {
        sessionActionId: 'learning/learning-word/production',
        actionKind: 'production',
        targetWordId: word.id,
        sampledSkillIds: ['production'],
        contentRef: null,
        intervalHours: 0,
        word,
        contrastSelection: null,
        production: null,
      },
    ]);
  });

  test('builds synthetic unstudied recognition and production session study items', () => {
    const word = createWord({ id: 'unstudied-word', status: 'unstudied' });

    assert.deepEqual(
      buildWordLifecycleSessionStudyItems({
        source: 'unstudied',
        word,
      }).map((item) => ({
        sessionActionId: item.sessionActionId,
        actionKind: item.actionKind,
        sampledSkillIds: item.sampledSkillIds,
        word: item.word,
      })),
      [
        {
          sessionActionId: 'unstudied/unstudied-word/recognition',
          actionKind: 'recognition',
          sampledSkillIds: ['recognition'],
          word,
        },
        {
          sessionActionId: 'unstudied/unstudied-word/production',
          actionKind: 'production',
          sampledSkillIds: ['production'],
          word,
        },
      ],
    );
  });

  test('rejects review session study item word-skill mismatches', () => {
    assert.throws(
      () =>
        buildReviewSessionStudyItem({
          wordSkillState: createWordSkillState({
            wordId: 'review-word',
            skillId: 'recognition',
          }),
          word: createWord({ id: 'other-word', status: 'review' }),
        }),
      /word skill state word "review-word" must match word "other-word"/,
    );
  });

  test('rejects source and word status mismatches', () => {
    assert.throws(
      () =>
        buildReviewSessionStudyItem({
          wordSkillState: createWordSkillState({
            wordId: 'learning-word',
            skillId: 'recognition',
          }),
          word: createWord({ id: 'learning-word', status: 'learning' }),
        }),
      /review session item word "learning-word" must have review status/,
    );

    assert.throws(
      () =>
        buildWordLifecycleSessionStudyItems({
          source: 'learning',
          word: createWord({ id: 'review-word', status: 'review' }),
        }),
      /learning session item word "review-word" must have learning status/,
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

function createWordSkillState(
  overrides: Partial<WordSkillState> & Pick<WordSkillState, 'wordId' | 'skillId'>,
): WordSkillState {
  return {
    wordId: overrides.wordId,
    skillId: overrides.skillId,
    enabled: overrides.enabled ?? true,
    intervalHours: overrides.intervalHours ?? 24,
    lastStudiedAt: overrides.lastStudiedAt ?? '2026-05-10T00:00:00.000Z',
    nextDueAt: overrides.nextDueAt ?? '2026-05-11T00:00:00.000Z',
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
