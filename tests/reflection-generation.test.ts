import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type {
  ReflectionOperation,
  SessionReflectionBundleV4,
  SessionReflectionResultV7,
} from '../src/domain/reflection.ts';
import type {
  MaterializeReflectionArtifactInput,
  RecordReflectionGenerationRunInput,
  ReflectionArtifactDetail,
  ReflectionGenerationContinuationRetrySource,
} from '../server/db/reflections.ts';
import { ReflectionEvidenceError } from '../server/reflection/evidence.ts';
import {
  createInitialReflectionGenerationService as createProductionReflectionGenerationService,
  RetiredReflectionSourceModelError,
  ReflectionSpendCapError,
  type InitialReflectionGenerationDependencies,
} from '../server/reflection/generation.ts';
import {
  LunaReflectionProviderError,
  type LunaReflectionSuccess,
} from '../server/reflection/luna-provider.ts';
import { createTestReflectionContinuationBoundaries } from './helpers/reflection-continuation.ts';

function createInitialReflectionGenerationService(
  dependencies: InitialReflectionGenerationDependencies,
) {
  const boundaries = createTestReflectionContinuationBoundaries();
  const suppliedRetrySource = dependencies.getContinuationRetrySource;
  return createProductionReflectionGenerationService({
    ...boundaries,
    startRun: () => {},
    ...dependencies,
    ...(suppliedRetrySource === undefined ? {} : {
      getContinuationRetrySource(runId: string) {
        const source = suppliedRetrySource(runId);
        if (source !== null) {
          boundaries.continuations.set(
            source.continuation.continuationId,
            source.continuation,
          );
        }
        return source;
      },
    }),
  });
}

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
    const { sourceRunId: _sourceRunId, continuationId, ...persistedWithoutRun } = persisted!;
    assert.equal(continuationId, 'test-continuation-1');
    const finalEvidence = {
      schemaVersion: 'session_reflection_bundle.v5' as const,
      generatedAt,
      session: evidenceBundle.session,
      items: evidenceBundle.items.map((item) => ({ ...item, promotionEvidence: null })),
    };
    assert.deepEqual(persistedWithoutRun, {
      sourceSessionId: 'session-1',
      reflectionFlowVersion: 'initial_post_session_reflection.v4',
      generatedAt,
      provider: 'openai',
      model: 'gpt-5.6-luna-high',
      promptVersion: 'reflection-staged-v2',
      evidenceBundle: finalEvidence,
      result: { ...result(), schemaVersion: 'session_reflection_result.v8' },
    });
    assert.match(recordedRun!.clientRequestId ?? '', /^[0-9a-f-]{36}$/);
    const { runId: _runId, clientRequestId: _clientRequestId, ...recordedRunWithoutId } = recordedRun!;
    assert.deepEqual(recordedRunWithoutId, {
      sourceSessionId: 'session-1',
      reflectionFlowVersion: 'initial_post_session_reflection.v4',
      startedAt: generatedAt,
      completedAt: generatedAt,
      provider: 'openai',
      model: 'gpt-5.6-luna-high',
      providerModel: 'gpt-5.6-luna',
      promptVersion: 'reflection-staged-v2',
      responseId: 'response-1',
      finishReason: 'stop',
      bundleSchemaVersion: 'session_reflection_bundle.v4',
      resultSchemaVersion: 'session_reflection_result.v7',
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

  test('records the selected provider hand-off before making the provider call', async () => {
    const evidenceBundle = bundle();
    let started: RecordReflectionGenerationRunInput | null = null;
    let providerRequestId: string | undefined;
    const service = createInitialReflectionGenerationService({
      now: () => generatedAt,
      buildBundle: () => evidenceBundle,
      startRun: (input) => { started = input as unknown as RecordReflectionGenerationRunInput; },
      provider: {
        async generate(_bundle, options) {
          providerRequestId = options?.clientRequestId;
          return providerSuccess();
        },
      },
      materializeArtifact: () => ({ created: true, artifact: artifactDetail('created-artifact', 0) }),
      recordRun: () => {},
    });

    await service.generate('session-1', { evidence: true });

    assert.equal(started?.sourceSessionId, 'session-1');
    assert.equal(started?.provider, 'openai');
    assert.equal(started?.model, 'gpt-5.6-luna-high');
    assert.equal(started?.evidenceBundle, evidenceBundle);
    assert.equal(started?.clientRequestId, providerRequestId);
    assert.match(providerRequestId ?? '', /^[0-9a-f-]{36}$/);
  });

  test('retries a current staged diagnosis run from its exact saved bundle', async () => {
    const evidenceBundle = bundle();
    let providerBundle: SessionReflectionBundleV4 | null = null;
    let recordedRun: RecordReflectionGenerationRunInput | null = null;
    const service = createInitialReflectionGenerationService({
      now: () => generatedAt,
      findExistingArtifact: () => null,
      getContinuationRetrySource: (runId) => {
        assert.equal(runId, 'failed-run');
        return currentDiagnosisRetrySource(runId, evidenceBundle, {
          eligibleItemCount: 3,
          includedItemCount: 1,
        });
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

  test('resumes saved diagnosis after final persistence failure without another call or false model provenance', async () => {
    const boundaries = createTestReflectionContinuationBoundaries();
    let providerCalls = 0;
    let materializeCalls = 0;
    let failedRunId = '';
    const persisted: MaterializeReflectionArtifactInput[] = [];
    const service = createProductionReflectionGenerationService({
      ...boundaries,
      now: () => generatedAt,
      random: () => 0,
      buildBundle: () => bundle(),
      startRun: () => {},
      provider: {
        async generate() {
          providerCalls += 1;
          return providerSuccess();
        },
      },
      glmProvider: {
        async generate() {
          throw new Error('saved diagnosis retry must not call the override provider');
        },
      },
      materializeArtifact(input) {
        materializeCalls += 1;
        persisted.push(input);
        if (materializeCalls === 1) throw new Error('artifact write failed');
        return { created: true, artifact: artifactDetail('resumed-artifact', 1) };
      },
      recordRun(input) {
        failedRunId = input.runId ?? '';
        assert.equal(input.state, 'failed');
        assert.equal(input.failureCode, 'internal_error');
        assert.deepEqual(input.usage, providerSuccess().metadata.usage);
      },
    });

    await assert.rejects(() => service.generate('session-1', {}), /artifact write failed/);
    assert.equal(providerCalls, 1);
    assert.match(failedRunId, /^[0-9a-f-]{36}$/);

    await service.retry(failedRunId, 'zai:glm-5.3-flash-max');
    assert.equal(providerCalls, 1);
    assert.equal(materializeCalls, 2);
    assert.equal(persisted[1]!.provider, 'openai');
    assert.equal(persisted[1]!.model, 'gpt-5.6-luna-high');
    assert.equal(persisted[1]!.promptVersion, 'reflection-staged-v2');
    assert.equal(persisted[1]!.sourceRunId, failedRunId);
  });

  test('retries only promotion from its exact saved input and honors the explicit model override', async () => {
    const boundaries = createTestReflectionContinuationBoundaries();
    const stageTwoBundles: unknown[] = [];
    const runRecords: RecordReflectionGenerationRunInput[] = [];
    let diagnosisCalls = 0;
    let failedPromotionRunId = '';
    const diagnosisSuccess: LunaReflectionSuccess = {
      ...providerSuccess(),
      result: {
        schemaVersion: 'session_reflection_result.v7',
        itemResults: [{
          itemId: 'item-1',
          diagnosisTags: ['production_cue_overloaded'],
          learnerExplanation: 'These words share this broad axis but retain different uses.',
          proposals: [],
          questions: [],
        }],
      },
    };
    const service = createProductionReflectionGenerationService({
      ...boundaries,
      now: () => generatedAt,
      buildBundle: () => bundle(true),
      startRun: () => {},
      provider: {
        async generateDiagnosis() {
          diagnosisCalls += 1;
          return diagnosisSuccess;
        },
        async generate() {
          throw new Error('staged generation must use the diagnosis entrypoint');
        },
        async generatePromotion(input) {
          stageTwoBundles.push(input);
          throw new LunaReflectionProviderError('upstream_failure');
        },
      },
      glmProvider: {
        async generate() {
          throw new Error('promotion retry must not rerun diagnosis');
        },
        async generatePromotion(input) {
          stageTwoBundles.push(input);
          return {
            result: {
              schemaVersion: 'pure_cue_promotion_result.v1',
              itemResults: input.items.map((item) => ({
                itemId: item.itemId,
                decision: { kind: 'no_promotion' as const, rationale: 'Keep the pair separate.' },
              })),
            },
            metadata: {
              ...providerSuccess().metadata,
              provider: 'zai',
              modelConfig: 'glm-5.3-flash-max',
              providerModel: 'glm-5.3-flash',
              promptVersion: 'pure-cue-promotion-v2',
            },
          };
        },
      },
      materializeArtifact: () => ({
        created: true,
        artifact: artifactDetail('stage-two-retry-artifact', 0),
      }),
      recordRun(input) {
        runRecords.push(input);
        if (input.state === 'failed') failedPromotionRunId = input.runId ?? '';
      },
    });

    await assert.rejects(
      () => service.generate('session-1', {}, 'openai:gpt-5.6-luna-high'),
      LunaReflectionProviderError,
    );
    assert.equal(diagnosisCalls, 1);
    assert.match(failedPromotionRunId, /^[0-9a-f-]{36}$/);
    await service.retry(failedPromotionRunId, 'zai:glm-5.3-flash-max');
    assert.equal(diagnosisCalls, 1);
    assert.equal(stageTwoBundles.length, 2);
    assert.equal(stageTwoBundles[1], stageTwoBundles[0]);
    assert.deepEqual(runRecords.map((run) => [run.state, run.model, run.resultSchemaVersion]), [
      ['succeeded', 'gpt-5.6-luna-high', 'session_reflection_result.v7'],
      ['failed', 'gpt-5.6-luna-high', 'pure_cue_promotion_result.v1'],
      ['succeeded', 'glm-5.3-flash-max', 'pure_cue_promotion_result.v1'],
    ]);
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

  test('retains the selected provider metadata when persistence fails after generation', async () => {
    let recordedRun: RecordReflectionGenerationRunInput | null = null;
    const glmSuccess: LunaReflectionSuccess = {
      ...providerSuccess(),
      metadata: {
        ...providerSuccess().metadata,
        provider: 'zai',
        modelConfig: 'glm-5.3-flash-max',
        providerModel: 'glm-5.3-flash',
      },
    };
    const service = createInitialReflectionGenerationService({
      now: () => generatedAt,
      getContinuationRetrySource: () => currentDiagnosisRetrySource('failed-run'),
      provider: { generate: async () => providerSuccess() },
      glmProvider: { generate: async () => glmSuccess },
      materializeArtifact: () => {
        throw new Error('persistence rejected the artifact');
      },
      recordRun: (input) => {
        recordedRun = input;
      },
    });

    await assert.rejects(
      () => service.retry('failed-run', 'zai:glm-5.3-flash-max'),
      /persistence rejected the artifact/,
    );
    assert.equal(recordedRun?.state, 'failed');
    assert.equal(recordedRun?.failureCode, 'internal_error');
    assert.equal(recordedRun?.provider, 'zai');
    assert.equal(recordedRun?.model, 'glm-5.3-flash-max');
    assert.equal(recordedRun?.providerModel, 'glm-5.3-flash');
    assert.equal(recordedRun?.responseId, 'response-1');
  });

  test('routes the initial run across offered comparison arms with equal probability', async () => {
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
      comparisonProviders: {
        'openrouter:gemini-3.6-flash': makeArm('gemini'),
        'openai:gpt-5.6-terra-high': makeArm('terra'),
      },
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
    assert.deepEqual(selected, ['luna', 'glm', 'terra']);
  });

  test('still routes an explicit request to a registered arm that is not offered by default', async () => {
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
      provider: makeArm('luna'),
      glmProvider: makeArm('glm'),
      comparisonProviders: {
        'openrouter:gemini-3.6-flash': makeArm('gemini'),
        'openai:gpt-5.6-terra-high': makeArm('terra'),
      },
      materializeArtifact: () => ({
        created: true,
        artifact: artifactDetail('explicit-gemini', 1),
      }),
      recordRun: () => {},
    });

    await service.generate('session-explicit', {}, 'openrouter:gemini-3.6-flash');
    assert.deepEqual(selected, ['gemini']);
  });

  test('refuses same-model retry when the stored model is registered but not currently offered', async () => {
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
      getContinuationRetrySource: (runId) => {
        assert.equal(runId, 'failed-gemini-run');
        return currentDiagnosisRetrySource(runId, bundle(), { model: 'gemini-3.6-flash' });
      },
      provider: makeArm('luna'),
      glmProvider: makeArm('glm'),
      comparisonProviders: {
        'openrouter:gemini-3.6-flash': makeArm('gemini'),
        'openai:gpt-5.6-terra-high': makeArm('terra'),
      },
      materializeArtifact: () => ({
        created: true,
        artifact: artifactDetail('artifact', 1),
      }),
      recordRun: () => {},
    });

    await assert.rejects(
      () => service.retry('failed-gemini-run'),
      (error: unknown) => (
        error instanceof RetiredReflectionSourceModelError
        && error.model === 'gemini-3.6-flash'
      ),
    );
    assert.deepEqual(selected, []);

    await service.retry('failed-gemini-run', 'openai:gpt-5.6-luna-high');
    assert.deepEqual(selected, ['luna']);
  });

  test('routes unselected initial generation to Luna after the daily spend cap', async () => {
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
      provider: makeArm('luna'),
      glmProvider: makeArm('glm'),
      comparisonProviders: {
        'openrouter:gemini-3.6-flash': makeArm('gemini'),
        'openai:gpt-5.6-terra-high': makeArm('terra'),
      },
      getSpendCap: () => cappedSpendCap(),
      random: () => 0.99,
      materializeArtifact: () => ({
        created: true,
        artifact: artifactDetail('capped-artifact', 1),
      }),
      recordRun: () => {},
    });

    assert.deepEqual(await service.generate('session-1', {}), {
      artifactId: 'capped-artifact',
      proposalCount: 1,
      status: 'created',
    });
    assert.deepEqual(selected, ['luna']);
  });

  test('refuses an explicit non-Luna choice after the daily spend cap', async () => {
    const selected: string[] = [];
    const service = createInitialReflectionGenerationService({
      findExistingArtifact: () => null,
      buildBundle: () => bundle(),
      provider: {
        async generate() {
          selected.push('luna');
          return providerSuccess();
        },
      },
      glmProvider: {
        async generate() {
          selected.push('glm');
          return providerSuccess();
        },
      },
      getSpendCap: () => cappedSpendCap(),
      materializeArtifact: () => ({
        created: true,
        artifact: artifactDetail('blocked-artifact', 1),
      }),
      recordRun: () => {},
    });

    await assert.rejects(
      () => service.generate('session-1', {}, 'zai:glm-5.3-flash-max'),
      ReflectionSpendCapError,
    );
    assert.deepEqual(selected, []);
  });

  test('allows explicit Luna after the daily spend cap', async () => {
    const selected: string[] = [];
    const service = createInitialReflectionGenerationService({
      findExistingArtifact: () => null,
      buildBundle: () => bundle(),
      provider: {
        async generate() {
          selected.push('luna');
          return providerSuccess();
        },
      },
      glmProvider: {
        async generate() {
          selected.push('glm');
          return providerSuccess();
        },
      },
      getSpendCap: () => cappedSpendCap(),
      getContinuationRetrySource: () => currentDiagnosisRetrySource('failed-run', bundle(), {
        provider: 'zai',
        model: 'glm-5.3-flash-max',
        providerModel: 'glm-5.3-flash',
      }),
      materializeArtifact: () => ({
        created: true,
        artifact: artifactDetail('luna-artifact', 1),
      }),
      recordRun: () => {},
    });

    await assert.rejects(() => service.retry('failed-run'), ReflectionSpendCapError);
    await service.generate('session-1', {}, 'openai:gpt-5.6-luna-high');
    await service.retry('failed-run', 'openai:gpt-5.6-luna-high');
    assert.deepEqual(selected, ['luna', 'luna']);
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
      getContinuationRetrySource: (runId) => {
        assert.equal(runId, 'failed-retired-run');
        return currentDiagnosisRetrySource(runId, bundle(), { model: 'qwen3.7-plus' });
      },
      provider: makeArm('luna'),
      glmProvider: makeArm('glm'),
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
      promptVersion: 'reflection-staged-v2',
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
    resultSchemaVersion: 'session_reflection_result.v7',
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
    helpInbox: [],
  };
}

function bundle(promotionCandidate = false): SessionReflectionBundleV4 {
  return {
    schemaVersion: 'session_reflection_bundle.v4',
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
        supplement: null,
      },
      rawResponse: promotionCandidate ? '替代' : '目标',
      submittedWord: {
        wordId: promotionCandidate ? 'alternate' : 'target',
        hanzi: promotionCandidate ? '替代' : '目标',
        pinyin: promotionCandidate ? 'tìdài' : 'mùbiāo',
        meanings: [promotionCandidate ? 'alternate' : 'target'],
      },
      responseKind: 'matched_known_word',
    }],
  };
}

function currentDiagnosisRetrySource(
  runId: string,
  diagnosisBundle = bundle(),
  overrides: Partial<Pick<
    ReflectionGenerationContinuationRetrySource,
    'provider' | 'model' | 'providerModel'
  >> & { eligibleItemCount?: number; includedItemCount?: number } = {},
): ReflectionGenerationContinuationRetrySource {
  return {
    runId,
    stage: 'diagnosis',
    provider: overrides.provider ?? 'openai',
    model: overrides.model ?? 'gpt-5.6-luna-high',
    providerModel: overrides.providerModel ?? 'gpt-5.6-luna',
    promptVersion: 'reflection-staged-v2',
    continuation: {
      continuationId: `continuation-${runId}`,
      sourceSessionId: 'session-1',
      reflectionFlowVersion: 'initial_post_session_reflection.v4',
      createdAt: generatedAt,
      eligibleItemCount: overrides.eligibleItemCount ?? 1,
      includedItemCount: overrides.includedItemCount ?? 1,
      diagnosisBundle,
      sourceProposalIds: null,
      diagnosisResult: null,
      finalEvidenceBundle: null,
      promotionBundle: null,
      artifactId: null,
    },
  };
}

function result(): SessionReflectionResultV7 {
  return {
    schemaVersion: 'session_reflection_result.v7',
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

function cappedSpendCap() {
  return {
    lunaOnly: true,
    spentUsd: 0.62,
    capUsd: 0.5,
    dayKey: '2026-07-29',
    resetsAt: '2026-07-30T00:00:00.000Z',
  };
}
