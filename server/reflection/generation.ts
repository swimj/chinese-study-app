import type { SessionReflectionBundleV1 } from '../../src/domain/reflection.ts';
import {
  getReflectionArtifactBySessionAndFlow,
  INITIAL_REFLECTION_FLOW_VERSION,
  materializeReflectionArtifact,
  type MaterializeReflectionArtifactResult,
  type ReflectionArtifactDetail,
} from '../db/reflections.ts';
import {
  buildInitialReflectionBundle,
  ReflectionEvidenceError,
} from './evidence.ts';
import {
  createLunaReflectionProvider,
  type LunaReflectionProvider,
} from './luna-provider.ts';

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
  findExistingArtifact?: (
    sessionId: string,
    reflectionFlowVersion: string,
  ) => ReflectionArtifactDetail | null;
  materializeArtifact?: typeof materializeReflectionArtifact;
};

/**
 * Creates one local generation coordinator. Concurrent requests for the same
 * session and flow share the same provider call, while the durable
 * session/flow key remains the final idempotency boundary.
 */
export function createInitialReflectionGenerationService(
  dependencies: InitialReflectionGenerationDependencies = {},
): InitialReflectionGenerationService {
  const provider = dependencies.provider ?? createLunaReflectionProvider();
  const now = dependencies.now ?? (() => new Date().toISOString());
  const buildBundle = dependencies.buildBundle ?? buildInitialReflectionBundle;
  const findExistingArtifact = dependencies.findExistingArtifact
    ?? getReflectionArtifactBySessionAndFlow;
  const materializeArtifact = dependencies.materializeArtifact
    ?? materializeReflectionArtifact;
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
        buildBundle,
        materializeArtifact,
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
  buildBundle: NonNullable<InitialReflectionGenerationDependencies['buildBundle']>;
  materializeArtifact: NonNullable<
    InitialReflectionGenerationDependencies['materializeArtifact']
  >;
}): Promise<InitialReflectionGenerationResult> {
  const bundle = input.buildBundle(
    input.sessionId,
    input.evidenceSupplement,
    input.generatedAt,
  );
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
  return generationResult(materialized.created, materialized.artifact);
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
