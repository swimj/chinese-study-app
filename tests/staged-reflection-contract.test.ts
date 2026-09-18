import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  normalizeStagedReflectionDiagnosisResultV1,
  validatePureCuePromotionResultV1,
  validateStagedReflectionDiagnosisResultV1,
  type PureCuePromotionBundleV1,
  type ReflectionItemV4,
  type SessionReflectionBundleV4,
  type StagedReflectionDiagnosisResultV1Wire,
} from '../src/domain/reflection.ts';
import {
  pureCuePromotionResultV1WireSchema,
  stagedReflectionDiagnosisResultV1WireSchema,
} from '../src/domain/reflection-result-schema.ts';
import { validateJsonSchema } from '../server/llm/json-schema-validator.ts';

const generatedAt = '2026-09-21T08:00:00.000Z';

function word(wordId: string) {
  return { wordId, hanzi: wordId, pinyin: `${wordId}1`, meanings: [`${wordId} meaning`] };
}

function item(overrides: Partial<ReflectionItemV4> = {}): ReflectionItemV4 {
  return {
    itemId: 'item-1',
    source: 'production_mistake',
    sourceActionKind: 'production',
    sessionActionId: 'action-1',
    occurredAt: generatedAt,
    targetWord: word('target'),
    sessionNote: null,
    existingContent: { contrastClusters: [], knownAcceptedAlternates: [] },
    sourceAttemptId: 'attempt-1',
    servedCue: {
      cueId: 'cue-target',
      cueType: 'definition_gloss',
      text: 'shared meaning',
      acceptedWordIds: ['target'],
      supplement: null,
    },
    rawResponse: 'response',
    submittedWord: word('response'),
    responseKind: 'matched_known_word',
    ...overrides,
  };
}

function bundle(inputItem = item()): SessionReflectionBundleV4 {
  return {
    schemaVersion: 'session_reflection_bundle.v4',
    generatedAt,
    session: {
      sessionId: 'session-1',
      startedAt: null,
      endedAt: generatedAt,
      studyProfile: 'mandarin',
    },
    items: [inputItem],
  };
}

function sharedAxisWire(): StagedReflectionDiagnosisResultV1Wire {
  return {
    schemaVersion: 'staged_reflection_diagnosis_result.v1',
    itemResults: [{
      kind: 'shared_axis',
      itemId: 'item-1',
      diagnosisTags: ['cue_overlap_hides_usage_difference'],
      handoff: {
        axis: 'one bounded shared meaning',
        boundaries: 'The words differ outside this meaning and in common constructions.',
        responseValidity: 'The rejected response naturally answers the exact shared meaning.',
      },
    }],
  };
}

describe('staged reflection diagnosis contract', () => {
  test('derives repair identity, ownership and create/replace from retained evidence', () => {
    const evidence = bundle();
    const wire: StagedReflectionDiagnosisResultV1Wire = {
      schemaVersion: 'staged_reflection_diagnosis_result.v1',
      itemResults: [{
        kind: 'ordinary',
        itemId: 'item-1',
        diagnosisTags: ['production_cue_overloaded'],
        learnerExplanation: 'The cue is too broad, but the response does not need shared elicitation.',
        proposals: [{
          proposalGroupKey: null,
          rationale: 'Replace the exact broad cue with a target-specific cue.',
          operation: {
            kind: 'repair_production_cue',
            replacementCues: [{ cueType: 'minimal_context', text: 'A context that evokes target.' }],
            sourceAttemptJudgments: [{ kind: 'misleading_or_overloaded_cue' }],
          },
        }],
        questions: [],
      }],
    };

    assert.deepEqual(validateJsonSchema(wire, stagedReflectionDiagnosisResultV1WireSchema), []);
    const normalized = normalizeStagedReflectionDiagnosisResultV1(wire, evidence);
    assert.deepEqual(validateStagedReflectionDiagnosisResultV1(normalized, evidence), []);
    const result = normalized.itemResults[0]!;
    assert.equal(result.kind, 'ordinary');
    if (result.kind !== 'ordinary') throw new Error('Expected ordinary result.');
    const operation = result.proposals[0]!.operation;
    assert.equal(operation.kind, 'repair_production_cue');
    if (operation.kind !== 'repair_production_cue' || operation.version !== 2) throw new Error('Expected cue repair.');
    assert.equal(operation.version, 2);
    assert.equal(operation.taskId, 'production-task:target:default_production');
    assert.equal(operation.sourceAttemptJudgments[0]?.sourceAttemptId, 'attempt-1');
    assert.deepEqual(operation.changes, [{
      kind: 'replace', cueId: 'cue-target',
      replacements: [{ cueType: 'minimal_context', text: 'A context that evokes target.', acceptedWordIds: ['target'] }],
    }]);

    const fallback = bundle(item({ servedCue: { ...evidence.items[0]!.servedCue, cueId: null } }));
    const fallbackResult = normalizeStagedReflectionDiagnosisResultV1(wire, fallback);
    assert.deepEqual(validateStagedReflectionDiagnosisResultV1(fallbackResult, fallback), []);
    const fallbackItem = fallbackResult.itemResults[0]!;
    if (fallbackItem.kind !== 'ordinary') throw new Error('Expected ordinary result.');
    const fallbackOperation = fallbackItem.proposals[0]!.operation;
    if (fallbackOperation.kind !== 'repair_production_cue' || fallbackOperation.version !== 2) throw new Error('Expected repair');
    assert.deepEqual(fallbackOperation.changes, [{
      kind: 'create', cue: { cueType: 'minimal_context', text: 'A context that evokes target.', acceptedWordIds: ['target'] },
    }]);

    const synthetic = bundle(item({ sourceAttemptId: 'synthetic-reflection-attempt:review' }));
    const syntheticItem = normalizeStagedReflectionDiagnosisResultV1(wire, synthetic).itemResults[0]!;
    if (syntheticItem.kind !== 'ordinary') throw new Error('Expected ordinary result.');
    const syntheticOperation = syntheticItem.proposals[0]!.operation;
    if (syntheticOperation.kind !== 'repair_production_cue') throw new Error('Expected repair');
    assert.deepEqual(syntheticOperation.sourceAttemptJudgments, []);

    for (const extra of [{ cueId: 'forged' }, { acceptedWordIds: ['target', 'response'] }]) {
      const malformed = structuredClone(wire);
      const malformedItem = malformed.itemResults[0]!;
      if (malformedItem.kind !== 'ordinary') throw new Error('Expected ordinary');
      const malformedOperation = malformedItem.proposals[0]!.operation;
      if (malformedOperation.kind !== 'repair_production_cue') throw new Error('Expected repair');
      Object.assign(malformedOperation.replacementCues[0]!, extra);
      assert.notDeepEqual(validateJsonSchema(malformed, stagedReflectionDiagnosisResultV1WireSchema), []);
    }
    const wrongOwner = structuredClone(wire);
    const wrongOwnerItem = wrongOwner.itemResults[0]!;
    if (wrongOwnerItem.kind !== 'ordinary') throw new Error('Expected ordinary');
    const wrongOwnerOperation = wrongOwnerItem.proposals[0]!.operation;
    if (wrongOwnerOperation.kind !== 'repair_production_cue') throw new Error('Expected repair');
    Object.assign(wrongOwnerOperation, { wordId: 'response' });
    assert.notDeepEqual(validateJsonSchema(wrongOwner, stagedReflectionDiagnosisResultV1WireSchema), []);

    for (const targetOperation of [
      { kind: 'suppress_definition_production' as const, version: 1 as const },
      { kind: 'add_production_cue_supplement' as const,
        englishFrame: 'A useful frame', exampleSentence: '目标', exampleTranslation: 'Target' },
    ]) {
      const targetWire = structuredClone(wire);
      const targetItem = targetWire.itemResults[0]!;
      if (targetItem.kind !== 'ordinary') throw new Error('Expected ordinary');
      targetItem.proposals[0]!.operation = targetOperation;
      assert.deepEqual(validateJsonSchema(targetWire, stagedReflectionDiagnosisResultV1WireSchema), []);
      const targetResult = normalizeStagedReflectionDiagnosisResultV1(targetWire, evidence).itemResults[0]!;
      if (targetResult.kind !== 'ordinary') throw new Error('Expected ordinary');
      assert.equal('wordId' in targetResult.proposals[0]!.operation
        && targetResult.proposals[0]!.operation.wordId, 'target');
      Object.assign(targetItem.proposals[0]!.operation, { wordId: 'response' });
      assert.notDeepEqual(validateJsonSchema(targetWire, stagedReflectionDiagnosisResultV1WireSchema), []);
    }
    const unknownItem = structuredClone(wire);
    unknownItem.itemResults[0]!.itemId = 'missing';
    assert.throws(() => normalizeStagedReflectionDiagnosisResultV1(unknownItem, evidence), /Unknown staged reflection item/);

    const emptyRepair = structuredClone(wire);
    const emptyItem = emptyRepair.itemResults[0]!;
    if (emptyItem.kind !== 'ordinary') throw new Error('Expected ordinary');
    const emptyOperation = emptyItem.proposals[0]!.operation;
    if (emptyOperation.kind !== 'repair_production_cue') throw new Error('Expected repair');
    emptyOperation.replacementCues = [];
    assert.notDeepEqual(validateJsonSchema(emptyRepair, stagedReflectionDiagnosisResultV1WireSchema), []);
    const unsupportedJudgment = structuredClone(wire);
    const judgmentItem = unsupportedJudgment.itemResults[0]!;
    if (judgmentItem.kind !== 'ordinary') throw new Error('Expected ordinary');
    const judgmentOperation = judgmentItem.proposals[0]!.operation;
    if (judgmentOperation.kind !== 'repair_production_cue') throw new Error('Expected repair');
    Object.assign(judgmentOperation.sourceAttemptJudgments[0]!, { sourceAttemptId: 'forged' });
    assert.notDeepEqual(validateJsonSchema(unsupportedJudgment, stagedReflectionDiagnosisResultV1WireSchema), []);
  });

  test('fails loudly when an ordinary result drafts a multi-answer word-owned cue', () => {
    const evidence = bundle();
    const wire = {
      schemaVersion: 'staged_reflection_diagnosis_result.v1',
      itemResults: [{
        kind: 'ordinary',
        itemId: 'item-1',
        diagnosisTags: ['valid_or_near_valid_alternate'],
        learnerExplanation: 'This invalid ordinary path tries to broaden a word-owned cue.',
        proposals: [{
          proposalGroupKey: null,
          rationale: 'Invalid shared acceptance in the ordinary path.',
          operation: {
            kind: 'repair_production_cue',
            wordId: 'target',
            changes: [{
              kind: 'replace',
              cueId: 'cue-target',
              replacements: [{
                cueType: 'definition_gloss',
                text: 'shared meaning',
                acceptedWordIds: ['target', 'response'],
              }],
            }],
            sourceAttemptJudgments: [{
              kind: 'accepted_answer_space_omission',
              submittedWordId: 'response',
            }],
          },
        }],
        questions: [],
      }],
    };
    assert.notDeepEqual(validateJsonSchema(wire, stagedReflectionDiagnosisResultV1WireSchema), []);
  });

  test('keeps shared-axis output exclusive and rejects ineligible routing without tag heuristics', () => {
    const evidence = bundle();
    const wire = sharedAxisWire();
    assert.deepEqual(validateJsonSchema(wire, stagedReflectionDiagnosisResultV1WireSchema), []);
    assert.deepEqual(validateStagedReflectionDiagnosisResultV1(wire, evidence), []);

    const muddy = structuredClone(wire) as unknown as { itemResults: Array<Record<string, unknown>> };
    muddy.itemResults[0]!.learnerExplanation = 'Not allowed on a shared-axis handoff.';
    assert.match(
      validateJsonSchema(muddy, stagedReflectionDiagnosisResultV1WireSchema).join('\n'),
      /does not match any allowed schema/,
    );

    const unrelatedTags = structuredClone(wire);
    unrelatedTags.itemResults[0]!.diagnosisTags = ['ordinary_retrieval_noise'];
    assert.deepEqual(
      validateStagedReflectionDiagnosisResultV1(unrelatedTags, evidence),
      [],
      'routing is explicit and does not depend on a diagnosis-tag heuristic',
    );

    const ineligible = bundle(item({
      servedCue: {
        ...item().servedCue,
        acceptedWordIds: ['target', 'response'],
      },
    }));
    assert.match(
      validateStagedReflectionDiagnosisResultV1(wire, ineligible).join('\n'),
      /shared_axis requires a rejected strict target-only production attempt/,
    );
  });

  test('does not offer unsupported persistence claims in the staged diagnosis tags', () => {
    const wire = sharedAxisWire();
    Object.assign(wire.itemResults[0]!, { diagnosisTags: ['persistent_confusion'] });
    assert.notDeepEqual(validateJsonSchema(wire, stagedReflectionDiagnosisResultV1WireSchema), []);
    assert.match(validateStagedReflectionDiagnosisResultV1(wire, bundle()).join('\n'), /persistent_confusion is not available/);
  });
});

describe('promotion reconciliation contract', () => {
  const promotionBundle: PureCuePromotionBundleV1 = {
    schemaVersion: 'pure_cue_promotion_bundle.v1',
    generatedAt,
    sourceSessionId: 'session-1',
    studyProfile: 'mandarin',
    items: [{
      itemId: 'item-1',
      sourceAttemptId: 'attempt-1',
      targetWord: word('target'),
      responseWord: word('response'),
      servedCue: item().servedCue,
      handoff: sharedAxisWire().itemResults[0]!.kind === 'shared_axis'
        ? sharedAxisWire().itemResults[0]!.handoff
        : { axis: '', boundaries: '', responseValidity: '' },
      promotionEvidence: {
        diagnosisTags: ['cue_overlap_hides_usage_difference'],
        words: ['target', 'response'].map((wordId) => ({
          wordId,
          activeProductionCues: [],
        })),
        intersectingPureCues: [],
      },
    }],
  };

  test('requires learner-facing text for promote and permits only explicit disagreement otherwise', () => {
    const promote = {
      schemaVersion: 'pure_cue_promotion_result.v1',
      itemResults: [{
        itemId: 'item-1',
        decision: {
          kind: 'promote',
          rationale: 'The explicit shared axis is useful.',
          learnerExplanation: 'Both words fit this bounded prompt, while their broader uses remain distinct.',
          operation: {
            destination: {
              kind: 'create',
              stimulus: 'one bounded shared meaning',
              axisNote: 'The shared axis described by stage 1.',
            },
            wordPlans: ['target', 'response'].map((wordId) => ({
              wordId,
              deactivateCueIds: [],
              distinctiveCueDrafts: [],
            })),
          },
        },
      }],
    };
    assert.deepEqual(validateJsonSchema(promote, pureCuePromotionResultV1WireSchema), []);
    assert.deepEqual(validatePureCuePromotionResultV1(promote, promotionBundle), []);

    const disagreement = {
      schemaVersion: 'pure_cue_promotion_result.v1',
      itemResults: [{
        itemId: 'item-1',
        decision: {
          kind: 'disagreement',
          learnerExplanation: 'On review, the proposed shared axis would erase an important usage boundary.',
        },
      }],
    };
    assert.deepEqual(validateJsonSchema(disagreement, pureCuePromotionResultV1WireSchema), []);
    assert.deepEqual(validatePureCuePromotionResultV1(disagreement, promotionBundle), []);

    const retiredNoPromotion = structuredClone(disagreement) as unknown as {
      itemResults: Array<{ decision: Record<string, unknown> }>;
    };
    retiredNoPromotion.itemResults[0]!.decision = {
      kind: 'no_promotion',
      rationale: 'Retired shape.',
    };
    assert.notDeepEqual(validateJsonSchema(retiredNoPromotion, pureCuePromotionResultV1WireSchema), []);
  });
});
