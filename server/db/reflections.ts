import { randomUUID } from 'node:crypto';
import type {
  EffectRef,
  OperationApplicationStatus,
  OperationApplicationState,
  OperationInvocation,
  ProposalReviewDisposition,
  ProposalReviewStatus,
  ProposalSupersession,
  ReflectionOperation,
  ReflectionProposalV1,
  ReflectionInputItemV1,
  ReflectionInputItemV2,
  ReflectionItemV3,
  ReflectionItemV4,
  ReflectionItemV5,
  SessionReflectionBundle,
  SessionReflectionBundleV1,
  SessionReflectionBundleV2,
  SessionReflectionBundleV3,
  SessionReflectionBundleV4,
  SessionReflectionBundleV5,
  CuratedReflectionBundleV1,
  CuratedReflectionBundleV2,
  CuratedReflectionDiagnosisBundleV2,
  PureCuePromotionBundleV1,
  PureCuePromotionResultV1Wire,
  SessionReflectionResult,
  SessionReflectionResultV4,
  SessionReflectionResultV5,
  ReflectionQualityItemTags,
  ReflectionHelpInboxEntry,
  SessionReflectionResultV6,
  SessionReflectionResultV7,
  SessionReflectionResultV8,
  PromotePureElicitationOperationV1,
} from '../../src/domain/reflection.ts';
import {
  assertOperationApplicationTransition,
  assertProposalReviewTransition,
  classifyProposalAcceptance,
  getReflectionOperationRegistration,
  reflectionOperationWordReferences,
  validateReflectionOperationEvidenceContext,
  validateReflectionOperation,
  validateSessionReflectionResult,
  validateSessionReflectionResultV5,
  validateSessionReflectionResultV6,
  validateSessionReflectionResultV7,
  validateSessionReflectionResultV8,
} from '../../src/domain/reflection.ts';
import {
  parseCuratedReflectionDiagnosisBundleV2,
  parsePureCuePromotionBundleV1,
  parseStoredSessionReflectionBundle,
} from '../../src/domain/reflection-evidence.ts';
import type { NormalizedTokenUsage } from '../llm/types.ts';
import type { ReflectionGenerationDiagnostic } from '../reflection/run-diagnostics.ts';
import {
  CURRENT_DEFERRED_SECOND_OPINION_FLOW_VERSION,
  CURRENT_INITIAL_REFLECTION_FLOW_VERSION,
  PURE_CUE_PROMOTION_PROMPT_VERSION,
  STAGED_REFLECTION_DIAGNOSIS_PROMPT_VERSION,
  isCurrentReflectionArtifactContract,
  isCurrentReflectionFlowVersion,
  isCurrentReflectionGenerationStage,
} from '../../src/domain/reflection-contracts.ts';
import {
  buildReflectionSpendCap,
  utcDayKey,
  utcDayRange,
  type ReflectionSpendCap,
} from '../reflection/spend-cap.ts';
import { dbPath, getConfig, getDb } from './connection.ts';
import { requireLearnerId } from './learner-context.ts';
import {
  learnerScopedStorageTableName,
  physicalLearnerTableName,
} from './learner-scoped-tables.ts';
import {
  createReflectionQualitySchema,
  listReflectionQualityAnnotationsForArtifact,
  validateReflectionQualitySchema,
} from './reflection-quality.ts';
import {
  createReflectionHelpInboxSchema,
  listReflectionHelpInboxForArtifact,
  markReflectionHelpInboxDone,
  seedReflectionHelpInboxWithoutTransaction,
  validateReflectionHelpInboxSchema,
} from './reflection-help-inbox.ts';
import {
  enableContextualSelectionWithoutTransaction,
  type EnableContextualSelectionResult,
  suppressDefinitionProductionWithoutTransaction,
} from './domain-commands.ts';
import {
  applyProductionCueRepairWithoutTransaction,
  applyProductionCueSupplementWithoutTransaction,
  defaultProductionTaskId,
  getActiveProductionCuesForWord,
  assertPureCuePromotionSource,
  validateProductionCueRepairCurrentStateWithoutTransaction,
} from './production-cues.ts';
import {
  createPureCueWithoutTransaction,
  extendPureCueAcceptedWordsWithoutTransaction,
  getPureCue,
  getPureCues,
  restoreProductionSchedulerSnapshotWithoutTransaction,
  setWordProductionProxiedWithoutTransaction,
} from './pure-cues.ts';
import { stampProposalInboxSeenIfLeavingPending } from './attention.ts';

export const INITIAL_REFLECTION_FLOW_VERSION = 'initial_post_session_reflection.v2';
export const STAGED_INITIAL_REFLECTION_FLOW_VERSION = CURRENT_INITIAL_REFLECTION_FLOW_VERSION;
export const LEGACY_INITIAL_REFLECTION_FLOW_VERSION = INITIAL_REFLECTION_FLOW_VERSION;
export const DEFERRED_SECOND_OPINION_FLOW_VERSION = 'deferred_second_opinion.v1';
export const STAGED_DEFERRED_SECOND_OPINION_FLOW_VERSION = CURRENT_DEFERRED_SECOND_OPINION_FLOW_VERSION;
export const LEGACY_DEFERRED_SECOND_OPINION_FLOW_VERSION = DEFERRED_SECOND_OPINION_FLOW_VERSION;
export const DEFERRED_SECOND_OPINION_MAX_EVIDENCE_ITEMS = 25;

export class DeferredSecondOpinionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeferredSecondOpinionError';
  }
}

const unsupportedApplicationReason = (operation: ReflectionOperation) => (
  `No faithful application adapter is available for ${operation.kind}@${operation.version}.`
);

type MaterializeReflectionArtifactBase = {
  artifactId?: string;
  sourceRunId?: string;
  sourceSessionId: string | null;
  reflectionFlowVersion: string;
  generatedAt: string;
  provider: string;
  model: string;
  promptVersion: string;
  continuationId?: string;
};

export type MaterializeReflectionArtifactInput = MaterializeReflectionArtifactBase & (
  | { evidenceBundle: SessionReflectionBundleV1; result: SessionReflectionResultV4 }
  | { evidenceBundle: SessionReflectionBundleV2; result: SessionReflectionResultV5 }
  | { evidenceBundle: SessionReflectionBundleV3; result: SessionReflectionResultV5 }
  | { evidenceBundle: SessionReflectionBundleV2; result: SessionReflectionResultV6 }
  | { evidenceBundle: SessionReflectionBundleV3; result: SessionReflectionResultV6 }
  | { evidenceBundle: SessionReflectionBundleV4; result: SessionReflectionResultV7 }
  | { evidenceBundle: SessionReflectionBundleV2; result: SessionReflectionResultV7 }
  | { evidenceBundle: SessionReflectionBundleV3; result: SessionReflectionResultV7 }
  | { evidenceBundle: SessionReflectionBundleV5; result: SessionReflectionResultV8 }
  | {
      evidenceBundle: CuratedReflectionBundleV2;
      result: SessionReflectionResultV8;
      sourceProposalIds: string[];
    }
  | {
      evidenceBundle: CuratedReflectionBundleV1;
      result: SessionReflectionResultV7;
      sourceProposalIds: string[];
    }
);

export type ReflectionGenerationProviderBundle =
  | SessionReflectionBundle
  | CuratedReflectionDiagnosisBundleV2
  | PureCuePromotionBundleV1;

export type ReflectionGenerationRunState = 'in_flight' | 'succeeded' | 'failed';

export type ReflectionGenerationRunRecord = {
  runId: string;
  sourceSessionId: string | null;
  reflectionFlowVersion: string;
  startedAt: string;
  completedAt: string | null;
  provider: string;
  model: string;
  providerModel: string;
  promptVersion: string;
  responseId: string | null;
  clientRequestId: string | null;
  finishReason: string | null;
  bundleSchemaVersion: string | null;
  resultSchemaVersion: string | null;
  diagnostic: ReflectionGenerationDiagnostic | null;
  state: ReflectionGenerationRunState;
  failureCode: string | null;
  eligibleItemCount: number;
  includedItemCount: number;
  usage: NormalizedTokenUsage;
  pricingSnapshotId: string | null;
  pricingAsOf: string | null;
  pricingBasis: unknown | null;
  estimatedCostUsd: number | null;
  retryable: boolean;
};

export type RecordReflectionGenerationRunInput = Omit<
  ReflectionGenerationRunRecord,
  'runId' | 'retryable'
> & {
  runId?: string;
  clientRequestId?: string | null;
  bundleSchemaVersion?: string | null;
  resultSchemaVersion?: string | null;
  diagnostic?: ReflectionGenerationDiagnostic | null;
  evidenceBundle: ReflectionGenerationProviderBundle;
  sourceProposalIds?: string[] | null;
};

export type StartReflectionGenerationRunInput = {
  runId: string;
  sourceSessionId: string | null;
  reflectionFlowVersion: string;
  startedAt: string;
  provider: string;
  model: string;
  providerModel: string;
  promptVersion: string;
  clientRequestId: string;
  eligibleItemCount: number;
  includedItemCount: number;
  evidenceBundle: ReflectionGenerationProviderBundle;
  sourceProposalIds?: string[] | null;
};

export type ReflectionGenerationContinuationStage = 'diagnosis' | 'promotion';

export type ReflectionGenerationContinuation = {
  continuationId: string;
  sourceSessionId: string | null;
  reflectionFlowVersion: string;
  createdAt: string;
  eligibleItemCount: number;
  includedItemCount: number;
  diagnosisBundle: SessionReflectionBundleV4 | CuratedReflectionDiagnosisBundleV2;
  sourceProposalIds: string[] | null;
  diagnosisResult: SessionReflectionResultV7 | null;
  finalEvidenceBundle: SessionReflectionBundleV5 | CuratedReflectionBundleV2 | null;
  promotionBundle: PureCuePromotionBundleV1 | null;
  artifactId: string | null;
};

export type ReflectionGenerationContinuationRetrySource = {
  runId: string;
  continuation: ReflectionGenerationContinuation;
  stage: ReflectionGenerationContinuationStage;
  provider: string;
  model: string;
  providerModel: string;
  promptVersion: string;
};

/**
 * Persistence and read-model map:
 *
 * ReflectionArtifactRecord
 *   └─ result.itemResults[].proposals[]       immutable generated proposals
 *                │ one review row per (itemId, proposalIndex)
 *                ▼
 * ReflectionArtifactDetail.proposals[]        all originals, flattened in result order
 *   ├─ proposal                               immutable original
 *   ├─ review                                 current proposal-review status
 *   └─ invocation?                            linked authorization, when present
 *        ├─ invocation                        immutable authorized operation
 *        └─ application                       current operation-application status
 *
 * Detail reads join lifecycle status onto the artifact without changing its
 * original result. They require exactly one review row for every generated
 * proposal, reject review rows that cannot be traced to an original proposal,
 * and flatten first by the existing `result.itemResults` array order and then
 * by proposal index within each item result; they do not sort by item id. They
 * expose an invocation only when the review disposition owns that link. Manual
 * invocations therefore never appear in an artifact's proposal list.
 */
export type ReflectionArtifactRecord = {
  artifactId: string;
  sourceSessionId: string | null;
  sourceRunId: string | null;
  reflectionFlowVersion: string;
  generatedAt: string;
  provider: string;
  model: string;
  promptVersion: string;
  bundleSchemaVersion: SessionReflectionBundle['schemaVersion'];
  resultSchemaVersion: SessionReflectionResult['schemaVersion'];
  evidenceBundle: SessionReflectionBundle;
  result: SessionReflectionResult;
};

export type OperationInvocationStatus = {
  invocation: OperationInvocation;
  application: OperationApplicationStatus;
};

export type ReflectionProposalDetail = {
  itemId: string;
  proposalIndex: number;
  proposal: ReflectionProposalV1;
  review: ProposalReviewStatus;
  invocation: OperationInvocationStatus | null;
};

export type ReflectionArtifactDetail = ReflectionArtifactRecord & {
  proposals: ReflectionProposalDetail[];
  qualityItemTags: ReflectionQualityItemTags[];
  helpInbox: ReflectionHelpInboxEntry[];
};

export function reflectionArtifactSupportsCurrentActions(
  artifact: Pick<
    ReflectionArtifactRecord,
    'reflectionFlowVersion' | 'bundleSchemaVersion' | 'resultSchemaVersion' | 'promptVersion'
  >,
): boolean {
  return isCurrentReflectionArtifactContract({
    reflectionFlowVersion: artifact.reflectionFlowVersion,
    bundleSchemaVersion: artifact.bundleSchemaVersion,
    resultSchemaVersion: artifact.resultSchemaVersion,
    promptVersion: artifact.promptVersion,
  });
}

export type ReflectionArtifactSummary = Omit<
  ReflectionArtifactRecord,
  'bundleSchemaVersion' | 'resultSchemaVersion' | 'evidenceBundle' | 'result'
> & {
  bundleSchemaVersion: string;
  resultSchemaVersion: string;
  proposalCount: number;
  openProposalCount: number;
} & (
  | { readState: 'available'; itemCount: number }
  | { readState: 'unreadable'; itemCount: null }
);

export type MaterializeReflectionArtifactResult = {
  created: boolean;
  artifact: ReflectionArtifactDetail;
};

export type AcceptReflectionProposalInput = {
  proposalId: string;
  operation: ReflectionOperation;
  invocationId?: string;
  createdAt?: string;
};

export type AcceptReflectionProposalResult = {
  review: ProposalReviewStatus;
  invocation: OperationInvocationStatus;
};

export type ReplaceReflectionProposalInput = {
  proposalId: string;
  operation: ReflectionOperation;
  invocationId?: string;
  createdAt?: string;
};

export type ReplaceReflectionProposalResult = {
  review: ProposalReviewStatus;
  invocation: OperationInvocationStatus;
};

export type AuthorizeManualReflectionOperationInput = {
  artifactId: string;
  itemId: string;
  operation: ReflectionOperation;
  invocationId?: string;
  createdAt?: string;
};

export type AuthorizeManualReflectionOperationResult = {
  invocation: OperationInvocationStatus;
};

export type SupersedeReflectionProposalInput = {
  proposalId: string;
  supersession: ProposalSupersession;
  updatedAt?: string;
};

type ArtifactRow = {
  artifact_id: string;
  source_session_id: string | null;
  source_run_id: string | null;
  reflection_flow_version: string;
  generated_at: string;
  provider: string;
  model: string;
  prompt_version: string;
  bundle_schema_version: string;
  result_schema_version: string;
  evidence_bundle_json: string;
  result_json: string;
};

type ReflectionGenerationRunRow = {
  run_id: string;
  source_session_id: string | null;
  reflection_flow_version: string;
  started_at: string;
  completed_at: string;
  provider: string;
  model: string;
  provider_model: string;
  prompt_version: string;
  response_id: string | null;
  client_request_id: string | null;
  finish_reason: string | null;
  bundle_schema_version: string | null;
  result_schema_version: string | null;
  diagnostic_json: string | null;
  state: ReflectionGenerationRunState;
  failure_code: string | null;
  eligible_item_count: number;
  included_item_count: number;
  input_tokens: number | null;
  cached_input_tokens: number | null;
  cache_write_input_tokens: number | null;
  output_tokens: number | null;
  reasoning_tokens: number | null;
  total_tokens: number | null;
  pricing_snapshot_id: string | null;
  pricing_as_of: string | null;
  pricing_basis_json: string | null;
  estimated_cost_usd: number | null;
  evidence_bundle_json: string | null;
  source_proposal_ids_json: string | null;
  retryable: number;
};

type ProposalReviewRow = {
  proposal_id: string;
  artifact_id: string;
  item_id: string;
  proposal_index: number;
  disposition: string;
  updated_at: string;
  acceptance_mode: string | null;
  accepted_invocation_id: string | null;
  dismissal_reason: string | null;
  supersession_source: string | null;
  supersession_actor: string | null;
  supersession_reason: string | null;
  replacement_proposal_id: string | null;
  replacement_invocation_id: string | null;
  satisfying_effect_refs_json: string;
};

type InvocationRow = {
  invocation_id: string;
  created_at: string;
  origin_kind: string;
  origin_proposal_id: string | null;
  origin_superseded_proposal_id: string | null;
  operation_kind: string;
  operation_version: number;
  operation_json: string;
  application_state: string;
  application_updated_at: string;
  unsupported_reason: string | null;
  applied_at: string | null;
  application_error: string | null;
  stale_reason: string | null;
  effect_refs_json: string;
  satisfying_effect_refs_json: string;
};

type StoredInvocationOperationV1 = {
  schemaVersion: 'reflection_invocation_operation.v1';
  sourceArtifactId: string;
  sourceItemId: string;
  operation: ReflectionOperation;
};

const LEGACY_REFLECTION_READ_ONLY_MESSAGE = (
  'This reflection was generated by an older contract and is read-only. '
  + 'Its saved result remains available, but it cannot authorize or apply changes.'
);

const artifactColumns = [
  'artifact_id',
  'source_session_id',
  'source_run_id',
  'reflection_flow_version',
  'generated_at',
  'provider',
  'model',
  'prompt_version',
  'bundle_schema_version',
  'result_schema_version',
  'evidence_bundle_json',
  'result_json',
] as const;

const reflectionGenerationRunColumns = [
  'run_id',
  'source_session_id',
  'reflection_flow_version',
  'started_at',
  'completed_at',
  'provider',
  'model',
  'provider_model',
  'prompt_version',
  'response_id',
  'client_request_id',
  'finish_reason',
  'bundle_schema_version',
  'result_schema_version',
  'state',
  'failure_code',
  'eligible_item_count',
  'included_item_count',
  'input_tokens',
  'cached_input_tokens',
  'cache_write_input_tokens',
  'output_tokens',
  'reasoning_tokens',
  'total_tokens',
  'pricing_snapshot_id',
  'pricing_as_of',
  'pricing_basis_json',
  'estimated_cost_usd',
  'evidence_bundle_json',
  'source_proposal_ids_json',
  'diagnostic_json',
] as const;

const proposalReviewColumns = [
  'proposal_id',
  'artifact_id',
  'item_id',
  'proposal_index',
  'disposition',
  'updated_at',
  'acceptance_mode',
  'accepted_invocation_id',
  'dismissal_reason',
  'supersession_source',
  'supersession_actor',
  'supersession_reason',
  'replacement_proposal_id',
  'replacement_invocation_id',
  'satisfying_effect_refs_json',
] as const;

const invocationColumns = [
  'invocation_id',
  'created_at',
  'origin_kind',
  'origin_proposal_id',
  'origin_superseded_proposal_id',
  'operation_kind',
  'operation_version',
  'operation_json',
  'application_state',
  'application_updated_at',
  'unsupported_reason',
  'applied_at',
  'application_error',
  'stale_reason',
  'effect_refs_json',
  'satisfying_effect_refs_json',
] as const;

export function createReflectionSchema(): void {
  createReflectionGenerationRunStartSchema();
  getDb().exec(`
    CREATE TABLE reflection_artifacts (
      artifact_id TEXT PRIMARY KEY,
      learner_id TEXT NOT NULL DEFAULT (current_learner_id()) REFERENCES learners(learner_id) ON DELETE CASCADE,
      source_session_id TEXT,
      source_run_id TEXT,
      reflection_flow_version TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      bundle_schema_version TEXT NOT NULL,
      result_schema_version TEXT NOT NULL,
      evidence_bundle_json TEXT NOT NULL,
      result_json TEXT NOT NULL
    );

    CREATE TABLE reflection_generation_runs (
      run_id TEXT PRIMARY KEY,
      learner_id TEXT NOT NULL DEFAULT (current_learner_id()) REFERENCES learners(learner_id) ON DELETE CASCADE,
      source_session_id TEXT,
      reflection_flow_version TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      provider_model TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      response_id TEXT,
      finish_reason TEXT,
      client_request_id TEXT,
      bundle_schema_version TEXT,
      result_schema_version TEXT,
      diagnostic_json TEXT,
      state TEXT NOT NULL CHECK (state IN ('succeeded', 'failed')),
      failure_code TEXT,
      eligible_item_count INTEGER NOT NULL CHECK (eligible_item_count >= 0),
      included_item_count INTEGER NOT NULL CHECK (
        included_item_count >= 0 AND included_item_count <= eligible_item_count
      ),
      input_tokens INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0),
      cached_input_tokens INTEGER CHECK (
        cached_input_tokens IS NULL OR cached_input_tokens >= 0
      ),
      cache_write_input_tokens INTEGER CHECK (
        cache_write_input_tokens IS NULL OR cache_write_input_tokens >= 0
      ),
      output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
      reasoning_tokens INTEGER CHECK (reasoning_tokens IS NULL OR reasoning_tokens >= 0),
      total_tokens INTEGER CHECK (total_tokens IS NULL OR total_tokens >= 0),
      pricing_snapshot_id TEXT,
      pricing_as_of TEXT,
      pricing_basis_json TEXT,
      estimated_cost_usd REAL CHECK (
        estimated_cost_usd IS NULL OR estimated_cost_usd >= 0
      ),
      evidence_bundle_json TEXT,
      CHECK (
        (state = 'succeeded' AND failure_code IS NULL)
        OR (state = 'failed' AND failure_code IS NOT NULL)
      ),
      CHECK (
        (estimated_cost_usd IS NULL AND pricing_snapshot_id IS NULL
          AND pricing_as_of IS NULL AND pricing_basis_json IS NULL)
        OR (estimated_cost_usd IS NOT NULL AND pricing_snapshot_id IS NOT NULL
          AND pricing_as_of IS NOT NULL AND pricing_basis_json IS NOT NULL)
      )
    );

    CREATE TABLE reflection_proposal_reviews (
      proposal_id TEXT PRIMARY KEY,
      learner_id TEXT NOT NULL DEFAULT (current_learner_id()) REFERENCES learners(learner_id) ON DELETE CASCADE,
      artifact_id TEXT NOT NULL
        REFERENCES reflection_artifacts(artifact_id) ON DELETE RESTRICT,
      item_id TEXT NOT NULL,
      proposal_index INTEGER NOT NULL CHECK (proposal_index >= 0),
      disposition TEXT NOT NULL
        CHECK (disposition IN ('pending', 'deferred', 'accepted', 'dismissed', 'superseded')),
      updated_at TEXT NOT NULL,
      acceptance_mode TEXT
        CHECK (acceptance_mode IS NULL OR acceptance_mode IN ('exact', 'revised')),
      accepted_invocation_id TEXT
        REFERENCES reflection_operation_invocations(invocation_id) ON DELETE RESTRICT,
      dismissal_reason TEXT,
      supersession_source TEXT
        CHECK (
          supersession_source IS NULL
          OR supersession_source IN ('competing_proposal', 'user_replacement', 'external_state')
        ),
      supersession_actor TEXT
        CHECK (supersession_actor IS NULL OR supersession_actor IN ('user', 'system')),
      supersession_reason TEXT,
      replacement_proposal_id TEXT
        REFERENCES reflection_proposal_reviews(proposal_id) ON DELETE RESTRICT,
      replacement_invocation_id TEXT
        REFERENCES reflection_operation_invocations(invocation_id) ON DELETE RESTRICT,
      satisfying_effect_refs_json TEXT NOT NULL DEFAULT '[]',
      UNIQUE (artifact_id, item_id, proposal_index),
      CHECK (
        (
          disposition IN ('pending', 'deferred')
          AND acceptance_mode IS NULL
          AND accepted_invocation_id IS NULL
          AND dismissal_reason IS NULL
          AND supersession_source IS NULL
          AND supersession_actor IS NULL
          AND supersession_reason IS NULL
          AND replacement_proposal_id IS NULL
          AND replacement_invocation_id IS NULL
          AND satisfying_effect_refs_json = '[]'
        )
        OR (
          disposition = 'accepted'
          AND acceptance_mode IS NOT NULL
          AND accepted_invocation_id IS NOT NULL
          AND dismissal_reason IS NULL
          AND supersession_source IS NULL
          AND supersession_actor IS NULL
          AND supersession_reason IS NULL
          AND replacement_proposal_id IS NULL
          AND replacement_invocation_id IS NULL
          AND satisfying_effect_refs_json = '[]'
        )
        OR (
          disposition = 'dismissed'
          AND acceptance_mode IS NULL
          AND accepted_invocation_id IS NULL
          AND supersession_source IS NULL
          AND supersession_actor IS NULL
          AND supersession_reason IS NULL
          AND replacement_proposal_id IS NULL
          AND replacement_invocation_id IS NULL
          AND satisfying_effect_refs_json = '[]'
        )
        OR (
          disposition = 'superseded'
          AND acceptance_mode IS NULL
          AND accepted_invocation_id IS NULL
          AND dismissal_reason IS NULL
          AND supersession_source IS NOT NULL
          AND supersession_actor IS NOT NULL
          AND supersession_reason IS NOT NULL
          AND (
            (
              supersession_source = 'competing_proposal'
              AND replacement_proposal_id IS NOT NULL
              AND replacement_invocation_id IS NULL
              AND satisfying_effect_refs_json = '[]'
            )
            OR (
              supersession_source = 'user_replacement'
              AND replacement_proposal_id IS NULL
              AND replacement_invocation_id IS NOT NULL
              AND satisfying_effect_refs_json = '[]'
            )
            OR (
              supersession_source = 'external_state'
              AND replacement_proposal_id IS NULL
              AND replacement_invocation_id IS NULL
              AND satisfying_effect_refs_json != '[]'
            )
          )
        )
      )
    );

    CREATE TABLE reflection_operation_invocations (
      invocation_id TEXT PRIMARY KEY,
      learner_id TEXT NOT NULL DEFAULT (current_learner_id()) REFERENCES learners(learner_id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      origin_kind TEXT NOT NULL
        CHECK (origin_kind IN ('proposal_acceptance', 'user_replacement', 'manual')),
      origin_proposal_id TEXT
        REFERENCES reflection_proposal_reviews(proposal_id) ON DELETE RESTRICT,
      origin_superseded_proposal_id TEXT
        REFERENCES reflection_proposal_reviews(proposal_id) ON DELETE RESTRICT,
      operation_kind TEXT NOT NULL,
      operation_version INTEGER NOT NULL,
      operation_json TEXT NOT NULL,
      application_state TEXT NOT NULL
        CHECK (
          application_state IN (
            'unsupported',
            'pending',
            'applied',
            'failed',
            'stale',
            'already_satisfied',
            'authorization_withdrawn'
          )
        ),
      application_updated_at TEXT NOT NULL,
      unsupported_reason TEXT,
      applied_at TEXT,
      application_error TEXT,
      stale_reason TEXT,
      effect_refs_json TEXT NOT NULL DEFAULT '[]',
      satisfying_effect_refs_json TEXT NOT NULL DEFAULT '[]',
      CHECK (
        (
          origin_kind = 'proposal_acceptance'
          AND origin_proposal_id IS NOT NULL
          AND origin_superseded_proposal_id IS NULL
        )
        OR (
          origin_kind = 'user_replacement'
          AND origin_proposal_id IS NULL
          AND origin_superseded_proposal_id IS NOT NULL
        )
        OR (
          origin_kind = 'manual'
          AND origin_proposal_id IS NULL
          AND origin_superseded_proposal_id IS NULL
        )
      ),
      CHECK (
        (
          application_state = 'unsupported'
          AND unsupported_reason IS NOT NULL
          AND applied_at IS NULL
          AND application_error IS NULL
          AND stale_reason IS NULL
          AND effect_refs_json = '[]'
          AND satisfying_effect_refs_json = '[]'
        )
        OR (
          application_state IN ('pending', 'authorization_withdrawn')
          AND unsupported_reason IS NULL
          AND applied_at IS NULL
          AND application_error IS NULL
          AND stale_reason IS NULL
          AND effect_refs_json = '[]'
          AND satisfying_effect_refs_json = '[]'
        )
        OR (
          application_state = 'applied'
          AND unsupported_reason IS NULL
          AND applied_at IS NOT NULL
          AND application_error IS NULL
          AND stale_reason IS NULL
          AND effect_refs_json != '[]'
          AND satisfying_effect_refs_json = '[]'
        )
        OR (
          application_state = 'failed'
          AND unsupported_reason IS NULL
          AND applied_at IS NULL
          AND application_error IS NOT NULL
          AND stale_reason IS NULL
          AND effect_refs_json = '[]'
          AND satisfying_effect_refs_json = '[]'
        )
        OR (
          application_state = 'stale'
          AND unsupported_reason IS NULL
          AND applied_at IS NULL
          AND application_error IS NULL
          AND stale_reason IS NOT NULL
          AND effect_refs_json = '[]'
          AND satisfying_effect_refs_json = '[]'
        )
        OR (
          application_state = 'already_satisfied'
          AND unsupported_reason IS NULL
          AND applied_at IS NULL
          AND application_error IS NULL
          AND stale_reason IS NULL
          AND effect_refs_json = '[]'
          AND satisfying_effect_refs_json != '[]'
        )
      )
    );

    CREATE TRIGGER reflection_proposal_identity_immutable
    BEFORE UPDATE OF proposal_id, artifact_id, item_id, proposal_index
    ON reflection_proposal_reviews
    BEGIN
      SELECT RAISE(ABORT, 'reflection proposal identity is immutable');
    END;

    CREATE TRIGGER reflection_invocation_authorization_immutable
    BEFORE UPDATE OF
      invocation_id,
      created_at,
      origin_kind,
      origin_proposal_id,
      origin_superseded_proposal_id,
      operation_kind,
      operation_version,
      operation_json
    ON reflection_operation_invocations
    BEGIN
      SELECT RAISE(ABORT, 'reflection invocation authorization is immutable');
    END;
  `);

  createReflectionQualitySchema();
  createReflectionHelpInboxSchema();
}

function createReflectionGenerationRunStartSchema(): void {
  getDb().exec(`
    CREATE TABLE reflection_generation_run_starts (
      run_id TEXT PRIMARY KEY,
      learner_id TEXT NOT NULL DEFAULT (current_learner_id()) REFERENCES learners(learner_id) ON DELETE CASCADE,
      source_session_id TEXT,
      reflection_flow_version TEXT NOT NULL,
      started_at TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      provider_model TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      client_request_id TEXT NOT NULL,
      eligible_item_count INTEGER NOT NULL CHECK (eligible_item_count >= 0),
      included_item_count INTEGER NOT NULL CHECK (included_item_count >= 0 AND included_item_count <= eligible_item_count),
      evidence_bundle_json TEXT NOT NULL
    );
    CREATE INDEX idx_reflection_generation_run_starts_started
      ON ${learnerScopedStorageTableName('reflection_generation_run_starts')}(started_at DESC, run_id ASC);
  `);
}

export function createReflectionIndexes(): void {
  getDb().exec(`
    CREATE INDEX idx_reflection_artifacts_generated
      ON ${learnerScopedStorageTableName('reflection_artifacts')}(generated_at DESC, artifact_id ASC);
    CREATE INDEX idx_reflection_generation_runs_completed
      ON ${learnerScopedStorageTableName('reflection_generation_runs')}(completed_at DESC, run_id ASC);
    CREATE INDEX idx_reflection_proposal_reviews_open
      ON ${learnerScopedStorageTableName('reflection_proposal_reviews')}(disposition, artifact_id);
    CREATE INDEX idx_reflection_invocations_application
      ON ${learnerScopedStorageTableName('reflection_operation_invocations')}(application_state, application_updated_at ASC);
    CREATE UNIQUE INDEX idx_reflection_invocations_proposal_origin
      ON ${learnerScopedStorageTableName('reflection_operation_invocations')}(origin_proposal_id)
      WHERE origin_kind = 'proposal_acceptance';
    CREATE UNIQUE INDEX idx_reflection_proposal_reviews_accepted_invocation
      ON ${learnerScopedStorageTableName('reflection_proposal_reviews')}(accepted_invocation_id)
      WHERE accepted_invocation_id IS NOT NULL;
  `);
}

export function validateReflectionSchema(): void {
  assertTableColumns('reflection_artifacts', artifactColumns);
  assertTableColumns('reflection_generation_runs', reflectionGenerationRunColumns);
  assertTableColumns('reflection_proposal_reviews', proposalReviewColumns);
  assertTableColumns('reflection_operation_invocations', invocationColumns);
  validateReflectionQualitySchema();
  validateReflectionHelpInboxSchema();
  assertUniqueIndex(
    'reflection_proposal_reviews',
    ['artifact_id', 'item_id', 'proposal_index'],
  );
  assertNamedIndex(
    'idx_reflection_artifacts_generated',
    'reflection_artifacts',
    false,
    ['generated_at', 'artifact_id'],
  );
  assertNamedIndex(
    'idx_reflection_generation_runs_completed',
    'reflection_generation_runs',
    false,
    ['completed_at', 'run_id'],
  );
  assertNamedIndex(
    'idx_reflection_proposal_reviews_open',
    'reflection_proposal_reviews',
    false,
    ['disposition', 'artifact_id'],
  );
  assertNamedIndex(
    'idx_reflection_invocations_application',
    'reflection_operation_invocations',
    false,
    ['application_state', 'application_updated_at'],
  );
  assertNamedIndex(
    'idx_reflection_invocations_proposal_origin',
    'reflection_operation_invocations',
    true,
    ['origin_proposal_id'],
    true,
  );
  assertNamedIndex(
    'idx_reflection_proposal_reviews_accepted_invocation',
    'reflection_proposal_reviews',
    true,
    ['accepted_invocation_id'],
    true,
  );
  assertForeignKey(
    'reflection_proposal_reviews',
    'artifact_id',
    'reflection_artifacts',
    'artifact_id',
    'RESTRICT',
  );
  assertForeignKey(
    'reflection_proposal_reviews',
    'accepted_invocation_id',
    'reflection_operation_invocations',
    'invocation_id',
    'RESTRICT',
  );
  assertForeignKey(
    'reflection_operation_invocations',
    'origin_proposal_id',
    'reflection_proposal_reviews',
    'proposal_id',
    'RESTRICT',
  );
}

export function materializeReflectionArtifact(
  input: MaterializeReflectionArtifactInput,
): MaterializeReflectionArtifactResult {
  if (input.sourceSessionId !== null) assertNonEmpty(input.sourceSessionId, 'source session id');
  assertNonEmpty(input.reflectionFlowVersion, 'reflection flow version');
  assertNonEmpty(input.provider, 'provider');
  assertNonEmpty(input.model, 'model');
  assertNonEmpty(input.promptVersion, 'prompt version');
  assertIsoTimestamp(input.generatedAt, 'generation timestamp');
  if (
    (
      input.sourceSessionId !== null
      || input.reflectionFlowVersion === STAGED_INITIAL_REFLECTION_FLOW_VERSION
      || input.reflectionFlowVersion === STAGED_DEFERRED_SECOND_OPINION_FLOW_VERSION
    )
    && providerBundleSourceSessionId(input.evidenceBundle) !== input.sourceSessionId
  ) {
    throw new Error('Reflection evidence session does not match the source session id.');
  }
  if (
    input.reflectionFlowVersion === LEGACY_INITIAL_REFLECTION_FLOW_VERSION
    && input.evidenceBundle.schemaVersion !== 'session_reflection_bundle.v2'
    && input.evidenceBundle.schemaVersion !== 'session_reflection_bundle.v3'
    && input.evidenceBundle.schemaVersion !== 'session_reflection_bundle.v4'
  ) {
    throw new Error('The legacy initial reflection flow requires a V2, V3, or V4 evidence bundle.');
  }
  if (
    input.reflectionFlowVersion === STAGED_INITIAL_REFLECTION_FLOW_VERSION
    && input.evidenceBundle.schemaVersion !== 'session_reflection_bundle.v5'
  ) {
    throw new Error('The staged initial reflection flow requires a V5 evidence bundle.');
  }
  if (
    input.reflectionFlowVersion === LEGACY_DEFERRED_SECOND_OPINION_FLOW_VERSION
    && input.evidenceBundle.schemaVersion !== 'curated_reflection_bundle.v1'
  ) {
    throw new Error('The legacy deferred second-opinion flow requires a V1 curated bundle.');
  }
  if (
    input.reflectionFlowVersion === STAGED_DEFERRED_SECOND_OPINION_FLOW_VERSION
    && input.evidenceBundle.schemaVersion !== 'curated_reflection_bundle.v2'
  ) {
    throw new Error('The staged deferred second-opinion flow requires a V2 curated bundle.');
  }
  if (
    isCurrentReflectionFlowVersion(input.reflectionFlowVersion)
    && !isCurrentReflectionArtifactContract({
      reflectionFlowVersion: input.reflectionFlowVersion,
      bundleSchemaVersion: input.evidenceBundle.schemaVersion,
      resultSchemaVersion: input.result.schemaVersion,
      promptVersion: input.promptVersion,
    })
  ) {
    throw new Error('The current reflection flow requires current final bundle, result, and prompt versions.');
  }
  assertCuratedSourceProposalProvenance(input.evidenceBundle, input.sourceProposalIds);
  const validationErrors = validateReflectionArtifactPair(input.result, input.evidenceBundle);
  if (validationErrors.length > 0) {
    throw new Error(`Cannot materialize invalid reflection result:\n${validationErrors.join('\n')}`);
  }

  const artifactId = input.artifactId ?? randomUUID();
  assertNonEmpty(artifactId, 'artifact id');
  const database = getDb();
  let persistedArtifactId = artifactId;
  let created = false;
  database.exec('BEGIN IMMEDIATE');

  try {
    {
      database.prepare(`
        INSERT INTO reflection_artifacts (
          artifact_id,
          source_session_id,
          source_run_id,
          reflection_flow_version,
          generated_at,
          provider,
          model,
          prompt_version,
          bundle_schema_version,
          result_schema_version,
          evidence_bundle_json,
          result_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        artifactId,
        input.sourceSessionId,
        input.sourceRunId ?? null,
        input.reflectionFlowVersion,
        input.generatedAt,
        input.provider,
        input.model,
        input.promptVersion,
        input.evidenceBundle.schemaVersion,
        input.result.schemaVersion,
        JSON.stringify(input.evidenceBundle),
        JSON.stringify(input.result),
      );

      const insertProposal = database.prepare(`
        INSERT INTO reflection_proposal_reviews (
          proposal_id,
          artifact_id,
          item_id,
          proposal_index,
          disposition,
          updated_at
        ) VALUES (?, ?, ?, ?, 'pending', ?)
      `);
      const explanationItemIds: string[] = [];
      for (const itemResult of input.result.itemResults) {
        if (itemResult.proposals.length === 0) {
          explanationItemIds.push(itemResult.itemId);
        }
        for (const [proposalIndex] of itemResult.proposals.entries()) {
          insertProposal.run(
            randomUUID(),
            artifactId,
            itemResult.itemId,
            proposalIndex,
            input.generatedAt,
          );
        }
      }

      if (input.continuationId !== undefined) {
        const updated = database.prepare(`
          UPDATE reflection_generation_continuations
          SET artifact_id = ?
          WHERE learner_id = current_learner_id()
            AND continuation_id = ?
            AND artifact_id IS NULL
            AND final_evidence_bundle_json = ?
            AND diagnosis_result_json IS NOT NULL
        `).run(
          artifactId,
          input.continuationId,
          JSON.stringify(input.evidenceBundle),
        );
        if (updated.changes !== 1) {
          throw new Error('Reflection generation continuation is not ready for final materialization.');
        }
      }
      seedReflectionHelpInboxWithoutTransaction(
        artifactId,
        explanationItemIds,
        input.generatedAt,
      );
      if (
        input.evidenceBundle.schemaVersion === 'curated_reflection_bundle.v1'
        || input.evidenceBundle.schemaVersion === 'curated_reflection_bundle.v2'
      ) {
        const selection = input.sourceProposalIds;
        if (selection === undefined || selection.length === 0) {
          throw new DeferredSecondOpinionError('Second-opinion selection provenance is required.');
        }
        const placeholders = selection.map(() => '?').join(', ');
        const eligible = database.prepare(`
          SELECT proposal_id
          FROM reflection_proposal_reviews
          WHERE proposal_id IN (${placeholders}) AND disposition = 'deferred'
        `).all(...selection) as Array<{ proposal_id: string }>;
        if (eligible.length !== selection.length) {
          throw new DeferredSecondOpinionError(
            'One or more selected deferred proposals were already resolved.',
          );
        }
        database.prepare(`
          UPDATE reflection_proposal_reviews
          SET disposition = 'requested_second_opinion', updated_at = ?
          WHERE proposal_id IN (${placeholders}) AND disposition = 'deferred'
        `).run(input.generatedAt, ...selection);
      }
      created = true;
      database.exec('COMMIT');
    }
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
  return {
    created,
    artifact: getReflectionArtifactDetail(persistedArtifactId),
  };
}

export function getReflectionArtifactBySessionAndFlow(
  sourceSessionId: string,
  reflectionFlowVersion: string,
): ReflectionArtifactDetail | null {
  const artifact = getArtifactBySessionAndFlow(sourceSessionId, reflectionFlowVersion);
  return artifact === null ? null : getReflectionArtifactDetail(artifact.artifactId);
}

export function getReflectionArtifactDetail(artifactId: string): ReflectionArtifactDetail {
  const row = getDb().prepare(`
    SELECT ${artifactColumns.join(', ')}
    FROM reflection_artifacts
    WHERE artifact_id = ?
  `).get(artifactId) as ArtifactRow | undefined;
  if (!row) {
    throw new Error('Reflection artifact not found.');
  }

  const artifact = mapArtifactRow(row);
  const reviewRows = getDb().prepare(`
    SELECT ${proposalReviewColumns.join(', ')}
    FROM reflection_proposal_reviews
    WHERE artifact_id = ?
    ORDER BY item_id ASC, proposal_index ASC
  `).all(artifactId) as unknown as ProposalReviewRow[];
  const reviewRowsByLocator = new Map(
    reviewRows.map((reviewRow) => [
      proposalLocator(reviewRow.item_id, reviewRow.proposal_index),
      reviewRow,
    ]),
  );
  const proposals: ReflectionProposalDetail[] = [];

  for (const itemResult of artifact.result.itemResults) {
    for (const [proposalIndex, proposal] of itemResult.proposals.entries()) {
      const locator = proposalLocator(itemResult.itemId, proposalIndex);
      const reviewRow = reviewRowsByLocator.get(locator);
      if (!reviewRow) {
        throw corruptionError(
          `artifact ${artifactId} is missing the review row for ${locator}`,
        );
      }
      reviewRowsByLocator.delete(locator);
      const review = mapProposalReviewRow(reviewRow);
      const invocationId = invocationIdForReview(review.disposition);
      const invocation = invocationId === null
        ? null
        : getReflectionInvocation(invocationId);
      assertReviewInvocationConsistency(review, invocation);
      proposals.push({
        itemId: itemResult.itemId,
        proposalIndex,
        proposal,
        review,
        invocation,
      });
    }
  }

  if (reviewRowsByLocator.size > 0) {
    throw corruptionError(
      `artifact ${artifactId} has review rows that cannot be traced to immutable proposals`,
    );
  }

  return {
    ...artifact,
    proposals,
    qualityItemTags: listReflectionQualityAnnotationsForArtifact(artifactId),
    helpInbox: listReflectionHelpInboxForArtifact(artifactId),
  };
}

export function listReflectionArtifacts(
  review: 'open' | 'all',
  limit = 50,
): ReflectionArtifactSummary[] {
  if (review !== 'open' && review !== 'all') {
    throw new Error(`Unsupported reflection review filter ${String(review)}.`);
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new Error('Reflection artifact list limit must be an integer from 1 to 200.');
  }

  const openClause = review === 'open'
    ? `WHERE EXISTS (
        SELECT 1
        FROM reflection_proposal_reviews AS open_review
        WHERE open_review.artifact_id = reflection_artifacts.artifact_id
          AND open_review.disposition IN ('pending', 'deferred')
      )`
    : '';
  const rows = getDb().prepare(`
    SELECT ${artifactColumns.join(', ')}
    FROM reflection_artifacts
    ${openClause}
    ORDER BY generated_at DESC, artifact_id ASC
    LIMIT ?
  `).all(limit) as unknown as ArtifactRow[];

  const countStatement = getDb().prepare(`
    SELECT
      COUNT(*) AS proposal_count,
      COALESCE(SUM(CASE WHEN disposition IN ('pending', 'deferred') THEN 1 ELSE 0 END), 0)
        AS open_proposal_count
    FROM reflection_proposal_reviews
    WHERE artifact_id = ?
  `);

  return rows.map((row) => {
    const counts = countStatement.get(row.artifact_id) as {
      proposal_count: number;
      open_proposal_count: number;
    };
    const summary = {
      artifactId: row.artifact_id,
      sourceSessionId: row.source_session_id,
      reflectionFlowVersion: row.reflection_flow_version,
      generatedAt: row.generated_at,
      provider: row.provider,
      model: row.model,
      promptVersion: row.prompt_version,
      bundleSchemaVersion: row.bundle_schema_version,
      resultSchemaVersion: row.result_schema_version,
      proposalCount: counts.proposal_count,
      openProposalCount: counts.open_proposal_count,
    };
    try {
      const artifact = mapArtifactRow(row);
      return {
        ...summary,
        readState: 'available' as const,
        itemCount: artifact.result.itemResults.length,
      };
    } catch {
      return {
        ...summary,
        readState: 'unreadable' as const,
        itemCount: null,
      };
    }
  });
}

/**
 * Reflection artifacts record only validated successful output. This separate
 * append-only log records concluded provider attempts, including failures that
 * never produce an artifact, without adding a new learner-facing lifecycle.
 */
export function recordReflectionGenerationRun(
  input: RecordReflectionGenerationRunInput,
): ReflectionGenerationRunRecord {
  const runId = input.runId ?? randomUUID();
  assertNonEmpty(runId, 'reflection generation run id');
  if (input.sourceSessionId !== null) {
    assertNonEmpty(input.sourceSessionId, 'reflection generation run source session id');
  }
  assertNonEmpty(input.reflectionFlowVersion, 'reflection generation run flow version');
  assertIsoTimestamp(input.startedAt, 'reflection generation run start time');
  assertIsoTimestamp(input.completedAt, 'reflection generation run completion time');
  assertNonEmpty(input.provider, 'reflection generation run provider');
  assertNonEmpty(input.model, 'reflection generation run model');
  assertNonEmpty(input.providerModel, 'reflection generation run provider model');
  assertNonEmpty(input.promptVersion, 'reflection generation run prompt version');
  if (input.state !== 'succeeded' && input.state !== 'failed') {
    throw new Error('Reflection generation run state must be succeeded or failed.');
  }
  if ((input.state === 'succeeded') !== (input.failureCode === null)) {
    throw new Error('Successful reflection generation runs cannot have a failure code.');
  }
  assertCount(input.eligibleItemCount, 'eligible reflection evidence item count');
  assertCount(input.includedItemCount, 'included reflection evidence item count');
  if (input.includedItemCount > input.eligibleItemCount) {
    throw new Error('Included reflection evidence item count cannot exceed eligible item count.');
  }
  if (
    (
      input.sourceSessionId !== null
      || input.reflectionFlowVersion === STAGED_INITIAL_REFLECTION_FLOW_VERSION
      || input.reflectionFlowVersion === STAGED_DEFERRED_SECOND_OPINION_FLOW_VERSION
    )
    && providerBundleSourceSessionId(input.evidenceBundle) !== input.sourceSessionId
  ) {
    throw new Error('Reflection generation run source session does not match its evidence bundle.');
  }
  if (
    input.reflectionFlowVersion === LEGACY_INITIAL_REFLECTION_FLOW_VERSION
    && input.evidenceBundle.schemaVersion !== 'session_reflection_bundle.v2'
    && input.evidenceBundle.schemaVersion !== 'session_reflection_bundle.v3'
    && input.evidenceBundle.schemaVersion !== 'session_reflection_bundle.v4'
  ) {
    throw new Error('The legacy reflection flow requires a V2, V3, or V4 retained evidence bundle.');
  }
  assertCuratedSourceProposalProvenance(input.evidenceBundle, input.sourceProposalIds);
  parseReflectionGenerationProviderBundle(input.evidenceBundle);
  assertNormalizedUsage(input.usage);
  if (input.estimatedCostUsd !== null && (!Number.isFinite(input.estimatedCostUsd)
    || input.estimatedCostUsd < 0)) {
    throw new Error('Estimated reflection run cost must be a non-negative finite number.');
  }

  const pricingPresent = input.pricingSnapshotId !== null
    || input.pricingAsOf !== null
    || input.pricingBasis !== null
    || input.estimatedCostUsd !== null;
  if (pricingPresent && (
    input.pricingSnapshotId === null
    || input.pricingAsOf === null
    || input.pricingBasis === null
    || input.estimatedCostUsd === null
  )) {
    throw new Error('Reflection run pricing fields must be present together.');
  }

  getDb().prepare(`
    INSERT INTO reflection_generation_runs (
      run_id, source_session_id, reflection_flow_version, started_at, completed_at,
      provider, model, provider_model, prompt_version, response_id, finish_reason,
      client_request_id, bundle_schema_version, result_schema_version, diagnostic_json,
      state, failure_code, eligible_item_count, included_item_count,
      input_tokens, cached_input_tokens, cache_write_input_tokens, output_tokens,
      reasoning_tokens, total_tokens, pricing_snapshot_id, pricing_as_of,
      pricing_basis_json, estimated_cost_usd, evidence_bundle_json, source_proposal_ids_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    runId,
    input.sourceSessionId,
    input.reflectionFlowVersion,
    input.startedAt,
    input.completedAt,
    input.provider,
    input.model,
    input.providerModel,
    input.promptVersion,
    input.responseId,
    input.finishReason,
    input.clientRequestId ?? null,
    input.bundleSchemaVersion ?? input.evidenceBundle.schemaVersion,
    input.resultSchemaVersion ?? (
      (
        input.evidenceBundle.schemaVersion === 'session_reflection_bundle.v2'
        || input.evidenceBundle.schemaVersion === 'session_reflection_bundle.v3'
        || input.evidenceBundle.schemaVersion === 'session_reflection_bundle.v4'
        || input.evidenceBundle.schemaVersion === 'curated_reflection_bundle.v1'
        || input.evidenceBundle.schemaVersion === 'curated_reflection_diagnosis_bundle.v2'
      )
        ? (input.evidenceBundle.schemaVersion === 'session_reflection_bundle.v4'
          || input.evidenceBundle.schemaVersion === 'curated_reflection_bundle.v1'
          || input.evidenceBundle.schemaVersion === 'curated_reflection_diagnosis_bundle.v2')
          ? 'session_reflection_result.v7'
          : 'session_reflection_result.v6'
        : 'session_reflection_result.v4'
    ),
    input.diagnostic === undefined || input.diagnostic === null
      ? null
      : JSON.stringify(input.diagnostic),
    input.state,
    input.failureCode,
    input.eligibleItemCount,
    input.includedItemCount,
    input.usage.inputTokens,
    input.usage.cachedInputTokens,
    input.usage.cacheWriteInputTokens,
    input.usage.outputTokens,
    input.usage.reasoningTokens,
    input.usage.totalTokens,
    input.pricingSnapshotId,
    input.pricingAsOf,
    input.pricingBasis === null ? null : JSON.stringify(input.pricingBasis),
    input.estimatedCostUsd,
    JSON.stringify(input.evidenceBundle),
    input.sourceProposalIds === undefined || input.sourceProposalIds === null
      ? null
      : JSON.stringify(input.sourceProposalIds),
  );
  return getReflectionGenerationRun(runId);
}

/** Durable evidence that a selected provider was about to receive this bundle. */
export function startReflectionGenerationRun(input: StartReflectionGenerationRunInput): void {
  assertNonEmpty(input.runId, 'reflection generation run id');
  if (input.sourceSessionId !== null) assertNonEmpty(input.sourceSessionId, 'reflection generation run source session id');
  assertNonEmpty(input.reflectionFlowVersion, 'reflection generation run flow version');
  assertIsoTimestamp(input.startedAt, 'reflection generation run start time');
  assertNonEmpty(input.provider, 'reflection generation run provider');
  assertNonEmpty(input.model, 'reflection generation run model');
  assertNonEmpty(input.providerModel, 'reflection generation run provider model');
  assertNonEmpty(input.promptVersion, 'reflection generation run prompt version');
  assertNonEmpty(input.clientRequestId, 'reflection generation client request id');
  assertCount(input.eligibleItemCount, 'eligible reflection evidence item count');
  assertCount(input.includedItemCount, 'included reflection evidence item count');
  if (input.includedItemCount > input.eligibleItemCount) throw new Error('Included reflection evidence item count cannot exceed eligible item count.');
  if (
    (
      input.sourceSessionId !== null
      || input.reflectionFlowVersion === STAGED_INITIAL_REFLECTION_FLOW_VERSION
      || input.reflectionFlowVersion === STAGED_DEFERRED_SECOND_OPINION_FLOW_VERSION
    )
    && providerBundleSourceSessionId(input.evidenceBundle) !== input.sourceSessionId
  ) throw new Error('Reflection generation run source session does not match its evidence bundle.');
  parseReflectionGenerationProviderBundle(input.evidenceBundle);
  assertCuratedSourceProposalProvenance(input.evidenceBundle, input.sourceProposalIds);
  getDb().prepare(`
    INSERT INTO reflection_generation_run_starts (
      run_id, source_session_id, reflection_flow_version, started_at,
      provider, model, provider_model, prompt_version, client_request_id,
      eligible_item_count, included_item_count, evidence_bundle_json, source_proposal_ids_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.runId, input.sourceSessionId, input.reflectionFlowVersion, input.startedAt,
    input.provider, input.model, input.providerModel, input.promptVersion, input.clientRequestId,
    input.eligibleItemCount, input.includedItemCount, JSON.stringify(input.evidenceBundle),
    input.sourceProposalIds === undefined || input.sourceProposalIds === null
      ? null
      : JSON.stringify(input.sourceProposalIds),
  );
}

export function listReflectionGenerationRuns(limit = 50): ReflectionGenerationRunRecord[] {
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new Error('Reflection generation run list limit must be an integer from 1 to 200.');
  }
  const activeRows = getDb().prepare(`
    SELECT starts.* FROM reflection_generation_run_starts AS starts
    WHERE NOT EXISTS (SELECT 1 FROM reflection_generation_runs AS runs WHERE runs.run_id = starts.run_id)
    ORDER BY starts.started_at DESC, starts.run_id ASC LIMIT ?
  `).all(limit) as Array<{
    run_id: string; source_session_id: string | null; reflection_flow_version: string;
    started_at: string; provider: string; model: string; provider_model: string; prompt_version: string;
    client_request_id: string; eligible_item_count: number; included_item_count: number;
  }>;
  const inFlight = activeRows.map((row): ReflectionGenerationRunRecord => ({
    runId: row.run_id, sourceSessionId: row.source_session_id, reflectionFlowVersion: row.reflection_flow_version,
    startedAt: row.started_at, completedAt: null, provider: row.provider, model: row.model,
    providerModel: row.provider_model, promptVersion: row.prompt_version, responseId: null,
    clientRequestId: row.client_request_id, finishReason: null, bundleSchemaVersion: 'session_reflection_bundle.v4',
    resultSchemaVersion: 'session_reflection_result.v7', diagnostic: null, state: 'in_flight', failureCode: null,
    eligibleItemCount: row.eligible_item_count, includedItemCount: row.included_item_count,
    usage: { inputTokens: null, cachedInputTokens: null, cacheWriteInputTokens: null, outputTokens: null, reasoningTokens: null, totalTokens: null },
    pricingSnapshotId: null, pricingAsOf: null, pricingBasis: null, estimatedCostUsd: null, retryable: false,
  }));
  if (inFlight.length >= limit) return inFlight;
  const concludedRows = getDb().prepare(`
    SELECT ${reflectionGenerationRunColumns.map((column) => `runs.${column}`).join(', ')},
      CASE WHEN runs.state = 'failed' AND runs.evidence_bundle_json IS NOT NULL AND EXISTS (
        SELECT 1
        FROM reflection_generation_continuation_runs AS links
        JOIN reflection_generation_continuations AS continuations
          ON continuations.learner_id = links.learner_id
          AND continuations.continuation_id = links.continuation_id
        WHERE links.learner_id = current_learner_id()
          AND links.run_id = runs.run_id
          AND continuations.artifact_id IS NULL
          AND continuations.reflection_flow_version = runs.reflection_flow_version
          AND (
            (
              links.stage = 'diagnosis'
              AND runs.prompt_version = '${STAGED_REFLECTION_DIAGNOSIS_PROMPT_VERSION}'
              AND (
                (runs.reflection_flow_version = '${CURRENT_INITIAL_REFLECTION_FLOW_VERSION}'
                  AND runs.bundle_schema_version = 'session_reflection_bundle.v4')
                OR (runs.reflection_flow_version = '${CURRENT_DEFERRED_SECOND_OPINION_FLOW_VERSION}'
                  AND runs.bundle_schema_version = 'curated_reflection_diagnosis_bundle.v2')
              )
            )
            OR (
              links.stage = 'promotion'
              AND runs.reflection_flow_version IN (
                '${CURRENT_INITIAL_REFLECTION_FLOW_VERSION}',
                '${CURRENT_DEFERRED_SECOND_OPINION_FLOW_VERSION}'
              )
              AND runs.bundle_schema_version = 'pure_cue_promotion_bundle.v1'
              AND runs.prompt_version = '${PURE_CUE_PROMOTION_PROMPT_VERSION}'
            )
          )
      ) THEN 1 ELSE 0 END AS retryable
    FROM reflection_generation_runs AS runs
    ORDER BY completed_at DESC, run_id ASC
    LIMIT ?
  `).all(limit - inFlight.length) as unknown as ReflectionGenerationRunRow[];
  return [...inFlight, ...concludedRows.map(mapReflectionGenerationRunRow)];
}

export function getReflectionSpendCap(now = new Date()): ReflectionSpendCap {
  const dayKey = utcDayKey(now);
  const { start, end } = utcDayRange(dayKey);
  const row = getDb().prepare(`
    SELECT COALESCE(SUM(estimated_cost_usd), 0) AS spent_usd
    FROM reflection_generation_runs
    WHERE completed_at >= ? AND completed_at < ?
  `).get(start, end) as { spent_usd: number };
  return buildReflectionSpendCap(row.spent_usd, now);
}

function getReflectionGenerationRun(runId: string): ReflectionGenerationRunRecord {
  const row = getDb().prepare(`
    SELECT ${reflectionGenerationRunColumns.map((column) => `runs.${column}`).join(', ')},
      CASE WHEN runs.state = 'failed' AND runs.evidence_bundle_json IS NOT NULL AND EXISTS (
        SELECT 1 FROM reflection_generation_continuation_runs AS links
        JOIN reflection_generation_continuations AS continuations
          ON continuations.learner_id = links.learner_id
          AND continuations.continuation_id = links.continuation_id
        WHERE links.learner_id = current_learner_id()
          AND links.run_id = runs.run_id
          AND continuations.artifact_id IS NULL
          AND continuations.reflection_flow_version = runs.reflection_flow_version
          AND (
            (
              links.stage = 'diagnosis'
              AND runs.prompt_version = '${STAGED_REFLECTION_DIAGNOSIS_PROMPT_VERSION}'
              AND (
                (runs.reflection_flow_version = '${CURRENT_INITIAL_REFLECTION_FLOW_VERSION}'
                  AND runs.bundle_schema_version = 'session_reflection_bundle.v4')
                OR (runs.reflection_flow_version = '${CURRENT_DEFERRED_SECOND_OPINION_FLOW_VERSION}'
                  AND runs.bundle_schema_version = 'curated_reflection_diagnosis_bundle.v2')
              )
            )
            OR (
              links.stage = 'promotion'
              AND runs.reflection_flow_version IN (
                '${CURRENT_INITIAL_REFLECTION_FLOW_VERSION}',
                '${CURRENT_DEFERRED_SECOND_OPINION_FLOW_VERSION}'
              )
              AND runs.bundle_schema_version = 'pure_cue_promotion_bundle.v1'
              AND runs.prompt_version = '${PURE_CUE_PROMOTION_PROMPT_VERSION}'
            )
          )
      ) THEN 1 ELSE 0 END AS retryable
    FROM reflection_generation_runs AS runs
    WHERE runs.run_id = ?
  `).get(runId) as ReflectionGenerationRunRow | undefined;
  if (!row) throw new Error('Reflection generation run not found.');
  return mapReflectionGenerationRunRow(row);
}

function parseSourceProposalIds(value: string, runId: string): string[] {
  const parsed = parseJson(value, `reflection generation run ${runId} source proposal ids`);
  if (!Array.isArray(parsed) || parsed.some((id) => typeof id !== 'string' || id.trim().length === 0)) {
    throw corruptionError(`reflection generation run ${runId} source proposal ids are invalid`);
  }
  return parsed;
}

function providerBundleSourceSessionId(bundle: ReflectionGenerationProviderBundle): string | null {
  if ('session' in bundle) return bundle.session.sessionId;
  if (bundle.schemaVersion === 'pure_cue_promotion_bundle.v1') return bundle.sourceSessionId;
  return null;
}

function parseReflectionGenerationProviderBundle(
  value: unknown,
): ReflectionGenerationProviderBundle {
  if (isRecord(value) && value.schemaVersion === 'pure_cue_promotion_bundle.v1') {
    return parsePureCuePromotionBundleV1(value);
  }
  if (isRecord(value) && value.schemaVersion === 'curated_reflection_diagnosis_bundle.v2') {
    return parseCuratedReflectionDiagnosisBundleV2(value);
  }
  return parseStoredSessionReflectionBundle(value);
}

export function createReflectionGenerationContinuation(input: {
  continuationId?: string;
  sourceSessionId: string | null;
  reflectionFlowVersion: string;
  createdAt: string;
  eligibleItemCount: number;
  includedItemCount: number;
  diagnosisBundle: SessionReflectionBundleV4 | CuratedReflectionDiagnosisBundleV2;
  sourceProposalIds?: string[];
}): ReflectionGenerationContinuation {
  const continuationId = input.continuationId ?? randomUUID();
  assertNonEmpty(continuationId, 'reflection continuation id');
  assertIsoTimestamp(input.createdAt, 'reflection continuation creation time');
  assertCount(input.eligibleItemCount, 'eligible reflection evidence item count');
  assertCount(input.includedItemCount, 'included reflection evidence item count');
  if (input.includedItemCount > input.eligibleItemCount) {
    throw new Error('Included reflection evidence item count cannot exceed eligible item count.');
  }
  parseReflectionGenerationProviderBundle(input.diagnosisBundle);
  if (!isCurrentReflectionGenerationStage({
    reflectionFlowVersion: input.reflectionFlowVersion,
    stage: 'diagnosis',
    bundleSchemaVersion: input.diagnosisBundle.schemaVersion,
    promptVersion: STAGED_REFLECTION_DIAGNOSIS_PROMPT_VERSION,
  })) {
    throw new Error('New reflection continuations require the current staged diagnosis contract.');
  }
  if (providerBundleSourceSessionId(input.diagnosisBundle) !== input.sourceSessionId) {
    throw new Error('Reflection continuation source session does not match its diagnosis bundle.');
  }
  assertCuratedSourceProposalProvenance(input.diagnosisBundle, input.sourceProposalIds);
  getDb().prepare(`
    INSERT INTO reflection_generation_continuations (
      learner_id, continuation_id, source_session_id, reflection_flow_version,
      created_at, eligible_item_count, included_item_count, diagnosis_bundle_json,
      source_proposal_ids_json, diagnosis_result_json, final_evidence_bundle_json,
      promotion_bundle_json, artifact_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL)
  `).run(
    requireLearnerId(),
    continuationId,
    input.sourceSessionId,
    input.reflectionFlowVersion,
    input.createdAt,
    input.eligibleItemCount,
    input.includedItemCount,
    JSON.stringify(input.diagnosisBundle),
    input.sourceProposalIds === undefined ? null : JSON.stringify(input.sourceProposalIds),
  );
  return getReflectionGenerationContinuation(continuationId);
}

export function linkReflectionGenerationContinuationRun(input: {
  continuationId: string;
  runId: string;
  stage: ReflectionGenerationContinuationStage;
  createdAt: string;
}): void {
  assertNonEmpty(input.continuationId, 'reflection continuation id');
  assertNonEmpty(input.runId, 'reflection continuation run id');
  assertIsoTimestamp(input.createdAt, 'reflection continuation run link time');
  if (input.stage !== 'diagnosis' && input.stage !== 'promotion') {
    throw new Error('Reflection continuation stage must be diagnosis or promotion.');
  }
  getDb().prepare(`
    INSERT INTO reflection_generation_continuation_runs (
      learner_id, run_id, continuation_id, stage, created_at
    ) VALUES (?, ?, ?, ?, ?)
  `).run(requireLearnerId(), input.runId, input.continuationId, input.stage, input.createdAt);
}

export function prepareReflectionGenerationPromotion(input: {
  continuationId: string;
  diagnosisResult: SessionReflectionResultV7;
  preparedAt: string;
}): ReflectionGenerationContinuation {
  assertIsoTimestamp(input.preparedAt, 'reflection promotion preparation time');
  const continuation = getReflectionGenerationContinuation(input.continuationId);
  const validationErrors = validateSessionReflectionResultV7(
    input.diagnosisResult,
    continuation.diagnosisBundle,
  );
  if (validationErrors.length > 0) {
    throw new Error(`Cannot persist invalid staged diagnosis:\n${validationErrors.join('\n')}`);
  }
  const resultByItemId = new Map(
    input.diagnosisResult.itemResults.map((itemResult) => [itemResult.itemId, itemResult]),
  );
  const enrichedItems = continuation.diagnosisBundle.items.map((item): ReflectionItemV5 => {
    const itemResult = resultByItemId.get(item.itemId)!;
    const responseWordId = item.submittedWord?.wordId ?? null;
    const targetWordId = item.targetWord.wordId;
    const distinctPair = responseWordId !== null && responseWordId !== targetWordId;
    const shouldEnrich = distinctPair && isPureCuePromotionCandidate(item, itemResult);
    const activeByWord = shouldEnrich
      ? [targetWordId, responseWordId].map((wordId) => ({
          wordId,
          activeProductionCues: getActiveProductionCuesForWord(wordId).map((cue) => ({
            cueId: cue.cueId,
            taskId: cue.taskId,
            cueType: cue.cueType,
            text: cue.text,
            acceptedWordIds: cue.acceptedWordIds,
          })),
        }))
      : [];
    const promotionEvidence = shouldEnrich ? {
      diagnosisTags: [...itemResult.diagnosisTags],
      words: activeByWord,
      intersectingPureCues: getPureCues()
        .filter((cue) => cue.active && cue.acceptedWordIds.some((wordId) => (
          wordId === targetWordId || wordId === responseWordId
        )))
        .map((cue) => ({
          id: cue.id,
          stimulus: cue.stimulus,
          axisNote: cue.axisNote,
          acceptedWordIds: cue.acceptedWordIds,
        })),
    } : null;
    return { ...item, promotionEvidence };
  });
  const studyProfile = 'session' in continuation.diagnosisBundle
    ? continuation.diagnosisBundle.session.studyProfile
    : continuation.diagnosisBundle.studyProfile;
  const finalEvidenceBundle: SessionReflectionBundleV5 | CuratedReflectionBundleV2 =
    'session' in continuation.diagnosisBundle
      ? {
          schemaVersion: 'session_reflection_bundle.v5',
          generatedAt: input.preparedAt,
          session: continuation.diagnosisBundle.session,
          items: enrichedItems,
        }
      : {
          schemaVersion: 'curated_reflection_bundle.v2',
          generatedAt: input.preparedAt,
          studyProfile,
          items: enrichedItems,
        };
  parseStoredSessionReflectionBundle(finalEvidenceBundle);
  const promotionBundle: PureCuePromotionBundleV1 = {
    schemaVersion: 'pure_cue_promotion_bundle.v1',
    generatedAt: input.preparedAt,
    sourceSessionId: continuation.sourceSessionId,
    studyProfile,
    items: enrichedItems.flatMap((item) => {
      const itemResult = resultByItemId.get(item.itemId)!;
      if (item.promotionEvidence === null || item.submittedWord === null) return [];
      return [{
        itemId: item.itemId,
        sourceAttemptId: item.sourceAttemptId,
        targetWord: item.targetWord,
        responseWord: item.submittedWord,
        servedCue: item.servedCue,
        learnerExplanation: itemResult.learnerExplanation,
        promotionEvidence: item.promotionEvidence,
      }];
    }),
  };
  parsePureCuePromotionBundleV1(promotionBundle);

  const database = getDb();
  const stored = database.prepare(`
    SELECT diagnosis_result_json, final_evidence_bundle_json, promotion_bundle_json
    FROM reflection_generation_continuations
    WHERE learner_id = ? AND continuation_id = ?
  `).get(requireLearnerId(), input.continuationId) as {
    diagnosis_result_json: string | null;
    final_evidence_bundle_json: string | null;
    promotion_bundle_json: string | null;
  } | undefined;
  if (stored === undefined) throw new Error('Reflection generation continuation not found.');
  const exact = [
    JSON.stringify(input.diagnosisResult),
    JSON.stringify(finalEvidenceBundle),
    JSON.stringify(promotionBundle),
  ];
  if (stored.diagnosis_result_json !== null) {
    if (
      stored.diagnosis_result_json !== exact[0]
      || stored.final_evidence_bundle_json !== exact[1]
      || stored.promotion_bundle_json !== exact[2]
    ) {
      throw new Error('Reflection continuation diagnosis was already prepared with different evidence.');
    }
    return getReflectionGenerationContinuation(input.continuationId);
  }
  const updated = database.prepare(`
    UPDATE reflection_generation_continuations
    SET diagnosis_result_json = ?, final_evidence_bundle_json = ?, promotion_bundle_json = ?
    WHERE learner_id = ? AND continuation_id = ? AND diagnosis_result_json IS NULL
  `).run(...exact, requireLearnerId(), input.continuationId);
  if (updated.changes !== 1) throw new Error('Reflection continuation could not save promotion evidence.');
  return getReflectionGenerationContinuation(input.continuationId);
}

export function getReflectionGenerationContinuationRetrySource(
  runId: string,
): ReflectionGenerationContinuationRetrySource | null {
  const row = getDb().prepare(`
    SELECT links.continuation_id, links.stage, runs.provider, runs.model,
      runs.provider_model, runs.prompt_version, runs.bundle_schema_version,
      runs.state, runs.reflection_flow_version AS run_flow_version,
      continuations.reflection_flow_version, continuations.artifact_id
    FROM reflection_generation_continuation_runs AS links
    JOIN reflection_generation_runs AS runs ON runs.run_id = links.run_id
    JOIN reflection_generation_continuations AS continuations
      ON continuations.learner_id = links.learner_id
      AND continuations.continuation_id = links.continuation_id
    WHERE links.learner_id = ? AND links.run_id = ?
  `).get(requireLearnerId(), runId) as {
    continuation_id: string;
    stage: ReflectionGenerationContinuationStage;
    provider: string;
    model: string;
    provider_model: string;
    prompt_version: string;
    bundle_schema_version: string | null;
    state: ReflectionGenerationRunState;
    run_flow_version: string;
    reflection_flow_version: string;
    artifact_id: string | null;
  } | undefined;
  if (row === undefined) return null;
  if (
    row.state !== 'failed'
    || row.artifact_id !== null
    || row.run_flow_version !== row.reflection_flow_version
    || !isCurrentReflectionGenerationStage({
      reflectionFlowVersion: row.reflection_flow_version,
      stage: row.stage,
      bundleSchemaVersion: row.bundle_schema_version,
      promptVersion: row.prompt_version,
    })
  ) return null;
  return {
    runId,
    continuation: getReflectionGenerationContinuation(row.continuation_id),
    stage: row.stage,
    provider: row.provider,
    model: row.model,
    providerModel: row.provider_model,
    promptVersion: row.prompt_version,
  };
}

export function getReflectionGenerationContinuation(
  continuationId: string,
): ReflectionGenerationContinuation {
  const row = getDb().prepare(`
    SELECT * FROM reflection_generation_continuations
    WHERE learner_id = ? AND continuation_id = ?
  `).get(requireLearnerId(), continuationId) as ReflectionGenerationContinuationRow | undefined;
  if (row === undefined) throw new Error('Reflection generation continuation not found.');
  return mapReflectionGenerationContinuation(row);
}

type ReflectionGenerationContinuationRow = {
  continuation_id: string;
  source_session_id: string | null;
  reflection_flow_version: string;
  created_at: string;
  eligible_item_count: number;
  included_item_count: number;
  diagnosis_bundle_json: string;
  source_proposal_ids_json: string | null;
  diagnosis_result_json: string | null;
  final_evidence_bundle_json: string | null;
  promotion_bundle_json: string | null;
  artifact_id: string | null;
};

function mapReflectionGenerationContinuation(
  row: ReflectionGenerationContinuationRow,
): ReflectionGenerationContinuation {
  const diagnosisBundle = parseReflectionGenerationProviderBundle(parseJson(
    row.diagnosis_bundle_json,
    `reflection continuation ${row.continuation_id} diagnosis bundle`,
  ));
  if (
    diagnosisBundle.schemaVersion !== 'session_reflection_bundle.v4'
    && diagnosisBundle.schemaVersion !== 'curated_reflection_diagnosis_bundle.v2'
  ) {
    throw corruptionError(`reflection continuation ${row.continuation_id} has an invalid diagnosis bundle`);
  }
  const diagnosisResult = row.diagnosis_result_json === null
    ? null
    : parseJson(row.diagnosis_result_json, `reflection continuation ${row.continuation_id} diagnosis result`) as SessionReflectionResultV7;
  if (diagnosisResult !== null) {
    const errors = validateSessionReflectionResultV7(diagnosisResult, diagnosisBundle);
    if (errors.length > 0) throw corruptionError(errors.join('; '));
  }
  const finalEvidenceBundle = row.final_evidence_bundle_json === null
    ? null
    : parseStoredSessionReflectionBundle(parseJson(
        row.final_evidence_bundle_json,
        `reflection continuation ${row.continuation_id} final evidence`,
      ));
  if (
    finalEvidenceBundle !== null
    && finalEvidenceBundle.schemaVersion !== 'session_reflection_bundle.v5'
    && finalEvidenceBundle.schemaVersion !== 'curated_reflection_bundle.v2'
  ) {
    throw corruptionError(`reflection continuation ${row.continuation_id} has invalid final evidence`);
  }
  const promotionBundle = row.promotion_bundle_json === null
    ? null
    : parsePureCuePromotionBundleV1(parseJson(
        row.promotion_bundle_json,
        `reflection continuation ${row.continuation_id} promotion bundle`,
      ));
  return {
    continuationId: row.continuation_id,
    sourceSessionId: row.source_session_id,
    reflectionFlowVersion: row.reflection_flow_version,
    createdAt: row.created_at,
    eligibleItemCount: row.eligible_item_count,
    includedItemCount: row.included_item_count,
    diagnosisBundle,
    sourceProposalIds: row.source_proposal_ids_json === null
      ? null
      : parseSourceProposalIds(row.source_proposal_ids_json, row.continuation_id),
    diagnosisResult,
    finalEvidenceBundle,
    promotionBundle,
    artifactId: row.artifact_id,
  };
}

function isPureCuePromotionCandidate(
  item: ReflectionItemV4,
  itemResult: SessionReflectionResultV7['itemResults'][number],
): boolean {
  if (item.responseKind !== 'matched_known_word' || item.submittedWord === null) return false;
  const diagnosisSelected = itemResult.diagnosisTags.some((tag) => (
    tag === 'valid_or_near_valid_alternate'
    || tag === 'cue_overlap_hides_usage_difference'
    || tag === 'production_cue_overloaded'
  ));
  const proposesMultiAnswerCue = itemResult.proposals.some(({ operation }) => (
    operation.kind === 'repair_production_cue'
    && operation.version === 2
    && operation.changes.some((change) => {
      if (change.kind === 'create') return change.cue.acceptedWordIds.length > 1;
      if (change.kind === 'replace') {
        return change.replacements.some((replacement) => replacement.acceptedWordIds.length > 1);
      }
      return false;
    })
  ));
  if (!diagnosisSelected && !proposesMultiAnswerCue) return false;
  try {
    assertPureCuePromotionSource(
      item.sourceAttemptId,
      item.targetWord.wordId,
      item.submittedWord.wordId,
    );
    return true;
  } catch {
    return false;
  }
}

function assertCuratedSourceProposalProvenance(
  bundle: ReflectionGenerationProviderBundle,
  sourceProposalIds: string[] | null | undefined,
): void {
  if (
    bundle.schemaVersion !== 'curated_reflection_bundle.v1'
    && bundle.schemaVersion !== 'curated_reflection_diagnosis_bundle.v2'
    && bundle.schemaVersion !== 'curated_reflection_bundle.v2'
    && !(bundle.schemaVersion === 'pure_cue_promotion_bundle.v1' && bundle.sourceSessionId === null)
  ) {
    if (sourceProposalIds !== null && sourceProposalIds !== undefined) {
      throw new Error('Only curated reflection bundles may retain proposal selection provenance.');
    }
    return;
  }
  if (sourceProposalIds === null || sourceProposalIds === undefined || sourceProposalIds.length === 0) {
    throw new Error('Curated reflection bundles require selected proposal provenance.');
  }
  const unique = new Set<string>();
  for (const proposalId of sourceProposalIds) {
    assertNonEmpty(proposalId, 'selected source proposal id');
    if (unique.has(proposalId)) throw new Error('Selected source proposal ids must be unique.');
    unique.add(proposalId);
  }
}

export function deferReflectionProposal(
  proposalId: string,
  updatedAt = new Date().toISOString(),
): ProposalReviewStatus {
  return transitionProposalReview(proposalId, 'deferred', updatedAt, () => {
    getDb().prepare(`
      UPDATE reflection_proposal_reviews
      SET disposition = 'deferred',
          updated_at = ?
      WHERE proposal_id = ?
    `).run(updatedAt, proposalId);
  });
}

/**
 * Resolves learner-owned deferred proposals to their immutable source items.
 * The returned envelope intentionally contains no earlier proposal text or
 * review disposition; the provider sees only the original evidence again.
 */
export function buildStagedDeferredSecondOpinionBundle(
  proposalIds: string[],
  generatedAt = new Date().toISOString(),
): { bundle: CuratedReflectionDiagnosisBundleV2; sourceProposalIds: string[] } {
  const normalizedProposalIds = [...new Set(proposalIds.map((proposalId) => proposalId.trim()))].sort();
  if (normalizedProposalIds.length === 0) {
    throw new DeferredSecondOpinionError('Select at least one deferred proposal.');
  }
  if (normalizedProposalIds.some((proposalId) => proposalId.length === 0)) {
    throw new DeferredSecondOpinionError('Selected proposal ids must be non-empty.');
  }
  const placeholders = normalizedProposalIds.map(() => '?').join(', ');
  const rows = getDb().prepare(`
    SELECT proposal_id, artifact_id, item_id
    FROM reflection_proposal_reviews
    WHERE proposal_id IN (${placeholders}) AND disposition = 'deferred'
  `).all(...normalizedProposalIds) as Array<{ proposal_id: string; artifact_id: string; item_id: string }>;
  if (rows.length !== normalizedProposalIds.length) {
    throw new DeferredSecondOpinionError(
      'Every selected proposal must still be deferred and available for a second opinion.',
    );
  }

  const sourceItems = new Map<string, ReflectionItemV4>();
  const studyProfiles = new Set<string>();
  for (const row of rows) {
    const artifact = getReflectionArtifactDetail(row.artifact_id);
    if (!reflectionArtifactSupportsCurrentActions(artifact)) {
      throw new DeferredSecondOpinionError(
        'Second opinions are only available for proposals from the current reflection version. '
        + 'This older proposal remains viewable.',
      );
    }
    const item = artifact.evidenceBundle.items.find((candidate) => candidate.itemId === row.item_id);
    if (item === undefined) {
      throw new DeferredSecondOpinionError('A selected proposal no longer has usable retained evidence.');
    }
    if (!('servedCue' in item)) {
      throw new DeferredSecondOpinionError('A selected proposal no longer has usable retained evidence.');
    }
    const { promotionEvidence: _promotionEvidence, ...diagnosisItem } = item as ReflectionItemV5;
    sourceItems.set(`${row.artifact_id}\u0000${row.item_id}`, {
      ...diagnosisItem,
      servedCue: {
        ...diagnosisItem.servedCue,
        supplement: diagnosisItem.servedCue.supplement ?? null,
      },
    });
    studyProfiles.add(
      'session' in artifact.evidenceBundle
        ? artifact.evidenceBundle.session.studyProfile
        : 'studyProfile' in artifact.evidenceBundle
          ? artifact.evidenceBundle.studyProfile
          : getConfig().studyProfile,
    );
  }
  if (sourceItems.size > DEFERRED_SECOND_OPINION_MAX_EVIDENCE_ITEMS) {
    throw new DeferredSecondOpinionError(
      `Select at most ${DEFERRED_SECOND_OPINION_MAX_EVIDENCE_ITEMS} distinct evidence items for one second opinion.`,
    );
  }

  const requestId = randomUUID();
  const items = [...sourceItems.values()].map((item, index) => ({
    ...item,
    itemId: `${requestId}:item:${index + 1}`,
  }));
  if (studyProfiles.size !== 1) {
    throw new DeferredSecondOpinionError('Selected evidence spans incompatible study profiles.');
  }
  const bundle: CuratedReflectionDiagnosisBundleV2 = {
    schemaVersion: 'curated_reflection_diagnosis_bundle.v2',
    generatedAt,
    studyProfile: [...studyProfiles][0] as CuratedReflectionDiagnosisBundleV2['studyProfile'],
    items,
  };
  parseCuratedReflectionDiagnosisBundleV2(bundle);
  return { bundle, sourceProposalIds: normalizedProposalIds };
}

export function dismissReflectionProposal(
  proposalId: string,
  reason: string | null,
  updatedAt = new Date().toISOString(),
): ProposalReviewStatus {
  return transitionProposalReview(proposalId, 'dismissed', updatedAt, () => {
    getDb().prepare(`
      UPDATE reflection_proposal_reviews
      SET disposition = 'dismissed',
          updated_at = ?,
          dismissal_reason = ?
      WHERE proposal_id = ?
    `).run(updatedAt, reason, proposalId);
  });
}

export function reopenReflectionProposal(
  proposalId: string,
  updatedAt = new Date().toISOString(),
): ProposalReviewStatus {
  return transitionProposalReview(proposalId, 'pending', updatedAt, () => {
    getDb().prepare(`
      UPDATE reflection_proposal_reviews
      SET disposition = 'pending',
          updated_at = ?,
          dismissal_reason = NULL
      WHERE proposal_id = ?
    `).run(updatedAt, proposalId);
  });
}

export function supersedeReflectionProposal(
  input: SupersedeReflectionProposalInput,
): ProposalReviewStatus {
  const updatedAt = input.updatedAt ?? new Date().toISOString();
  assertSupersession(input.supersession);
  return transitionProposalReview(input.proposalId, 'superseded', updatedAt, () => {
    getDb().prepare(`
      UPDATE reflection_proposal_reviews
      SET disposition = 'superseded',
          updated_at = ?,
          supersession_source = ?,
          supersession_actor = ?,
          supersession_reason = ?,
          replacement_proposal_id = ?,
          replacement_invocation_id = ?,
          satisfying_effect_refs_json = ?
      WHERE proposal_id = ?
    `).run(
      updatedAt,
      input.supersession.source,
      input.supersession.actor,
      input.supersession.reason,
      input.supersession.replacementProposalId,
      input.supersession.replacementInvocationId,
      JSON.stringify(input.supersession.satisfyingEffectRefs),
      input.proposalId,
    );
  });
}

function requireRegisteredOperationForEvidence(
  operation: ReflectionOperation,
  evidenceItem: ReflectionInputItemV1 | ReflectionInputItemV2 | ReflectionItemV3 | ReflectionItemV4 | ReflectionItemV5,
): NonNullable<ReturnType<typeof getReflectionOperationRegistration>> {
  const itemValidationErrors = validateReflectionOperation(operation, {
    allowedWordIds: visibleWordIds(evidenceItem),
    evidenceItemId: evidenceItem.itemId,
  });
  if ('servedCue' in evidenceItem) {
    itemValidationErrors.push(...validateReflectionOperationEvidenceContext(
      operation,
      evidenceItem,
      '$',
    ));
  }
  if (itemValidationErrors.length > 0) {
    throw new Error(
      `Cannot authorize reflection operation outside its evidence item:\n`
      + itemValidationErrors.join('\n'),
    );
  }
  assertWordReferencesExist(operation);
  const registration = getReflectionOperationRegistration(operation.kind, operation.version);
  if (!registration) {
    throw new Error(
      `No reflection operation registration for ${operation.kind}@${operation.version}.`,
    );
  }
  return registration;
}

export function acceptReflectionProposal(
  input: AcceptReflectionProposalInput,
): AcceptReflectionProposalResult {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const invocationId = input.invocationId ?? randomUUID();
  assertIsoTimestamp(createdAt, 'invocation creation timestamp');
  assertNonEmpty(invocationId, 'invocation id');
  const operationErrors = validateReflectionOperation(input.operation);
  if (operationErrors.length > 0) {
    throw new Error(`Cannot authorize invalid reflection operation:\n${operationErrors.join('\n')}`);
  }

  const database = getDb();
  database.exec('BEGIN IMMEDIATE');
  try {
    const reviewRow = requireProposalReviewRow(input.proposalId);
    assertCurrentReflectionArtifactActions(reviewRow.artifact_id);
    assertProposalReviewTransition(
      reviewRow.disposition as ProposalReviewDisposition['kind'],
      'accepted',
    );
    const { proposal: originalProposal, evidenceItem } = originalProposalContextForReview(reviewRow);
    const registration = requireRegisteredOperationForEvidence(input.operation, evidenceItem);
    const acceptanceMode = classifyProposalAcceptance(
      originalProposal.operation,
      input.operation,
    );
    const initialApplication: OperationApplicationState = registration.applySupport === 'supported'
      ? { kind: 'pending' }
      : { kind: 'unsupported', reason: unsupportedApplicationReason(input.operation) };
    const applicationColumns = applicationStateColumns(initialApplication);

    database.prepare(`
      INSERT INTO reflection_operation_invocations (
        invocation_id,
        created_at,
        origin_kind,
        origin_proposal_id,
        origin_superseded_proposal_id,
        operation_kind,
        operation_version,
        operation_json,
        application_state,
        application_updated_at,
        unsupported_reason,
        applied_at,
        application_error,
        stale_reason,
        effect_refs_json,
        satisfying_effect_refs_json
      ) VALUES (?, ?, 'proposal_acceptance', ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      invocationId,
      createdAt,
      input.proposalId,
      input.operation.kind,
      input.operation.version,
      serializeStoredInvocationOperation(
        input.operation,
        reviewRow.artifact_id,
        reviewRow.item_id,
      ),
      initialApplication.kind,
      createdAt,
      applicationColumns.unsupportedReason,
      applicationColumns.appliedAt,
      applicationColumns.applicationError,
      applicationColumns.staleReason,
      applicationColumns.effectRefsJson,
      applicationColumns.satisfyingEffectRefsJson,
    );
    database.prepare(`
      UPDATE reflection_proposal_reviews
      SET disposition = 'accepted',
          updated_at = ?,
          acceptance_mode = ?,
          accepted_invocation_id = ?
      WHERE proposal_id = ?
    `).run(createdAt, acceptanceMode, invocationId, input.proposalId);
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }

  const review = mapProposalReviewRow(requireProposalReviewRow(input.proposalId));
  return { review, invocation: getReflectionInvocation(invocationId) };
}

export function replaceReflectionProposal(
  input: ReplaceReflectionProposalInput,
): ReplaceReflectionProposalResult {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const invocationId = input.invocationId ?? randomUUID();
  assertIsoTimestamp(createdAt, 'invocation creation timestamp');
  assertNonEmpty(invocationId, 'invocation id');
  const operationErrors = validateReflectionOperation(input.operation);
  if (operationErrors.length > 0) {
    throw new Error(`Cannot authorize invalid reflection operation:\n${operationErrors.join('\n')}`);
  }

  const database = getDb();
  database.exec('BEGIN IMMEDIATE');
  try {
    const reviewRow = requireProposalReviewRow(input.proposalId);
    assertCurrentReflectionArtifactActions(reviewRow.artifact_id);
    assertProposalReviewTransition(
      reviewRow.disposition as ProposalReviewDisposition['kind'],
      'superseded',
    );
    const { proposal: originalProposal, evidenceItem } = originalProposalContextForReview(reviewRow);
    if (
      originalProposal.operation.kind === input.operation.kind
      && originalProposal.operation.version === input.operation.version
    ) {
      throw new Error('A replacement proposal must change operation kind or version.');
    }
    const registration = requireRegisteredOperationForEvidence(input.operation, evidenceItem);
    const initialApplication: OperationApplicationState = registration.applySupport === 'supported'
      ? { kind: 'pending' }
      : { kind: 'unsupported', reason: unsupportedApplicationReason(input.operation) };
    const applicationColumns = applicationStateColumns(initialApplication);

    database.prepare(`
      INSERT INTO reflection_operation_invocations (
        invocation_id,
        created_at,
        origin_kind,
        origin_proposal_id,
        origin_superseded_proposal_id,
        operation_kind,
        operation_version,
        operation_json,
        application_state,
        application_updated_at,
        unsupported_reason,
        applied_at,
        application_error,
        stale_reason,
        effect_refs_json,
        satisfying_effect_refs_json
      ) VALUES (?, ?, 'user_replacement', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      invocationId,
      createdAt,
      input.proposalId,
      input.operation.kind,
      input.operation.version,
      serializeStoredInvocationOperation(
        input.operation,
        reviewRow.artifact_id,
        reviewRow.item_id,
      ),
      initialApplication.kind,
      createdAt,
      applicationColumns.unsupportedReason,
      applicationColumns.appliedAt,
      applicationColumns.applicationError,
      applicationColumns.staleReason,
      applicationColumns.effectRefsJson,
      applicationColumns.satisfyingEffectRefsJson,
    );
    database.prepare(`
      UPDATE reflection_proposal_reviews
      SET disposition = 'superseded',
          updated_at = ?,
          acceptance_mode = NULL,
          accepted_invocation_id = NULL,
          dismissal_reason = NULL,
          supersession_source = 'user_replacement',
          supersession_actor = 'user',
          supersession_reason = ?,
          replacement_proposal_id = NULL,
          replacement_invocation_id = ?,
          satisfying_effect_refs_json = '[]'
      WHERE proposal_id = ?
    `).run(
      createdAt,
      'The user authorized a different operation during proposal review.',
      invocationId,
      input.proposalId,
    );
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }

  const review = mapProposalReviewRow(requireProposalReviewRow(input.proposalId));
  return { review, invocation: getReflectionInvocation(invocationId) };
}

export function authorizeManualReflectionOperation(
  input: AuthorizeManualReflectionOperationInput,
): AuthorizeManualReflectionOperationResult {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const invocationId = input.invocationId ?? randomUUID();
  assertIsoTimestamp(createdAt, 'invocation creation timestamp');
  assertNonEmpty(invocationId, 'invocation id');
  assertNonEmpty(input.artifactId, 'artifact id');
  assertNonEmpty(input.itemId, 'item id');
  const operationErrors = validateReflectionOperation(input.operation);
  if (operationErrors.length > 0) {
    throw new Error(`Cannot authorize invalid reflection operation:\n${operationErrors.join('\n')}`);
  }

  const database = getDb();
  database.exec('BEGIN IMMEDIATE');
  try {
    const artifact = getReflectionArtifactDetail(input.artifactId);
    assertCurrentReflectionArtifactActions(artifact.artifactId);
    const itemResult = artifact.result.itemResults.find((item) => item.itemId === input.itemId);
    const evidenceItem = artifact.evidenceBundle.items.find((item) => item.itemId === input.itemId);
    if (!itemResult || !evidenceItem) {
      throw new Error('Reflection item not found.');
    }
    if (itemResult.proposals.length > 0) {
      throw new Error(
        'Manual authorization is only available for explanation-only reflection items.',
      );
    }
    const registration = requireRegisteredOperationForEvidence(input.operation, evidenceItem);
    const initialApplication: OperationApplicationState = registration.applySupport === 'supported'
      ? { kind: 'pending' }
      : { kind: 'unsupported', reason: unsupportedApplicationReason(input.operation) };
    const applicationColumns = applicationStateColumns(initialApplication);

    database.prepare(`
      INSERT INTO reflection_operation_invocations (
        invocation_id,
        created_at,
        origin_kind,
        origin_proposal_id,
        origin_superseded_proposal_id,
        operation_kind,
        operation_version,
        operation_json,
        application_state,
        application_updated_at,
        unsupported_reason,
        applied_at,
        application_error,
        stale_reason,
        effect_refs_json,
        satisfying_effect_refs_json
      ) VALUES (?, ?, 'manual', NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      invocationId,
      createdAt,
      input.operation.kind,
      input.operation.version,
      serializeStoredInvocationOperation(input.operation, input.artifactId, input.itemId),
      initialApplication.kind,
      createdAt,
      applicationColumns.unsupportedReason,
      applicationColumns.appliedAt,
      applicationColumns.applicationError,
      applicationColumns.staleReason,
      applicationColumns.effectRefsJson,
      applicationColumns.satisfyingEffectRefsJson,
    );
    markReflectionHelpInboxDone({
      artifactId: input.artifactId,
      itemId: input.itemId,
    });
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }

  return { invocation: getReflectionInvocation(invocationId) };
}

export function getReflectionInvocation(
  invocationId: string,
): OperationInvocationStatus {
  const row = getDb().prepare(`
    SELECT ${invocationColumns.join(', ')}
    FROM reflection_operation_invocations
    WHERE invocation_id = ?
  `).get(invocationId) as InvocationRow | undefined;
  if (!row) {
    throw new Error('Reflection invocation not found.');
  }
  return mapInvocationRow(row);
}

export function transitionReflectionInvocationApplication(
  invocationId: string,
  state: OperationApplicationState,
  updatedAt = new Date().toISOString(),
): OperationInvocationStatus {
  assertIsoTimestamp(updatedAt, 'application update timestamp');
  assertApplicationState(state);
  const columns = applicationStateColumns(state);
  const database = getDb();
  database.exec('BEGIN IMMEDIATE');
  try {
    const current = getReflectionInvocation(invocationId);
    assertCurrentReflectionInvocationActions(invocationId);
    assertOperationApplicationTransition(current.application.state.kind, state.kind);
    database.prepare(`
      UPDATE ${physicalLearnerTableName('reflection_operation_invocations')}
      SET application_state = ?,
          application_updated_at = ?,
          unsupported_reason = ?,
          applied_at = ?,
          application_error = ?,
          stale_reason = ?,
          effect_refs_json = ?,
          satisfying_effect_refs_json = ?
      WHERE invocation_id = ?
    `).run(
      state.kind,
      updatedAt,
      columns.unsupportedReason,
      columns.appliedAt,
      columns.applicationError,
      columns.staleReason,
      columns.effectRefsJson,
      columns.satisfyingEffectRefsJson,
      invocationId,
    );
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
  return getReflectionInvocation(invocationId);
}

export function withdrawReflectionInvocationAuthorization(
  invocationId: string,
  updatedAt = new Date().toISOString(),
): OperationInvocationStatus {
  return transitionReflectionInvocationApplication(
    invocationId,
    { kind: 'authorization_withdrawn' },
    updatedAt,
  );
}

export function listPendingReflectionInvocationIds(): string[] {
  const rows = getDb().prepare(`
    SELECT invocation_id
    FROM reflection_operation_invocations
    WHERE application_state = 'pending'
    ORDER BY application_updated_at ASC, invocation_id ASC
  `).all() as Array<{ invocation_id: string }>;
  return rows
    .map((row) => row.invocation_id)
    .filter(reflectionInvocationSupportsCurrentActions);
}

export function recoverPendingReflectionInvocations(): OperationInvocationStatus[] {
  return listPendingReflectionInvocationIds().map((invocationId) => (
    applyReflectionInvocation(invocationId)
  ));
}

/**
 * Applies one durable authorization. The invocation status is the
 * idempotency boundary: after application is terminal, later calls return its
 * recorded outcome without running the adapter again.
 */
export function applyReflectionInvocation(
  invocationId: string,
  appliedAt = new Date().toISOString(),
): OperationInvocationStatus {
  assertNonEmpty(invocationId, 'invocation id');
  assertIsoTimestamp(appliedAt, 'application time');
  const database = getDb();
  database.exec('BEGIN IMMEDIATE');
  let current: OperationInvocationStatus;
  try {
    current = getReflectionInvocation(invocationId);
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
  if (current.application.state.kind !== 'pending') {
    database.exec('COMMIT');
    return current;
  }

  try {
    assertCurrentReflectionInvocationActions(invocationId);
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }

  try {
    const nextState = applyPendingOperationWithoutTransaction(
      current.invocation.operation,
      invocationId,
      appliedAt,
    );
    writeApplicationStateWithoutTransaction(invocationId, nextState, appliedAt);
    database.exec('COMMIT');
    return getReflectionInvocation(invocationId);
  } catch (error) {
    database.exec('ROLLBACK');
    const failed = database.prepare(`
      UPDATE ${physicalLearnerTableName('reflection_operation_invocations')}
      SET application_state = 'failed',
          application_updated_at = ?,
          unsupported_reason = NULL,
          applied_at = NULL,
          application_error = ?,
          stale_reason = NULL,
          effect_refs_json = '[]',
          satisfying_effect_refs_json = '[]'
      WHERE invocation_id = ?
        AND application_state = 'pending'
    `).run(appliedAt, safeApplicationError(error), invocationId);
    if (failed.changes === 0) {
      throw error;
    }
    return getReflectionInvocation(invocationId);
  }
}

function transitionProposalReview(
  proposalId: string,
  to: ProposalReviewDisposition['kind'],
  updatedAt: string,
  update: () => void,
): ProposalReviewStatus {
  assertIsoTimestamp(updatedAt, 'proposal review update timestamp');
  const database = getDb();
  database.exec('BEGIN IMMEDIATE');
  try {
    const current = requireProposalReviewRow(proposalId);
    assertCurrentReflectionArtifactActions(current.artifact_id);
    assertProposalReviewTransition(
      current.disposition as ProposalReviewDisposition['kind'],
      to,
    );
    update();
    if (to !== 'pending') {
      stampProposalInboxSeenIfLeavingPending(proposalId, updatedAt);
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
  return mapProposalReviewRow(requireProposalReviewRow(proposalId));
}

function getArtifactBySessionAndFlow(
  sourceSessionId: string,
  reflectionFlowVersion: string,
): ReflectionArtifactRecord | null {
  const row = getDb().prepare(`
    SELECT ${artifactColumns.join(', ')}
    FROM reflection_artifacts
    WHERE source_session_id = ?
      AND reflection_flow_version = ?
  `).get(sourceSessionId, reflectionFlowVersion) as ArtifactRow | undefined;
  return row ? mapArtifactRow(row) : null;
}

function requireProposalReviewRow(proposalId: string): ProposalReviewRow {
  const row = getDb().prepare(`
    SELECT ${proposalReviewColumns.join(', ')}
    FROM reflection_proposal_reviews
    WHERE proposal_id = ?
  `).get(proposalId) as ProposalReviewRow | undefined;
  if (!row) {
    throw new Error('Reflection proposal not found.');
  }
  return row;
}

function originalProposalContextForReview(row: ProposalReviewRow): {
  proposal: ReflectionProposalV1;
  evidenceItem: ReflectionInputItemV1 | ReflectionInputItemV2 | ReflectionItemV3 | ReflectionItemV4 | ReflectionItemV5;
} {
  const artifactRow = getDb().prepare(`
    SELECT ${artifactColumns.join(', ')}
    FROM reflection_artifacts
    WHERE artifact_id = ?
  `).get(row.artifact_id) as ArtifactRow | undefined;
  if (!artifactRow) {
    throw corruptionError(`proposal ${row.proposal_id} references a missing artifact`);
  }
  const artifact = mapArtifactRow(artifactRow);
  const itemResult = artifact.result.itemResults.find((candidate) => candidate.itemId === row.item_id);
  const evidenceItem = artifact.evidenceBundle.items.find(
    (candidate) => candidate.itemId === row.item_id,
  );
  const proposal = itemResult?.proposals[row.proposal_index];
  if (!proposal || !evidenceItem) {
    throw corruptionError(
      `proposal review ${row.proposal_id} cannot be traced to immutable proposal content`,
    );
  }
  return { proposal, evidenceItem };
}

function mapReflectionGenerationRunRow(
  row: ReflectionGenerationRunRow,
): ReflectionGenerationRunRecord {
  const usage: NormalizedTokenUsage = {
    inputTokens: row.input_tokens,
    cachedInputTokens: row.cached_input_tokens,
    cacheWriteInputTokens: row.cache_write_input_tokens,
    outputTokens: row.output_tokens,
    reasoningTokens: row.reasoning_tokens,
    totalTokens: row.total_tokens,
  };
  assertNormalizedUsage(usage);
  assertCount(row.eligible_item_count, 'stored eligible reflection evidence item count');
  assertCount(row.included_item_count, 'stored included reflection evidence item count');
  if (row.included_item_count > row.eligible_item_count) {
    throw corruptionError('reflection generation run includes more items than were eligible');
  }
  if (row.state !== 'succeeded' && row.state !== 'failed') {
    throw corruptionError(`reflection generation run has unsupported state ${row.state}`);
  }
  if ((row.state === 'succeeded') !== (row.failure_code === null)) {
    throw corruptionError('reflection generation run has inconsistent failure fields');
  }
  const pricingPresent = row.pricing_snapshot_id !== null
    || row.pricing_as_of !== null
    || row.pricing_basis_json !== null
    || row.estimated_cost_usd !== null;
  if (pricingPresent && (
    row.pricing_snapshot_id === null
    || row.pricing_as_of === null
    || row.pricing_basis_json === null
    || row.estimated_cost_usd === null
  )) {
    throw corruptionError('reflection generation run has incomplete pricing fields');
  }
  if (row.estimated_cost_usd !== null && (!Number.isFinite(row.estimated_cost_usd)
    || row.estimated_cost_usd < 0)) {
    throw corruptionError('reflection generation run has invalid estimated cost');
  }

  return {
    runId: row.run_id,
    sourceSessionId: row.source_session_id,
    reflectionFlowVersion: row.reflection_flow_version,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    provider: row.provider,
    model: row.model,
    providerModel: row.provider_model,
    promptVersion: row.prompt_version,
    responseId: row.response_id,
    clientRequestId: row.client_request_id,
    finishReason: row.finish_reason,
    bundleSchemaVersion: row.bundle_schema_version,
    resultSchemaVersion: row.result_schema_version,
    state: row.state,
    failureCode: row.failure_code,
    eligibleItemCount: row.eligible_item_count,
    includedItemCount: row.included_item_count,
    usage,
    pricingSnapshotId: row.pricing_snapshot_id,
    pricingAsOf: row.pricing_as_of,
    pricingBasis: row.pricing_basis_json === null
      ? null
      : parseJson(row.pricing_basis_json, 'reflection generation run pricing basis'),
    estimatedCostUsd: row.estimated_cost_usd,
    diagnostic: row.diagnostic_json === null
      ? null
      : parseReflectionDiagnostic(row.diagnostic_json, row.run_id),
    retryable: row.retryable === 1,
  };
}

function parseReflectionDiagnostic(value: string, runId: string): ReflectionGenerationDiagnostic | null {
  try {
    const parsed = JSON.parse(value) as Partial<ReflectionGenerationDiagnostic>;
    if (parsed.schemaVersion !== 'reflection_generation_diagnostic.v1'
      || typeof parsed.phase !== 'string'
      || !Array.isArray(parsed.issues)
      || (parsed.rejectedOutput !== null && typeof parsed.rejectedOutput !== 'string')) {
      throw new Error('unsupported diagnostic shape');
    }
    return parsed as ReflectionGenerationDiagnostic;
  } catch (error) {
    throw corruptionError(
      `reflection generation run ${runId} contains invalid diagnostics: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function mapArtifactRow(row: ArtifactRow): ReflectionArtifactRecord {
  const evidenceBundle = parseJson(
    row.evidence_bundle_json,
    `reflection artifact ${row.artifact_id} evidence bundle`,
  );
  assertReflectionBundle(evidenceBundle, row.artifact_id);
  const result = parseJson(
    row.result_json,
    `reflection artifact ${row.artifact_id} result`,
  );
  const errors = validateReflectionArtifactPair(result, evidenceBundle);
  if (errors.length > 0) {
    throw corruptionError(
      `artifact ${row.artifact_id} contains an invalid result:\n${errors.join('\n')}`,
    );
  }
  if (
    row.bundle_schema_version !== evidenceBundle.schemaVersion
    || row.result_schema_version !== result.schemaVersion
  ) {
    throw corruptionError(`artifact ${row.artifact_id} schema metadata does not match its JSON`);
  }
  if (
    row.source_session_id !== null
    && (!('session' in evidenceBundle) || row.source_session_id !== evidenceBundle.session.sessionId)
  ) {
    throw corruptionError(`artifact ${row.artifact_id} source session does not match its evidence`);
  }
  return {
    artifactId: row.artifact_id,
    sourceSessionId: row.source_session_id,
    sourceRunId: row.source_run_id,
    reflectionFlowVersion: row.reflection_flow_version,
    generatedAt: row.generated_at,
    provider: row.provider,
    model: row.model,
    promptVersion: row.prompt_version,
    bundleSchemaVersion: evidenceBundle.schemaVersion,
    resultSchemaVersion: result.schemaVersion,
    evidenceBundle,
    result,
  };
}

function validateReflectionArtifactPair(
  result: unknown,
  evidenceBundle: SessionReflectionBundle,
): string[] {
  if (!isRecord(result)) return ['$: expected object'];
  if (
    evidenceBundle.schemaVersion === 'session_reflection_bundle.v1'
    && result.schemaVersion === 'session_reflection_result.v4'
  ) {
    return validateSessionReflectionResult(result, evidenceBundle);
  }
  if (
    evidenceBundle.schemaVersion === 'session_reflection_bundle.v2'
    && result.schemaVersion === 'session_reflection_result.v5'
  ) {
    return validateSessionReflectionResultV5(result, evidenceBundle);
  }
  if (
    evidenceBundle.schemaVersion === 'session_reflection_bundle.v3'
    && result.schemaVersion === 'session_reflection_result.v5'
  ) {
    return validateSessionReflectionResultV5(result, evidenceBundle);
  }
  if (
    evidenceBundle.schemaVersion === 'session_reflection_bundle.v2'
    && result.schemaVersion === 'session_reflection_result.v6'
  ) {
    return validateSessionReflectionResultV6(result, evidenceBundle);
  }
  if (
    evidenceBundle.schemaVersion === 'session_reflection_bundle.v3'
    && result.schemaVersion === 'session_reflection_result.v6'
  ) {
    return validateSessionReflectionResultV6(result, evidenceBundle);
  }
  if (
    evidenceBundle.schemaVersion === 'session_reflection_bundle.v4'
    && result.schemaVersion === 'session_reflection_result.v7'
  ) {
    return validateSessionReflectionResultV7(result, evidenceBundle);
  }
  if (
    evidenceBundle.schemaVersion === 'curated_reflection_bundle.v1'
    && result.schemaVersion === 'session_reflection_result.v7'
  ) {
    return validateSessionReflectionResultV7(result, evidenceBundle);
  }
  if (
    (evidenceBundle.schemaVersion === 'session_reflection_bundle.v2'
      || evidenceBundle.schemaVersion === 'session_reflection_bundle.v3')
    && result.schemaVersion === 'session_reflection_result.v7'
  ) {
    return validateSessionReflectionResultV7(result, evidenceBundle);
  }
  if (
    evidenceBundle.schemaVersion === 'session_reflection_bundle.v5'
    && result.schemaVersion === 'session_reflection_result.v8'
  ) {
    return validateSessionReflectionResultV8(result, evidenceBundle);
  }
  if (
    evidenceBundle.schemaVersion === 'curated_reflection_bundle.v2'
    && result.schemaVersion === 'session_reflection_result.v8'
  ) {
    return validateSessionReflectionResultV8(result, evidenceBundle);
  }
  return [
    `$.schemaVersion: result ${String(result.schemaVersion)} is not compatible with ${evidenceBundle.schemaVersion}`,
  ];
}

function mapProposalReviewRow(row: ProposalReviewRow): ProposalReviewStatus {
  let disposition: ProposalReviewDisposition;
  switch (row.disposition) {
    case 'pending':
    case 'deferred':
      disposition = { kind: row.disposition };
      break;
    case 'accepted':
      if (
        (row.acceptance_mode !== 'exact' && row.acceptance_mode !== 'revised')
        || row.accepted_invocation_id === null
      ) {
        throw corruptionError(`accepted proposal ${row.proposal_id} lacks authorization metadata`);
      }
      disposition = {
        kind: 'accepted',
        acceptanceMode: row.acceptance_mode,
        acceptedInvocationId: row.accepted_invocation_id,
      };
      break;
    case 'dismissed':
      disposition = { kind: 'dismissed', reason: row.dismissal_reason };
      break;
    case 'requested_second_opinion':
      disposition = { kind: 'requested_second_opinion' };
      break;
    case 'superseded':
      if (
        !isSupersessionSource(row.supersession_source)
        || !isSupersessionActor(row.supersession_actor)
        || row.supersession_reason === null
      ) {
        throw corruptionError(`superseded proposal ${row.proposal_id} lacks causal metadata`);
      }
      disposition = {
        kind: 'superseded',
        supersession: {
          source: row.supersession_source,
          actor: row.supersession_actor,
          reason: row.supersession_reason,
          replacementProposalId: row.replacement_proposal_id,
          replacementInvocationId: row.replacement_invocation_id,
          satisfyingEffectRefs: parseEffectRefs(
            row.satisfying_effect_refs_json,
            `proposal ${row.proposal_id} satisfying effects`,
          ),
        },
      };
      break;
    default:
      throw corruptionError(`proposal ${row.proposal_id} has unknown disposition ${row.disposition}`);
  }
  return {
    proposalId: row.proposal_id,
    updatedAt: row.updated_at,
    disposition,
  };
}

function mapInvocationRow(row: InvocationRow): OperationInvocationStatus {
  const storedOperation = parseJson(
    row.operation_json,
    `reflection invocation ${row.invocation_id} operation`,
  );
  const { operation } = parseStoredInvocationOperation(storedOperation, row.invocation_id);
  const operationErrors = validateReflectionOperation(operation);
  if (operationErrors.length > 0) {
    throw corruptionError(
      `invocation ${row.invocation_id} contains an invalid operation:\n${operationErrors.join('\n')}`,
    );
  }
  const validatedOperation = operation as ReflectionOperation;
  if (
    row.operation_kind !== validatedOperation.kind
    || row.operation_version !== validatedOperation.version
  ) {
    throw corruptionError(`invocation ${row.invocation_id} operation metadata does not match its JSON`);
  }

  let origin: OperationInvocation['origin'];
  switch (row.origin_kind) {
    case 'proposal_acceptance':
      if (row.origin_proposal_id === null) {
        throw corruptionError(`invocation ${row.invocation_id} lacks its proposal origin`);
      }
      origin = { kind: 'proposal_acceptance', proposalId: row.origin_proposal_id };
      break;
    case 'user_replacement':
      if (row.origin_superseded_proposal_id === null) {
        throw corruptionError(`invocation ${row.invocation_id} lacks its superseded proposal origin`);
      }
      origin = {
        kind: 'user_replacement',
        supersededProposalId: row.origin_superseded_proposal_id,
      };
      break;
    case 'manual':
      origin = { kind: 'manual' };
      break;
    default:
      throw corruptionError(`invocation ${row.invocation_id} has unknown origin ${row.origin_kind}`);
  }

  return {
    invocation: {
      invocationId: row.invocation_id,
      createdAt: row.created_at,
      origin,
      operation: validatedOperation,
    },
    application: {
      invocationId: row.invocation_id,
      updatedAt: row.application_updated_at,
      state: applicationStateFromRow(row),
    },
  };
}

function serializeStoredInvocationOperation(
  operation: ReflectionOperation,
  sourceArtifactId: string,
  sourceItemId: string,
): string {
  const stored: StoredInvocationOperationV1 = {
    schemaVersion: 'reflection_invocation_operation.v1',
    sourceArtifactId,
    sourceItemId,
    operation,
  };
  return JSON.stringify(stored);
}

function parseStoredInvocationOperation(
  value: unknown,
  invocationId: string,
): {
  operation: unknown;
  sourceArtifactId: string | null;
  sourceItemId: string | null;
} {
  if (!isRecord(value) || value.schemaVersion !== 'reflection_invocation_operation.v1') {
    return { operation: value, sourceArtifactId: null, sourceItemId: null };
  }
  if (
    typeof value.sourceArtifactId !== 'string'
    || value.sourceArtifactId.trim().length === 0
    || typeof value.sourceItemId !== 'string'
    || value.sourceItemId.trim().length === 0
    || !('operation' in value)
  ) {
    throw corruptionError(`invocation ${invocationId} has invalid source-artifact provenance`);
  }
  return {
    operation: value.operation,
    sourceArtifactId: value.sourceArtifactId,
    sourceItemId: value.sourceItemId,
  };
}

function assertCurrentReflectionArtifactActions(artifactId: string): void {
  const row = getDb().prepare(`
    SELECT reflection_flow_version, bundle_schema_version, result_schema_version, prompt_version
    FROM reflection_artifacts
    WHERE artifact_id = ?
  `).get(artifactId) as {
    reflection_flow_version: string;
    bundle_schema_version: string;
    result_schema_version: string;
    prompt_version: string;
  } | undefined;
  if (row === undefined) throw new Error('Reflection artifact not found.');
  if (!isCurrentReflectionArtifactContract({
    reflectionFlowVersion: row.reflection_flow_version,
    bundleSchemaVersion: row.bundle_schema_version,
    resultSchemaVersion: row.result_schema_version,
    promptVersion: row.prompt_version,
  })) {
    throw new Error(`Cannot authorize or apply changes. ${LEGACY_REFLECTION_READ_ONLY_MESSAGE}`);
  }
}

function invocationSourceArtifactId(row: InvocationRow): string | null {
  const stored = parseStoredInvocationOperation(
    parseJson(row.operation_json, `reflection invocation ${row.invocation_id} operation`),
    row.invocation_id,
  );
  if (stored.sourceArtifactId !== null) return stored.sourceArtifactId;
  const proposalId = row.origin_kind === 'proposal_acceptance'
    ? row.origin_proposal_id
    : row.origin_kind === 'user_replacement'
      ? row.origin_superseded_proposal_id
      : null;
  if (proposalId === null) return null;
  const proposal = getDb().prepare(`
    SELECT artifact_id
    FROM reflection_proposal_reviews
    WHERE proposal_id = ?
  `).get(proposalId) as { artifact_id: string } | undefined;
  return proposal?.artifact_id ?? null;
}

function assertCurrentReflectionInvocationActions(invocationId: string): void {
  const row = getDb().prepare(`
    SELECT ${invocationColumns.join(', ')}
    FROM reflection_operation_invocations
    WHERE invocation_id = ?
  `).get(invocationId) as InvocationRow | undefined;
  if (row === undefined) throw new Error('Reflection invocation not found.');
  const artifactId = invocationSourceArtifactId(row);
  if (artifactId === null) {
    throw new Error(`Cannot authorize or apply changes. ${LEGACY_REFLECTION_READ_ONLY_MESSAGE}`);
  }
  assertCurrentReflectionArtifactActions(artifactId);
}

function reflectionInvocationSupportsCurrentActions(invocationId: string): boolean {
  try {
    assertCurrentReflectionInvocationActions(invocationId);
    return true;
  } catch {
    return false;
  }
}

function applicationStateFromRow(row: InvocationRow): OperationApplicationState {
  switch (row.application_state) {
    case 'unsupported':
      if (row.unsupported_reason === null) {
        throw corruptionError(`unsupported invocation ${row.invocation_id} lacks a reason`);
      }
      return { kind: 'unsupported', reason: row.unsupported_reason };
    case 'pending':
      return { kind: 'pending' };
    case 'applied':
      if (row.applied_at === null) {
        throw corruptionError(`applied invocation ${row.invocation_id} lacks an application time`);
      }
      return {
        kind: 'applied',
        appliedAt: row.applied_at,
        effectRefs: parseNonEmptyEffectRefs(
          row.effect_refs_json,
          `invocation ${row.invocation_id} effects`,
        ),
      };
    case 'failed':
      if (row.application_error === null) {
        throw corruptionError(`failed invocation ${row.invocation_id} lacks an error`);
      }
      return { kind: 'failed', error: row.application_error };
    case 'stale':
      if (row.stale_reason === null) {
        throw corruptionError(`stale invocation ${row.invocation_id} lacks a reason`);
      }
      return { kind: 'stale', reason: row.stale_reason };
    case 'already_satisfied':
      return {
        kind: 'already_satisfied',
        satisfyingEffectRefs: parseNonEmptyEffectRefs(
          row.satisfying_effect_refs_json,
          `invocation ${row.invocation_id} satisfying effects`,
        ),
      };
    case 'authorization_withdrawn':
      return { kind: 'authorization_withdrawn' };
    default:
      throw corruptionError(
        `invocation ${row.invocation_id} has unknown application state ${row.application_state}`,
      );
  }
}

function applicationStateColumns(state: OperationApplicationState): {
  unsupportedReason: string | null;
  appliedAt: string | null;
  applicationError: string | null;
  staleReason: string | null;
  effectRefsJson: string;
  satisfyingEffectRefsJson: string;
} {
  return {
    unsupportedReason: state.kind === 'unsupported' ? state.reason : null,
    appliedAt: state.kind === 'applied' ? state.appliedAt : null,
    applicationError: state.kind === 'failed' ? state.error : null,
    staleReason: state.kind === 'stale' ? state.reason : null,
    effectRefsJson: JSON.stringify(state.kind === 'applied' ? state.effectRefs : []),
    satisfyingEffectRefsJson: JSON.stringify(
      state.kind === 'already_satisfied' ? state.satisfyingEffectRefs : [],
    ),
  };
}

function applyPendingOperationWithoutTransaction(
  operation: ReflectionOperation,
  invocationId: string,
  appliedAt: string,
): OperationApplicationState {
  switch (operation.kind) {
    case 'suppress_definition_production':
      return applyProductionSuppressionWithoutTransaction(operation.wordId, appliedAt);
    case 'create_contrast_cluster':
      return applyContrastClusterCreationWithoutTransaction(operation, appliedAt);
    case 'repair_production_cue':
      return operation.version === 2
        ? applyProductionCueRepairWithoutTransaction(operation, invocationId, appliedAt)
        : (() => {
            throw new Error(
              `No faithful application adapter is available for ${operation.kind}@${operation.version}.`,
            );
          })();
    case 'add_production_cue_supplement':
      return applyProductionCueSupplementWithoutTransaction(
        operation,
        invocationId,
        appliedAt,
      );
    case 'accept_production_alternate':
      throw new Error(
        `No faithful application adapter is available for ${operation.kind}@${operation.version}.`,
      );
    case 'promote_pure_elicitation':
      return applyPureElicitationPromotionWithoutTransaction(
        operation,
        invocationId,
        appliedAt,
      );
  }
}

function applyPureElicitationPromotionWithoutTransaction(
  operation: PromotePureElicitationOperationV1,
  invocationId: string,
  appliedAt: string,
): OperationApplicationState {
  assertPureCuePromotionSource(operation.sourceAttemptId, operation.targetWordId, operation.responseWordId);
  const pairWordIds = [operation.targetWordId, operation.responseWordId];
  const planByWordId = new Map(operation.wordPlans.map((plan) => [plan.wordId, plan]));
  const repairs = pairWordIds.map((wordId) => {
    const plan = planByWordId.get(wordId)!;
    return {
      kind: 'repair_production_cue' as const,
      version: 2 as const,
      wordId,
      taskId: defaultProductionTaskId(wordId),
      changes: [
        ...plan.deactivateCueIds.map((cueId) => ({ kind: 'deactivate' as const, cueId })),
        ...plan.distinctiveCueDrafts.map((draft) => ({
          kind: 'create' as const,
          cue: {
            cueType: draft.cueType,
            text: draft.text,
            acceptedWordIds: [wordId],
          },
        })),
      ],
      sourceAttemptJudgments: [],
    };
  });

  for (const repair of repairs) {
    const currentStateError = validateProductionCueRepairCurrentStateWithoutTransaction(repair);
    if (currentStateError !== null) return { kind: 'stale', reason: currentStateError };
  }

  const existingDestination = operation.destination.kind === 'existing'
    ? getPureCue(operation.destination.pureCueId)
    : getPureCue(`pure-cue:reflection:${invocationId}`);
  if (operation.destination.kind === 'existing') {
    if (existingDestination === null || !existingDestination.active) {
      return {
        kind: 'stale',
        reason: `Pure cue ${operation.destination.pureCueId} is no longer active.`,
      };
    }
  } else if (existingDestination !== null) {
    return {
      kind: 'stale',
      reason: `Pure cue id reserved for invocation ${invocationId} already exists.`,
    };
  }

  const causedEffectRefs: EffectRef[] = [];
  const satisfyingEffectRefs: EffectRef[] = [];
  let pureCueId: string;
  if (operation.destination.kind === 'create') {
    const pureCue = createPureCueWithoutTransaction({
      id: `pure-cue:reflection:${invocationId}`,
      stimulus: operation.destination.stimulus,
      axisNote: operation.destination.axisNote,
      acceptedWordIds: pairWordIds,
      createdAt: appliedAt,
    });
    pureCueId = pureCue.id;
    causedEffectRefs.push({ type: 'pure_cue', id: pureCueId });
  } else {
    pureCueId = operation.destination.pureCueId;
    const existingMembers = new Set(existingDestination!.acceptedWordIds);
    const addedMembers = pairWordIds.filter((wordId) => !existingMembers.has(wordId));
    extendPureCueAcceptedWordsWithoutTransaction({
      id: pureCueId,
      acceptedWordIds: pairWordIds,
    });
    for (const wordId of pairWordIds) {
      const membershipRef = {
        type: 'pure_cue_membership',
        id: `${encodeURIComponent(pureCueId)}/${encodeURIComponent(wordId)}`,
      };
      if (addedMembers.includes(wordId)) causedEffectRefs.push(membershipRef);
      else satisfyingEffectRefs.push(membershipRef);
    }
  }

  for (const repair of repairs) {
    const repairState = applyProductionCueRepairWithoutTransaction(repair, invocationId, appliedAt);
    if (repairState.kind === 'stale') {
      throw new Error(`Promotion cue state changed after preflight: ${repairState.reason}`);
    }
    if (repairState.kind === 'applied') causedEffectRefs.push(...repairState.effectRefs);
    if (repairState.kind === 'already_satisfied') {
      satisfyingEffectRefs.push(...repairState.satisfyingEffectRefs);
    }
    if (
      repairState.kind !== 'applied'
      && repairState.kind !== 'already_satisfied'
    ) {
      throw new Error(`Unexpected promotion cue application state ${repairState.kind}.`);
    }
  }

  for (const wordId of pairWordIds) {
    const hasDistinctiveCue = getActiveProductionCuesForWord(wordId).some((cue) => (
      cue.acceptedWordIds.length === 1 && cue.acceptedWordIds[0] === wordId
    ));
    const relevanceResult = setWordProductionProxiedWithoutTransaction({
      wordId,
      proxied: !hasDistinctiveCue,
      updatedAt: appliedAt,
    });
    const relevanceRef = {
      type: 'word_skill_relevance',
      id: `${encodeURIComponent(wordId)}/production`,
    };
    if (relevanceResult === 'applied') causedEffectRefs.push(relevanceRef);
    else satisfyingEffectRefs.push(relevanceRef);
  }

  const compensationKind = restoreProductionSchedulerSnapshotWithoutTransaction({
    sourceAttemptId: operation.sourceAttemptId,
    compensationInvocationId: invocationId,
    restoredAt: appliedAt,
  }).kind;
  const compensationRef = {
    type: 'production_scheduler_compensation',
    id: `${encodeURIComponent(operation.sourceAttemptId)}/${compensationKind}`,
  };
  if (compensationKind === 'restored') causedEffectRefs.push(compensationRef);
  else satisfyingEffectRefs.push(compensationRef);

  if (causedEffectRefs.length > 0) {
    return { kind: 'applied', appliedAt, effectRefs: [...causedEffectRefs, ...satisfyingEffectRefs] };
  }
  return { kind: 'already_satisfied', satisfyingEffectRefs };
}

function applyProductionSuppressionWithoutTransaction(
  wordId: string,
  appliedAt: string,
): OperationApplicationState {
  if (!wordExistsWithoutTransaction(wordId)) {
    return {
      kind: 'stale',
      reason: `Word ${wordId} no longer exists.`,
    };
  }
  const result = suppressDefinitionProductionWithoutTransaction({
    wordId,
    updatedAt: appliedAt,
    sourceEventId: null,
  });
  const relevanceRef: EffectRef = {
    type: 'word_skill_relevance',
    id: `${encodeURIComponent(wordId)}/production`,
  };
  return result.kind === 'already_satisfied'
    ? { kind: 'already_satisfied', satisfyingEffectRefs: [relevanceRef] }
    : { kind: 'applied', appliedAt, effectRefs: [relevanceRef] };
}

function applyContrastClusterCreationWithoutTransaction(
  operation: Extract<ReflectionOperation, { kind: 'create_contrast_cluster' }>,
  appliedAt: string,
): OperationApplicationState {
  const missingWordIds = operation.members
    .map((member) => member.wordId)
    .filter((wordId) => !wordExistsWithoutTransaction(wordId));
  if (missingWordIds.length > 0) {
    return {
      kind: 'stale',
      reason: `Contrast member word ${missingWordIds[0]} no longer exists.`,
    };
  }

  const normalized = {
    title: operation.title.trim(),
    note: operation.clusterNote?.trim() ?? '',
    members: operation.members.map((member, index) => ({
      wordId: member.wordId,
      nuanceNote: member.nuanceNote?.trim() ?? '',
      displayOrder: index + 1,
    })),
    prompts: operation.prompts.map((prompt) => ({
      targetWordId: prompt.targetWordId,
      promptText: prompt.promptText.trim(),
      explanation: prompt.explanation?.trim() ?? '',
    })),
  };
  const exactContentRefs = findExactContrastClusterPostcondition(normalized);
  if (exactContentRefs !== null) {
    const eligibilityResults = normalized.members.map((member) => (
      enableContextualSelectionWithoutTransaction({
        wordId: member.wordId,
        updatedAt: appliedAt,
        sourceEventId: null,
      })
    ));
    const causedEligibilityRefs = eligibilityResults.flatMap(contextualEligibilityCausedEffectRefs);
    if (causedEligibilityRefs.length > 0) {
      return {
        kind: 'applied',
        appliedAt,
        effectRefs: causedEligibilityRefs,
      };
    }
    return {
      kind: 'already_satisfied',
      satisfyingEffectRefs: [
        ...exactContentRefs,
        ...eligibilityResults.flatMap(contextualEligibilitySatisfyingEffectRefs),
      ],
    };
  }

  const clusterId = randomUUID();
  getDb().prepare(`
    INSERT INTO contrast_clusters (id, title, note)
    VALUES (?, ?, ?)
  `).run(clusterId, normalized.title, normalized.note);
  const effectRefs: EffectRef[] = [{ type: 'contrast_cluster', id: clusterId }];
  const insertMember = getDb().prepare(`
    INSERT INTO contrast_cluster_members (
      cluster_id,
      word_id,
      nuance_note,
      display_order
    ) VALUES (?, ?, ?, ?)
  `);
  const eligibilityEffectRefs: EffectRef[] = [];
  for (const member of normalized.members) {
    insertMember.run(
      clusterId,
      member.wordId,
      member.nuanceNote,
      member.displayOrder,
    );
    effectRefs.push({
      type: 'contrast_cluster_member',
      id: `${encodeURIComponent(clusterId)}/${encodeURIComponent(member.wordId)}`,
    });
    eligibilityEffectRefs.push(
      ...contextualEligibilityCausedEffectRefs(
        enableContextualSelectionWithoutTransaction({
          wordId: member.wordId,
          updatedAt: appliedAt,
          sourceEventId: null,
        }),
      ),
    );
  }

  const insertPrompt = getDb().prepare(`
    INSERT INTO contrast_prompts (
      id,
      cluster_id,
      target_word_id,
      prompt_text,
      explanation
    ) VALUES (?, ?, ?, ?, ?)
  `);
  for (const prompt of normalized.prompts) {
    const promptId = randomUUID();
    insertPrompt.run(
      promptId,
      clusterId,
      prompt.targetWordId,
      prompt.promptText,
      prompt.explanation,
    );
    effectRefs.push({ type: 'contrast_prompt', id: promptId });
  }
  return {
    kind: 'applied',
    appliedAt,
    effectRefs: [...effectRefs, ...eligibilityEffectRefs],
  };
}

function contextualEligibilityCausedEffectRefs(
  result: EnableContextualSelectionResult,
): EffectRef[] {
  const refs: EffectRef[] = [];
  const id = `${encodeURIComponent(result.relevance.wordId)}/contextual_selection`;
  if (result.relevanceChanged) {
    refs.push({ type: 'word_skill_relevance', id });
  }
  if (result.schedulerStateChanged) {
    refs.push({ type: 'word_skill_state', id });
  }
  return refs;
}

function contextualEligibilitySatisfyingEffectRefs(
  result: EnableContextualSelectionResult,
): EffectRef[] {
  const id = `${encodeURIComponent(result.relevance.wordId)}/contextual_selection`;
  return [
    { type: 'word_skill_relevance', id },
    { type: 'word_skill_state', id },
  ];
}

type NormalizedContrastCreation = {
  title: string;
  note: string;
  members: Array<{
    wordId: string;
    nuanceNote: string;
    displayOrder: number;
  }>;
  prompts: Array<{
    targetWordId: string;
    promptText: string;
    explanation: string;
  }>;
};

function findExactContrastClusterPostcondition(
  expected: NormalizedContrastCreation,
): EffectRef[] | null {
  const candidates = getDb().prepare(`
    SELECT id
    FROM contrast_clusters
    WHERE title = ?
      AND note = ?
    ORDER BY id ASC
  `).all(expected.title, expected.note) as Array<{ id: string }>;

  for (const candidate of candidates) {
    const members = getDb().prepare(`
      SELECT word_id, nuance_note, display_order
      FROM contrast_cluster_members
      WHERE cluster_id = ?
      ORDER BY display_order ASC, word_id ASC
    `).all(candidate.id) as Array<{
      word_id: string;
      nuance_note: string;
      display_order: number | null;
    }>;
    if (
      members.length !== expected.members.length
      || members.some((member, index) => (
        member.word_id !== expected.members[index]?.wordId
        || member.nuance_note !== expected.members[index]?.nuanceNote
        || member.display_order !== expected.members[index]?.displayOrder
      ))
    ) {
      continue;
    }

    const prompts = getDb().prepare(`
      SELECT id, target_word_id, prompt_text, explanation
      FROM contrast_prompts
      WHERE cluster_id = ?
      ORDER BY target_word_id ASC, prompt_text ASC, explanation ASC, id ASC
    `).all(candidate.id) as Array<{
      id: string;
      target_word_id: string;
      prompt_text: string;
      explanation: string;
    }>;
    const expectedPrompts = [...expected.prompts].sort(compareNormalizedPrompts);
    if (
      prompts.length !== expectedPrompts.length
      || prompts.some((prompt, index) => (
        prompt.target_word_id !== expectedPrompts[index]?.targetWordId
        || prompt.prompt_text !== expectedPrompts[index]?.promptText
        || prompt.explanation !== expectedPrompts[index]?.explanation
      ))
    ) {
      continue;
    }

    return [
      { type: 'contrast_cluster', id: candidate.id },
      ...members.map((member) => ({
        type: 'contrast_cluster_member',
        id: `${encodeURIComponent(candidate.id)}/${encodeURIComponent(member.word_id)}`,
      })),
      ...prompts.map((prompt) => ({ type: 'contrast_prompt', id: prompt.id })),
    ];
  }
  return null;
}

function compareNormalizedPrompts(
  left: NormalizedContrastCreation['prompts'][number],
  right: NormalizedContrastCreation['prompts'][number],
): number {
  return compareText(left.targetWordId, right.targetWordId)
    || compareText(left.promptText, right.promptText)
    || compareText(left.explanation, right.explanation);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function wordExistsWithoutTransaction(wordId: string): boolean {
  return getDb().prepare(`
    SELECT 1
    FROM words
    WHERE id = ?
  `).get(wordId) !== undefined;
}

function writeApplicationStateWithoutTransaction(
  invocationId: string,
  state: OperationApplicationState,
  updatedAt: string,
): void {
  assertApplicationState(state);
  assertOperationApplicationTransition('pending', state.kind);
  const columns = applicationStateColumns(state);
  const result = getDb().prepare(`
    UPDATE ${physicalLearnerTableName('reflection_operation_invocations')}
    SET application_state = ?,
        application_updated_at = ?,
        unsupported_reason = ?,
        applied_at = ?,
        application_error = ?,
        stale_reason = ?,
        effect_refs_json = ?,
        satisfying_effect_refs_json = ?
    WHERE invocation_id = ?
      AND application_state = 'pending'
  `).run(
    state.kind,
    updatedAt,
    columns.unsupportedReason,
    columns.appliedAt,
    columns.applicationError,
    columns.staleReason,
    columns.effectRefsJson,
    columns.satisfyingEffectRefsJson,
    invocationId,
  );
  if (result.changes !== 1) {
    throw new Error('Reflection invocation is no longer pending.');
  }
}

function safeApplicationError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return `Reflection application failed: ${error.message}`;
  }
  return 'Reflection application failed.';
}

function assertApplicationState(state: OperationApplicationState): void {
  switch (state.kind) {
    case 'unsupported':
      assertNonEmpty(state.reason, 'unsupported application reason');
      return;
    case 'pending':
    case 'authorization_withdrawn':
      return;
    case 'applied':
      assertIsoTimestamp(state.appliedAt, 'application time');
      assertEffectRefs(state.effectRefs, 'application effects', true);
      return;
    case 'failed':
      assertNonEmpty(state.error, 'application error');
      return;
    case 'stale':
      assertNonEmpty(state.reason, 'stale application reason');
      return;
    case 'already_satisfied':
      assertEffectRefs(state.satisfyingEffectRefs, 'satisfying effects', true);
  }
}

function assertWordReferencesExist(operation: ReflectionOperation): void {
  const wordIds = new Set(reflectionOperationWordReferences(operation));
  const query = getDb().prepare('SELECT id FROM words WHERE id = ?');
  for (const wordId of wordIds) {
    if (!query.get(wordId)) {
      throw new Error(`Reflection operation references unknown word ${wordId}.`);
    }
  }
}

function assertReflectionBundle(
  value: unknown,
  artifactId: string,
): asserts value is SessionReflectionBundle {
  try {
    parseStoredSessionReflectionBundle(value);
  } catch {
    throw corruptionError(`artifact ${artifactId} contains an invalid evidence bundle`);
  }
}

function assertSupersession(supersession: ProposalSupersession): void {
  if (!isSupersessionSource(supersession.source)) {
    throw new Error('Invalid proposal supersession source.');
  }
  if (!isSupersessionActor(supersession.actor)) {
    throw new Error('Invalid proposal supersession actor.');
  }
  assertNonEmpty(supersession.reason, 'proposal supersession reason');
  assertEffectRefs(supersession.satisfyingEffectRefs, 'proposal satisfying effects');
  switch (supersession.source) {
    case 'competing_proposal':
      if (
        supersession.replacementProposalId === null
        || supersession.replacementInvocationId !== null
        || supersession.satisfyingEffectRefs.length !== 0
      ) {
        throw new Error(
          'Competing-proposal supersession requires only a replacement proposal reference.',
        );
      }
      break;
    case 'user_replacement':
      if (
        supersession.replacementProposalId !== null
        || supersession.replacementInvocationId === null
        || supersession.satisfyingEffectRefs.length !== 0
      ) {
        throw new Error(
          'User-replacement supersession requires only a replacement invocation reference.',
        );
      }
      break;
    case 'external_state':
      if (
        supersession.replacementProposalId !== null
        || supersession.replacementInvocationId !== null
        || supersession.satisfyingEffectRefs.length === 0
      ) {
        throw new Error(
          'External-state supersession requires only non-empty satisfying effect references.',
        );
      }
  }
}

function assertEffectRefs(value: EffectRef[], label: string, requireNonEmpty = false): void {
  if (!Array.isArray(value)) {
    throw new Error(`Expected ${label} to be an array.`);
  }
  if (requireNonEmpty && value.length === 0) {
    throw new Error(`Expected ${label} to contain at least one reference.`);
  }
  for (const effectRef of value) {
    if (!isRecord(effectRef)) {
      throw new Error(`Expected every ${label} entry to be an object.`);
    }
    const keys = Object.keys(effectRef);
    if (keys.length !== 2 || !keys.includes('type') || !keys.includes('id')) {
      throw new Error(`Expected every ${label} entry to contain only type and id.`);
    }
    assertNonEmpty(effectRef.type, `${label} type`);
    assertNonEmpty(effectRef.id, `${label} id`);
  }
}

function parseEffectRefs(json: string, label: string): EffectRef[] {
  const value = parseJson(json, label);
  if (!Array.isArray(value)) {
    throw corruptionError(`${label} is not an array`);
  }
  try {
    assertEffectRefs(value as EffectRef[], label);
  } catch (error) {
    throw corruptionError(error instanceof Error ? error.message : String(error));
  }
  return value as EffectRef[];
}

function parseNonEmptyEffectRefs(json: string, label: string): EffectRef[] {
  const effectRefs = parseEffectRefs(json, label);
  if (effectRefs.length === 0) {
    throw corruptionError(`${label} must contain at least one reference`);
  }
  return effectRefs;
}

function invocationIdForReview(disposition: ProposalReviewDisposition): string | null {
  if (disposition.kind === 'accepted') {
    return disposition.acceptedInvocationId;
  }
  if (disposition.kind === 'superseded') {
    return disposition.supersession.replacementInvocationId;
  }
  return null;
}

function assertReviewInvocationConsistency(
  review: ProposalReviewStatus,
  invocation: OperationInvocationStatus | null,
): void {
  if (review.disposition.kind === 'accepted') {
    if (
      invocation === null
      || invocation.invocation.origin.kind !== 'proposal_acceptance'
      || invocation.invocation.origin.proposalId !== review.proposalId
    ) {
      throw corruptionError(
        `accepted proposal review ${review.proposalId} is inconsistent with its linked invocation`,
      );
    }
    return;
  }
  if (
    review.disposition.kind === 'superseded'
    && review.disposition.supersession.source === 'user_replacement'
  ) {
    if (
      invocation === null
      || invocation.invocation.origin.kind !== 'user_replacement'
      || invocation.invocation.origin.supersededProposalId !== review.proposalId
    ) {
      throw corruptionError(
        `user-replacement proposal review ${review.proposalId} is inconsistent with its linked invocation`,
      );
    }
    return;
  }
  if (invocation !== null) {
    throw corruptionError(
      `proposal review ${review.proposalId} is inconsistent with an unexpected linked invocation`,
    );
  }
}

function proposalLocator(itemId: string, proposalIndex: number): string {
  return `${itemId}\u0000${proposalIndex}`;
}

function parseJson(json: string, label: string): unknown {
  try {
    return JSON.parse(json) as unknown;
  } catch {
    throw corruptionError(`${label} is not valid JSON`);
  }
}

function assertTableColumns(tableName: string, expectedColumns: readonly string[]): void {
  const storageTableName = learnerScopedStorageTableName(tableName);
  const rows = getDb().prepare(`PRAGMA table_info(${storageTableName})`).all() as Array<{
    name: string;
  }>;
  const actualColumns = new Set(rows.map((row) => row.name));
  if (actualColumns.size === 0) {
    throw new Error(`Database at ${dbPath} is missing the required "${tableName}" table.`);
  }
  for (const column of expectedColumns) {
    if (!actualColumns.has(column)) {
      throw new Error(
        `Database at ${dbPath} has an incompatible "${tableName}" table. Missing column "${column}".`,
      );
    }
  }
}

function assertUniqueIndex(tableName: string, expectedColumns: readonly string[]): void {
  const storageTableName = learnerScopedStorageTableName(tableName);
  const indexes = getDb().prepare(`PRAGMA index_list(${storageTableName})`).all() as Array<{
    name: string;
    unique: number;
  }>;
  const hasExpectedIndex = indexes.some((index) => {
    if (index.unique !== 1) return false;
    const columns = getDb().prepare(`PRAGMA index_info(${index.name})`).all() as Array<{
      name: string;
    }>;
    return columns.map((column) => column.name).join('\u0000')
      === expectedColumns.join('\u0000');
  });
  if (!hasExpectedIndex) {
    throw new Error(
      `Database at ${dbPath} has an incompatible "${tableName}" table. `
      + `Missing unique key (${expectedColumns.join(', ')}).`,
    );
  }
}

function assertNamedIndex(
  indexName: string,
  tableName: string,
  unique: boolean,
  expectedColumns: readonly string[],
  partial = false,
): void {
  const storageTableName = learnerScopedStorageTableName(tableName);
  const indexes = getDb().prepare(`PRAGMA index_list(${storageTableName})`).all() as Array<{
    name: string;
    unique: number;
    partial: number;
  }>;
  const index = indexes.find((candidate) => candidate.name === indexName);
  if (!index || index.unique !== (unique ? 1 : 0) || index.partial !== (partial ? 1 : 0)) {
    throw new Error(
      `Database at ${dbPath} is missing the required "${indexName}" index on "${tableName}".`,
    );
  }
  const columns = getDb().prepare(`PRAGMA index_info(${indexName})`).all() as Array<{
    name: string;
  }>;
  if (columns.map((column) => column.name).join('\u0000') !== expectedColumns.join('\u0000')) {
    throw new Error(
      `Database at ${dbPath} has an incompatible "${indexName}" index on "${tableName}".`,
    );
  }
}

function assertForeignKey(
  tableName: string,
  fromColumn: string,
  targetTable: string,
  targetColumn: string,
  onDelete: string,
): void {
  const storageTableName = learnerScopedStorageTableName(tableName);
  const storageTargetTable = learnerScopedStorageTableName(targetTable);
  const foreignKeys = getDb().prepare(`PRAGMA foreign_key_list(${storageTableName})`).all() as Array<{
    table: string;
    from: string;
    to: string;
    on_delete: string;
  }>;
  const present = foreignKeys.some((foreignKey) => (
    foreignKey.table === storageTargetTable
    && foreignKey.from === fromColumn
    && foreignKey.to === targetColumn
    && foreignKey.on_delete === onDelete
  ));
  if (!present) {
    throw new Error(
      `Database at ${dbPath} has an incompatible "${tableName}" table. `
      + `Missing foreign key ${fromColumn} -> ${targetTable}(${targetColumn}) ON DELETE ${onDelete}.`,
    );
  }
}

function assertNonEmpty(value: string, label: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Expected non-empty ${label}.`);
  }
}

function assertIsoTimestamp(value: string, label: string): void {
  assertNonEmpty(value, label);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new Error(`Expected ${label} to be an ISO-8601 UTC timestamp.`);
  }
}

function assertCount(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Expected ${label} to be a non-negative integer.`);
  }
}

function assertNormalizedUsage(usage: NormalizedTokenUsage): void {
  for (const [name, value] of Object.entries(usage)) {
    if (value !== null && (!Number.isInteger(value) || value < 0)) {
      throw new Error(`Expected ${name} to be a non-negative integer or null.`);
    }
  }
}

function isSupersessionSource(
  value: unknown,
): value is ProposalSupersession['source'] {
  return value === 'competing_proposal'
    || value === 'user_replacement'
    || value === 'external_state';
}

function isSupersessionActor(
  value: unknown,
): value is ProposalSupersession['actor'] {
  return value === 'user' || value === 'system';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function visibleWordIds(
  item: ReflectionInputItemV1 | ReflectionInputItemV2 | ReflectionItemV3 | ReflectionItemV4 | ReflectionItemV5,
): Set<string> {
  const wordIds = new Set<string>();
  if (item.targetWord !== null) {
    wordIds.add(item.targetWord.wordId);
  }
  if ('submittedWord' in item && item.submittedWord !== null) {
    wordIds.add(item.submittedWord.wordId);
  }
  if (item.source === 'session_note') {
    for (const relatedWord of item.relatedWords) {
      wordIds.add(relatedWord.wordId);
    }
  }
  if (item.source === 'contrast_selection') {
    for (const choiceWord of item.promptAsShown.choiceWords) {
      wordIds.add(choiceWord.wordId);
    }
  }
  if ('servedCue' in item) {
    for (const acceptedWordId of item.servedCue.acceptedWordIds) wordIds.add(acceptedWordId);
  }
  return wordIds;
}

function corruptionError(detail: string): Error {
  return new Error(`Reflection store corruption: ${detail}.`);
}
