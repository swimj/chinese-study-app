import type {
  SessionReflectionBundleV2,
  SessionReflectionBundleV3,
} from '../../src/domain/reflection.ts';
import {
  getReflectionGenerationRetrySource,
  getReflectionArtifactBySessionAndFlow,
  INITIAL_REFLECTION_FLOW_VERSION,
  materializeReflectionArtifact,
  recordReflectionGenerationRun,
  type MaterializeReflectionArtifactResult,
  type RecordReflectionGenerationRunInput,
  type ReflectionArtifactDetail,
  type ReflectionGenerationRetrySource,
} from '../db/reflections.ts';
import {
  buildInitialReflectionBundleWithMetrics,
  type InitialReflectionBundleBuild,
  ReflectionEvidenceError,
} from './evidence.ts';
import {
  createLunaReflectionProvider,
  LUNA_REFLECTION_MODEL_CONFIG,
  LUNA_REFLECTION_PROMPT_VERSION,
  LunaReflectionProviderError,
  type LunaReflectionProvider,
  type LunaReflectionRunMetadata,
} from './luna-provider.ts';
import { createReflectionProvider } from './luna-provider.ts';
import { createGlmReflectionProvider } from './glm-provider.ts';
import { createQwen38MaxReflectionProvider } from './qwen-provider.ts';
import {
  REFLECTION_MODEL_ARMS,
  isReflectionModelChoice,
  type ReflectionModelChoice,
} from './model-arms.ts';
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

export function choiceForStoredModel(model: string): ReflectionModelChoice | null {
  const match = REFLECTION_MODEL_ARMS.map((arm) => arm.choice).find((choice) => {
    const separator = choice.indexOf(':');
    return separator >= 0 && choice.slice(separator + 1) === model;
  });
  return match ?? null;
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
};

export type InitialReflectionGenerationDependencies = {
  provider?: LunaReflectionProvider;
  glmProvider?: LunaReflectionProvider;
  qwen38MaxProvider?: LunaReflectionProvider;
  comparisonProviders?: Partial<Record<ReflectionModelChoice, LunaReflectionProvider>>;
  random?: () => number;
  now?: () => string;
  buildBundle?: (
    sessionId: string,
    supplement: unknown,
    generatedAt: string,
  ) => SessionReflectionBundleV3;
  buildBundleWithMetrics?: (
    sessionId: string,
    supplement: unknown,
    generatedAt: string,
  ) => InitialReflectionBundleBuild;
  findExistingArtifact?: (
    sessionId: string,
    reflectionFlowVersion: string,
  ) => ReflectionArtifactDetail | null;
  getRetrySource?: (runId: string) => ReflectionGenerationRetrySource;
  materializeArtifact?: typeof materializeReflectionArtifact;
  recordRun?: (input: RecordReflectionGenerationRunInput) => void;
  lifecycleLogger?: ReflectionLifecycleLogger;
  providerDiagnosticSink?: ReflectionProviderDiagnosticSink;
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
  const qwen38MaxProvider = dependencies.qwen38MaxProvider ?? createQwen38MaxReflectionProvider({
    diagnosticSink: dependencies.providerDiagnosticSink,
  });
  const random = dependencies.random ?? Math.random;
  const now = dependencies.now ?? (() => new Date().toISOString());
  const buildBundleWithMetrics = dependencies.buildBundleWithMetrics
    ?? (dependencies.buildBundle === undefined
      ? buildInitialReflectionBundleWithMetrics
      : (sessionId: string, supplement: unknown, generatedAt: string) => {
          const bundle = dependencies.buildBundle!(sessionId, supplement, generatedAt);
          return {
            bundle,
            eligibleItemCount: bundle.items.length,
            includedItemCount: bundle.items.length,
          };
        });
  const findExistingArtifact = dependencies.findExistingArtifact
    ?? getReflectionArtifactBySessionAndFlow;
  const getRetrySource = dependencies.getRetrySource ?? getReflectionGenerationRetrySource;
  const materializeArtifact = dependencies.materializeArtifact
    ?? materializeReflectionArtifact;
  const recordRun = dependencies.recordRun ?? recordReflectionGenerationRun;
  const lifecycleLogger = dependencies.lifecycleLogger;
  const inFlight = new Map<string, Promise<InitialReflectionGenerationResult>>();
  const configuredProviders: Partial<Record<ReflectionModelChoice, LunaReflectionProvider>> = {
    ...dependencies.comparisonProviders,
    'openai:gpt-5.6-luna-high': provider,
    'zai:glm-5.2-high': glmProvider,
    'dashscope:qwen3.8-max': qwen38MaxProvider,
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
    REFLECTION_MODEL_ARMS.find((candidate) => candidate.choice === arm.choice)!.enabledByDefault
  ));

  function selectProvider(choice: ReflectionModelChoice | undefined): LunaReflectionProvider {
    // Tests that inject only the Luna provider keep deterministic single-arm behavior.
    if (
      choice === undefined
      && dependencies.provider !== undefined
      && dependencies.glmProvider === undefined
      && dependencies.qwen38MaxProvider === undefined
      && dependencies.comparisonProviders === undefined
    ) {
      return provider;
    }
    if (choice !== undefined) {
      const selected = comparisonArms.find((arm) => arm.choice === choice);
      if (selected === undefined) {
        throw new Error(`Unsupported reflection model choice: ${choice}`);
      }
      return selected.provider;
    }
    const index = Math.floor(random() * defaultComparisonArms.length);
    return defaultComparisonArms[index]!.provider;
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
      return runCoalesced(`${normalizedSessionId}\u0000${coalescingModelKey}`, () => generateAndMaterialize({
        sessionId: normalizedSessionId,
        evidenceSupplement,
        generatedAt,
        provider: selectedProvider,
        buildBundleWithMetrics,
        materializeArtifact,
        recordRun,
        now,
        lifecycleLogger,
        runId: randomUUID(),
      }));
    },

    async retry(runId: string, model?: ReflectionModelChoice): Promise<InitialReflectionGenerationResult> {
      const retrySource = getRetrySource(runId);
      if (retrySource.reflectionFlowVersion !== INITIAL_REFLECTION_FLOW_VERSION) {
        throw new Error('Reflection generation run is not retryable by the current flow.');
      }
      if (retrySource.evidenceBundle.schemaVersion !== 'session_reflection_bundle.v2'
        && retrySource.evidenceBundle.schemaVersion !== 'session_reflection_bundle.v3') {
        throw new Error('The current reflection flow cannot retry this evidence bundle.');
      }
      const selectedChoice = model ?? choiceForStoredModel(retrySource.model);
      if (selectedChoice === null) {
        throw new RetiredReflectionSourceModelError(retrySource.model);
      }
      const retryStartedAt = Date.now();
      lifecycleLogger?.emit({
        event: 'reflection.generation_requested',
        sessionId: retrySource.sourceSessionId,
      });
      try {
        const result = await generateBundleAndMaterialize({
              sessionId: retrySource.sourceSessionId,
              builtBundle: {
                bundle: retrySource.evidenceBundle,
                eligibleItemCount: retrySource.eligibleItemCount,
                includedItemCount: retrySource.includedItemCount,
              },
              generatedAt: now(),
              provider: selectProvider(selectedChoice),
              materializeArtifact,
              recordRun,
              now,
              lifecycleLogger,
              runId: randomUUID(),
            });
        lifecycleLogger?.emit({
          event: 'reflection.generation_succeeded',
          sessionId: retrySource.sourceSessionId,
          artifactId: result.artifactId,
          proposalCount: result.proposalCount,
          status: result.status,
          elapsedMs: Date.now() - retryStartedAt,
        });
        return result;
      } catch (error) {
        lifecycleLogger?.emit({
          event: 'reflection.generation_failed',
          sessionId: retrySource.sourceSessionId,
          failure: error instanceof LunaReflectionProviderError ? 'provider' : 'internal',
          code: error instanceof LunaReflectionProviderError ? error.code : null,
          clientRequestId: error instanceof LunaReflectionProviderError
            ? error.clientRequestId
            : null,
          elapsedMs: Date.now() - retryStartedAt,
        });
        throw error;
      }
    },
  };
}

async function generateAndMaterialize(input: {
  sessionId: string;
  evidenceSupplement: unknown;
  generatedAt: string;
  provider: LunaReflectionProvider;
  buildBundleWithMetrics: NonNullable<
    InitialReflectionGenerationDependencies['buildBundleWithMetrics']
  >;
  materializeArtifact: NonNullable<
    InitialReflectionGenerationDependencies['materializeArtifact']
  >;
  recordRun: NonNullable<InitialReflectionGenerationDependencies['recordRun']>;
  now: () => string;
  lifecycleLogger: ReflectionLifecycleLogger | undefined;
  runId: string;
}): Promise<InitialReflectionGenerationResult> {
  const builtBundle = input.buildBundleWithMetrics(
    input.sessionId,
    input.evidenceSupplement,
    input.generatedAt,
  );
  return generateBundleAndMaterialize({
    sessionId: input.sessionId,
    builtBundle,
    generatedAt: input.generatedAt,
    provider: input.provider,
    materializeArtifact: input.materializeArtifact,
    recordRun: input.recordRun,
    now: input.now,
    lifecycleLogger: input.lifecycleLogger,
    runId: input.runId,
  });
}

async function generateBundleAndMaterialize(input: {
  sessionId: string;
  builtBundle: InitialReflectionBundleBuild;
  generatedAt: string;
  provider: LunaReflectionProvider;
  materializeArtifact: NonNullable<
    InitialReflectionGenerationDependencies['materializeArtifact']
  >;
  recordRun: NonNullable<InitialReflectionGenerationDependencies['recordRun']>;
  now: () => string;
  lifecycleLogger: ReflectionLifecycleLogger | undefined;
  runId: string;
}): Promise<InitialReflectionGenerationResult> {
  const builtBundle = input.builtBundle;
  const { bundle } = builtBundle;
  input.lifecycleLogger?.emit({
    event: 'reflection.provider_started',
    sessionId: input.sessionId,
    evidenceItemCount: bundle.items.length,
  });
  let artifactMaterialized = false;
  try {
    const generated = await input.provider.generate(bundle);
    const materialized: MaterializeReflectionArtifactResult = input.materializeArtifact({
      sourceRunId: input.runId,
      sourceSessionId: input.sessionId,
      reflectionFlowVersion: INITIAL_REFLECTION_FLOW_VERSION,
      generatedAt: input.generatedAt,
      provider: generated.metadata.provider,
      model: generated.metadata.modelConfig,
      promptVersion: generated.metadata.promptVersion,
      evidenceBundle: bundle,
      result: generated.result,
    });
    artifactMaterialized = true;
    try {
      input.recordRun(runRecordInput({
        runId: input.runId,
        sessionId: input.sessionId,
        startedAt: input.generatedAt,
        completedAt: input.now(),
        metadata: generated.metadata,
        state: 'succeeded',
        failureCode: null,
        error: null,
        eligibleItemCount: builtBundle.eligibleItemCount,
        includedItemCount: builtBundle.includedItemCount,
        evidenceBundle: bundle,
      }));
    } catch {
      // A successful immutable artifact remains a success if optional dogfood
      // observability cannot be recorded.
    }
    return generationResult(materialized.created, materialized.artifact);
  } catch (error) {
    if (!artifactMaterialized) {
      try {
        input.recordRun(runRecordInput({
          runId: input.runId,
          sessionId: input.sessionId,
          startedAt: input.generatedAt,
          completedAt: input.now(),
          metadata: failureMetadata(error),
          state: 'failed',
          failureCode: failureCode(error),
          error,
          eligibleItemCount: builtBundle.eligibleItemCount,
          includedItemCount: builtBundle.includedItemCount,
          evidenceBundle: bundle,
        }));
      } catch {
        // Run logging must not turn a reflection/provider failure into a study failure.
      }
    }
    throw error;
  }
}

function runRecordInput(input: {
  runId: string;
  sessionId: string;
  startedAt: string;
  completedAt: string;
  metadata: LunaReflectionRunMetadata;
  state: 'succeeded' | 'failed';
  failureCode: string | null;
  error: unknown;
  eligibleItemCount: number;
  includedItemCount: number;
  evidenceBundle: SessionReflectionBundleV2 | SessionReflectionBundleV3;
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
    sourceSessionId: input.sessionId,
    reflectionFlowVersion: INITIAL_REFLECTION_FLOW_VERSION,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    provider: input.metadata.provider,
    model: input.metadata.modelConfig,
    providerModel: input.metadata.providerModel,
    promptVersion: input.metadata.promptVersion,
    responseId: input.metadata.responseId,
    clientRequestId: input.error instanceof LunaReflectionProviderError
      ? input.error.clientRequestId
      : null,
    finishReason: input.metadata.finishReason,
    bundleSchemaVersion: input.evidenceBundle.schemaVersion,
    resultSchemaVersion: 'session_reflection_result.v6',
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
  };
}

function failureMetadata(error: unknown): LunaReflectionRunMetadata {
  if (error instanceof LunaReflectionProviderError && error.metadata !== null) {
    return error.metadata;
  }
  return {
    provider: 'openai',
    modelConfig: LUNA_REFLECTION_MODEL_CONFIG.modelConfig,
    providerModel: LUNA_REFLECTION_MODEL_CONFIG.providerModel,
    promptVersion: LUNA_REFLECTION_PROMPT_VERSION,
    responseId: null,
    finishReason: null,
    usage: {
      inputTokens: null,
      cachedInputTokens: null,
      cacheWriteInputTokens: null,
      outputTokens: null,
      reasoningTokens: null,
      totalTokens: null,
    },
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
