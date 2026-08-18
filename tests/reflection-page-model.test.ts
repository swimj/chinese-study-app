import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type {
  CreateContrastClusterOperationV1,
  ProductionMistakeReflectionItemV2,
  ReflectionOperation,
  RepairProductionCueOperationV2,
  SessionReflectionBundleV1,
  SessionReflectionResultV4,
} from '../src/domain/reflection.js';
import {
  buildNoDurableChangeGists,
  buildReflectionItemPresentations,
  buildLearnerRequestedReflectionPresentations,
  buildReflectionProposalPresentations,
  buildReflectionHelpCards,
  collectEvidenceWordOptions,
  listQualityPromptVersions,
  presentQualityStatsArms,
  REFLECTION_QUALITY_TAG_OPTIONS,
  cloneReflectionOperation,
  createReplacementOperation,
  getOperationDraftState,
  reduceReflectionOperationDraft,
  formatRunDuration,
  visibleOutputTokens,
  type ReflectionArtifactDetailDto,
} from '../src/features/reflection/reflection-page-model.js';
import type { ReflectionQualityArmStatsDto } from '../src/services/api.js';

describe('reflection page model', () => {
  test('groups each durable proposal under its immutable item without inventing rows', () => {
    const detail = artifactDetail();
    const presentations = buildReflectionItemPresentations(detail);

    assert.equal(presentations.length, 2);
    assert.equal(presentations[0].evidence?.itemId, 'mistake');
    assert.deepEqual(
      presentations[0].proposals.map((proposal) => proposal.review.proposalId),
      ['proposal-a', 'proposal-b'],
    );
    assert.equal(presentations[1].proposals.length, 0);
  });

  test('summarizes no-proposal bundle items for by-session observability', () => {
    const detail = artifactDetail();
    const presentations = buildReflectionItemPresentations(detail);
    const gists = buildNoDurableChangeGists(detail, presentations);

    assert.equal(gists.length, 1);
    assert.deepEqual(gists[0], {
      artifactId: 'artifact',
      itemId: 'informational',
      title: '目标 · pinyin',
      diagnosisTags: ['ordinary_retrieval_noise'],
      feedback: 'Keep going.',
      responseSummary: 'Typed 替代 · pinyin',
      cueSummary: 'target',
      questionCount: 0,
    });
  });

  test('builds one help card per pending proposal and one for open explanation inbox items', () => {
    const detail = artifactDetail();
    const cards = buildReflectionHelpCards([detail]);
    assert.deepEqual(cards.map((card) => card.cardKey), [
      'proposal:proposal-a',
      'proposal:proposal-b',
      'explanation:artifact:informational',
    ]);
    assert.equal(cards[0]?.kind === 'proposal' && cards[0].result.itemId, 'mistake');
    assert.equal(cards[2]?.kind, 'explanation');
  });

  test('hides Done explanation cards from the help queue but keeps pending proposals', () => {
    const detail = artifactDetail();
    detail.helpInbox = [];
    const cards = buildReflectionHelpCards([detail]);
    assert.deepEqual(cards.map((card) => card.cardKey), [
      'proposal:proposal-a',
      'proposal:proposal-b',
    ]);

    detail.proposals[0]!.review.disposition = { kind: 'deferred' };
    const afterDefer = buildReflectionHelpCards([detail]);
    assert.deepEqual(afterDefer.map((card) => card.cardKey), [
      'proposal:proposal-b',
    ]);
  });

  test('exposes the closed item quality tag set including praise', () => {
    assert.deepEqual(
      REFLECTION_QUALITY_TAG_OPTIONS.map((option) => option.code),
      [
        'praise',
        'wrong_diagnosis',
        'wrong_intervention',
        'missed_intervention',
        'low_quality_content',
        'inconsistent',
        'other',
      ],
    );
  });

  test('filters and groups quality stats arms for the Quality table', () => {
    const arms = [
      qualityArm('luna', 'reflection-v7', { terminalReviewCount: 2, exactAcceptCount: 2, taggedItemCount: 1, praise: 1 }),
      qualityArm('luna', 'reflection-v6', { terminalReviewCount: 1, exactAcceptCount: 1, taggedItemCount: 1, praise: 1 }),
      qualityArm('glm', 'reflection-v7', { terminalReviewCount: 3, dismissCount: 1, taggedItemCount: 2, missed: 1 }),
    ];

    const currentOnly = presentQualityStatsArms(arms, {
      promptVersionFilter: 'reflection-v7',
      groupBy: 'model_and_prompt',
    });
    assert.equal(currentOnly.length, 2);
    assert.ok(currentOnly.every((arm) => arm.promptVersion === 'reflection-v7'));

    const byModel = presentQualityStatsArms(arms, {
      promptVersionFilter: 'all',
      groupBy: 'model',
    });
    const luna = byModel.find((arm) => arm.modelArm === 'luna');
    assert(luna);
    assert.equal(luna.terminalReviewCount, 3);
    assert.equal(luna.tagCounts.praise, 2);

    const byPrompt = presentQualityStatsArms(arms, {
      promptVersionFilter: 'all',
      groupBy: 'prompt',
    });
    const v7 = byPrompt.find((arm) => arm.promptVersion === 'reflection-v7');
    assert(v7);
    assert.equal(v7.terminalReviewCount, 5);
    assert.deepEqual(listQualityPromptVersions(arms), ['reflection-v6', 'reflection-v7']);
  });

  test('builds proposal queues by actionable lifecycle state without session grouping', () => {
    const openDetail = artifactDetail();
    openDetail.proposals[1].review.disposition = { kind: 'deferred' };
    const unappliedDetail = artifactDetail();
    unappliedDetail.artifactId = 'unapplied-artifact';
    unappliedDetail.proposals[0].review.disposition = {
      kind: 'accepted',
      acceptanceMode: 'exact',
      acceptedInvocationId: 'invocation-a',
    };
    unappliedDetail.proposals[0].invocation = {
      invocation: {
        invocationId: 'invocation-a',
        createdAt: '2026-07-29T12:01:00.000Z',
        origin: { kind: 'proposal_acceptance', proposalId: 'proposal-a' },
        operation: unappliedDetail.proposals[0].proposal.operation,
      },
      application: {
        invocationId: 'invocation-a',
        updatedAt: '2026-07-29T12:01:00.000Z',
        state: { kind: 'unsupported', reason: 'Not implemented yet.' },
      },
    };
    unappliedDetail.proposals[1].review.disposition = { kind: 'dismissed', reason: null };

    assert.deepEqual(
      buildReflectionProposalPresentations([openDetail, unappliedDetail], 'attention')
        .map((entry) => entry.proposal.review.proposalId),
      ['proposal-a'],
    );
    assert.deepEqual(
      buildReflectionProposalPresentations([openDetail, unappliedDetail], 'deferred')
        .map((entry) => entry.proposal.review.proposalId),
      ['proposal-b'],
    );
    assert.deepEqual(
      buildReflectionProposalPresentations([openDetail, unappliedDetail], 'unapplied')
        .map((entry) => entry.artifact.artifactId),
      ['unapplied-artifact'],
    );
  });

  test('keeps learner-requested informational feedback visible without a proposal', () => {
    const detail = artifactDetail();
    detail.evidenceBundle = {
      schemaVersion: 'session_reflection_bundle.v3',
      generatedAt: detail.evidenceBundle.generatedAt,
      session: detail.evidenceBundle.session,
      items: [{ ...v2Evidence(), learnerRequestedReview: true }],
    };
    detail.result = {
      schemaVersion: 'session_reflection_result.v5',
      itemResults: [{
        itemId: 'item', diagnosisTags: ['ordinary_retrieval_noise'],
        observation: 'The cue is usable.', learnerExplanation: 'Try retrieving the phrase in a small context.',
        proposals: [], questions: [], unhandledNeeds: [],
      }],
    };
    assert.deepEqual(
      buildLearnerRequestedReflectionPresentations([detail]).map((entry) => entry.result.learnerExplanation),
      ['Try retrieving the phrase in a small context.'],
    );
  });

  test('derives visible output tokens and formats run duration', () => {
    assert.equal(visibleOutputTokens({ outputTokens: 30, reasoningTokens: 10 }), 20);
    assert.equal(visibleOutputTokens({ outputTokens: 30, reasoningTokens: null }), 30);
    assert.equal(visibleOutputTokens({ outputTokens: null, reasoningTokens: 10 }), null);
    assert.equal(visibleOutputTokens({ outputTokens: 5, reasoningTokens: 9 }), 0);

    assert.equal(
      formatRunDuration('2026-07-29T12:00:00.000Z', '2026-07-29T12:00:00.400Z'),
      '0m 01s',
    );
    assert.equal(
      formatRunDuration('2026-07-29T12:00:00.000Z', '2026-07-29T12:00:01.000Z'),
      '0m 01s',
    );
    assert.equal(
      formatRunDuration('2026-07-29T12:00:00.000Z', '2026-07-29T12:01:05.200Z'),
      '1m 06s',
    );
  });

  test('deep clones editable generated content while retaining exact acceptance', () => {
    const original = contrastOperation();
    const draft = cloneReflectionOperation(original);

    assert.notEqual(draft, original);
    assert.notEqual(
      draft.kind === 'create_contrast_cluster' ? draft.members : null,
      original.members,
    );
    assert.equal(getOperationDraftState(original, draft).acceptanceMode, 'exact');

    const cueOriginal = cueRepairV2();
    const cueDraft = cloneReflectionOperation(cueOriginal);
    assert.equal(cueDraft.kind, 'repair_production_cue');
    assert.equal(cueDraft.kind === 'repair_production_cue' && cueDraft.version, 2);
    if (cueDraft.kind === 'repair_production_cue' && cueDraft.version === 2) {
      assert.notEqual(cueDraft.changes, cueOriginal.changes);
      assert.notEqual(cueDraft.sourceAttemptJudgments, cueOriginal.sourceAttemptJudgments);
      const replacement = cueDraft.changes[0];
      assert.equal(replacement?.kind, 'replace');
      if (replacement?.kind === 'replace') {
        assert.notEqual(replacement.replacements, cueOriginal.changes[0].kind === 'replace'
          ? cueOriginal.changes[0].replacements
          : null);
        assert.notEqual(replacement.replacements[0], cueOriginal.changes[0].kind === 'replace'
          ? cueOriginal.changes[0].replacements[0]
          : null);
        assert.notEqual(
          replacement.replacements[0]?.acceptedWordIds,
          cueOriginal.changes[0].kind === 'replace'
            ? cueOriginal.changes[0].replacements[0]?.acceptedWordIds
            : null,
        );
        replacement.replacements[0]!.acceptedWordIds.push('third');
        assert.deepEqual(
          cueOriginal.changes[0].kind === 'replace'
            ? cueOriginal.changes[0].replacements[0]?.acceptedWordIds
            : null,
          ['target', 'alternate'],
        );
      }
      assert.notEqual(cueDraft.sourceAttemptJudgments[0], cueOriginal.sourceAttemptJudgments[0]);
    }
  });

  test('edits every V2 cue lifecycle, draft, answer-space, and judgment field', () => {
    let operation: ReflectionOperation = cueRepairV2();
    operation = reduceReflectionOperationDraft(operation, {
      type: 'set_v2_cue_change_id',
      index: 0,
      cueId: 'cue-revised',
    });
    operation = reduceReflectionOperationDraft(operation, {
      type: 'update_v2_replacement',
      changeIndex: 0,
      replacementIndex: 0,
      patch: {
        cueType: 'circumstance',
        text: 'A revised circumstance',
        acceptedWordIds: ['target', 'alternate'],
      },
    });
    operation = reduceReflectionOperationDraft(operation, {
      type: 'add_v2_replacement',
      changeIndex: 0,
    });
    operation = reduceReflectionOperationDraft(operation, { type: 'add_v2_cue_change' });
    operation = reduceReflectionOperationDraft(operation, {
      type: 'update_v2_create_cue',
      changeIndex: 1,
      patch: { text: 'A created cue', acceptedWordIds: ['target'] },
    });
    operation = reduceReflectionOperationDraft(operation, { type: 'add_v2_cue_change' });
    operation = reduceReflectionOperationDraft(operation, {
      type: 'set_v2_cue_change_kind',
      index: 2,
      kind: 'deactivate',
    });
    operation = reduceReflectionOperationDraft(operation, {
      type: 'set_v2_cue_change_id',
      index: 2,
      cueId: 'cue-overloaded',
    });
    operation = reduceReflectionOperationDraft(operation, { type: 'add_v2_cue_change' });
    operation = reduceReflectionOperationDraft(operation, { type: 'add_v2_cue_judgment' });
    operation = reduceReflectionOperationDraft(operation, {
      type: 'set_v2_cue_judgment_kind',
      index: 1,
      kind: 'accepted_answer_space_omission',
    });
    operation = reduceReflectionOperationDraft(operation, {
      type: 'set_v2_cue_judgment_attempt',
      index: 1,
      sourceAttemptId: 'attempt-2',
    });
    operation = reduceReflectionOperationDraft(operation, {
      type: 'set_v2_cue_judgment_word',
      index: 1,
      submittedWordId: 'alternate',
    });
    operation = reduceReflectionOperationDraft(operation, {
      type: 'set_v2_cue_judgment_kind',
      index: 1,
      kind: 'misleading_or_overloaded_cue',
    });
    operation = reduceReflectionOperationDraft(operation, {
      type: 'remove_v2_replacement',
      changeIndex: 0,
      replacementIndex: 1,
    });
    operation = reduceReflectionOperationDraft(operation, {
      type: 'remove_v2_cue_change',
      index: 3,
    });
    operation = reduceReflectionOperationDraft(operation, {
      type: 'remove_v2_cue_judgment',
      index: 0,
    });

    assert.equal(operation.kind, 'repair_production_cue');
    assert.equal(operation.kind === 'repair_production_cue' && operation.version, 2);
    if (operation.kind === 'repair_production_cue' && operation.version === 2) {
      assert.equal(operation.changes[0]?.kind, 'replace');
      const replace = operation.changes[0];
      if (replace?.kind === 'replace') {
        assert.equal(replace.cueId, 'cue-revised');
        assert.equal(replace.replacements.length, 1);
        assert.equal(replace.replacements[0]?.cueType, 'circumstance');
      }
      assert.deepEqual(operation.changes.slice(1).map((change) => change.kind), [
        'create',
        'deactivate',
      ]);
      assert.deepEqual(operation.sourceAttemptJudgments[0], {
        kind: 'misleading_or_overloaded_cue',
        sourceAttemptId: 'attempt-2',
      });
    }
  });

  test('edits every supported and unsupported operation family through typed actions', () => {
    const suppression = reduceReflectionOperationDraft(
      { kind: 'suppress_definition_production', version: 1, wordId: 'target' },
      { type: 'set_suppression_word', wordId: 'alternate' },
    );
    assert.equal(suppression.kind === 'suppress_definition_production' && suppression.wordId, 'alternate');

    let cluster: ReflectionOperation = contrastOperation();
    cluster = reduceReflectionOperationDraft(cluster, { type: 'add_cluster_member' });
    cluster = reduceReflectionOperationDraft(cluster, {
      type: 'update_cluster_member',
      index: 2,
      patch: { wordId: 'third', nuanceNote: 'formal' },
    });
    cluster = reduceReflectionOperationDraft(cluster, { type: 'add_cluster_prompt' });
    cluster = reduceReflectionOperationDraft(cluster, {
      type: 'update_cluster_prompt',
      index: 1,
      patch: { targetWordId: 'third', promptText: 'Choose precisely.' },
    });
    assert.equal(cluster.kind === 'create_contrast_cluster' && cluster.members[2].wordId, 'third');
    assert.equal(cluster.kind === 'create_contrast_cluster' && cluster.prompts[1].targetWordId, 'third');

    let cue: ReflectionOperation = {
      kind: 'repair_production_cue',
      version: 1,
      wordId: 'target',
      repairIntent: 'add_distinguishing_anchor',
      proposedCues: [{ cueType: 'definition_gloss', text: 'old' }],
    };
    cue = reduceReflectionOperationDraft(cue, { type: 'add_replacement_cue' });
    cue = reduceReflectionOperationDraft(cue, {
      type: 'update_replacement_cue',
      index: 1,
      patch: { cueType: 'cloze', text: 'new cue' },
    });
    assert.deepEqual(
      cue.kind === 'repair_production_cue' ? cue.proposedCues[1] : null,
      { cueType: 'cloze', text: 'new cue' },
    );

    const alternate = reduceReflectionOperationDraft(
      {
        kind: 'accept_production_alternate',
        version: 1,
        targetWordId: 'target',
        alternateWordId: 'alternate',
      },
      { type: 'set_alternate_word', alternateWordId: 'third' },
    );
    assert.equal(
      alternate.kind === 'accept_production_alternate' && alternate.alternateWordId,
      'third',
    );
  });

  test('reports revised acceptance, runtime support, and deterministic draft errors', () => {
    const original = contrastOperation();
    const revised = reduceReflectionOperationDraft(original, {
      type: 'set_cluster_title',
      title: 'Revised title',
    });
    assert.deepEqual(getOperationDraftState(original, revised), {
      acceptanceMode: 'revised',
      validationErrors: [],
      applySupport: 'supported',
    });

    const unsupported = {
      kind: 'repair_production_cue',
      version: 1,
      wordId: 'target',
      repairIntent: 'add_distinguishing_anchor',
      proposedCues: [],
    } as const;
    const state = getOperationDraftState(unsupported, unsupported);
    assert.equal(state.applySupport, 'unsupported');
    assert.match(state.validationErrors[0], /at least one replacement/);

    const cue = cueRepairV2();
    assert.deepEqual(getOperationDraftState(cue, cue, v2Evidence()), {
      acceptanceMode: 'exact',
      validationErrors: [],
      applySupport: 'supported',
    });
    const revisedCue = structuredClone(cue);
    assert.equal(revisedCue.changes[0]?.kind, 'replace');
    if (revisedCue.changes[0]?.kind === 'replace') {
      revisedCue.changes[0].replacements[0]!.text = 'Revised bounded context';
      revisedCue.changes[0].replacements[0]!.acceptedWordIds = ['target'];
    }
    revisedCue.sourceAttemptJudgments = [{
      kind: 'accepted_answer_space_omission',
      sourceAttemptId: 'attempt-1',
      submittedWordId: 'alternate',
    }];
    const revisedState = getOperationDraftState(cue, revisedCue, v2Evidence());
    assert.equal(revisedState.acceptanceMode, 'revised');
    assert.equal(revisedState.applySupport, 'supported');
    assert.match(revisedState.validationErrors.join('\n'), /must be admitted/);

    const wrongCue = structuredClone(cue);
    assert.equal(wrongCue.changes[0]?.kind, 'replace');
    if (wrongCue.changes[0]?.kind === 'replace') wrongCue.changes[0].cueId = 'other-cue';
    assert.match(
      getOperationDraftState(cue, wrongCue, v2Evidence()).validationErrors.join('\n'),
      /is not owned by the evidence task|must repair the exact served cue contract/,
    );
  });

  test('collects evidence-scoped word options and disables Accept for words outside that set', () => {
    const evidence = v2Evidence();
    assert.deepEqual(
      collectEvidenceWordOptions(evidence).map((option) => option.wordId),
      ['target', 'alternate'],
    );

    const original: ReflectionOperation = {
      kind: 'suppress_definition_production',
      version: 1,
      wordId: 'target',
    };
    const invalid = { ...original, wordId: 'outsider' };
    assert.match(
      getOperationDraftState(original, invalid, evidence).validationErrors.join('\n'),
      /word id outsider is not present in item/,
    );
    assert.deepEqual(getOperationDraftState(original, original, evidence).validationErrors, []);
  });

  test('creates an editable replacement draft without treating it as a revision', () => {
    const original: ReflectionOperation = {
      kind: 'suppress_definition_production',
      version: 1,
      wordId: 'target',
    };
    const replacement = createReplacementOperation(
      'accept_production_alternate',
      1,
      original,
      artifactDetail().evidenceBundle.items[0]!,
    );

    assert.deepEqual(replacement, {
      kind: 'accept_production_alternate',
      version: 1,
      targetWordId: 'target',
      alternateWordId: 'alternate',
    });
    assert.equal(getOperationDraftState(original, replacement).acceptanceMode, 'replacement');
  });

  test('fails loudly when an editor action targets the wrong operation shape or index', () => {
    const suppression = {
      kind: 'suppress_definition_production',
      version: 1,
      wordId: 'target',
    } as const;
    assert.throws(
      () => reduceReflectionOperationDraft(suppression, {
        type: 'set_cluster_title',
        title: 'No',
      }),
      /cannot edit suppress_definition_production/,
    );
    assert.throws(
      () => reduceReflectionOperationDraft(contrastOperation(), {
        type: 'remove_cluster_prompt',
        index: 7,
      }),
      /out of range/,
    );
    assert.throws(
      () => reduceReflectionOperationDraft({
        kind: 'repair_production_cue',
        version: 1,
        wordId: 'target',
        repairIntent: 'add_distinguishing_anchor',
        proposedCues: [{ cueType: 'definition_gloss', text: 'target' }],
      }, { type: 'add_v2_cue_change' }),
      /cannot edit repair_production_cue@1/,
    );
    const createOnly = reduceReflectionOperationDraft(cueRepairV2(), {
      type: 'set_v2_cue_change_kind',
      index: 0,
      kind: 'create',
    });
    assert.throws(
      () => reduceReflectionOperationDraft(createOnly, {
        type: 'set_v2_cue_change_id',
        index: 0,
        cueId: 'cue',
      }),
      /create changes do not reference/,
    );
    assert.throws(
      () => reduceReflectionOperationDraft(createOnly, {
        type: 'add_v2_replacement',
        changeIndex: 0,
      }),
      /only replace changes/,
    );
    assert.throws(
      () => reduceReflectionOperationDraft(cueRepairV2(), {
        type: 'set_v2_cue_judgment_word',
        index: 0,
        submittedWordId: 'alternate',
      }),
      /only accepted-answer judgments/,
    );
    assert.throws(
      () => reduceReflectionOperationDraft(cueRepairV2(), {
        type: 'update_v2_create_cue',
        changeIndex: 0,
        patch: { text: 'wrong variant' },
      }),
      /only create changes/,
    );
    assert.throws(
      () => reduceReflectionOperationDraft(cueRepairV2(), {
        type: 'remove_v2_replacement',
        changeIndex: 0,
        replacementIndex: 9,
      }),
      /out of range/,
    );
  });
});

function contrastOperation(): CreateContrastClusterOperationV1 {
  return {
    kind: 'create_contrast_cluster',
    version: 1,
    title: 'Target and alternate',
    clusterNote: null,
    members: [
      { wordId: 'target', nuanceNote: null },
      { wordId: 'alternate', nuanceNote: 'wider sense' },
    ],
    prompts: [
      { targetWordId: 'target', promptText: 'Choose the narrower word.', explanation: null },
      { targetWordId: 'target', promptText: 'Use the narrower word here.', explanation: null },
      { targetWordId: 'alternate', promptText: 'Choose the wider word.', explanation: null },
      { targetWordId: 'alternate', promptText: 'Use the wider word here.', explanation: null },
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
      kind: 'misleading_or_overloaded_cue',
      sourceAttemptId: 'attempt-1',
    }],
  };
}

function v2Evidence(): ProductionMistakeReflectionItemV2 {
  return {
    itemId: 'item',
    source: 'production_mistake',
    sourceActionKind: 'production',
    sourceAttemptId: 'attempt-1',
    sessionActionId: 'action-1',
    occurredAt: '2026-07-29T11:59:00.000Z',
    targetWord: {
      wordId: 'target',
      hanzi: '目标',
      pinyin: 'mùbiāo',
      meanings: ['target'],
    },
    sessionNote: null,
    existingContent: { contrastClusters: [], knownAcceptedAlternates: [] },
    servedCue: {
      cueId: 'cue-1',
      cueType: 'definition_gloss',
      text: 'target',
      acceptedWordIds: ['target'],
    },
    rawResponse: '替代',
    submittedWord: {
      wordId: 'alternate',
      hanzi: '替代',
      pinyin: 'tìdài',
      meanings: ['alternate'],
    },
    responseKind: 'matched_known_word',
  };
}

function artifactDetail(): ReflectionArtifactDetailDto {
  const evidenceBundle: SessionReflectionBundleV1 = {
    schemaVersion: 'session_reflection_bundle.v1',
    generatedAt: '2026-07-29T12:00:00.000Z',
    session: {
      sessionId: 'session',
      startedAt: '2026-07-29T11:30:00.000Z',
      endedAt: '2026-07-29T12:00:00.000Z',
      studyProfile: 'mandarin',
    },
    items: [
      productionItem('mistake'),
      productionItem('informational'),
    ],
  };
  const result: SessionReflectionResultV4 = {
    schemaVersion: 'session_reflection_result.v4',
    itemResults: [
      {
        itemId: 'mistake',
        diagnosisTags: ['persistent_confusion'],
        observation: 'Two independently useful changes were found.',
        learnerExplanation: null,
        proposals: [
          {
            proposalGroupKey: 'pair',
            rationale: 'The production goal is low value.',
            operation: {
              kind: 'suppress_definition_production',
              version: 1,
              wordId: 'target',
            },
          },
          {
            proposalGroupKey: 'pair',
            rationale: 'The distinction needs practice.',
            operation: contrastOperation(),
          },
        ],
        questions: [],
        unhandledNeeds: [],
      },
      {
        itemId: 'informational',
        diagnosisTags: ['ordinary_retrieval_noise'],
        observation: 'No durable change is warranted.',
        learnerExplanation: 'Keep going.',
        proposals: [],
        questions: [],
        unhandledNeeds: [],
      },
    ],
  };

  return {
    artifactId: 'artifact',
    sourceSessionId: 'session',
    sourceRunId: null,
    reflectionFlowVersion: 'initial_post_session_reflection.v1',
    generatedAt: evidenceBundle.generatedAt,
    provider: 'openai-compatible',
    model: 'gpt-5.6-luna',
    promptVersion: 'reflection-v2',
    bundleSchemaVersion: evidenceBundle.schemaVersion,
    resultSchemaVersion: result.schemaVersion,
    evidenceBundle,
    result,
    proposals: result.itemResults[0].proposals.map((proposal, proposalIndex) => ({
      itemId: 'mistake',
      proposalIndex,
      proposal,
      review: {
        proposalId: proposalIndex === 0 ? 'proposal-a' : 'proposal-b',
        updatedAt: evidenceBundle.generatedAt,
        disposition: { kind: 'pending' },
      },
      invocation: null,
    })),
    qualityItemTags: [],
    helpInbox: [{
      inboxId: 'inbox-informational',
      artifactId: 'artifact',
      itemId: 'informational',
      openedAt: evidenceBundle.generatedAt,
    }],
  };
}

function productionItem(itemId: string): SessionReflectionBundleV1['items'][number] {
  return {
    itemId,
    source: 'production_mistake',
    sourceActionKind: 'production',
    sessionActionId: `action-${itemId}`,
    occurredAt: '2026-07-29T11:45:00.000Z',
    targetWord: wordSnapshot('target', '目标'),
    sessionNote: null,
    existingContent: {
      contrastClusters: [],
      knownAcceptedAlternates: [],
    },
    cuesAsShown: [{
      cueId: null,
      cueType: 'definition_gloss',
      displayOrder: 0,
      text: 'target',
      displayedMeanings: ['target'],
    }],
    rawResponse: '替代',
    submittedWord: wordSnapshot('alternate', '替代'),
    responseKind: 'matched_known_word',
  };
}

function wordSnapshot(wordId: string, hanzi: string) {
  return {
    wordId,
    hanzi,
    pinyin: 'pinyin',
    meanings: ['meaning'],
  };
}

function qualityArm(
  modelArm: string,
  promptVersion: string,
  values: {
    terminalReviewCount: number;
    exactAcceptCount?: number;
    dismissCount?: number;
    taggedItemCount?: number;
    praise?: number;
    missed?: number;
  },
): ReflectionQualityArmStatsDto {
  return {
    modelArm,
    promptVersion,
    terminalReviewCount: values.terminalReviewCount,
    exactAcceptCount: values.exactAcceptCount ?? 0,
    revisedAcceptCount: 0,
    userReplaceCount: 0,
    dismissCount: values.dismissCount ?? 0,
    taggedItemCount: values.taggedItemCount ?? 0,
    tagCounts: {
      praise: values.praise ?? 0,
      wrong_diagnosis: 0,
      wrong_intervention: 0,
      missed_intervention: values.missed ?? 0,
      low_quality_content: 0,
      inconsistent: 0,
      other: 0,
    },
  };
}
