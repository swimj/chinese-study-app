import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type {
  ReflectionOperation,
  SessionReflectionBundleV2,
  SessionReflectionResultV6,
} from '../src/domain/reflection.ts';
import type {
  MaterializeReflectionArtifactInput,
  RecordReflectionGenerationRunInput,
  ReflectionArtifactDetail,
} from '../server/db/reflections.ts';
import { ReflectionEvidenceError } from '../server/reflection/evidence.ts';
import { createInitialReflectionGenerationService, RetiredReflectionSourceModelError } from '../server/reflection/generation.ts';
import {
  LunaReflectionProviderError,
  type LunaReflectionSuccess,
} from '../server/reflection/luna-provider.ts';

const generatedAt = '2026-07-29T12:00:00.000Z';

describe('initial reflection generation orchestration', () => {
  test('creates a new candidate even when a prior artifact exists for the session and flow', async () => {
    let bundleCalls = 0;
    let providerCalls = 0;
    let materializeCalls = 0;
    const service = createInitialReflectionGenerationService({
      findExistingArtifact: () => artifactDetail('existing-artifact', 2),
      buildBundle: () => {
        bundleCalls += 1;
        return bundle();
      },
      provider: {
        async generate() {
          providerCalls += 1;
          return providerSuccess();
        },
      },
      materializeArtifact: () => {
        materializeCalls += 1;
        return {
          created: true,
          artifact: artifactDetail('unexpected-artifact', 0),
        };
      },
      recordRun: () => {},
    });

    assert.deepEqual(await service.generate(' session-1 ', { ignored: true }), {
      artifactId: 'unexpected-artifact',
      proposalCount: 0,
      status: 'created',
    });
    assert.equal(bundleCalls, 1);
    assert.equal(providerCalls, 1);
    assert.equal(materializeCalls, 1);
  });

  test('enriches, calls the configured provider, and persists provider metadata once', async () => {
    let persisted: MaterializeReflectionArtifactInput | null = null;
    let recordedRun: RecordReflectionGenerationRunInput | null = null;
    const evidenceBundle = bundle();
    const service = createInitialReflectionGenerationService({
      now: () => generatedAt,
      findExistingArtifact: () => null,
      buildBundle: (sessionId, supplement, at) => {
        assert.equal(sessionId, 'session-1');
        assert.deepEqual(supplement, { evidence: true });
        assert.equal(at, generatedAt);
        return evidenceBundle;
      },
      provider: { generate: async () => providerSuccess() },
      materializeArtifact: (input) => {
        persisted = input;
        return {
          created: true,
          artifact: artifactDetail('created-artifact', 1),
        };
      },
      recordRun: (input) => {
        recordedRun = input;
      },
    });

    assert.deepEqual(await service.generate('session-1', { evidence: true }), {
      artifactId: 'created-artifact',
      proposalCount: 1,
      status: 'created',
    });
    assert.equal(persisted?.sourceRunId !== undefined, true);
    assert.equal(persisted?.sourceRunId, recordedRun?.runId);
    const { sourceRunId: _sourceRunId, ...persistedWithoutRun } = persisted!;
    assert.deepEqual(persistedWithoutRun, {
      sourceSessionId: 'session-1',
      reflectionFlowVersion: 'initial_post_session_reflection.v2',
      generatedAt,
      provider: 'openai',
      model: 'gpt-5.6-luna-high',
      promptVersion: 'reflection-v3',
      evidenceBundle,
      result: result(),
    });
    const { runId: _runId, ...recordedRunWithoutId } = recordedRun!;
    assert.deepEqual(recordedRunWithoutId, {
      sourceSessionId: 'session-1',
      reflectionFlowVersion: 'initial_post_session_reflection.v2',
      startedAt: generatedAt,
      completedAt: generatedAt,
      provider: 'openai',
      model: 'gpt-5.6-luna-high',
      providerModel: 'gpt-5.6-luna',
      promptVersion: 'reflection-v3',
      responseId: 'response-1',
      clientRequestId: null,
      finishReason: 'stop',
      bundleSchemaVersion: 'session_reflection_bundle.v2',
      resultSchemaVersion: 'session_reflection_result.v6',
      diagnostic: null,
      state: 'succeeded',
      failureCode: null,
      eligibleItemCount: 1,
      includedItemCount: 1,
      usage: {
        inputTokens: 10,
        cachedInputTokens: null,
        cacheWriteInputTokens: null,
        outputTokens: 5,
        reasoningTokens: 2,
        totalTokens: 15,
      },
      pricingSnapshotId: 'openai-gpt-5.6-luna-standard-short-context-2026-07-30',
      pricingAsOf: '2026-07-30',
      pricingBasis: {
        id: 'openai-gpt-5.6-luna-standard-short-context-2026-07-30',
        pricingAsOf: '2026-07-30',
        provider: 'openai',
        providerModel: 'gpt-5.6-luna',
        serviceTier: 'standard',
        contextBand: 'short',
        currency: 'USD',
        inputPerMillionUsd: 0.2,
        cachedInputPerMillionUsd: 0.02,
        cacheWriteInputPerMillionUsd: 0.25,
        outputPerMillionUsd: 1.2,
      },
      estimatedCostUsd: 0.000008,
      evidenceBundle,
    });
  });

  test('retries a failed durable run from its exact saved bundle', async () => {
    const evidenceBundle = bundle();
    let providerBundle: SessionReflectionBundleV2 | null = null;
    let recordedRun: RecordReflectionGenerationRunInput | null = null;
    const service = createInitialReflectionGenerationService({
      now: () => generatedAt,
      findExistingArtifact: () => null,
      getRetrySource: (runId) => {
        assert.equal(runId, 'failed-run');
        return {
          runId,
          sourceSessionId: 'session-1',
          reflectionFlowVersion: 'initial_post_session_reflection.v2',
          model: 'gpt-5.6-luna-high',
          eligibleItemCount: 3,
          includedItemCount: 1,
          evidenceBundle,
        };
      },
      provider: {
        async generate(input) {
          providerBundle = input;
          return providerSuccess();
        },
      },
      materializeArtifact: () => ({
        created: true,
        artifact: artifactDetail('retried-artifact', 1),
      }),
      recordRun: (input) => {
        recordedRun = input;
      },
    });

    assert.deepEqual(await service.retry('failed-run'), {
      artifactId: 'retried-artifact',
      proposalCount: 1,
      status: 'created',
    });
    assert.equal(providerBundle, evidenceBundle);
    assert.deepEqual(recordedRun?.evidenceBundle, evidenceBundle);
    assert.equal(recordedRun?.eligibleItemCount, 3);
    assert.equal(recordedRun?.includedItemCount, 1);
  });

  test('coalesces concurrent generation by normalized session and flow key', async () => {
    let providerCalls = 0;
    let materializeCalls = 0;
    let releaseProvider: (success: LunaReflectionSuccess) => void = () => {
      throw new Error('Provider release was not initialized.');
    };
    const waitingProvider = new Promise<LunaReflectionSuccess>((resolve) => {
      releaseProvider = resolve;
    });
    const service = createInitialReflectionGenerationService({
      now: () => generatedAt,
      findExistingArtifact: () => null,
      buildBundle: () => bundle(),
      provider: {
        async generate() {
          providerCalls += 1;
          return waitingProvider;
        },
      },
      materializeArtifact: () => {
        materializeCalls += 1;
        return {
          created: true,
          artifact: artifactDetail('coalesced-artifact', 1),
        };
      },
      recordRun: () => {},
    });

    const first = service.generate('session-1', { first: true });
    const second = service.generate(' session-1 ', { second: true });
    assert.equal(providerCalls, 1);
    releaseProvider(providerSuccess());

    assert.deepEqual(await Promise.all([first, second]), [
      {
        artifactId: 'coalesced-artifact',
        proposalCount: 1,
        status: 'created',
      },
      {
        artifactId: 'coalesced-artifact',
        proposalCount: 1,
        status: 'created',
      },
    ]);
    assert.equal(materializeCalls, 1);
  });

  test('leaves no artifact on evidence or provider failure and permits retry', async () => {
    let providerCalls = 0;
    let materializeCalls = 0;
    const evidenceFailureService = createInitialReflectionGenerationService({
      findExistingArtifact: () => null,
      buildBundle: () => {
        throw new ReflectionEvidenceError(
          'session_not_completed',
          'The study session is incomplete.',
        );
      },
      provider: {
        async generate() {
          providerCalls += 1;
          return providerSuccess();
        },
      },
      materializeArtifact: () => {
        materializeCalls += 1;
        throw new Error('must not materialize');
      },
      recordRun: () => {},
    });
    await assert.rejects(
      evidenceFailureService.generate('session-1', {}),
      (error: unknown) => (
        error instanceof ReflectionEvidenceError
        && error.code === 'session_not_completed'
      ),
    );
    assert.equal(providerCalls, 0);
    assert.equal(materializeCalls, 0);

    let failProvider = true;
    const providerFailureService = createInitialReflectionGenerationService({
      findExistingArtifact: () => null,
      buildBundle: () => bundle(),
      provider: {
        async generate() {
          providerCalls += 1;
          if (failProvider) {
            failProvider = false;
            throw new LunaReflectionProviderError('upstream_failure');
          }
          return providerSuccess();
        },
      },
      materializeArtifact: () => {
        materializeCalls += 1;
        return {
          created: true,
          artifact: artifactDetail('retry-artifact', 1),
        };
      },
      recordRun: () => {},
    });
    await assert.rejects(
      providerFailureService.generate('session-1', {}),
      (error: unknown) => (
        error instanceof LunaReflectionProviderError
        && error.code === 'upstream_failure'
      ),
    );
    assert.equal(materializeCalls, 0);
    assert.deepEqual(await providerFailureService.generate('session-1', {}), {
      artifactId: 'retry-artifact',
      proposalCount: 1,
      status: 'created',
    });
    assert.equal(providerCalls, 2);
    assert.equal(materializeCalls, 1);
  });

  test('routes the initial run across three comparison arms with equal probability', async () => {
    const selected: string[] = [];
    const makeArm = (label: string) => ({
      async generate() {
        selected.push(label);
        return providerSuccess();
      },
    });
    let randomCalls = 0;
    const service = createInitialReflectionGenerationService({
      findExistingArtifact: () => null,
      buildBundle: () => bundle(),
      provider: makeArm('luna'),
      glmProvider: makeArm('glm'),
      qwen38MaxProvider: makeArm('qwen38'),
      random: () => {
        const values = [0, 0.4, 0.8];
        return values[randomCalls++]!;
      },
      materializeArtifact: () => ({
        created: true,
        artifact: artifactDetail('routed-artifact', 1),
      }),
      recordRun: () => {},
    });

    for (let index = 0; index < 3; index += 1) {
      await service.generate(`session-${index}`, {});
    }
    assert.deepEqual(selected, ['luna', 'glm', 'qwen38']);
  });

  test('refuses same-model retry when the stored model is no longer a current choice', async () => {
    const selected: string[] = [];
    const makeArm = (label: string) => ({
      async generate() {
        selected.push(label);
        return providerSuccess();
      },
    });
    const service = createInitialReflectionGenerationService({
      findExistingArtifact: () => null,
      buildBundle: () => bundle(),
      getRetrySource: (runId) => {
        assert.equal(runId, 'failed-retired-run');
        return {
          runId,
          sourceSessionId: 'session-1',
          reflectionFlowVersion: 'initial_post_session_reflection.v2',
          model: 'qwen3.7-plus',
          eligibleItemCount: 1,
          includedItemCount: 1,
          evidenceBundle: bundle(),
        };
      },
      provider: makeArm('luna'),
      glmProvider: makeArm('glm'),
      qwen38MaxProvider: makeArm('qwen38'),
      materializeArtifact: () => ({
        created: true,
        artifact: artifactDetail('artifact', 1),
      }),
      recordRun: () => {},
    });

    await assert.rejects(
      () => service.retry('failed-retired-run'),
      (error: unknown) => (
        error instanceof RetiredReflectionSourceModelError
        && error.model === 'qwen3.7-plus'
        && error.message === 'The source run\'s model (qwen3.7-plus) is no longer available. Choose a current model.'
      ),
    );
    assert.deepEqual(selected, []);

    await service.retry('failed-retired-run', 'openai:gpt-5.6-luna-high');
    assert.deepEqual(selected, ['luna']);
  });
});

function providerSuccess(): LunaReflectionSuccess {
  return {
    result: result(),
    metadata: {
      provider: 'openai',
      modelConfig: 'gpt-5.6-luna-high',
      providerModel: 'gpt-5.6-luna',
      promptVersion: 'reflection-v3',
      responseId: 'response-1',
      finishReason: 'stop',
      usage: {
        inputTokens: 10,
        cachedInputTokens: null,
        cacheWriteInputTokens: null,
        outputTokens: 5,
        reasoningTokens: 2,
        totalTokens: 15,
      },
    },
  };
}

function artifactDetail(artifactId: string, proposalCount: number): ReflectionArtifactDetail {
  return {
    artifactId,
    sourceSessionId: 'session-1',
    reflectionFlowVersion: 'initial_post_session_reflection.v2',
    generatedAt,
    provider: 'openai',
    model: 'gpt-5.6-luna-high',
    promptVersion: 'reflection-v3',
    bundleSchemaVersion: 'session_reflection_bundle.v2',
    resultSchemaVersion: 'session_reflection_result.v6',
    evidenceBundle: bundle(),
    result: result(),
    proposals: Array.from({ length: proposalCount }, (_, index) => ({
      itemId: 'item-1',
      proposalIndex: index,
      proposal: {
        proposalGroupKey: null,
        rationale: 'Suppress this production goal.',
        operation: operation(),
      },
      review: {
        proposalId: `proposal-${index}`,
        updatedAt: generatedAt,
        disposition: { kind: 'pending' },
      },
      invocation: null,
    })),
    qualityItemTags: [],
  };
}

function bundle(): SessionReflectionBundleV2 {
  return {
    schemaVersion: 'session_reflection_bundle.v2',
    generatedAt,
    session: {
      sessionId: 'session-1',
      startedAt: '2026-07-29T11:30:00.000Z',
      endedAt: generatedAt,
      studyProfile: 'mandarin',
    },
    items: [{
      itemId: 'item-1',
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
    }],
  };
}

function result(): SessionReflectionResultV6 {
  return {
    schemaVersion: 'session_reflection_result.v6',
    itemResults: [{
      itemId: 'item-1',
      diagnosisTags: ['persistent_confusion'],
      learnerExplanation: 'This production goal is not useful as an isolated task.',
      proposals: [{
        proposalGroupKey: null,
        rationale: 'Suppress this production goal.',
        operation: operation(),
      }],
      questions: [],
    }],
  };
}

function operation(): ReflectionOperation {
  return {
    kind: 'suppress_definition_production',
    version: 1,
    wordId: 'target',
  };
}
