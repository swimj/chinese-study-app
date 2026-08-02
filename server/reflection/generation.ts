import type { SessionReflectionBundleV1 } from '../../src/domain/reflection.ts';
import {
  getReflectionArtifactBySessionAndFlow,
  INITIAL_REFLECTION_FLOW_VERSION,
  materializeReflectionArtifact,
  recordReflectionGenerationRun,
  type MaterializeReflectionArtifactResult,
  type RecordReflectionGenerationRunInput,
  type ReflectionArtifactDetail,
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
};

export type InitialReflectionGenerationDependencies = {
  provider?: LunaReflectionProvider;
  now?: () => string;
  buildBundle?: (
    sessionId: string,
    supplement: unknown,
    generatedAt: string,
  ) => SessionReflectionBundleV1;
  buildBundleWithMetrics?: (
    sessionId: string,
    supplement: unknown,
    generatedAt: string,
  ) => InitialReflectionBundleBuild;
  findExistingArtifact?: (
    sessionId: string,
    reflectionFlowVersion: string,
  ) => ReflectionArtifactDetail | null;
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
  const materializeArtifact = dependencies.materializeArtifact
    ?? materializeReflectionArtifact;
  const recordRun = dependencies.recordRun ?? recordReflectionGenerationRun;
  const lifecycleLogger = dependencies.lifecycleLogger;
  const inFlight = new Map<string, Promise<InitialReflectionGenerationResult>>();

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

      const generationKey = `${normalizedSessionId}\u0000${INITIAL_REFLECTION_FLOW_VERSION}`;
      const activeGeneration = inFlight.get(generationKey);
      if (activeGeneration) return activeGeneration;

      const generatedAt = now();
      const generation = generateAndMaterialize({
        sessionId: normalizedSessionId,
        evidenceSupplement,
        generatedAt,
        provider,
        buildBundleWithMetrics,
        materializeArtifact,
        recordRun,
        now,
        lifecycleLogger,
      });
      inFlight.set(generationKey, generation);

      try {
        return await generation;
      } finally {
        if (inFlight.get(generationKey) === generation) {
          inFlight.delete(generationKey);
        }
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
        eligibleItemCount: builtBundle.eligibleItemCount,
        includedItemCount: builtBundle.includedItemCount,
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
          eligibleItemCount: builtBundle.eligibleItemCount,
          includedItemCount: builtBundle.includedItemCount,
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
  eligibleItemCount: number;
  includedItemCount: number;
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
    finishReason: input.metadata.finishReason,
    state: input.state,
    failureCode: input.failureCode,
    eligibleItemCount: input.eligibleItemCount,
    includedItemCount: input.includedItemCount,
    usage: input.metadata.usage,
    pricingSnapshotId: estimate?.pricing.id ?? null,
    pricingAsOf: estimate?.pricing.pricingAsOf ?? null,
    pricingBasis: estimate?.pricing ?? null,
    estimatedCostUsd: estimate?.estimatedCostUsd ?? null,
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
