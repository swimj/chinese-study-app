import type {
  AcceptProductionAlternateOperationV1,
  CreateContrastClusterOperationV1,
  ReflectionInputItemV1,
  ReflectionItemResultV1,
  ReflectionOperation,
  RepairProductionCueOperationV1,
} from '../../domain/reflection';
import type {
  ReflectionArtifactDetailDto,
  ReflectionProposalDetailDto,
  ReflectionGenerationRunDto,
} from '../../services/api';
import {
  classifyProposalAcceptance,
  getReflectionOperationRegistration,
  validateReflectionOperation,
} from '../../domain/reflection';

export type ReflectionItemPresentation = {
  evidence: ReflectionInputItemV1 | null;
  result: ReflectionItemResultV1;
  proposals: ReflectionProposalDetailDto[];
};

export type ReflectionProposalQueueKind = 'attention' | 'deferred' | 'unapplied';

export type ReflectionProposalPresentation = {
  artifact: ReflectionArtifactDetailDto;
  evidence: ReflectionInputItemV1 | null;
  result: ReflectionItemResultV1;
  proposal: ReflectionProposalDetailDto;
};

export type ReflectionTokenUsageSummary = {
  runCount: number;
  succeededCount: number;
  failedCount: number;
  usage: {
    inputTokens: number | null;
    cachedInputTokens: number | null;
    cacheWriteInputTokens: number | null;
    outputTokens: number | null;
    reasoningTokens: number | null;
    totalTokens: number | null;
  };
  pricedRunCount: number;
  estimatedCostUsd: number | null;
};

export function buildReflectionItemPresentations(
  detail: ReflectionArtifactDetailDto,
): ReflectionItemPresentation[] {
  const evidenceByItemId = new Map(
    detail.evidenceBundle.items.map((item) => [item.itemId, item]),
  );
  const proposalsByItemId = new Map<string, ReflectionProposalDetailDto[]>();
  for (const proposal of detail.proposals) {
    const proposals = proposalsByItemId.get(proposal.itemId) ?? [];
    proposals.push(proposal);
    proposalsByItemId.set(proposal.itemId, proposals);
  }

  return detail.result.itemResults.map((result) => ({
    evidence: evidenceByItemId.get(result.itemId) ?? null,
    result,
    proposals: proposalsByItemId.get(result.itemId) ?? [],
  }));
}

export function buildReflectionProposalPresentations(
  details: ReflectionArtifactDetailDto[],
  kind: ReflectionProposalQueueKind,
): ReflectionProposalPresentation[] {
  const presentations: ReflectionProposalPresentation[] = [];

  for (const artifact of details) {
    const evidenceByItemId = new Map(
      artifact.evidenceBundle.items.map((item) => [item.itemId, item]),
    );
    const resultByItemId = new Map(
      artifact.result.itemResults.map((result) => [result.itemId, result]),
    );

    for (const proposal of artifact.proposals) {
      if (!proposalBelongsInQueue(proposal, kind)) continue;
      const result = resultByItemId.get(proposal.itemId);
      if (result === undefined) {
        throw new Error(
          `Reflection proposal ${proposal.review.proposalId} has no matching item result.`,
        );
      }
      presentations.push({
        artifact,
        evidence: evidenceByItemId.get(proposal.itemId) ?? null,
        result,
        proposal,
      });
    }
  }

  return presentations;
}

export function summarizeReflectionTokenUsage(
  runs: ReflectionGenerationRunDto[],
): ReflectionTokenUsageSummary {
  const pricedRuns = runs.filter((run) => run.estimatedCostUsd !== null);
  return {
    runCount: runs.length,
    succeededCount: runs.filter((run) => run.state === 'succeeded').length,
    failedCount: runs.filter((run) => run.state === 'failed').length,
    usage: {
      inputTokens: sumKnown(runs.map((run) => run.usage.inputTokens)),
      cachedInputTokens: sumKnown(runs.map((run) => run.usage.cachedInputTokens)),
      cacheWriteInputTokens: sumKnown(runs.map((run) => run.usage.cacheWriteInputTokens)),
      outputTokens: sumKnown(runs.map((run) => run.usage.outputTokens)),
      reasoningTokens: sumKnown(runs.map((run) => run.usage.reasoningTokens)),
      totalTokens: sumKnown(runs.map((run) => run.usage.totalTokens)),
    },
    pricedRunCount: pricedRuns.length,
    estimatedCostUsd: pricedRuns.length === 0
      ? null
      : pricedRuns.reduce((total, run) => total + (run.estimatedCostUsd ?? 0), 0),
  };
}

function proposalBelongsInQueue(
  proposal: ReflectionProposalDetailDto,
  kind: ReflectionProposalQueueKind,
): boolean {
  switch (kind) {
    case 'attention':
      return proposal.review.disposition.kind === 'pending';
    case 'deferred':
      return proposal.review.disposition.kind === 'deferred';
    case 'unapplied':
      return proposal.review.disposition.kind === 'accepted'
        && proposal.invocation !== null
        && (
          proposal.invocation.application.state.kind === 'unsupported'
          || proposal.invocation.application.state.kind === 'pending'
        );
  }
}

function sumKnown(values: Array<number | null>): number | null {
  const knownValues = values.filter((value): value is number => value !== null);
  return knownValues.length === 0
    ? null
    : knownValues.reduce((total, value) => total + value, 0);
}

export function cloneReflectionOperation(operation: ReflectionOperation): ReflectionOperation {
  switch (operation.kind) {
    case 'suppress_definition_production':
      return { ...operation };
    case 'create_contrast_cluster':
      return {
        ...operation,
        members: operation.members.map((member) => ({ ...member })),
        prompts: operation.prompts.map((prompt) => ({ ...prompt })),
      };
    case 'repair_production_cue':
      if (operation.version === 2) {
        return {
          ...operation,
          changes: operation.changes.map((change) => {
            switch (change.kind) {
              case 'create':
                return {
                  ...change,
                  cue: { ...change.cue, acceptedWordIds: [...change.cue.acceptedWordIds] },
                };
              case 'replace':
                return {
                  ...change,
                  replacements: change.replacements.map((cue) => ({
                    ...cue,
                    acceptedWordIds: [...cue.acceptedWordIds],
                  })),
                };
              case 'deactivate':
                return { ...change };
            }
          }),
          sourceAttemptJudgments: operation.sourceAttemptJudgments.map((judgment) => ({
            ...judgment,
          })),
        };
      }
      return {
        ...operation,
        proposedCues: operation.proposedCues.map((cue) => ({ ...cue })),
      };
    case 'accept_production_alternate':
      return { ...operation };
  }
}

export type ReflectionOperationDraftAction =
  | { type: 'set_suppression_word'; wordId: string }
  | { type: 'set_cluster_title'; title: string }
  | { type: 'set_cluster_note'; clusterNote: string | null }
  | { type: 'add_cluster_member' }
  | { type: 'remove_cluster_member'; index: number }
  | {
      type: 'update_cluster_member';
      index: number;
      patch: Partial<CreateContrastClusterOperationV1['members'][number]>;
    }
  | { type: 'add_cluster_prompt' }
  | { type: 'remove_cluster_prompt'; index: number }
  | {
      type: 'update_cluster_prompt';
      index: number;
      patch: Partial<CreateContrastClusterOperationV1['prompts'][number]>;
    }
  | { type: 'set_cue_word'; wordId: string }
  | {
      type: 'set_repair_intent';
      repairIntent: RepairProductionCueOperationV1['repairIntent'];
    }
  | { type: 'add_replacement_cue' }
  | { type: 'remove_replacement_cue'; index: number }
  | {
      type: 'update_replacement_cue';
      index: number;
      patch: Partial<RepairProductionCueOperationV1['proposedCues'][number]>;
    }
  | { type: 'set_alternate_target'; targetWordId: string }
  | { type: 'set_alternate_word'; alternateWordId: string };

export function reduceReflectionOperationDraft(
  operation: ReflectionOperation,
  action: ReflectionOperationDraftAction,
): ReflectionOperation {
  switch (action.type) {
    case 'set_suppression_word':
      return editOperation(
        operation,
        'suppress_definition_production',
        action.type,
        (current) => ({ ...current, wordId: action.wordId }),
      );
    case 'set_cluster_title':
      return editOperation(
        operation,
        'create_contrast_cluster',
        action.type,
        (current) => ({ ...current, title: action.title }),
      );
    case 'set_cluster_note':
      return editOperation(
        operation,
        'create_contrast_cluster',
        action.type,
        (current) => ({ ...current, clusterNote: action.clusterNote }),
      );
    case 'add_cluster_member':
      return editOperation(
        operation,
        'create_contrast_cluster',
        action.type,
        (current) => ({
          ...current,
          members: [...current.members, { wordId: '', nuanceNote: null }],
        }),
      );
    case 'remove_cluster_member':
      return editOperation(
        operation,
        'create_contrast_cluster',
        action.type,
        (current) => ({
          ...current,
          members: removeAt(current.members, action.index, 'cluster member'),
        }),
      );
    case 'update_cluster_member':
      return editOperation(
        operation,
        'create_contrast_cluster',
        action.type,
        (current) => ({
          ...current,
          members: updateAt(
            current.members,
            action.index,
            (member) => ({ ...member, ...action.patch }),
            'cluster member',
          ),
        }),
      );
    case 'add_cluster_prompt':
      return editOperation(
        operation,
        'create_contrast_cluster',
        action.type,
        (current) => ({
          ...current,
          prompts: [
            ...current.prompts,
            {
              targetWordId: current.members[0]?.wordId ?? '',
              promptText: '',
              explanation: null,
            },
          ],
        }),
      );
    case 'remove_cluster_prompt':
      return editOperation(
        operation,
        'create_contrast_cluster',
        action.type,
        (current) => ({
          ...current,
          prompts: removeAt(current.prompts, action.index, 'cluster prompt'),
        }),
      );
    case 'update_cluster_prompt':
      return editOperation(
        operation,
        'create_contrast_cluster',
        action.type,
        (current) => ({
          ...current,
          prompts: updateAt(
            current.prompts,
            action.index,
            (prompt) => ({ ...prompt, ...action.patch }),
            'cluster prompt',
          ),
        }),
      );
    case 'set_cue_word':
      return editRepairCueV1(
        operation,
        action.type,
        (current) => ({ ...current, wordId: action.wordId }),
      );
    case 'set_repair_intent':
      return editRepairCueV1(
        operation,
        action.type,
        (current) => ({ ...current, repairIntent: action.repairIntent }),
      );
    case 'add_replacement_cue':
      return editRepairCueV1(
        operation,
        action.type,
        (current) => ({
          ...current,
          proposedCues: [
            ...current.proposedCues,
            { cueType: 'definition_gloss', text: '' },
          ],
        }),
      );
    case 'remove_replacement_cue':
      return editRepairCueV1(
        operation,
        action.type,
        (current) => ({
          ...current,
          proposedCues: removeAt(current.proposedCues, action.index, 'replacement cue'),
        }),
      );
    case 'update_replacement_cue':
      return editRepairCueV1(
        operation,
        action.type,
        (current) => ({
          ...current,
          proposedCues: updateAt(
            current.proposedCues,
            action.index,
            (cue) => ({ ...cue, ...action.patch }),
            'replacement cue',
          ),
        }),
      );
    case 'set_alternate_target':
      return editOperation(
        operation,
        'accept_production_alternate',
        action.type,
        (current) => ({ ...current, targetWordId: action.targetWordId }),
      );
    case 'set_alternate_word':
      return editOperation(
        operation,
        'accept_production_alternate',
        action.type,
        (current) => ({ ...current, alternateWordId: action.alternateWordId }),
      );
  }
}

export function getOperationDraftState(
  original: ReflectionOperation,
  draft: ReflectionOperation,
): {
  acceptanceMode: 'exact' | 'revised';
  validationErrors: string[];
  applySupport: 'supported' | 'unsupported';
} {
  const registration = getReflectionOperationRegistration(draft.kind, draft.version);
  if (registration === null) {
    throw new Error(`Invariant violated: unregistered operation ${draft.kind}@${draft.version}.`);
  }
  return {
    acceptanceMode: classifyProposalAcceptance(original, draft),
    validationErrors: validateReflectionOperation(draft),
    applySupport: registration.applySupport,
  };
}

export function reflectionOperationLabel(operation: ReflectionOperation): string {
  switch (operation.kind) {
    case 'suppress_definition_production':
      return 'Suppress definition production';
    case 'create_contrast_cluster':
      return 'Create contrast cluster';
    case 'repair_production_cue':
      return 'Repair production cue';
    case 'accept_production_alternate':
      return 'Accept production alternate';
  }
}

function editOperation<K extends ReflectionOperation['kind']>(
  operation: ReflectionOperation,
  expectedKind: K,
  actionType: string,
  update: (
    current: Extract<ReflectionOperation, { kind: K }>,
  ) => Extract<ReflectionOperation, { kind: K }>,
): Extract<ReflectionOperation, { kind: K }> {
  if (operation.kind !== expectedKind) {
    throw new Error(
      `Invariant violated: ${actionType} cannot edit ${operation.kind}@${operation.version}.`,
    );
  }
  return update(operation as Extract<ReflectionOperation, { kind: K }>);
}

function editRepairCueV1(
  operation: ReflectionOperation,
  actionType: string,
  update: (current: RepairProductionCueOperationV1) => RepairProductionCueOperationV1,
): RepairProductionCueOperationV1 {
  if (operation.kind !== 'repair_production_cue' || operation.version !== 1) {
    throw new Error(
      `Invariant violated: ${actionType} cannot edit ${operation.kind}@${operation.version}.`,
    );
  }
  return update(operation);
}

function updateAt<T>(
  values: T[],
  index: number,
  update: (value: T) => T,
  label: string,
): T[] {
  assertIndex(values, index, label);
  return values.map((value, valueIndex) => (
    valueIndex === index ? update(value) : value
  ));
}

function removeAt<T>(values: T[], index: number, label: string): T[] {
  assertIndex(values, index, label);
  return values.filter((_value, valueIndex) => valueIndex !== index);
}

function assertIndex(values: unknown[], index: number, label: string): void {
  if (!Number.isInteger(index) || index < 0 || index >= values.length) {
    throw new Error(`Invariant violated: ${label} index ${index} is out of range.`);
  }
}

export type {
  ReflectionArtifactDetailDto,
  ReflectionArtifactSummaryDto,
  ReflectionGenerationRunDto,
  ReflectionProposalDetailDto,
  ReflectionReviewApi,
} from '../../services/api';
export type { AcceptProductionAlternateOperationV1 };
