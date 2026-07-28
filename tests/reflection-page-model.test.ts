import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type {
  CreateContrastClusterOperationV1,
  ReflectionOperation,
  SessionReflectionBundleV1,
  SessionReflectionResultV4,
} from '../src/domain/reflection.js';
import {
  buildReflectionItemPresentations,
  cloneReflectionOperation,
  getOperationDraftState,
  reduceReflectionOperationDraft,
  type ReflectionArtifactDetailDto,
} from '../src/features/reflection/reflection-page-model.js';

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

  test('deep clones editable generated content while retaining exact acceptance', () => {
    const original = contrastOperation();
    const draft = cloneReflectionOperation(original);

    assert.notEqual(draft, original);
    assert.notEqual(
      draft.kind === 'create_contrast_cluster' ? draft.members : null,
      original.members,
    );
    assert.equal(getOperationDraftState(original, draft).acceptanceMode, 'exact');
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
      {
        targetWordId: 'target',
        promptText: 'Choose the narrower word.',
        explanation: null,
      },
    ],
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
    bundleSchemaVersion: evidenceBundle.schemaVersion,
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
