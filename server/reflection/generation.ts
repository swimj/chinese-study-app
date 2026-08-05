import type { SessionReflectionBundleV2 } from '../../src/domain/reflection.ts';
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
import type { ReflectionLifecycleLogger } from './lifecycle-log.ts';
import type { ReflectionProviderDiagnosticSink } from './provider-diagnostics.ts';
import { estimateInitialReflectionRunCost } from './run-pricing.ts';

export type InitialReflectionGenerationResult = {
  artifactId: string;
  proposalCount: number;
  status: 'created' | 'existing';
};

export type InitialReflectionGenerationService = {
  generate(
    sessionId: string,
    evidenceSupplement: unknown,
  ): Promise<InitialReflectionGenerationResult>;
  retry(runId: string): Promise<InitialReflectionGenerationResult>;
};

export type InitialReflectionGenerationDependencies = {
  provider?: LunaReflectionProvider;
  now?: () => string;
  buildBundle?: (
    sessionId: string,
    supplement: unknown,
    generatedAt: string,
  ) => SessionReflectionBundleV2;
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

  async function runCoalesced(
    sessionId: string,
    startGeneration: () => Promise<InitialReflectionGenerationResult>,
  ): Promise<InitialReflectionGenerationResult> {
    const generationKey = `${sessionId}\u0000${INITIAL_REFLECTION_FLOW_VERSION}`;
    const activeGeneration = inFlight.get(generationKey);
    if (activeGeneration) return activeGeneration;

    const generation = startGeneration();
    inFlight.set(generationKey, generation);
    try {
      return await generation;
    } finally {
      if (inFlight.get(generationKey) === generation) {
        inFlight.delete(generationKey);
      }
    }
  }

  return {
    async generate(
      sessionId: string,
      evidenceSupplement: unknown,
    ): Promise<InitialReflectionGenerationResult> {
      const normalizedSessionId = sessionId.trim();
      if (normalizedSessionId.length === 0) {
        throw new ReflectionEvidenceError(
          'invalid_reference',
          'A non-empty session id is required.',
        );
      }

      const existing = findExistingArtifact(
        normalizedSessionId,
        INITIAL_REFLECTION_FLOW_VERSION,
      );
      if (existing !== null) {
        return generationResult(false, existing);
      }

      const generatedAt = now();
      return runCoalesced(normalizedSessionId, () => generateAndMaterialize({
        sessionId: normalizedSessionId,
        evidenceSupplement,
        generatedAt,
        provider,
        buildBundleWithMetrics,
        materializeArtifact,
        recordRun,
        now,
        lifecycleLogger,
      }));
    },

    async retry(runId: string): Promise<InitialReflectionGenerationResult> {
      const retrySource = getRetrySource(runId);
      if (retrySource.reflectionFlowVersion !== INITIAL_REFLECTION_FLOW_VERSION) {
        throw new Error('Reflection generation run is not retryable by the current flow.');
      }
      if (retrySource.evidenceBundle.schemaVersion !== 'session_reflection_bundle.v2') {
        throw new Error('The current reflection flow cannot retry a non-V2 evidence bundle.');
      }
      const retryStartedAt = Date.now();
      lifecycleLogger?.emit({
        event: 'reflection.generation_requested',
        sessionId: retrySource.sourceSessionId,
      });
      try {
        const existing = findExistingArtifact(
          retrySource.sourceSessionId,
          INITIAL_REFLECTION_FLOW_VERSION,
        );
        const result = existing === null
          ? await runCoalesced(retrySource.sourceSessionId, () => generateBundleAndMaterialize({
              sessionId: retrySource.sourceSessionId,
              builtBundle: {
                bundle: retrySource.evidenceBundle,
                eligibleItemCount: retrySource.eligibleItemCount,
                includedItemCount: retrySource.includedItemCount,
              },
              generatedAt: now(),
              provider,
              materializeArtifact,
              recordRun,
              now,
              lifecycleLogger,
            }))
          : generationResult(false, existing);
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
  sessionId: string;
  startedAt: string;
  completedAt: string;
  metadata: LunaReflectionRunMetadata;
  state: 'succeeded' | 'failed';
  failureCode: string | null;
  error: unknown;
  eligibleItemCount: number;
  includedItemCount: number;
  evidenceBundle: SessionReflectionBundleV2;
}): RecordReflectionGenerationRunInput {
  const estimate = estimateInitialReflectionRunCost({
    provider: input.metadata.provider,
    providerModel: input.metadata.providerModel,
    usage: input.metadata.usage,
  });
  return {
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
    resultSchemaVersion: 'session_reflection_result.v5',
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
    modelConfig: LUNA_REFLECTION_MODEL_CONFIG.id,
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
