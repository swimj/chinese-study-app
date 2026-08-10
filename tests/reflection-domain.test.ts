import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  REFLECTION_OPERATION_REGISTRY,
  assertOperationApplicationTransition,
  assertProposalReviewTransition,
  classifyProposalAcceptance,
  isOperationApplicationTransitionAllowed,
  isProposalReviewTransitionAllowed,
  normalizeSessionReflectionResultV5,
  reflectionOperationWordReferences,
  validateReflectionOperation,
  validateSessionReflectionResult,
  validateSessionReflectionResultV5,
} from '../src/domain/reflection.js';
import type {
  CreateContrastClusterOperationV1,
  ReflectionOperation,
  RepairProductionCueOperationV2,
  SessionReflectionBundleV1,
  SessionReflectionBundleV2,
  SessionReflectionResultV4,
  SessionReflectionResultV5Wire,
} from '../src/domain/reflection.js';

const visibleWordIds = new Set(['target', 'alternate']);

function bundle(): SessionReflectionBundleV1 {
  return {
    schemaVersion: 'session_reflection_bundle.v1',
    generatedAt: '2026-07-29T00:00:00.000Z',
    session: {
      sessionId: 'session',
      startedAt: '2026-07-29T00:00:00.000Z',
      endedAt: '2026-07-29T00:10:00.000Z',
      studyProfile: 'mandarin',
    },
    items: [{
      itemId: 'item',
      sessionActionId: 'action',
      occurredAt: '2026-07-29T00:05:00.000Z',
      source: 'production_mistake',
      sourceActionKind: 'production',
      targetWord: {
        wordId: 'target',
        hanzi: '目标',
        pinyin: 'mùbiāo',
        meanings: ['target'],
      },
      sessionNote: null,
      existingContent: { contrastClusters: [], knownAcceptedAlternates: [] },
      cuesAsShown: [{
        cueId: null,
        cueType: 'definition_gloss',
        displayOrder: 0,
        text: 'target',
        displayedMeanings: ['target'],
      }],
      rawResponse: '替代',
      submittedWord: {
        wordId: 'alternate',
        hanzi: '替代',
        pinyin: 'tìdài',
        meanings: ['alternate'],
      },
      responseKind: 'matched_known_word',
    }],
  };
}

function result(operation: ReflectionOperation): SessionReflectionResultV4 {
  return {
    schemaVersion: 'session_reflection_result.v4',
    itemResults: [{
      itemId: 'item',
      diagnosisTags: ['persistent_confusion'],
      observation: 'The learner supplied a visible alternate.',
      learnerExplanation: null,
      proposals: [{
        proposalGroupKey: null,
        rationale: 'The two words should be contrasted.',
        operation,
      }],
      questions: [],
      unhandledNeeds: [],
    }],
  };
}

function bundleV2(): SessionReflectionBundleV2 {
  const { cuesAsShown: _legacyCuesAsShown, ...baseItem } = bundle().items[0]!;
  return {
    schemaVersion: 'session_reflection_bundle.v2',
    generatedAt: '2026-07-29T00:00:00.000Z',
    session: bundle().session,
    items: [{
      ...baseItem,
      sourceAttemptId: 'attempt-1',
      servedCue: {
        cueId: 'cue-1',
        cueType: 'definition_gloss',
        text: 'target',
        acceptedWordIds: ['target'],
      },
    }],
  };
}

function contrastOperation(): CreateContrastClusterOperationV1 {
  return {
    kind: 'create_contrast_cluster',
    version: 1,
    title: '目标 / 替代',
    clusterNote: null,
    members: [
      { wordId: 'target', nuanceNote: null },
      { wordId: 'alternate', nuanceNote: null },
    ],
    prompts: [
      { targetWordId: 'target', promptText: 'Choose the intended target.', explanation: null },
      { targetWordId: 'target', promptText: 'Use the intended target here.', explanation: null },
      { targetWordId: 'alternate', promptText: 'Choose the alternate here.', explanation: null },
      { targetWordId: 'alternate', promptText: 'Use the alternate here.', explanation: null },
    ],
  };
}

function cueRepairV2(): RepairProductionCueOperationV2 {
  return {
    kind: 'repair_production_cue',
    version: 2,
    wordId: 'target',
    taskId: 'production-task:target:default_production',
    changes: [{
      kind: 'replace',
      cueId: 'cue-1',
      replacements: [{
        cueType: 'minimal_context',
        text: 'A bounded context',
        acceptedWordIds: ['target', 'alternate'],
      }],
    }],
    sourceAttemptJudgments: [{
      kind: 'accepted_answer_space_omission',
      sourceAttemptId: 'attempt-1',
      submittedWordId: 'alternate',
    }],
  };
}

describe('reflection operation registry and validation', () => {
  test('declares editor and version-specific apply support for every operation', () => {
    assert.deepEqual(
      REFLECTION_OPERATION_REGISTRY.map(({ kind, version, editorAvailable, applySupport }) => (
        [kind, version, editorAvailable, applySupport]
      )),
      [
        ['suppress_definition_production', 1, true, 'supported'],
        ['create_contrast_cluster', 1, true, 'supported'],
        ['repair_production_cue', 1, true, 'unsupported'],
        ['repair_production_cue', 2, true, 'supported'],
        ['accept_production_alternate', 1, true, 'unsupported'],
      ],
    );
  });

  test('accepts every well-formed registered operation with visible references', () => {
    const operations: ReflectionOperation[] = [
      { kind: 'suppress_definition_production', version: 1, wordId: 'target' },
      contrastOperation(),
      {
        kind: 'repair_production_cue',
        version: 1,
        wordId: 'target',
        proposedCues: [{ cueType: 'minimal_context', text: 'A bounded context' }],
        repairIntent: 'add_contextual_triangulation',
      },
      cueRepairV2(),
      {
        kind: 'accept_production_alternate',
        version: 1,
        targetWordId: 'target',
        alternateWordId: 'alternate',
      },
    ];
    for (const operation of operations) {
      assert.deepEqual(validateReflectionOperation(operation, { allowedWordIds: visibleWordIds }), []);
    }
  });

  test('rejects unknown fields, kinds, versions, and invisible references', () => {
    assert.match(
      validateReflectionOperation({
        kind: 'suppress_definition_production',
        version: 1,
        wordId: 'target',
        rationale: 'not payload',
      }).join('\n'),
      /rationale: unknown property/,
    );
    assert.match(
      validateReflectionOperation({ kind: 'invented', version: 1 }).join('\n'),
      /unknown operation kind\/version invented@1/,
    );
    assert.match(
      validateReflectionOperation({
        kind: 'suppress_definition_production',
        version: 2,
        wordId: 'target',
      }).join('\n'),
      /unknown operation kind\/version suppress_definition_production@2/,
    );
    assert.match(
      validateReflectionOperation(
        { kind: 'suppress_definition_production', version: 1, wordId: 'hidden' },
        { allowedWordIds: visibleWordIds },
      ).join('\n'),
      /word id hidden is not known and visible/,
    );
  });

  test('enforces every deterministic contrast-cluster rule', () => {
    const invalid = contrastOperation() as CreateContrastClusterOperationV1 & Record<string, unknown>;
    invalid.title = ' ';
    invalid.members.push({ wordId: 'target', nuanceNote: null });
    invalid.prompts = [
      { targetWordId: 'hidden', promptText: ' ', explanation: null },
      { targetWordId: 'hidden', promptText: ' ', explanation: null },
    ];
    const errors = validateReflectionOperation(invalid, { allowedWordIds: visibleWordIds }).join('\n');
    assert.match(errors, /title: must not be empty/);
    assert.match(errors, /members: duplicate word id/);
    assert.match(errors, /word id hidden is not known and visible/);
    assert.match(errors, /every target must be a member/);
    assert.match(errors, /promptText: must not be empty/);
    assert.match(errors, /prompts: duplicate prompt/);

    const tooSmall = contrastOperation();
    tooSmall.members = [{ wordId: 'target', nuanceNote: null }];
    tooSmall.prompts = [];
    const sizeErrors = validateReflectionOperation(tooSmall).join('\n');
    assert.match(sizeErrors, /at least two distinct words/);
    assert.match(sizeErrors, /member target requires at least two prompts/);
  });

  test('lists member word ids as contrast-cluster word references', () => {
    const operation = contrastOperation();
    assert.deepEqual(
      reflectionOperationWordReferences(operation),
      ['target', 'alternate'],
    );
    assert.deepEqual(
      validateReflectionOperation({
        ...operation,
        prompts: [{
          targetWordId: 'alternate',
          promptText: 'Choose the alternate.',
          explanation: null,
        }],
      }, { allowedWordIds: visibleWordIds }),
      [],
    );
  });

  test('requires a concrete cue repair and distinct alternate words', () => {
    const cueErrors = validateReflectionOperation({
      kind: 'repair_production_cue',
      version: 1,
      wordId: 'target',
      proposedCues: [{ cueType: 'cloze', text: ' ' }],
      repairIntent: 'add_distinguishing_anchor',
    }).join('\n');
    assert.match(cueErrors, /text: must not be empty/);
    assert.match(
      validateReflectionOperation({
        kind: 'repair_production_cue',
        version: 1,
        wordId: 'target',
        proposedCues: [],
        repairIntent: 'add_distinguishing_anchor',
      }).join('\n'),
      /at least one replacement/,
    );
    assert.match(
      validateReflectionOperation({
        kind: 'accept_production_alternate',
        version: 1,
        targetWordId: 'target',
        alternateWordId: 'target',
      }).join('\n'),
      /must be distinct/,
    );
  });

  test('validates immutable V2 cue changes, answer spaces, and judgments', () => {
    const operation = cueRepairV2();
    assert.deepEqual(
      validateReflectionOperation(operation, { allowedWordIds: visibleWordIds }),
      [],
    );
    assert.deepEqual(
      reflectionOperationWordReferences(operation),
      ['target', 'target', 'alternate', 'alternate'],
    );

    const invalid = structuredClone(operation);
    invalid.changes.push({ kind: 'deactivate', cueId: 'cue-1' });
    const replacement = invalid.changes[0];
    assert.equal(replacement?.kind, 'replace');
    if (replacement?.kind === 'replace') {
      replacement.replacements[0]!.acceptedWordIds = ['alternate', 'alternate'];
      replacement.replacements.push({
        cueType: 'circumstance',
        text: ' ',
        acceptedWordIds: ['target'],
      });
    }
    invalid.sourceAttemptJudgments.push(structuredClone(invalid.sourceAttemptJudgments[0]!));
    const errors = validateReflectionOperation(invalid, {
      allowedWordIds: visibleWordIds,
    }).join('\n');
    assert.match(errors, /must include anchor word target/);
    assert.match(errors, /duplicate word id/);
    assert.match(errors, /text: must not be empty/);
    assert.match(errors, /cue id may be referenced by only one change/);
    assert.match(errors, /duplicate judgment/);

    const reactivation = structuredClone(operation) as unknown as Record<string, unknown>;
    reactivation.changes = [{ kind: 'activate', cueId: 'cue-1' }];
    assert.match(
      validateReflectionOperation(reactivation, { allowedWordIds: visibleWordIds }).join('\n'),
      /kind: value is not in the allowed enum/,
    );
  });
});

describe('reflection result validation', () => {
  test('accepts one strict result per supplied item and validates item-local references', () => {
    assert.deepEqual(validateSessionReflectionResult(result(contrastOperation()), bundle()), []);
  });

  test('rejects unknown result fields, duplicate item identities, and cross-item references', () => {
    const strictResult = result(contrastOperation()) as unknown as Record<string, unknown>;
    strictResult.summary = 'not part of V4';
    assert.match(
      validateSessionReflectionResult(strictResult, bundle()).join('\n'),
      /summary: unknown property/,
    );

    const resultWithBundleVersion = result(contrastOperation()) as unknown as Record<string, unknown>;
    resultWithBundleVersion.bundleSchemaVersion = 'session_reflection_bundle.v1';
    assert.match(
      validateSessionReflectionResult(resultWithBundleVersion, bundle()).join('\n'),
      /bundleSchemaVersion: unknown property/,
    );

    const duplicateResult = result(contrastOperation());
    duplicateResult.itemResults.push(structuredClone(duplicateResult.itemResults[0]!));
    const duplicateErrors = validateSessionReflectionResult(duplicateResult, bundle()).join('\n');
    assert.match(duplicateErrors, /duplicate itemId/);
    assert.match(duplicateErrors, /every input item must appear exactly once/);

    const invalidReference = result({
      kind: 'suppress_definition_production',
      version: 1,
      wordId: 'word-from-another-item',
    });
    assert.match(
      validateSessionReflectionResult(invalidReference, bundle()).join('\n'),
      /word id word-from-another-item is not present in item item/,
    );
  });

  test('rejects duplicate diagnosis tags and empty required prose', () => {
    const invalid = result(contrastOperation());
    invalid.itemResults[0]!.diagnosisTags.push('persistent_confusion');
    invalid.itemResults[0]!.observation = ' ';
    invalid.itemResults[0]!.proposals[0]!.rationale = '';
    invalid.itemResults[0]!.questions = [{ question: '', reason: '' }];
    invalid.itemResults[0]!.unhandledNeeds = [{
      description: '',
      whyRegisteredOperationsDoNotFit: '',
    }];
    const errors = validateSessionReflectionResult(invalid, bundle()).join('\n');
    assert.match(errors, /duplicate tag/);
    assert.match(errors, /observation: must not be empty/);
    assert.match(errors, /rationale: must not be empty/);
    assert.match(errors, /questions\[0\]\.question: must not be empty/);
    assert.match(errors, /unhandledNeeds\[0\]\.description: must not be empty/);
  });

  test('stamps fixed and deterministic V2 metadata at the provider boundary', () => {
    const operation = cueRepairV2();
    const { version: _version, taskId: _taskId, ...wireOperation } = operation;
    const wireResult: SessionReflectionResultV5Wire = {
      schemaVersion: 'session_reflection_result.v5',
      itemResults: [{
        ...result(contrastOperation()).itemResults[0]!,
        proposals: [{
          proposalGroupKey: null,
          rationale: 'Replace the ambiguous cue without rewriting evidence.',
          operation: wireOperation,
        }],
      }],
    };
    const normalized = normalizeSessionReflectionResultV5(wireResult);
    assert.deepEqual(normalized.itemResults[0]!.proposals[0]!.operation, operation);
    assert.deepEqual(validateSessionReflectionResultV5(normalized, bundleV2()), []);
    assert.deepEqual(wireResult.itemResults[0]!.proposals[0]!.operation, wireOperation);
  });

  test('binds V2 repairs and judgments to the exact served cue evidence', () => {
    const operation = cueRepairV2();
    const { version: _version, taskId: _taskId, ...wireOperation } = operation;
    const wireResult: SessionReflectionResultV5Wire = {
      schemaVersion: 'session_reflection_result.v5',
      itemResults: [{
        ...result(contrastOperation()).itemResults[0]!,
        proposals: [{
          proposalGroupKey: null,
          rationale: 'Repair the exact served answer space.',
          operation: wireOperation,
        }],
      }],
    };
    const normalized = normalizeSessionReflectionResultV5(wireResult);

    const terminalDeactivation = structuredClone(normalized);
    const deactivationOperation = terminalDeactivation.itemResults[0]!.proposals[0]!.operation;
    assert.equal(deactivationOperation.kind, 'repair_production_cue');
    if (deactivationOperation.kind === 'repair_production_cue' && deactivationOperation.version === 2) {
      deactivationOperation.changes = [{ kind: 'deactivate', cueId: 'cue-1' }];
      deactivationOperation.sourceAttemptJudgments = [{
        kind: 'misleading_or_overloaded_cue',
        sourceAttemptId: 'attempt-1',
      }];
    }
    assert.deepEqual(validateSessionReflectionResultV5(terminalDeactivation, bundleV2()), []);

    const wrongRepair = structuredClone(normalized);
    const wrongOperation = wrongRepair.itemResults[0]!.proposals[0]!.operation;
    assert.equal(wrongOperation.kind, 'repair_production_cue');
    if (wrongOperation.kind === 'repair_production_cue' && wrongOperation.version === 2) {
      wrongOperation.changes = [{
        kind: 'create',
        cue: {
          cueType: 'minimal_context',
          text: 'An unrelated cue',
          acceptedWordIds: ['target', 'alternate'],
        },
      }];
    }
    const wrongRepairErrors = validateSessionReflectionResultV5(wrongRepair, bundleV2()).join('\n');
    assert.match(wrongRepairErrors, /create is allowed only for fallback evidence/);
    assert.match(wrongRepairErrors, /must repair the exact served cue contract/);

    const otherServedCueBundle = bundleV2();
    otherServedCueBundle.items[0]!.servedCue.cueId = 'cue-other';
    assert.match(
      validateSessionReflectionResultV5(normalized, otherServedCueBundle).join('\n'),
      /must match the exact served cue/,
    );
  });
});

describe('reflection authorization and lifecycle rules', () => {
  test('classifies structurally exact and revised acceptance and rejects replacements', () => {
    const proposed = contrastOperation();
    const reordered = {
      version: 1,
      kind: 'create_contrast_cluster',
      prompts: structuredClone(proposed.prompts),
      members: structuredClone(proposed.members),
      clusterNote: null,
      title: proposed.title,
    } as CreateContrastClusterOperationV1;
    assert.equal(classifyProposalAcceptance(proposed, reordered), 'exact');

    const revised = structuredClone(proposed);
    revised.prompts[0]!.promptText = 'A revised prompt';
    assert.equal(classifyProposalAcceptance(proposed, revised), 'revised');
    assert.throws(
      () => classifyProposalAcceptance(
        proposed,
        { kind: 'suppress_definition_production', version: 1, wordId: 'target' },
      ),
      /must preserve operation kind and version/,
    );
  });

  test('allows only canonical proposal review transitions', () => {
    const allowed = [
      ['pending', 'deferred'],
      ['pending', 'accepted'],
      ['pending', 'dismissed'],
      ['pending', 'superseded'],
      ['deferred', 'accepted'],
      ['deferred', 'dismissed'],
      ['deferred', 'superseded'],
    ] as const;
    for (const [from, to] of allowed) {
      assert.equal(isProposalReviewTransitionAllowed(from, to), true);
      assert.doesNotThrow(() => assertProposalReviewTransition(from, to));
    }
    assert.equal(isProposalReviewTransitionAllowed('accepted', 'deferred'), false);
    assert.equal(isProposalReviewTransitionAllowed('deferred', 'pending'), false);
    assert.throws(
      () => assertProposalReviewTransition('dismissed', 'accepted'),
      /Invalid proposal review transition/,
    );
  });

  test('allows only canonical application transitions', () => {
    const allowed = [
      ['unsupported', 'pending'],
      ['unsupported', 'authorization_withdrawn'],
      ['pending', 'applied'],
      ['pending', 'failed'],
      ['pending', 'stale'],
      ['pending', 'already_satisfied'],
      ['pending', 'authorization_withdrawn'],
    ] as const;
    for (const [from, to] of allowed) {
      assert.equal(isOperationApplicationTransitionAllowed(from, to), true);
      assert.doesNotThrow(() => assertOperationApplicationTransition(from, to));
    }
    assert.equal(isOperationApplicationTransitionAllowed('unsupported', 'applied'), false);
    assert.equal(isOperationApplicationTransitionAllowed('failed', 'pending'), false);
    assert.throws(
      () => assertOperationApplicationTransition('applied', 'authorization_withdrawn'),
      /Invalid operation application transition/,
    );
  });
});
