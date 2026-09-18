import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertStrictTargetOnlyProductionSnapshot,
  type ProductionExerciseSnapshot,
  type SessionStudyItem,
} from '../src/domain/study-actions.ts';
import {
  buildProductionAnswerLookup,
  resolveAcceptedProductionResponse,
  resolveUniqueOutOfSetWordId,
} from '../src/domain/production-response.ts';
import {
  createBucketSessionState,
  markActiveSessionUnitStarted,
  rateActiveSessionUnit,
} from '../src/lib/session-state.ts';
import type { Word } from '../src/types.ts';

const targetAnswer = { wordId: 'target', hanzi: '学习', traditional: '學習' };

test('word-owned production accepts only its target forms', () => {
  assert.deepEqual(resolveAcceptedProductionResponse({
    submittedText: ' 學 習 ',
    anchorWordId: 'target',
    acceptedAnswers: [targetAnswer],
  }), {
    submittedText: ' 學 習 ',
    result: 'accepted_anchor',
  });
  assert.deepEqual(resolveAcceptedProductionResponse({
    submittedText: '研习',
    anchorWordId: 'target',
    acceptedAnswers: [targetAnswer],
  }), {
    submittedText: '研习',
    result: 'rejected',
  });
});

test('word-owned production rejects a multi-answer or non-target served snapshot', () => {
  assert.throws(() => resolveAcceptedProductionResponse({
    submittedText: '学习',
    anchorWordId: 'target',
    acceptedAnswers: [targetAnswer, { wordId: 'other', hanzi: '研习', traditional: '研習' }],
  }), /exactly one accepted answer/);
  assert.throws(() => assertStrictTargetOnlyProductionSnapshot({
    ...createProductionSnapshot(),
    acceptedAnswers: [{ wordId: 'other', hanzi: '研习', traditional: '研習' }],
  }, 'target'), /only target word/);
});

test('session creation rejects an invalid live production snapshot before it can be served', () => {
  const item: SessionStudyItem = {
    sessionActionId: 'review/target/production',
    actionKind: 'production',
    targetWordId: 'target',
    sampledSkillIds: ['production'],
    contentRef: { type: 'production_cue', taskId: 'task', cueId: 'cue' },
    intervalHours: 24,
    word: createReviewWord(),
    contrastSelection: null,
    production: {
      ...createProductionSnapshot(),
      acceptedAnswers: [targetAnswer, { wordId: 'other', hanzi: '研习', traditional: '研習' }],
    },
  };

  assert.throws(() => createBucketSessionState({
    sessionId: 'strict-production-session',
    buckets: { review: [item], learning: [], unstudied: [] },
  }), /exactly one accepted answer/);
});

test('production attempt metadata omits retired recheck demand state', () => {
  const item = createReviewProductionItem();
  const started = markActiveSessionUnitStarted(createBucketSessionState({
    sessionId: 'strict-production-metadata',
    buckets: { review: [item], learning: [], unstudied: [] },
  }));
  const result = rateActiveSessionUnit(started, 'good', {
    response: '学习',
    productionResponse: { submittedText: '学习', result: 'accepted_anchor' },
  });

  assert.equal(result.commit.type, 'commit-review-action-session');
  if (result.commit.type !== 'commit-review-action-session') {
    throw new Error('Expected a production review commit.');
  }
  const production = result.commit.events[0]?.metadata.production as Record<string, unknown>;
  assert.equal(Object.hasOwn(production, 'recheckDemandId'), false);
});

test('catalog lookup may identify a rejected response without making it an accepted answer', () => {
  const answerLookup = buildProductionAnswerLookup([
    targetAnswer,
    { wordId: 'other', hanzi: '研习', traditional: '研習' },
  ]);

  assert.equal(resolveUniqueOutOfSetWordId({
    submittedText: '研習',
    answerLookup,
    acceptedWordIds: ['target'],
  }), 'other');
});

function createProductionSnapshot(): ProductionExerciseSnapshot {
  return {
    taskId: 'task',
    cueId: 'cue',
    cueType: 'definition_gloss',
    text: 'to study',
    acceptedAnswers: [targetAnswer],
    supplement: null,
  };
}

function createReviewProductionItem(): SessionStudyItem {
  return {
    sessionActionId: 'review/target/production',
    actionKind: 'production',
    targetWordId: 'target',
    sampledSkillIds: ['production'],
    contentRef: { type: 'production_cue', taskId: 'task', cueId: 'cue' },
    intervalHours: 24,
    word: createReviewWord(),
    contrastSelection: null,
    production: createProductionSnapshot(),
  };
}

function createReviewWord(): Word {
  return {
    id: 'target',
    hanzi: '学习',
    traditional: '學習',
    pinyin: 'xue2 xi2',
    meaning: 'to study',
    meanings: ['to study'],
    personalNotes: '',
    examples: [],
    status: 'review',
    priority: 1,
    createdAt: '2026-09-19T00:00:00.000Z',
    learningStreak: 0,
    lastLearningSuccessOn: null,
    lastLearningCoveredOn: null,
  };
}
