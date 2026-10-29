import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { resolveSessionProductionResponse } from '../src/domain/production-response.ts';
import type { ProductionExerciseSnapshot } from '../src/domain/study-actions.ts';
import {
  adaptLegacyProductionSnapshot,
  adaptTargetedReviewExercise,
  toProductionExerciseSnapshot,
  type ReviewCompatibleExerciseSnapshot,
  type ReviewSourceMetadata,
} from '../src/domain/word-content/review-compat.ts';
import type { ContentExercise, WordContentDocument } from '../src/domain/word-content/types.ts';

const target = { wordId: 'word-baobei', hanzi: '报备', traditional: '報備' };
const content: WordContentDocument = {
  schemaVersion: 1,
  id: 'content-baobei-v1',
  word: { wordId: target.wordId, hanzi: target.hanzi, traditional: target.traditional, pinyin: 'bàobèi' },
  uses: [{ id: 'notify', label: 'notify someone responsible', notes: [], exampleIds: ['parking'] }],
  examples: [{
    id: 'parking',
    text: '他向物业报备了车牌。',
    translation: 'He registered his license plate with property management.',
    pronunciation: null,
  }],
};

const supplement: NonNullable<ProductionExerciseSnapshot['supplement']> = {
  supplementId: 'supplement-cue-1',
  englishFrame: 'Notify the responsible party about a visit.',
  exampleSentence: '他向物业报备了车牌。',
  exampleTranslation: 'He registered his license plate with property management.',
};

function legacySnapshot(overrides: Partial<ProductionExerciseSnapshot> = {}): ProductionExerciseSnapshot {
  return {
    taskId: 'production-task:word-baobei:default_production',
    cueId: 'cue-1',
    cueType: 'definition_gloss',
    text: 'notify someone responsible in advance',
    acceptedAnswers: [{ ...target }],
    supplement: { ...supplement },
    ...overrides,
  };
}

function reviewMetadata(overrides: Partial<ReviewSourceMetadata> = {}): ReviewSourceMetadata {
  return {
    taskId: 'production-task:word-baobei:default_production',
    cueId: 'cue-new',
    cueType: 'minimal_context',
    supplement: null,
    ...overrides,
  };
}

function authoredCloze(overrides: Partial<ContentExercise> = {}): ContentExercise {
  return {
    id: 'review-cloze-1',
    contract: { kind: 'targeted_review', wordId: target.wordId },
    instruction: '',
    responseMode: 'hanzi_entry',
    stimulus: {
      kind: 'example_cloze',
      example: { contentId: content.id, exampleId: 'parking' },
      blanks: [{ start: 4, end: 6, expectedText: '报备' }],
      frame: null,
    },
    acceptedAnswers: [target],
    ...overrides,
  };
}

function authoredDefinition(): ContentExercise {
  return authoredCloze({
    id: 'review-definition-1',
    stimulus: { kind: 'direct_text', text: 'to notify someone responsible in advance' },
  });
}

describe('review content compatibility', () => {
  test('roundtrips an existing durable cue and its exact supplement without changing any field', () => {
    const original = legacySnapshot();
    const adapted = adaptLegacyProductionSnapshot(original, target.wordId);
    assert.deepEqual(adapted.exercise.stimulus.source, { kind: 'direct_text', text: original.text });
    assert.deepEqual(adapted.review.supplementSource, { kind: 'snapshot', value: supplement });
    assert.deepEqual(toProductionExerciseSnapshot(adapted), original);
    assert.notStrictEqual(toProductionExerciseSnapshot(adapted).supplement, original.supplement);
    original.acceptedAnswers[0]!.hanzi = 'changed';
    original.supplement!.englishFrame = 'changed';
    assert.deepEqual(toProductionExerciseSnapshot(adapted), legacySnapshot());
    assert.ok(Object.isFrozen(adapted.review));
  });

  test('preserves the fallback identity and mixed framing or multiple blanks as opaque text', () => {
    for (const [index, text] of [
      'English: report in advance; 他向物业___了车牌。',
      '先___车牌，再___访客姓名。',
    ].entries()) {
      const original = legacySnapshot({ cueId: null, text, supplement: index === 0 ? supplement : null });
      const adapted = adaptLegacyProductionSnapshot(original, target.wordId);
      assert.deepEqual(adapted.exercise.stimulus.source, { kind: 'direct_text', text });
      assert.equal(adapted.review.cueId, null);
      assert.deepEqual(toProductionExerciseSnapshot(adapted), original);
    }
  });

  test('rejects a legacy answer space that is not exactly the scheduled target, including on export', () => {
    assert.throws(() => adaptLegacyProductionSnapshot(legacySnapshot({
      acceptedAnswers: [{ ...target }, { wordId: 'other', hanzi: '通知', traditional: null }],
    }), target.wordId), /exactly one accepted answer/);
    assert.throws(() => adaptLegacyProductionSnapshot(legacySnapshot({
      acceptedAnswers: [{ wordId: 'other', hanzi: '通知', traditional: null }],
    }), target.wordId), /accept only target word/);

    const adapted = adaptLegacyProductionSnapshot(legacySnapshot(), target.wordId);
    const invalid: ReviewCompatibleExerciseSnapshot = {
      ...adapted,
      exercise: {
        ...adapted.exercise,
        acceptedAnswers: [{ wordId: 'other', hanzi: '通知', traditional: null }],
      },
    };
    assert.throws(() => toProductionExerciseSnapshot(invalid), /accept only target word/);
  });

  test('materializes an explicit example cloze into the existing target matcher', () => {
    const adapted = adaptTargetedReviewExercise(authoredCloze(), [content], reviewMetadata());
    const served = toProductionExerciseSnapshot(adapted);
    assert.equal(served.taskId, 'production-task:word-baobei:default_production');
    assert.equal(served.cueId, 'cue-new');
    assert.equal(served.cueType, 'minimal_context');
    assert.notEqual(served.text, content.examples[0]?.text);
    assert.ok(!served.text.includes('报备'));
    assert.deepEqual(resolveSessionProductionResponse({
      submittedText: '報備',
      anchorWordId: target.wordId,
      production: served,
    }), { submittedText: '報備', result: 'accepted_anchor' });
    assert.deepEqual(resolveSessionProductionResponse({
      submittedText: '报告',
      anchorWordId: target.wordId,
      production: served,
    }), { submittedText: '报告', result: 'rejected' });
  });

  test('materializes a source-linked supplement while retaining exact cue metadata and source identity', () => {
    const adapted = adaptTargetedReviewExercise(authoredDefinition(), [content], reviewMetadata({
      cueId: 'cue-definition-2',
      cueType: 'definition_gloss',
      supplement: {
        kind: 'example',
        supplementId: 'supplement-2',
        englishFrame: 'Report the information to the responsible party.',
        example: { contentId: content.id, exampleId: 'parking' },
      },
    }));
    const served = toProductionExerciseSnapshot(adapted);
    assert.equal(served.cueId, 'cue-definition-2');
    assert.equal(served.text, 'to notify someone responsible in advance');
    assert.deepEqual(served.supplement, {
      supplementId: 'supplement-2',
      englishFrame: 'Report the information to the responsible party.',
      exampleSentence: content.examples[0]?.text,
      exampleTranslation: content.examples[0]?.translation,
    });
    assert.deepEqual(adapted.review.supplementSource, {
      kind: 'example',
      supplementId: 'supplement-2',
      englishFrame: 'Report the information to the responsible party.',
      example: { contentId: content.id, exampleId: 'parking' },
    });
  });

  test('keeps a source-linked supplement stable when the caller later edits source objects', () => {
    const mutableContent = {
      ...content,
      examples: content.examples.map((example) => ({ ...example })),
    };
    const source = {
      kind: 'example' as const,
      supplementId: 'supplement-3',
      englishFrame: 'Notify the responsible party.',
      example: { contentId: content.id, exampleId: 'parking' },
    };
    const adapted = adaptTargetedReviewExercise(authoredDefinition(), [mutableContent], reviewMetadata({
      cueType: 'definition_gloss', supplement: source,
    }));
    const before = toProductionExerciseSnapshot(adapted);
    mutableContent.examples[0]!.text = 'Changed example';
    mutableContent.examples[0]!.translation = 'Changed translation';
    source.englishFrame = 'Changed frame';
    source.example.exampleId = 'changed-id';
    assert.deepEqual(toProductionExerciseSnapshot(adapted), before);
    assert.deepEqual(adapted.review.supplementSource, {
      kind: 'example',
      supplementId: 'supplement-3',
      englishFrame: 'Notify the responsible party.',
      example: { contentId: content.id, exampleId: 'parking' },
    });
  });

  test('requires durable cue identity and a definition cue for authored supplements', () => {
    assert.throws(() => adaptTargetedReviewExercise(authoredDefinition(), [content], reviewMetadata({
      cueId: null,
    })), /exact durable cue and task identity/);
    assert.throws(() => adaptTargetedReviewExercise(authoredDefinition(), [content], reviewMetadata({
      taskId: ' ',
    })), /exact durable cue and task identity/);
    assert.throws(() => adaptTargetedReviewExercise(authoredDefinition(), [content], reviewMetadata({
      cueType: 'minimal_context',
      supplement: { kind: 'snapshot', value: supplement },
    })), /require a definition-gloss cue/);
    assert.throws(() => adaptTargetedReviewExercise(authoredCloze(), [content], reviewMetadata({
      cueType: 'definition_gloss',
      supplement: { kind: 'snapshot', value: supplement },
    })), /clozes require a minimal-context review cue/);
  });

  test('rejects a source-linked supplement from another word', () => {
    const foreignContent: WordContentDocument = {
      ...content,
      word: { ...content.word, wordId: 'another-word' },
    };
    assert.throws(() => adaptTargetedReviewExercise(authoredDefinition(), [foreignContent], reviewMetadata({
      cueType: 'definition_gloss',
      supplement: {
        kind: 'example',
        supplementId: 'supplement-foreign',
        englishFrame: 'Another word',
        example: { contentId: content.id, exampleId: 'parking' },
      },
    })), /must belong to the reviewed word/);
  });

  test('rejects rehearsal, pure review, and an instruction the old snapshot cannot preserve', () => {
    assert.throws(() => adaptTargetedReviewExercise(authoredCloze({
      contract: { kind: 'target_rehearsal', wordId: target.wordId },
    }), [content], reviewMetadata()), /Only targeted review/);
    assert.throws(() => adaptTargetedReviewExercise(authoredCloze({
      contract: { kind: 'pure_review', axisNote: 'Any suitable notification term' },
    }), [content], reviewMetadata()), /Only targeted review/);
    assert.throws(() => adaptTargetedReviewExercise(authoredCloze({
      instruction: 'Recall the exact taught expression.',
    }), [content], reviewMetadata()), /cannot preserve a separate review instruction/);
  });
});
