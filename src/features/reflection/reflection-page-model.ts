import type {
  AcceptProductionAlternateOperationV1,
  CreateContrastClusterOperation,
  ReflectionInputItemV1,
  ReflectionInputItemV2,
  ReflectionItemV3,
  ReflectionItemResult,
  ReflectionHelpInboxEntry,
  ReflectionOperation,
  ReflectionQualityItemTags,
  ReflectionQualityTag,
  ProductionCueChangeV2,
  ProductionCueDraftV2,
  RepairProductionCueOperationV1,
  RepairProductionCueOperationV2,
} from '../../domain/reflection';
import type {
  ReflectionArtifactDetailDto,
  ReflectionProposalDetailDto,
  ReflectionQualityArmStatsDto,
} from '../../services/api';
import {
  classifyProposalAcceptance,
  getReflectionOperationRegistration,
  validateReflectionOperation,
  validateReflectionOperationEvidenceContext,
  visibleWordIds,
} from '../../domain/reflection';

export const REFLECTION_QUALITY_TAG_OPTIONS: ReadonlyArray<{
  code: ReflectionQualityTag;
  label: string;
}> = [
  { code: 'praise', label: 'I really like this' },
  { code: 'wrong_diagnosis', label: 'Wrong diagnosis' },
  { code: 'wrong_intervention', label: 'Wrong intervention' },
  { code: 'missed_intervention', label: 'Missed intervention' },
  { code: 'low_quality_content', label: 'Low-quality content' },
  { code: 'inconsistent', label: 'Inconsistent' },
  { code: 'other', label: 'Other' },
];

export function findQualityItemTags(
  rows: ReflectionQualityItemTags[],
  artifactId: string,
  itemId: string,
): ReflectionQualityItemTags | null {
  return rows.find((row) => row.artifactId === artifactId && row.itemId === itemId) ?? null;
}

export function findHelpInboxEntry(
  rows: ReflectionHelpInboxEntry[],
  artifactId: string,
  itemId: string,
): ReflectionHelpInboxEntry | null {
  return rows.find((row) => row.artifactId === artifactId && row.itemId === itemId) ?? null;
}

export type QualityStatsGroupBy = 'model_and_prompt' | 'model' | 'prompt';

export type QualityStatsPresentationOptions = {
  promptVersionFilter: string | 'all';
  groupBy: QualityStatsGroupBy;
};

export type QualityStatsArmPresentation = ReflectionQualityArmStatsDto & {
  /** Display label for the grouping key (may combine arms). */
  groupLabel: string;
};

export function presentQualityStatsArms(
  arms: ReflectionQualityArmStatsDto[],
  options: QualityStatsPresentationOptions,
): QualityStatsArmPresentation[] {
  const filtered = options.promptVersionFilter === 'all'
    ? arms
    : arms.filter((arm) => arm.promptVersion === options.promptVersionFilter);

  if (options.groupBy === 'model_and_prompt') {
    return filtered.map((arm) => ({
      ...arm,
      groupLabel: `${arm.modelArm} · ${arm.promptVersion}`,
    }));
  }

  const buckets = new Map<string, QualityStatsArmPresentation>();
  for (const arm of filtered) {
    const key = options.groupBy === 'model' ? arm.modelArm : arm.promptVersion;
    const existing = buckets.get(key);
    if (existing === undefined) {
      buckets.set(key, {
        ...arm,
        modelArm: options.groupBy === 'model' ? arm.modelArm : '—',
        promptVersion: options.groupBy === 'prompt' ? arm.promptVersion : '—',
        groupLabel: key,
        tagCounts: { ...arm.tagCounts },
      });
      continue;
    }
    existing.terminalReviewCount += arm.terminalReviewCount;
    existing.exactAcceptCount += arm.exactAcceptCount;
    existing.revisedAcceptCount += arm.revisedAcceptCount;
    existing.userReplaceCount += arm.userReplaceCount;
    existing.dismissCount += arm.dismissCount;
    existing.taggedItemCount += arm.taggedItemCount;
    for (const tag of Object.keys(arm.tagCounts) as Array<keyof typeof arm.tagCounts>) {
      existing.tagCounts[tag] += arm.tagCounts[tag];
    }
  }

  return [...buckets.values()].sort((left, right) => left.groupLabel.localeCompare(right.groupLabel));
}

export function listQualityPromptVersions(
  arms: ReflectionQualityArmStatsDto[],
): string[] {
  return [...new Set(arms.map((arm) => arm.promptVersion))].sort((left, right) => (
    left.localeCompare(right)
  ));
}

export type ReflectionItemPresentation = {
  evidence: ReflectionInputItemV1
    | ReflectionInputItemV2
    | ReflectionItemV3
    | null;
  result: ReflectionItemResult;
  proposals: ReflectionProposalDetailDto[];
};

/** Compact observability row for evidence items with no durable proposals. */
export type NoDurableChangeReflectionGist = {
  artifactId: string;
  itemId: string;
  title: string;
  diagnosisTags: ReflectionItemResult['diagnosisTags'];
  feedback: string;
  responseSummary: string | null;
  cueSummary: string | null;
  questionCount: number;
};

export type ReflectionProposalQueueKind = 'attention' | 'deferred' | 'unapplied';

export type LearnerRequestedReflectionPresentation = {
  artifact: ReflectionArtifactDetailDto;
  evidence: ReflectionInputItemV1
    | ReflectionInputItemV2
    | ReflectionItemV3
    | null;
  result: ReflectionItemResult;
};

export function buildLearnerRequestedReflectionPresentations(
  details: ReflectionArtifactDetailDto[],
): LearnerRequestedReflectionPresentation[] {
  return details.flatMap((artifact) => {
    const evidenceByItemId = new Map(artifact.evidenceBundle.items.map((item) => [item.itemId, item]));
    return artifact.result.itemResults.flatMap((result) => {
      const evidence = evidenceByItemId.get(result.itemId) ?? null;
      return evidence !== null && 'learnerRequestedReview' in evidence && evidence.learnerRequestedReview
        ? [{ artifact, evidence, result }]
        : [];
    });
  });
}

export type ReflectionProposalPresentation = {
  artifact: ReflectionArtifactDetailDto;
  evidence: ReflectionInputItemV1
    | ReflectionInputItemV2
    | ReflectionItemV3
    | null;
  result: ReflectionItemResult;
  proposal: ReflectionProposalDetailDto;
};

export type ReflectionHelpCard =
  | (ReflectionProposalPresentation & {
      kind: 'proposal';
      cardKey: string;
    })
  | {
      kind: 'explanation';
      cardKey: string;
      artifact: ReflectionArtifactDetailDto;
      evidence: ReflectionInputItemV1
        | ReflectionInputItemV2
        | ReflectionItemV3
        | null;
      result: ReflectionItemResult;
    };

/**
 * Build the learner Help queue from loaded artifact details.
 *
 * One card per pending proposal. Explanation-only items contribute one card
 * while their Help inbox row is still open. If an item has any pending
 * proposals, those cards are shown instead of an explanation card for that
 * item. Deferred and terminal proposal reviews are excluded.
 */
export function buildReflectionHelpCards(
  details: ReflectionArtifactDetailDto[],
): ReflectionHelpCard[] {
  const cards: ReflectionHelpCard[] = [];

  for (const artifact of details) {
    const evidenceByItemId = new Map(
      artifact.evidenceBundle.items.map((item) => [item.itemId, item]),
    );
    const proposalsByItemId = new Map<string, ReflectionProposalDetailDto[]>();
    for (const proposal of artifact.proposals) {
      const proposals = proposalsByItemId.get(proposal.itemId) ?? [];
      proposals.push(proposal);
      proposalsByItemId.set(proposal.itemId, proposals);
    }

    for (const result of artifact.result.itemResults) {
      const evidence = evidenceByItemId.get(result.itemId) ?? null;
      const proposals = proposalsByItemId.get(result.itemId) ?? [];
      const pending = proposals.filter((proposal) => (
        proposal.review.disposition.kind === 'pending'
      ));
      if (pending.length > 0) {
        for (const proposal of pending) {
          cards.push({
            kind: 'proposal',
            cardKey: `proposal:${proposal.review.proposalId}`,
            artifact,
            evidence,
            result,
            proposal,
          });
        }
        continue;
      }
      if (proposals.length > 0) continue;
      if (!findHelpInboxEntry(artifact.helpInbox, artifact.artifactId, result.itemId)) {
        continue;
      }
      cards.push({
        kind: 'explanation',
        cardKey: `explanation:${artifact.artifactId}:${result.itemId}`,
        artifact,
        evidence,
        result,
      });
    }
  }

  return cards;
}

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

/**
 * Session-scoped scan of evidence items that produced no proposals.
 * Empty proposals mean no durable change (often ordinary forgetting / retrieval
 * noise, but also insufficient evidence, questions-only, etc.).
 */
export function buildNoDurableChangeGists(
  detail: ReflectionArtifactDetailDto,
  presentations: ReflectionItemPresentation[],
): NoDurableChangeReflectionGist[] {
  return presentations
    .filter((item) => item.proposals.length === 0)
    .map((item) => ({
      artifactId: detail.artifactId,
      itemId: item.result.itemId,
      title: reflectionEvidenceTitle(item.evidence),
      diagnosisTags: item.result.diagnosisTags,
      feedback: reflectionLearnerFeedback(item.result),
      responseSummary: reflectionResponseSummary(item.evidence),
      cueSummary: reflectionCueSummary(item.evidence),
      questionCount: item.result.questions.length,
    }));
}

export function reflectionLearnerFeedback(result: ReflectionItemResult): string {
  if (result.learnerExplanation !== null) return result.learnerExplanation;
  return 'observation' in result ? result.observation : '';
}

export function legacyReflectionUnhandledNeeds(result: ReflectionItemResult) {
  return 'unhandledNeeds' in result ? result.unhandledNeeds : [];
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

/** User-facing output tokens: total output minus reasoning, when output is known. */
export function visibleOutputTokens(usage: {
  outputTokens: number | null;
  reasoningTokens: number | null;
}): number | null {
  if (usage.outputTokens === null) return null;
  const reasoning = usage.reasoningTokens ?? 0;
  return Math.max(0, usage.outputTokens - reasoning);
}

/**
 * Wall-clock run duration from persisted start/end timestamps.
 * Sub-second spans round up to 1 second; longer spans ceil to whole seconds.
 */
export function formatRunDuration(startedAt: string, completedAt: string): string {
  const startedMs = Date.parse(startedAt);
  const completedMs = Date.parse(completedAt);
  if (Number.isNaN(startedMs) || Number.isNaN(completedMs)) {
    throw new Error('Expected valid ISO run timestamps for duration display');
  }
  const elapsedMs = Math.max(0, completedMs - startedMs);
  const totalSeconds = Math.max(1, Math.ceil(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
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
      patch: Partial<CreateContrastClusterOperation['members'][number]>;
    }
  | { type: 'add_cluster_prompt' }
  | { type: 'remove_cluster_prompt'; index: number }
  | {
      type: 'update_cluster_prompt';
      index: number;
      patch: Partial<CreateContrastClusterOperation['prompts'][number]>;
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
  | { type: 'add_v2_cue_change' }
  | { type: 'remove_v2_cue_change'; index: number }
  | {
      type: 'set_v2_cue_change_kind';
      index: number;
      kind: ProductionCueChangeV2['kind'];
    }
  | { type: 'set_v2_cue_change_id'; index: number; cueId: string }
  | {
      type: 'update_v2_create_cue';
      changeIndex: number;
      patch: Partial<ProductionCueDraftV2>;
    }
  | { type: 'add_v2_replacement'; changeIndex: number }
  | { type: 'remove_v2_replacement'; changeIndex: number; replacementIndex: number }
  | {
      type: 'update_v2_replacement';
      changeIndex: number;
      replacementIndex: number;
      patch: Partial<ProductionCueDraftV2>;
    }
  | { type: 'add_v2_cue_judgment' }
  | { type: 'remove_v2_cue_judgment'; index: number }
  | {
      type: 'set_v2_cue_judgment_kind';
      index: number;
      kind: RepairProductionCueOperationV2['sourceAttemptJudgments'][number]['kind'];
    }
  | { type: 'set_v2_cue_judgment_attempt'; index: number; sourceAttemptId: string }
  | { type: 'set_v2_cue_judgment_word'; index: number; submittedWordId: string }
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
    case 'add_v2_cue_change':
      return editRepairCueV2(operation, action.type, (current) => ({
        ...current,
        changes: [...current.changes, {
          kind: 'create',
          cue: emptyProductionCueDraftV2(current.wordId),
        }],
      }));
    case 'remove_v2_cue_change':
      return editRepairCueV2(operation, action.type, (current) => ({
        ...current,
        changes: removeAt(current.changes, action.index, 'V2 cue change'),
      }));
    case 'set_v2_cue_change_kind':
      return editRepairCueV2(operation, action.type, (current) => ({
        ...current,
        changes: updateAt(
          current.changes,
          action.index,
          () => emptyProductionCueChangeV2(action.kind, current.wordId),
          'V2 cue change',
        ),
      }));
    case 'set_v2_cue_change_id':
      return editRepairCueV2(operation, action.type, (current) => ({
        ...current,
        changes: updateAt(
          current.changes,
          action.index,
          (change) => {
            if (change.kind === 'create') {
              throw new Error('Invariant violated: create changes do not reference a cue id.');
            }
            return { ...change, cueId: action.cueId };
          },
          'V2 cue change',
        ),
      }));
    case 'update_v2_create_cue':
      return editRepairCueV2(operation, action.type, (current) => ({
        ...current,
        changes: updateAt(
          current.changes,
          action.changeIndex,
          (change) => {
            if (change.kind !== 'create') {
              throw new Error('Invariant violated: only create changes contain a create cue draft.');
            }
            return { ...change, cue: { ...change.cue, ...action.patch } };
          },
          'V2 cue change',
        ),
      }));
    case 'add_v2_replacement':
      return editRepairCueV2(operation, action.type, (current) => ({
        ...current,
        changes: updateAt(
          current.changes,
          action.changeIndex,
          (change) => {
            if (change.kind !== 'replace') {
              throw new Error('Invariant violated: only replace changes contain replacements.');
            }
            return {
              ...change,
              replacements: [...change.replacements, emptyProductionCueDraftV2(current.wordId)],
            };
          },
          'V2 cue change',
        ),
      }));
    case 'remove_v2_replacement':
      return editRepairCueV2(operation, action.type, (current) => ({
        ...current,
        changes: updateAt(
          current.changes,
          action.changeIndex,
          (change) => {
            if (change.kind !== 'replace') {
              throw new Error('Invariant violated: only replace changes contain replacements.');
            }
            return {
              ...change,
              replacements: removeAt(
                change.replacements,
                action.replacementIndex,
                'V2 replacement cue',
              ),
            };
          },
          'V2 cue change',
        ),
      }));
    case 'update_v2_replacement':
      return editRepairCueV2(operation, action.type, (current) => ({
        ...current,
        changes: updateAt(
          current.changes,
          action.changeIndex,
          (change) => {
            if (change.kind !== 'replace') {
              throw new Error('Invariant violated: only replace changes contain replacements.');
            }
            return {
              ...change,
              replacements: updateAt(
                change.replacements,
                action.replacementIndex,
                (replacement) => ({ ...replacement, ...action.patch }),
                'V2 replacement cue',
              ),
            };
          },
          'V2 cue change',
        ),
      }));
    case 'add_v2_cue_judgment':
      return editRepairCueV2(operation, action.type, (current) => ({
        ...current,
        sourceAttemptJudgments: [...current.sourceAttemptJudgments, {
          kind: 'misleading_or_overloaded_cue',
          sourceAttemptId: '',
        }],
      }));
    case 'remove_v2_cue_judgment':
      return editRepairCueV2(operation, action.type, (current) => ({
        ...current,
        sourceAttemptJudgments: removeAt(
          current.sourceAttemptJudgments,
          action.index,
          'V2 cue judgment',
        ),
      }));
    case 'set_v2_cue_judgment_kind':
      return editRepairCueV2(operation, action.type, (current) => ({
        ...current,
        sourceAttemptJudgments: updateAt(
          current.sourceAttemptJudgments,
          action.index,
          (judgment) => action.kind === 'accepted_answer_space_omission'
            ? {
                kind: action.kind,
                sourceAttemptId: judgment.sourceAttemptId,
                submittedWordId: '',
              }
            : { kind: action.kind, sourceAttemptId: judgment.sourceAttemptId },
          'V2 cue judgment',
        ),
      }));
    case 'set_v2_cue_judgment_attempt':
      return editRepairCueV2(operation, action.type, (current) => ({
        ...current,
        sourceAttemptJudgments: updateAt(
          current.sourceAttemptJudgments,
          action.index,
          (judgment) => ({ ...judgment, sourceAttemptId: action.sourceAttemptId }),
          'V2 cue judgment',
        ),
      }));
    case 'set_v2_cue_judgment_word':
      return editRepairCueV2(operation, action.type, (current) => ({
        ...current,
        sourceAttemptJudgments: updateAt(
          current.sourceAttemptJudgments,
          action.index,
          (judgment) => {
            if (judgment.kind !== 'accepted_answer_space_omission') {
              throw new Error(
                'Invariant violated: only accepted-answer judgments name a submitted word.',
              );
            }
            return { ...judgment, submittedWordId: action.submittedWordId };
          },
          'V2 cue judgment',
        ),
      }));
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
  evidence: ReflectionInputItemV1 | ReflectionInputItemV2 | ReflectionItemV3 | null = null,
): {
  acceptanceMode: 'exact' | 'revised' | 'replacement';
  validationErrors: string[];
  applySupport: 'supported' | 'unsupported';
} {
  const registration = getReflectionOperationRegistration(draft.kind, draft.version);
  if (registration === null) {
    throw new Error(`Invariant violated: unregistered operation ${draft.kind}@${draft.version}.`);
  }
  const allowedWordIds = evidence === null ? undefined : visibleWordIds(evidence);
  const validationErrors = validateReflectionOperation(
    draft,
    evidence === null || allowedWordIds === undefined
      ? {}
      : { allowedWordIds, evidenceItemId: evidence.itemId },
  );
  if (evidence !== null && 'servedCue' in evidence) {
    validationErrors.push(...validateReflectionOperationEvidenceContext(draft, evidence, '$'));
  }
  return {
    acceptanceMode: original.kind !== draft.kind || original.version !== draft.version
      ? 'replacement'
      : classifyProposalAcceptance(original, draft),
    validationErrors,
    applySupport: registration.applySupport,
  };
}

export function createReplacementOperation(
  kind: ReflectionOperation['kind'],
  version: number,
  original: ReflectionOperation,
  evidence: ReflectionInputItemV1 | ReflectionInputItemV2 | ReflectionItemV3 | null,
): ReflectionOperation {
  const targetWordId = evidence?.targetWord?.wordId ?? primaryWordId(original);
  const submittedWordId = evidence !== null && 'submittedWord' in evidence
    ? evidence.submittedWord?.wordId ?? secondaryWordId(original)
    : secondaryWordId(original);

  switch (kind) {
    case 'suppress_definition_production':
      return { kind, version: 1, wordId: targetWordId };
    case 'create_contrast_cluster':
      return {
        kind,
        version: version === 2 ? 2 : 1,
        title: '',
        clusterNote: null,
        members: submittedWordId !== '' && submittedWordId !== targetWordId
          ? [{ wordId: targetWordId, nuanceNote: null }, { wordId: submittedWordId, nuanceNote: null }]
          : [{ wordId: targetWordId, nuanceNote: null }],
        prompts: [],
      };
    case 'repair_production_cue':
      if (version === 2) {
        return {
          kind,
          version: 2,
          wordId: targetWordId,
          taskId: `production-task:${targetWordId}:default_production`,
          changes: [],
          sourceAttemptJudgments: [],
        };
      }
      return {
        kind,
        version: 1,
        wordId: targetWordId,
        proposedCues: [],
        repairIntent: 'add_distinguishing_anchor',
      };
    case 'accept_production_alternate':
      return {
        kind,
        version: 1,
        targetWordId,
        alternateWordId: submittedWordId,
      };
  }
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

function primaryWordId(operation: ReflectionOperation): string {
  switch (operation.kind) {
    case 'suppress_definition_production':
    case 'repair_production_cue':
      return operation.wordId;
    case 'accept_production_alternate':
      return operation.targetWordId;
    case 'create_contrast_cluster':
      return operation.members[0]?.wordId ?? '';
  }
}

function secondaryWordId(operation: ReflectionOperation): string {
  switch (operation.kind) {
    case 'accept_production_alternate':
      return operation.alternateWordId;
    case 'create_contrast_cluster':
      return operation.members[1]?.wordId ?? '';
    case 'suppress_definition_production':
    case 'repair_production_cue':
      return '';
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

function editRepairCueV2(
  operation: ReflectionOperation,
  actionType: string,
  update: (current: RepairProductionCueOperationV2) => RepairProductionCueOperationV2,
): RepairProductionCueOperationV2 {
  if (operation.kind !== 'repair_production_cue' || operation.version !== 2) {
    throw new Error(
      `Invariant violated: ${actionType} cannot edit ${operation.kind}@${operation.version}.`,
    );
  }
  return update(operation);
}

function emptyProductionCueDraftV2(wordId: string): ProductionCueDraftV2 {
  return {
    cueType: 'definition_gloss',
    text: '',
    acceptedWordIds: wordId.length === 0 ? [] : [wordId],
  };
}

function emptyProductionCueChangeV2(
  kind: ProductionCueChangeV2['kind'],
  wordId: string,
): ProductionCueChangeV2 {
  switch (kind) {
    case 'create':
      return { kind, cue: emptyProductionCueDraftV2(wordId) };
    case 'replace':
      return { kind, cueId: '', replacements: [emptyProductionCueDraftV2(wordId)] };
    case 'deactivate':
      return { kind, cueId: '' };
  }
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

function reflectionEvidenceTitle(
  evidence: ReflectionInputItemV1 | ReflectionInputItemV2 | ReflectionItemV3 | null,
): string {
  if (evidence?.targetWord !== null && evidence?.targetWord !== undefined) {
    return reflectionWordLabel(evidence.targetWord);
  }
  return evidence?.source === 'session_note' ? 'Session note' : 'Reflection evidence';
}

function reflectionResponseSummary(
  evidence: ReflectionInputItemV1 | ReflectionInputItemV2 | ReflectionItemV3 | null,
): string | null {
  if (evidence === null) return null;
  if (evidence.source === 'production_mistake') {
    if (evidence.responseKind === 'no_clue') return 'No clue';
    if (evidence.submittedWord !== null) {
      return `Typed ${reflectionWordLabel(evidence.submittedWord)}`;
    }
    return evidence.rawResponse === null || evidence.rawResponse.trim() === ''
      ? 'No response'
      : `Typed ${evidence.rawResponse}`;
  }
  if (evidence.source === 'contrast_selection') {
    return evidence.reflectionSignal === null
      ? 'Contrast selection'
      : `Signal: ${evidence.reflectionSignal.replaceAll('_', ' ')}`;
  }
  return evidence.sessionNote;
}

function reflectionCueSummary(
  evidence: ReflectionInputItemV1 | ReflectionInputItemV2 | ReflectionItemV3 | null,
): string | null {
  if (evidence === null) return null;
  if (evidence.source === 'production_mistake') {
    if ('servedCue' in evidence) return evidence.servedCue.text;
    return evidence.cuesAsShown[0]?.text ?? null;
  }
  if (evidence.source === 'contrast_selection') {
    return evidence.promptAsShown.promptText;
  }
  return null;
}

function reflectionWordLabel(word: { hanzi: string; pinyin: string }): string {
  return `${word.hanzi} · ${word.pinyin}`;
}

export type EvidenceWordOption = {
  wordId: string;
  hanzi: string;
  pinyin: string;
};

export function collectEvidenceWordOptions(
  evidence: ReflectionInputItemV1 | ReflectionInputItemV2 | ReflectionItemV3 | null,
): EvidenceWordOption[] {
  if (evidence === null) return [];
  const byId = new Map<string, EvidenceWordOption>();
  function add(word: { wordId: string; hanzi: string; pinyin: string } | null | undefined) {
    if (word === null || word === undefined) return;
    if (!byId.has(word.wordId)) {
      byId.set(word.wordId, {
        wordId: word.wordId,
        hanzi: word.hanzi,
        pinyin: word.pinyin,
      });
    }
  }
  add(evidence.targetWord);
  if ('submittedWord' in evidence) add(evidence.submittedWord);
  if (evidence.source === 'session_note') {
    for (const relatedWord of evidence.relatedWords) add(relatedWord);
  }
  if (evidence.source === 'contrast_selection') {
    for (const choiceWord of evidence.promptAsShown.choiceWords) add(choiceWord);
  }
  return [...byId.values()];
}

export function evidenceWordSurfaceLabel(word: EvidenceWordOption): string {
  return `${word.hanzi} · ${word.pinyin}`;
}

export function servedCueDisplayText(
  evidence: ReflectionInputItemV1 | ReflectionInputItemV2 | ReflectionItemV3 | null,
): string | null {
  if (evidence === null) return null;
  if ('servedCue' in evidence) return evidence.servedCue.text;
  if (evidence.source === 'production_mistake') return evidence.cuesAsShown[0]?.text ?? null;
  return null;
}

export type {
  ReflectionArtifactDetailDto,
  ReflectionArtifactSummaryDto,
  ReflectionGenerationRunDto,
  ReflectionProposalDetailDto,
  ReflectionQualityStatsDto,
  ReflectionReviewApi,
} from '../../services/api';
export type { AcceptProductionAlternateOperationV1 };
