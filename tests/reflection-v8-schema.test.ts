import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  validateSessionReflectionResultV7,
  validateSessionReflectionResultV8,
  type PromotePureElicitationOperationV1,
  type ReflectionItemV5,
  type SessionReflectionBundleV4,
  type SessionReflectionBundleV5,
  type SessionReflectionResultV8,
} from '../src/domain/reflection.ts';
import {
  parsePureCuePromotionBundleV1,
  parseSessionReflectionBundleV5,
} from '../src/domain/reflection-evidence.ts';

const generatedAt = '2026-09-18T01:00:00.000Z';

function word(wordId: string) {
  return { wordId, hanzi: wordId, pinyin: `${wordId}1`, meanings: [`${wordId} meaning`] };
}

function item(itemId: string, targetWordId: string, responseWordId: string): ReflectionItemV5 {
  return {
    itemId,
    source: 'production_mistake',
    sourceActionKind: 'production',
    sessionActionId: `action-${itemId}`,
    occurredAt: generatedAt,
    targetWord: word(targetWordId),
    sessionNote: null,
    existingContent: { contrastClusters: [], knownAcceptedAlternates: [] },
    sourceAttemptId: `attempt-${itemId}`,
    servedCue: {
      cueId: `cue-${targetWordId}`,
      cueType: 'definition_gloss',
      text: `broad ${targetWordId}`,
      acceptedWordIds: [targetWordId],
      supplement: null,
    },
    rawResponse: responseWordId,
    submittedWord: word(responseWordId),
    responseKind: 'matched_known_word',
    promotionEvidence: {
      diagnosisTags: ['production_cue_overloaded'],
      words: [targetWordId, responseWordId].map((wordId) => ({
        wordId,
        activeProductionCues: [{
          cueId: `cue-${wordId}`,
          taskId: `production-task:${wordId}:default_production`,
          cueType: 'definition_gloss',
          text: `broad ${wordId}`,
          acceptedWordIds: [wordId],
        }],
      })),
      intersectingPureCues: [{
        id: `pure-${targetWordId}`,
        stimulus: `shared ${targetWordId}`,
        axisNote: 'shared semantic axis',
        acceptedWordIds: [targetWordId],
      }],
    },
  };
}

function bundle(items = [item('one', 'a', 'b')]): SessionReflectionBundleV5 {
  return {
    schemaVersion: 'session_reflection_bundle.v5',
    generatedAt,
    session: {
      sessionId: 'session-1',
      startedAt: '2026-09-18T00:30:00.000Z',
      endedAt: generatedAt,
      studyProfile: 'french',
    },
    items,
  };
}

function promotion(evidence: ReflectionItemV5): PromotePureElicitationOperationV1 {
  const responseWordId = evidence.submittedWord!.wordId;
  return {
    kind: 'promote_pure_elicitation',
    version: 1,
    sourceAttemptId: evidence.sourceAttemptId,
    targetWordId: evidence.targetWord.wordId,
    responseWordId,
    destination: {
      kind: 'existing',
      pureCueId: evidence.promotionEvidence!.intersectingPureCues[0]!.id,
    },
    wordPlans: [evidence.targetWord.wordId, responseWordId].map((wordId) => ({
      wordId,
      deactivateCueIds: [`cue-${wordId}`],
      distinctiveCueDrafts: [],
    })),
  };
}

function resultFor(items: ReflectionItemV5[]): SessionReflectionResultV8 {
  return {
    schemaVersion: 'session_reflection_result.v8',
    itemResults: items.map((evidence) => ({
      itemId: evidence.itemId,
      diagnosisTags: ['production_cue_overloaded'],
      learnerExplanation: 'Use a shared elicitation and remove only the named broad cues.',
      proposals: [{
        proposalGroupKey: null,
        rationale: 'Promote the explicit pair.',
        operation: promotion(evidence),
      }],
      questions: [],
    })),
  };
}

describe('session reflection V5 evidence and V8 final result', () => {
  test('strictly preserves profile and the exact promotion evidence references', () => {
    const evidence = bundle();
    assert.equal(parseSessionReflectionBundleV5(evidence), evidence);
    const stageTwo = {
      schemaVersion: 'pure_cue_promotion_bundle.v1' as const,
      generatedAt,
      sourceSessionId: evidence.session.sessionId,
      studyProfile: evidence.session.studyProfile,
      items: [{
        itemId: evidence.items[0]!.itemId,
        sourceAttemptId: evidence.items[0]!.sourceAttemptId,
        targetWord: evidence.items[0]!.targetWord,
        responseWord: evidence.items[0]!.submittedWord!,
        servedCue: evidence.items[0]!.servedCue,
        learnerExplanation: 'The response reveals a shared axis.',
        promotionEvidence: evidence.items[0]!.promotionEvidence!,
      }],
    };
    assert.equal(parsePureCuePromotionBundleV1(stageTwo), stageTwo);

    const missingProfile = structuredClone(stageTwo) as Record<string, unknown>;
    delete missingProfile.studyProfile;
    assert.throws(() => parsePureCuePromotionBundleV1(missingProfile), /studyProfile/);
  });

  test('accepts an evidence-bound promotion and rejects unreferenced ids', () => {
    const evidence = bundle();
    const result = resultFor(evidence.items);
    assert.deepEqual(validateSessionReflectionResultV8(result, evidence), []);

    const hiddenInference = structuredClone(result);
    const operation = hiddenInference.itemResults[0]!.proposals[0]!.operation;
    assert.equal(operation.kind, 'promote_pure_elicitation');
    if (operation.kind === 'promote_pure_elicitation') {
      operation.destination = { kind: 'existing', pureCueId: 'not-in-evidence' };
    }
    assert.match(
      validateSessionReflectionResultV8(hiddenInference, evidence).join('\n'),
      /enriched intersecting pure cue/,
    );
  });

  test('rejects multi-answer word-owned drafts and cross-item conflicting ordinary proposals', () => {
    const items = [item('one', 'a', 'b'), item('two', 'c', 'b')];
    const evidence = bundle(items);
    const result = resultFor(items);
    assert.deepEqual(
      validateSessionReflectionResultV8(result, evidence),
      [],
      'different pure axes may share a member word',
    );
    result.itemResults[1]!.proposals = [{
      proposalGroupKey: null,
      rationale: 'This must not survive the promotion elsewhere.',
      operation: { kind: 'suppress_definition_production', version: 1, wordId: 'b' },
    }];
    assert.match(
      validateSessionReflectionResultV8(result, evidence).join('\n'),
      /conflicts with .*affected word b/,
    );

    const noPromotion = resultFor([items[0]!]);
    noPromotion.itemResults[0]!.proposals = [{
      proposalGroupKey: null,
      rationale: 'Invalid new broad word-owned cue.',
      operation: {
        kind: 'repair_production_cue',
        version: 2,
        wordId: 'a',
        taskId: 'production-task:a:default_production',
        changes: [{
          kind: 'create',
          cue: { cueType: 'definition_gloss', text: 'broad', acceptedWordIds: ['a', 'b'] },
        }],
        sourceAttemptJudgments: [],
      },
    }];
    assert.match(
      validateSessionReflectionResultV8(noPromotion, bundle([items[0]!])).join('\n'),
      /must accept exactly their owner/,
    );
  });

  test('keeps legacy V7 validation compatible and promotion-free', () => {
    const evidenceV5 = bundle();
    const { promotionEvidence: _promotionEvidence, ...legacyItem } = evidenceV5.items[0]!;
    const legacyBundle: SessionReflectionBundleV4 = {
      ...evidenceV5,
      schemaVersion: 'session_reflection_bundle.v4',
      items: [legacyItem],
    };
    const legacyResult = {
      schemaVersion: 'session_reflection_result.v7' as const,
      itemResults: [{
        itemId: legacyItem.itemId,
        diagnosisTags: ['ordinary_retrieval_noise' as const],
        learnerExplanation: 'Keep the existing content.',
        proposals: [],
        questions: [],
      }],
    };
    assert.deepEqual(validateSessionReflectionResultV7(legacyResult, legacyBundle), []);
  });
});
