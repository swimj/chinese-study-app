import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type {
  ReflectionOperation,
  SessionReflectionBundleV1,
  SessionReflectionResultV4,
} from '../src/domain/reflection.ts';
import type {
  MaterializeReflectionArtifactInput,
  ReflectionArtifactDetail,
} from '../server/db/reflections.ts';
import { ReflectionEvidenceError } from '../server/reflection/evidence.ts';
import { createInitialReflectionGenerationService } from '../server/reflection/generation.ts';
import {
  LunaReflectionProviderError,
  type LunaReflectionSuccess,
} from '../server/reflection/luna-provider.ts';

const generatedAt = '2026-07-29T12:00:00.000Z';

describe('initial reflection generation orchestration', () => {
  test('returns a durable preexisting artifact without rebuilding evidence or calling Luna', async () => {
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
    });

    assert.deepEqual(await service.generate(' session-1 ', { ignored: true }), {
      artifactId: 'existing-artifact',
      proposalCount: 2,
      status: 'existing',
    });
    assert.equal(bundleCalls, 0);
    assert.equal(providerCalls, 0);
    assert.equal(materializeCalls, 0);
  });

  test('enriches, calls the configured provider, and persists provider metadata once', async () => {
    let persisted: MaterializeReflectionArtifactInput | null = null;
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
    });

    assert.deepEqual(await service.generate('session-1', { evidence: true }), {
      artifactId: 'created-artifact',
      proposalCount: 1,
      status: 'created',
    });
    assert.deepEqual(persisted, {
      sourceSessionId: 'session-1',
      reflectionFlowVersion: 'initial_post_session_reflection.v1',
      generatedAt,
      provider: 'openai',
      model: 'gpt-5.6-luna-high',
      promptVersion: 'reflection-v2',
      evidenceBundle,
      result: result(),
    });
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
});

function providerSuccess(): LunaReflectionSuccess {
  return {
    result: result(),
    metadata: {
      provider: 'openai',
      modelConfig: 'gpt-5.6-luna-high',
      providerModel: 'gpt-5.6-luna',
      promptVersion: 'reflection-v2',
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
    reflectionFlowVersion: 'initial_post_session_reflection.v1',
    generatedAt,
    provider: 'openai',
    model: 'gpt-5.6-luna-high',
    promptVersion: 'reflection-v2',
    bundleSchemaVersion: 'session_reflection_bundle.v1',
    resultSchemaVersion: 'session_reflection_result.v4',
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
  };
}

function bundle(): SessionReflectionBundleV1 {
  return {
    schemaVersion: 'session_reflection_bundle.v1',
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
      cuesAsShown: [{
        cueId: null,
        cueType: 'definition_gloss',
        displayOrder: 0,
        text: 'target',
        displayedMeanings: ['target'],
      }],
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

function result(): SessionReflectionResultV4 {
  return {
    schemaVersion: 'session_reflection_result.v4',
    itemResults: [{
      itemId: 'item-1',
      diagnosisTags: ['persistent_confusion'],
      observation: 'This production goal is not useful.',
      learnerExplanation: null,
      proposals: [{
        proposalGroupKey: null,
        rationale: 'Suppress this production goal.',
        operation: operation(),
      }],
      questions: [],
      unhandledNeeds: [],
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
