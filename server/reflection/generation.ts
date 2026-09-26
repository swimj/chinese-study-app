import type {
  SessionReflectionBundleV4,
  SessionReflectionBundleV6,
  CuratedReflectionBundleV3,
  CuratedReflectionDiagnosisBundleV2,
  PureCuePromotionBundleV2,
  PureCuePromotionResultV2Wire,
  StagedReflectionDiagnosisResultV2,
  SessionReflectionResultV9,
} from '../../src/domain/reflection.ts';
import { validateSessionReflectionResultV9, stampReconcileProductionCuesOperation } from '../../src/domain/reflection.ts';
import {
  createReflectionGenerationContinuation,
  getReflectionGenerationContinuationRetrySource,
  getReflectionArtifactBySessionAndFlow,
  STAGED_INITIAL_REFLECTION_FLOW_VERSION,
  STAGED_DEFERRED_SECOND_OPINION_FLOW_VERSION,
  buildStagedDeferredSecondOpinionBundle,
  linkReflectionGenerationContinuationRun,
  materializeReflectionArtifact,
  prepareReflectionGenerationPromotion,
  recordReflectionGenerationRun,
  startReflectionGenerationRun,
  type RecordReflectionGenerationRunInput,
  type StartReflectionGenerationRunInput,
  type ReflectionArtifactDetail,
  type ReflectionGenerationContinuation,
  type ReflectionGenerationContinuationRetrySource,
  type ReflectionGenerationProviderBundle,
} from '../db/reflections.ts';
import {
  buildInitialReflectionBundleWithMetrics,
  type InitialReflectionBundleBuild,
  ReflectionEvidenceError,
} from './evidence.ts';
import {
  createLunaReflectionProvider,
  LUNA_REFLECTION_MODEL_CONFIG,
  LunaReflectionProviderError,
  type LunaReflectionProvider,
  type LunaReflectionRunMetadata,
  type LunaPureCuePromotionSuccess,
  type ReflectionProviderConfig,
} from './luna-provider.ts';
import {
  PURE_CUE_PROMOTION_PROMPT_VERSION,
  STAGED_REFLECTION_DIAGNOSIS_PROMPT_VERSION,
} from '../../src/domain/reflection-contracts.ts';
import { createReflectionProvider } from './luna-provider.ts';
import { createGlmReflectionProvider } from './glm-provider.ts';
import { GLM_REFLECTION_MODEL_CONFIG } from './glm-provider.ts';
import {
  REFLECTION_MODEL_ARMS,
  isOfferedReflectionModelChoice,
  isReflectionModelChoice,
  LUNA_REFLECTION_MODEL_CHOICE,
  type ReflectionModelChoice,
} from './model-arms.ts';
import {
  assertReflectionModelAllowedUnderSpendCap,
  buildReflectionSpendCap,
  type ReflectionSpendCap,
} from './spend-cap.ts';
import { randomUUID } from 'node:crypto';
import type { ReflectionLifecycleLogger } from './lifecycle-log.ts';
import type { ReflectionProviderDiagnosticSink } from './provider-diagnostics.ts';
import { estimateInitialReflectionRunCost } from './run-pricing.ts';

export type InitialReflectionGenerationResult = {
  artifactId: string;
  proposalCount: number;
  status: 'created' | 'existing';
};

export { isReflectionModelChoice, type ReflectionModelChoice } from './model-arms.ts';
export { ReflectionSpendCapError } from './spend-cap.ts';

export function choiceForStoredModel(model: string): ReflectionModelChoice | null {
  const match = REFLECTION_MODEL_ARMS.map((arm) => arm.choice).find((choice) => {
    const separator = choice.indexOf(':');
    return separator >= 0 && choice.slice(separator + 1) === model;
  });
  return match ?? null;
}

function offeredChoiceForStoredModel(model: string): ReflectionModelChoice | null {
  const match = choiceForStoredModel(model);
  return match !== null && isOfferedReflectionModelChoice(match) ? match : null;
}

function reflectionProviderConfigForChoice(choice: ReflectionModelChoice): ReflectionProviderConfig {
  if (choice === 'openai:gpt-5.6-luna-high') return LUNA_REFLECTION_MODEL_CONFIG;
  if (choice === 'zai:glm-5.3-flash-max') return GLM_REFLECTION_MODEL_CONFIG;
  const arm = REFLECTION_MODEL_ARMS.find((candidate) => candidate.choice === choice);
  if (arm?.config === null || arm === undefined) {
    throw new Error(`Unsupported reflection model choice: ${choice}`);
  }
  return arm.config;
}

export class RetiredReflectionSourceModelError extends Error {
  readonly model: string;

  constructor(model: string) {
    super(`The source run's model (${model}) is no longer available. Choose a current model.`);
    this.name = 'RetiredReflectionSourceModelError';
    this.model = model;
  }
}

export type InitialReflectionGenerationService = {
  generate(
    sessionId: string,
    evidenceSupplement: unknown,
    model?: ReflectionModelChoice,
  ): Promise<InitialReflectionGenerationResult>;
  retry(runId: string, model?: ReflectionModelChoice): Promise<InitialReflectionGenerationResult>;
  generateDeferredSecondOpinion(
    proposalIds: string[],
    model: ReflectionModelChoice,
  ): Promise<InitialReflectionGenerationResult>;
};

export type InitialReflectionGenerationDependencies = {
  provider?: LunaReflectionProvider;
  glmProvider?: LunaReflectionProvider;
  comparisonProviders?: Partial<Record<ReflectionModelChoice, LunaReflectionProvider>>;
  random?: () => number;
  now?: () => string;
  buildBundle?: (
    sessionId: string,
    supplement: unknown,
    generatedAt: string,
  ) => SessionReflectionBundleV4;
  buildBundleWithMetrics?: (
    sessionId: string,
    supplement: unknown,
    generatedAt: string,
  ) => InitialReflectionBundleBuild;
  buildDeferredBundle?: (proposalIds: string[], generatedAt: string) => {
    bundle: CuratedReflectionDiagnosisBundleV2;
    sourceProposalIds: string[];
    eligibleItemCount?: number;
    overlapOmittedItemCount?: number;
  };
  findExistingArtifact?: (
    sessionId: string,
    reflectionFlowVersion: string,
  ) => ReflectionArtifactDetail | null;
  materializeArtifact?: typeof materializeReflectionArtifact;
  recordRun?: (input: RecordReflectionGenerationRunInput) => void;
  startRun?: (input: StartReflectionGenerationRunInput) => void;
  createContinuation?: typeof createReflectionGenerationContinuation;
  preparePromotion?: typeof prepareReflectionGenerationPromotion;
  linkContinuationRun?: typeof linkReflectionGenerationContinuationRun;
  getContinuationRetrySource?: typeof getReflectionGenerationContinuationRetrySource;
  lifecycleLogger?: ReflectionLifecycleLogger;
  providerDiagnosticSink?: ReflectionProviderDiagnosticSink;
  getSpendCap?: () => ReflectionSpendCap;
};

/**
 * Creates one local generation coordinator. Concurrent requests for the same
 * session and flow share the same provider call, while the durable
 * session/flow key remains the final idempotency boundary.
 */
export function createInitialReflectionGenerationService(
  dependencies: InitialReflectionGenerationDependencies = {},
): InitialReflectionGenerationService {
  const provider = dependencies.provider ?? createLunaReflectionProvider({
    diagnosticSink: dependencies.providerDiagnosticSink,
  });
  const glmProvider = dependencies.glmProvider ?? createGlmReflectionProvider({
    diagnosticSink: dependencies.providerDiagnosticSink,
  });
  const random = dependencies.random ?? Math.random;
  const now = dependencies.now ?? (() => new Date().toISOString());
  const buildBundleWithMetrics = dependencies.buildBundleWithMetrics
    ?? (dependencies.buildBundle === undefined
      ? buildInitialReflectionBundleWithMetrics
      : (sessionId: string, supplement: unknown, generatedAt: string): InitialReflectionBundleBuild => {
          const bundle = dependencies.buildBundle!(sessionId, supplement, generatedAt);
          return {
            bundle,
            eligibleItemCount: bundle.items.length,
            includedItemCount: bundle.items.length,
          };
        });
  const findExistingArtifact = dependencies.findExistingArtifact
    ?? getReflectionArtifactBySessionAndFlow;
  const buildDeferredBundle = dependencies.buildDeferredBundle ?? buildStagedDeferredSecondOpinionBundle;
  const materializeArtifact = dependencies.materializeArtifact
    ?? materializeReflectionArtifact;
  const recordRun = dependencies.recordRun ?? recordReflectionGenerationRun;
  const startRun = dependencies.startRun ?? startReflectionGenerationRun;
  const createContinuation = dependencies.createContinuation
    ?? createReflectionGenerationContinuation;
  const preparePromotion = dependencies.preparePromotion
    ?? prepareReflectionGenerationPromotion;
  const linkContinuationRun = dependencies.linkContinuationRun
    ?? linkReflectionGenerationContinuationRun;
  const continuationRetrySource = dependencies.getContinuationRetrySource
    ?? getReflectionGenerationContinuationRetrySource;
  const getSpendCap = dependencies.getSpendCap
    ?? (() => buildReflectionSpendCap(0, new Date(now())));
  const lifecycleLogger = dependencies.lifecycleLogger;
  const inFlight = new Map<string, Promise<InitialReflectionGenerationResult>>();
  const configuredProviders: Partial<Record<ReflectionModelChoice, LunaReflectionProvider>> = {
    ...dependencies.comparisonProviders,
    'openai:gpt-5.6-luna-high': provider,
    'zai:glm-5.3-flash-max': glmProvider,
  };
  for (const arm of REFLECTION_MODEL_ARMS) {
    if (arm.config !== null && configuredProviders[arm.choice] === undefined) {
      configuredProviders[arm.choice] = createReflectionProvider(arm.config, {
        diagnosticSink: dependencies.providerDiagnosticSink,
      });
    }
  }
  const comparisonArms: ReadonlyArray<{
    choice: ReflectionModelChoice;
    provider: LunaReflectionProvider;
  }> = REFLECTION_MODEL_ARMS.map((arm) => ({
    choice: arm.choice,
    provider: configuredProviders[arm.choice]!,
  }));
  const defaultComparisonArms = comparisonArms.filter((arm) => (
    isOfferedReflectionModelChoice(arm.choice)
  ));

  function selectProvider(choice: ReflectionModelChoice | undefined): {
    provider: LunaReflectionProvider;
    config: ReflectionProviderConfig;
  } {
    // Tests that inject only the Luna provider keep deterministic single-arm behavior.
    if (
      choice === undefined
      && dependencies.provider !== undefined
      && dependencies.glmProvider === undefined
      && dependencies.comparisonProviders === undefined
    ) {
      return { provider, config: LUNA_REFLECTION_MODEL_CONFIG };
    }
    const spendCap = getSpendCap();
    if (choice !== undefined) {
      assertReflectionModelAllowedUnderSpendCap(choice, spendCap);
      const selected = comparisonArms.find((arm) => arm.choice === choice);
      if (selected === undefined) {
        throw new Error(`Unsupported reflection model choice: ${choice}`);
      }
      return { provider: selected.provider, config: reflectionProviderConfigForChoice(choice) };
    }
    if (spendCap.lunaOnly) {
      const luna = comparisonArms.find((arm) => arm.choice === LUNA_REFLECTION_MODEL_CHOICE);
      if (luna === undefined) {
        throw new Error('Luna is not a configured reflection comparison arm.');
      }
      return { provider: luna.provider, config: reflectionProviderConfigForChoice(LUNA_REFLECTION_MODEL_CHOICE) };
    }
    const index = Math.floor(random() * defaultComparisonArms.length);
    const selected = defaultComparisonArms[index]!;
    return { provider: selected.provider, config: reflectionProviderConfigForChoice(selected.choice) };
  }

  async function runCoalesced(
    key: string,
    start: () => Promise<InitialReflectionGenerationResult>,
  ): Promise<InitialReflectionGenerationResult> {
    const active = inFlight.get(key);
    if (active) return active;
    const generation = start();
    inFlight.set(key, generation);
    try {
      return await generation;
    } finally {
      if (inFlight.get(key) === generation) inFlight.delete(key);
    }
  }

  return {
    async generate(
      sessionId: string,
      evidenceSupplement: unknown,
      model?: ReflectionModelChoice,
    ): Promise<InitialReflectionGenerationResult> {
      const normalizedSessionId = sessionId.trim();
      if (normalizedSessionId.length === 0) {
        throw new ReflectionEvidenceError(
          'invalid_reference',
          'A non-empty session id is required.',
        );
      }

      const generatedAt = now();
      const selectedProvider = selectProvider(model);
      const coalescingModelKey = model ?? 'initial-routed';
      return runCoalesced(`${normalizedSessionId}\u0000${coalescingModelKey}`, async () => {
        const built = buildBundleWithMetrics(
          normalizedSessionId,
          evidenceSupplement,
          generatedAt,
        );
        if (built.bundle.schemaVersion !== 'session_reflection_bundle.v4') {
          throw new Error('New staged initial reflection requires a V4 diagnosis bundle.');
        }
        const continuation = createContinuation({
          sourceSessionId: normalizedSessionId,
          reflectionFlowVersion: STAGED_INITIAL_REFLECTION_FLOW_VERSION,
          createdAt: generatedAt,
          eligibleItemCount: built.eligibleItemCount,
          includedItemCount: built.includedItemCount,
          overlapOmittedItemCount: built.overlapOmittedItemCount ?? 0,
          diagnosisBundle: built.bundle,
        });
        return runStagedContinuation({
          continuation,
          startingStage: 'diagnosis',
          provider: selectedProvider.provider,
          providerConfig: selectedProvider.config,
          now,
          startRun,
          recordRun,
          materializeArtifact,
          linkContinuationRun,
          preparePromotion,
          lifecycleLogger,
        });
      });
    },

    async retry(runId: string, model?: ReflectionModelChoice): Promise<InitialReflectionGenerationResult> {
      const stagedRetry = continuationRetrySource(runId);
      if (stagedRetry === null) {
        throw new Error('Reflection generation run is not retryable by the current flow.');
      }
      const selectedChoice = model ?? offeredChoiceForStoredModel(stagedRetry.model);
      if (selectedChoice === null) throw new RetiredReflectionSourceModelError(stagedRetry.model);
      const selectedProvider = selectProvider(selectedChoice);
      return runCoalesced(`continuation\u0000${stagedRetry.continuation.continuationId}`, () => (
        runStagedContinuation({
          continuation: stagedRetry.continuation,
          startingStage: stagedRetry.stage,
          retryRunId: stagedRetry.runId,
          provider: selectedProvider.provider,
          providerConfig: selectedProvider.config,
          resumeMetadata: {
            provider: stagedRetry.provider,
            modelConfig: stagedRetry.model,
            providerModel: stagedRetry.providerModel,
            promptVersion: stagedRetry.promptVersion,
            responseId: null,
            finishReason: null,
            usage: unavailableUsage(),
          },
          now,
          startRun,
          recordRun,
          materializeArtifact,
          linkContinuationRun,
          preparePromotion,
          lifecycleLogger,
        })
      ));
    },

    async generateDeferredSecondOpinion(
      proposalIds: string[],
      model: ReflectionModelChoice,
    ): Promise<InitialReflectionGenerationResult> {
      const normalizedProposalIds = [...new Set(proposalIds.map((proposalId) => proposalId.trim()))].sort();
      const key = `deferred-second-opinion\u0000${normalizedProposalIds.join('\u0000')}\u0000${model}`;
      return runCoalesced(key, async () => {
        const generatedAt = now();
        const deferred = buildDeferredBundle(normalizedProposalIds, generatedAt);
        const selectedProvider = selectProvider(model);
        const continuation = createContinuation({
          sourceSessionId: null,
          reflectionFlowVersion: STAGED_DEFERRED_SECOND_OPINION_FLOW_VERSION,
          createdAt: generatedAt,
          eligibleItemCount: deferred.eligibleItemCount ?? deferred.bundle.items.length,
          includedItemCount: deferred.bundle.items.length,
          overlapOmittedItemCount: deferred.overlapOmittedItemCount ?? 0,
          diagnosisBundle: deferred.bundle,
          sourceProposalIds: deferred.sourceProposalIds,
        });
        return runStagedContinuation({
          continuation,
          startingStage: 'diagnosis',
          provider: selectedProvider.provider,
          providerConfig: selectedProvider.config,
          now,
          startRun,
          recordRun,
          materializeArtifact,
          linkContinuationRun,
          preparePromotion,
          lifecycleLogger,
        });
      });
    },
  };
}

type StagedRunSuccess<T> = {
  result: T;
  metadata: LunaReflectionRunMetadata;
  runId: string;
  startedAt: string;
  clientRequestId: string;
  bundle: ReflectionGenerationProviderBundle;
  eligibleItemCount: number;
  includedItemCount: number;
  resultSchemaVersion: string;
  sourceProposalIds?: string[];
};

type PreparedReflectionGenerationContinuation = ReflectionGenerationContinuation & {
  diagnosisResult: StagedReflectionDiagnosisResultV2;
  finalEvidenceBundle: SessionReflectionBundleV6 | CuratedReflectionBundleV3;
  promotionBundle: PureCuePromotionBundleV2;
};

function assertPreparedReflectionGenerationContinuation(
  continuation: ReflectionGenerationContinuation,
): asserts continuation is PreparedReflectionGenerationContinuation {
  if (
    continuation.diagnosisResult === null
    || continuation.finalEvidenceBundle === null
    || continuation.promotionBundle === null
  ) {
    throw new Error('Reflection continuation preparation did not persist exact stage-two evidence.');
  }
}

async function runStagedContinuation(input: {
  continuation: ReflectionGenerationContinuation;
  startingStage: 'diagnosis' | 'promotion';
  provider: LunaReflectionProvider;
  providerConfig: ReflectionProviderConfig;
  now: () => string;
  startRun: NonNullable<InitialReflectionGenerationDependencies['startRun']>;
  recordRun: NonNullable<InitialReflectionGenerationDependencies['recordRun']>;
  materializeArtifact: NonNullable<InitialReflectionGenerationDependencies['materializeArtifact']>;
  linkContinuationRun: NonNullable<InitialReflectionGenerationDependencies['linkContinuationRun']>;
  preparePromotion: NonNullable<InitialReflectionGenerationDependencies['preparePromotion']>;
  lifecycleLogger: ReflectionLifecycleLogger | undefined;
  retryRunId?: string;
  resumeMetadata?: LunaReflectionRunMetadata;
}): Promise<InitialReflectionGenerationResult> {
  let continuation = input.continuation;
  let diagnosisCall: StagedRunSuccess<StagedReflectionDiagnosisResultV2> | null = null;
  if (input.startingStage === 'diagnosis' && continuation.diagnosisResult === null) {
    diagnosisCall = await runDiagnosisStage({ ...input, continuation });
    try {
      continuation = input.preparePromotion({
        continuationId: continuation.continuationId,
        diagnosisResult: diagnosisCall.result,
        preparedAt: input.now(),
      });
    } catch (error) {
      recordStagedRunOutcome(input, diagnosisCall, 'failed', error);
      throw error;
    }
  } else if (
    continuation.diagnosisResult === null
    || continuation.finalEvidenceBundle === null
    || continuation.promotionBundle === null
  ) {
    throw new Error('The saved reflection continuation has no exact promotion-stage input.');
  }

  assertPreparedReflectionGenerationContinuation(continuation);

  if (diagnosisCall !== null && continuation.promotionBundle.items.length > 0) {
    recordStagedRunOutcome(input, diagnosisCall, 'succeeded', null);
  }

  if (continuation.promotionBundle.items.length > 0) {
    const promotion = await runPromotionStage({ ...input, continuation });
    try {
      const result = materializeStagedResult(input, continuation, promotion.result, promotion);
      recordStagedRunOutcome(input, promotion, 'succeeded', null);
      return result;
    } catch (error) {
      recordStagedRunOutcome(input, promotion, 'failed', error);
      throw error;
    }
  } else if (input.startingStage === 'promotion') {
    throw new Error('A continuation without promotion candidates has no promotion stage to retry.');
  }

  const finalCall = diagnosisCall ?? {
    metadata: input.resumeMetadata
      ?? unavailableMetadata(input.providerConfig, STAGED_REFLECTION_DIAGNOSIS_PROMPT_VERSION),
    runId: input.retryRunId ?? '',
  };
  try {
    const result = materializeStagedResult(input, continuation, null, finalCall);
    if (diagnosisCall !== null) recordStagedRunOutcome(input, diagnosisCall, 'succeeded', null);
    return result;
  } catch (error) {
    if (diagnosisCall !== null) recordStagedRunOutcome(input, diagnosisCall, 'failed', error);
    throw error;
  }
}

function materializeStagedResult(
  input: Pick<
    Parameters<typeof runStagedContinuation>[0],
    'materializeArtifact' | 'now'
  >,
  continuation: PreparedReflectionGenerationContinuation,
  promotionResult: PureCuePromotionResultV2Wire | null,
  finalCall: { metadata: LunaReflectionRunMetadata; runId: string },
): InitialReflectionGenerationResult {
  const result = assembleStagedReflectionResult(
    continuation.diagnosisResult,
    continuation.finalEvidenceBundle,
    promotionResult,
  );
  const materializationBase = {
    continuationId: continuation.continuationId,
    sourceRunId: finalCall.runId,
    sourceSessionId: continuation.sourceSessionId,
    reflectionFlowVersion: continuation.reflectionFlowVersion,
    generatedAt: input.now(),
    provider: finalCall.metadata.provider,
    model: finalCall.metadata.modelConfig,
    promptVersion: finalCall.metadata.promptVersion,
  };
  const materialized = continuation.finalEvidenceBundle.schemaVersion === 'curated_reflection_bundle.v3'
    ? input.materializeArtifact({
        ...materializationBase,
        evidenceBundle: continuation.finalEvidenceBundle,
        result,
        sourceProposalIds: continuation.sourceProposalIds
          ?? (() => {
            throw new Error('A curated staged continuation requires source proposal provenance.');
          })(),
      })
    : input.materializeArtifact({
        ...materializationBase,
        evidenceBundle: continuation.finalEvidenceBundle,
        result,
      });
  return generationResult(materialized.created, materialized.artifact);
}

async function runDiagnosisStage(input: {
  continuation: ReflectionGenerationContinuation;
  provider: LunaReflectionProvider;
  providerConfig: ReflectionProviderConfig;
  now: () => string;
  startRun: NonNullable<InitialReflectionGenerationDependencies['startRun']>;
  recordRun: NonNullable<InitialReflectionGenerationDependencies['recordRun']>;
  linkContinuationRun: NonNullable<InitialReflectionGenerationDependencies['linkContinuationRun']>;
  lifecycleLogger: ReflectionLifecycleLogger | undefined;
}): Promise<StagedRunSuccess<StagedReflectionDiagnosisResultV2>> {
  if (input.provider.generateDiagnosis === undefined) {
    throw new Error('The selected reflection provider does not implement the staged diagnosis contract.');
  }
  return runProviderStage({
    ...input,
    stage: 'diagnosis',
    bundle: input.continuation.diagnosisBundle,
    promptVersion: STAGED_REFLECTION_DIAGNOSIS_PROMPT_VERSION,
    resultSchemaVersion: 'staged_reflection_diagnosis_result.v2',
    sourceProposalIds: input.continuation.sourceProposalIds ?? undefined,
    invoke: (options) => (
      input.provider.generateDiagnosis!(input.continuation.diagnosisBundle, options)
    ),
  });
}

async function runPromotionStage(input: {
  continuation: ReflectionGenerationContinuation;
  provider: LunaReflectionProvider;
  providerConfig: ReflectionProviderConfig;
  now: () => string;
  startRun: NonNullable<InitialReflectionGenerationDependencies['startRun']>;
  recordRun: NonNullable<InitialReflectionGenerationDependencies['recordRun']>;
  linkContinuationRun: NonNullable<InitialReflectionGenerationDependencies['linkContinuationRun']>;
  lifecycleLogger: ReflectionLifecycleLogger | undefined;
}): Promise<StagedRunSuccess<PureCuePromotionResultV2Wire>> {
  const bundle = input.continuation.promotionBundle;
  if (bundle === null) throw new Error('Reflection continuation promotion input is missing.');
  if (input.provider.generatePromotion === undefined) {
    throw new Error('The selected reflection provider does not implement the promotion-stage contract.');
  }
  return runProviderStage({
    ...input,
    stage: 'promotion',
    bundle,
    promptVersion: PURE_CUE_PROMOTION_PROMPT_VERSION,
    resultSchemaVersion: 'pure_cue_promotion_result.v2',
    sourceProposalIds: input.continuation.sourceProposalIds ?? undefined,
    invoke: (options) => input.provider.generatePromotion!(bundle, options),
  });
}

function stageEvidenceItemCounts(
  stage: 'diagnosis' | 'promotion',
  continuation: ReflectionGenerationContinuation,
  bundle: ReflectionGenerationProviderBundle,
): { eligibleItemCount: number; includedItemCount: number } {
  if (stage === 'promotion') {
    return {
      eligibleItemCount: bundle.items.length,
      includedItemCount: bundle.items.length,
    };
  }
  return {
    eligibleItemCount: continuation.eligibleItemCount,
    includedItemCount: continuation.includedItemCount,
  };
}

async function runProviderStage<T>(input: {
  continuation: ReflectionGenerationContinuation;
  stage: 'diagnosis' | 'promotion';
  bundle: ReflectionGenerationProviderBundle;
  providerConfig: ReflectionProviderConfig;
  promptVersion: string;
  resultSchemaVersion: string;
  invoke: (options: { clientRequestId: string }) => Promise<{
    result: T;
    metadata: LunaReflectionRunMetadata;
  }>;
  now: () => string;
  startRun: NonNullable<InitialReflectionGenerationDependencies['startRun']>;
  recordRun: NonNullable<InitialReflectionGenerationDependencies['recordRun']>;
  linkContinuationRun: NonNullable<InitialReflectionGenerationDependencies['linkContinuationRun']>;
  lifecycleLogger: ReflectionLifecycleLogger | undefined;
  sourceProposalIds?: string[];
}): Promise<StagedRunSuccess<T>> {
  const runId = randomUUID();
  const clientRequestId = randomUUID();
  const startedAt = input.now();
  const itemCounts = stageEvidenceItemCounts(input.stage, input.continuation, input.bundle);
  input.linkContinuationRun({
    continuationId: input.continuation.continuationId,
    runId,
    stage: input.stage,
    createdAt: startedAt,
  });
  input.startRun({
    runId,
    sourceSessionId: input.continuation.sourceSessionId,
    reflectionFlowVersion: input.continuation.reflectionFlowVersion,
    startedAt,
    provider: input.providerConfig.provider,
    model: input.providerConfig.modelConfig,
    providerModel: input.providerConfig.providerModel,
    promptVersion: input.promptVersion,
    clientRequestId,
    eligibleItemCount: itemCounts.eligibleItemCount,
    includedItemCount: itemCounts.includedItemCount,
    evidenceBundle: input.bundle,
    ...(input.sourceProposalIds === undefined ? {} : { sourceProposalIds: input.sourceProposalIds }),
  });
  input.lifecycleLogger?.emit({
    event: 'reflection.provider_started',
    sessionId: input.continuation.sourceSessionId,
    evidenceItemCount: input.bundle.items.length,
  });
  let metadata: LunaReflectionRunMetadata | null = null;
  try {
    const generated = await input.invoke({ clientRequestId });
    metadata = generated.metadata;
    if (metadata.promptVersion !== input.promptVersion) {
      throw new Error(
        `Reflection provider returned prompt version ${metadata.promptVersion}; expected ${input.promptVersion}.`,
      );
    }
    return {
      ...generated,
      runId,
      startedAt,
      clientRequestId,
      bundle: input.bundle,
      eligibleItemCount: itemCounts.eligibleItemCount,
      includedItemCount: itemCounts.includedItemCount,
      resultSchemaVersion: input.resultSchemaVersion,
      ...(input.sourceProposalIds === undefined ? {} : { sourceProposalIds: input.sourceProposalIds }),
    };
  } catch (error) {
    try {
      input.recordRun(runRecordInput({
        runId,
        sourceSessionId: input.continuation.sourceSessionId,
        reflectionFlowVersion: input.continuation.reflectionFlowVersion,
        startedAt,
        completedAt: input.now(),
        metadata: failureMetadataForConfig(error, metadata, input.providerConfig, input.promptVersion),
        state: 'failed',
        failureCode: failureCode(error),
        error,
        eligibleItemCount: itemCounts.eligibleItemCount,
        includedItemCount: itemCounts.includedItemCount,
        evidenceBundle: input.bundle,
        clientRequestId,
        resultSchemaVersion: input.resultSchemaVersion,
        sourceProposalIds: input.sourceProposalIds,
      }));
    } catch {
      // Provider failure remains primary when operational logging also fails.
    }
    throw error;
  }
}

function recordStagedRunOutcome(
  input: Pick<
    Parameters<typeof runStagedContinuation>[0],
    'continuation' | 'now' | 'recordRun' | 'providerConfig'
  >,
  run: StagedRunSuccess<unknown>,
  state: 'succeeded' | 'failed',
  error: unknown,
): void {
  input.recordRun(runRecordInput({
    runId: run.runId,
    sourceSessionId: input.continuation.sourceSessionId,
    reflectionFlowVersion: input.continuation.reflectionFlowVersion,
    startedAt: run.startedAt,
    completedAt: input.now(),
    metadata: run.metadata,
    state,
    failureCode: state === 'succeeded' ? null : failureCode(error),
    error,
    eligibleItemCount: run.eligibleItemCount,
    includedItemCount: run.includedItemCount,
    evidenceBundle: run.bundle,
    clientRequestId: run.clientRequestId,
    resultSchemaVersion: run.resultSchemaVersion,
    sourceProposalIds: run.sourceProposalIds,
  }));
}

export function assembleStagedReflectionResult(
  diagnosis: StagedReflectionDiagnosisResultV2,
  evidence: SessionReflectionBundleV6 | CuratedReflectionBundleV3,
  promotion: PureCuePromotionResultV2Wire | null,
): SessionReflectionResultV9 {
  const promotionByItemId = new Map(
    promotion?.itemResults.map((itemResult) => [itemResult.itemId, itemResult.decision]) ?? [],
  );
  const evidenceByItemId = new Map(evidence.items.map((item) => [item.itemId, item]));
  const itemResults: SessionReflectionResultV9['itemResults'] = diagnosis.itemResults.map((itemResult) => {
    const item = evidenceByItemId.get(itemResult.itemId)!;
    const decision = promotionByItemId.get(itemResult.itemId);
    if (itemResult.kind === 'ordinary') {
      if (decision !== undefined) throw new Error('Ordinary reflection received an unexpected promotion decision.');
      const { kind: _kind, ...ordinary } = itemResult;
      return ordinary;
    }
    if (decision === undefined) throw new Error('Shared-axis handoff is missing its content-reconciliation decision.');
    if (decision.kind === 'explanation_only') {
      return {
        itemId: itemResult.itemId,
        diagnosisTags: itemResult.diagnosisTags,
        learnerExplanation: decision.learnerExplanation,
        promotionOutcome: 'explanation_only',
        proposals: [],
        questions: [],
      };
    }
    if (item.submittedWord === null) throw new Error('Promotion requires an identified response word.');
    return {
      itemId: itemResult.itemId,
      diagnosisTags: itemResult.diagnosisTags,
      learnerExplanation: decision.learnerExplanation,
      promotionOutcome: 'reconciled',
      questions: [],
      proposals: [{
        proposalGroupKey: null,
        rationale: decision.rationale,
        operation: stampReconcileProductionCuesOperation(decision.operation, {
          ...item,
          responseWord: item.submittedWord,
          promotionEvidence: item.promotionEvidence!,
        }),
      }],
    };
  });
  const result: SessionReflectionResultV9 = {
    schemaVersion: 'session_reflection_result.v9',
    itemResults,
  };
  const errors = validateSessionReflectionResultV9(result, evidence);
  if (errors.length > 0) {
    throw new Error(`Cannot assemble invalid staged reflection result:\n${errors.join('\n')}`);
  }
  return result;
}

function runRecordInput(input: {
  runId: string;
  sourceSessionId: string | null;
  reflectionFlowVersion: string;
  startedAt: string;
  completedAt: string;
  metadata: LunaReflectionRunMetadata;
  state: 'succeeded' | 'failed';
  failureCode: string | null;
  error: unknown;
  eligibleItemCount: number;
  includedItemCount: number;
  evidenceBundle: ReflectionGenerationProviderBundle;
  clientRequestId: string;
  resultSchemaVersion?: string;
  sourceProposalIds?: string[];
}): RecordReflectionGenerationRunInput {
  const estimate = estimateInitialReflectionRunCost({
    provider: input.metadata.provider,
    providerModel: input.metadata.providerModel,
    usage: input.metadata.usage,
    reportedCostUsd: input.metadata.reportedCostUsd,
    reportedAt: input.completedAt,
  });
  return {
    runId: input.runId,
    sourceSessionId: input.sourceSessionId,
    reflectionFlowVersion: input.reflectionFlowVersion,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    provider: input.metadata.provider,
    model: input.metadata.modelConfig,
    providerModel: input.metadata.providerModel,
    promptVersion: input.metadata.promptVersion,
    responseId: input.metadata.responseId,
    clientRequestId: input.clientRequestId,
    finishReason: input.metadata.finishReason,
    bundleSchemaVersion: input.evidenceBundle.schemaVersion,
    resultSchemaVersion: input.resultSchemaVersion ?? 'session_reflection_result.v7',
    diagnostic: input.error instanceof LunaReflectionProviderError
      ? input.error.diagnostic
      : null,
    state: input.state,
    failureCode: input.failureCode,
    eligibleItemCount: input.eligibleItemCount,
    includedItemCount: input.includedItemCount,
    usage: input.metadata.usage,
    pricingSnapshotId: estimate?.pricing.id ?? null,
    pricingAsOf: estimate?.pricing.pricingAsOf ?? null,
    pricingBasis: estimate?.pricing ?? null,
    estimatedCostUsd: estimate?.estimatedCostUsd ?? null,
    evidenceBundle: input.evidenceBundle,
    ...(input.sourceProposalIds === undefined ? {} : { sourceProposalIds: input.sourceProposalIds }),
  };
}

function failureMetadataForConfig(
  error: unknown,
  generatedMetadata: LunaReflectionRunMetadata | null,
  config: ReflectionProviderConfig,
  promptVersion: string,
): LunaReflectionRunMetadata {
  if (error instanceof LunaReflectionProviderError && error.metadata !== null) {
    return error.metadata;
  }
  if (generatedMetadata !== null) return generatedMetadata;
  return unavailableMetadata(config, promptVersion);
}

function unavailableMetadata(
  config: ReflectionProviderConfig,
  promptVersion: string,
): LunaReflectionRunMetadata {
  return {
    provider: config.provider,
    modelConfig: config.modelConfig,
    providerModel: config.providerModel,
    promptVersion,
    responseId: null,
    finishReason: null,
    usage: unavailableUsage(),
  };
}

function unavailableUsage(): LunaReflectionRunMetadata['usage'] {
  return {
    inputTokens: null,
    cachedInputTokens: null,
    cacheWriteInputTokens: null,
    outputTokens: null,
    reasoningTokens: null,
    totalTokens: null,
  };
}

function failureCode(error: unknown): string {
  return error instanceof LunaReflectionProviderError ? error.code : 'internal_error';
}

function generationResult(
  created: boolean,
  artifact: ReflectionArtifactDetail,
): InitialReflectionGenerationResult {
  return {
    artifactId: artifact.artifactId,
    proposalCount: artifact.proposals.length,
    status: created ? 'created' : 'existing',
  };
}
