import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, test } from 'node:test';
import type { SessionReflectionBundleV1, SessionReflectionResultV4 } from '../src/domain/reflection.ts';
import type { ReflectionPageController } from '../src/features/reflection/useReflectionPageController.ts';
import { ReflectionsPage, TokenUsageView } from '../src/pages/ReflectionsPage.tsx';
import type { ReflectionArtifactDetailDto } from '../src/services/api.ts';

describe('reflection run log presentation', () => {
  test('keeps the page available when every stored artifact is unreadable', () => {
    const artifactId = 'unreadable-artifact';
    const controller: ReflectionPageController = {
      isLoading: false,
      openArtifacts: [unreadableArtifact(artifactId)],
      recentArtifacts: [unreadableArtifact(artifactId)],
      artifactDetails: [],
      unreadableArtifactIds: new Set([artifactId]),
      generationRuns: [],
      qualityStats: { arms: [] },
      selectedArtifact: null,
      selectedArtifactId: null,
      submittingProposalId: null,
      withdrawingInvocationId: null,
      submittingQualityItemKey: null,
      submittingHelpInboxItemKey: null,
      generationRetryStatus: null,
      openPage: async () => {},
      refresh: async () => {},
      selectArtifact: async () => {},
      retryGenerationRun: async () => {},
      deferProposal: async () => {},
      dismissProposal: async () => {},
      acceptProposal: async () => {},
      replaceProposal: async () => {},
      withdrawAuthorization: async () => {},
      upsertQuality: async () => {},
      clearQuality: async () => {},
      markHelpInboxDone: async () => {},
      authorizeManualOperation: async () => {},
    };

    const markup = renderToStaticMarkup(createElement(ReflectionsPage, { controller }));
    assert.match(markup, /1 stored reflection could not be read/);
    assert.match(markup, /No remaining session help to review/);
    assert.match(markup, /reflection-view-rail/);
    assert.match(markup, />Help</);
    assert.match(markup, />Deferred</);
    assert.doesNotMatch(markup, />Pending</);
    assert.doesNotMatch(markup, /Review the help you asked for/);
  });

  test('explanation-only Help keeps the proposal toolbar and maps Accept to Done', () => {
    const markup = renderToStaticMarkup(createElement(ReflectionsPage, {
      controller: idleController({
        artifactDetails: [explanationArtifact()],
      }),
    }));
    assert.match(markup, /aria-label="Handle"/);
    assert.doesNotMatch(markup, /disabled=""[^>]*aria-label="Handle"/);
    assert.match(markup, /disabled=""[^>]*>Reset</);
    assert.match(markup, /disabled=""[^>]*>Defer</);
    assert.match(markup, /disabled=""[^>]*>Dismiss</);
    assert.match(markup, />Accept</);
    assert.doesNotMatch(markup, />Done</);
    assert.doesNotMatch(markup, /disabled=""[^>]*>Accept</);
  });

  test('renders the empty dogfood state', () => {
    const markup = renderRuns([]);

    assert.match(markup, /No reflection generation attempts yet/);
  });

  test('renders failed usage with unavailable cost and successful priced usage', () => {
    const markup = renderRuns([
        run({
          runId: 'failed',
          state: 'failed',
          failureCode: 'output_truncated',
          finishReason: 'length',
          estimatedCostUsd: null,
          pricingAsOf: null,
          startedAt: '2026-07-29T12:00:00.000Z',
          completedAt: '2026-07-29T12:00:00.250Z',
          responseId: 'response-should-hide',
          clientRequestId: 'client-should-hide',
          outputTokens: 40,
          reasoningTokens: 15,
        }),
        run({
          runId: 'succeeded',
          state: 'succeeded',
          failureCode: null,
          finishReason: 'stop',
          estimatedCostUsd: 0.000032,
          pricingAsOf: '2026-07-30',
          startedAt: '2026-07-29T12:00:00.000Z',
          completedAt: '2026-07-29T12:02:03.000Z',
          outputTokens: 40,
          reasoningTokens: 15,
        }),
      ]);

    assert.match(markup, /output truncated/);
    assert.match(markup, /finish: length/);
    assert.match(markup, /Cost estimate unavailable for this run/);
    assert.match(markup, /Rates as of 2026-07-30; price-v1/);
    assert.match(markup, /Cached/);
    assert.match(markup, /Duration/);
    assert.match(markup, /Visible/);
    assert.match(markup, /0m 01s/);
    assert.match(markup, /2m 03s/);
    assert.match(markup, />25</);
    assert.match(markup, /bundle session_reflection_bundle\.v1/);
    assert.match(markup, /result session_reflection_result\.v4/);
    assert.doesNotMatch(markup, /Cache write/);
    assert.doesNotMatch(markup, />Total</);
    assert.doesNotMatch(markup, /response /);
    assert.doesNotMatch(markup, /provider run /);
    assert.doesNotMatch(markup, /Token usage summary/);
    assert.doesNotMatch(markup, /Estimated cost/);
    assert.match(markup, /Retry reflection: output truncated\. Choose a model\./);
    assert.doesNotMatch(markup, /<select/);
    assert.doesNotMatch(markup, /Choose model for reflection retry/);
  });

  test('replaces retry with a concise generation status', () => {
    const runs = [run({
      runId: 'failed',
      state: 'failed',
      failureCode: 'upstream_failure',
      finishReason: null,
      estimatedCostUsd: null,
      pricingAsOf: null,
    })];
    const markup = renderRuns(runs, { runId: 'failed', state: 'generating' });
    assert.match(markup, /Generating…/);
    assert.doesNotMatch(markup, /Retry reflection/);
  });
});

function unreadableArtifact(
  artifactId: string,
): ReflectionPageController['recentArtifacts'][number] {
  return {
    artifactId,
    sourceSessionId: 'session-1',
    reflectionFlowVersion: 'initial_post_session_reflection.v1',
    generatedAt: '2026-07-29T12:00:00.000Z',
    provider: 'openai',
    model: 'gpt-5.6-luna-high',
    promptVersion: 'reflection-v3',
    bundleSchemaVersion: 'session_reflection_bundle.v2',
    resultSchemaVersion: 'session_reflection_result.v5',
    proposalCount: 1,
    openProposalCount: 1,
    readState: 'unreadable',
    itemCount: null,
  };
}

function idleController(
  overrides: Partial<ReflectionPageController> = {},
): ReflectionPageController {
  return {
    isLoading: false,
    openArtifacts: [],
    recentArtifacts: [],
    artifactDetails: [],
    unreadableArtifactIds: new Set(),
    generationRuns: [],
    qualityStats: { arms: [] },
    selectedArtifact: null,
    selectedArtifactId: null,
    submittingProposalId: null,
    withdrawingInvocationId: null,
    submittingQualityItemKey: null,
    submittingHelpInboxItemKey: null,
    generationRetryStatus: null,
    openPage: async () => {},
    refresh: async () => {},
    selectArtifact: async () => {},
    retryGenerationRun: async () => {},
    deferProposal: async () => {},
    dismissProposal: async () => {},
    acceptProposal: async () => {},
    replaceProposal: async () => {},
    withdrawAuthorization: async () => {},
    upsertQuality: async () => {},
    clearQuality: async () => {},
    markHelpInboxDone: async () => {},
    authorizeManualOperation: async () => {},
    ...overrides,
  };
}

function explanationArtifact(): ReflectionArtifactDetailDto {
  const generatedAt = '2026-07-29T12:00:00.000Z';
  const evidenceBundle: SessionReflectionBundleV1 = {
    schemaVersion: 'session_reflection_bundle.v1',
    generatedAt,
    session: {
      sessionId: 'session',
      startedAt: generatedAt,
      endedAt: generatedAt,
      studyProfile: 'mandarin',
    },
    items: [{
      itemId: 'informational',
      source: 'production_mistake',
      sourceActionKind: 'production',
      sessionActionId: 'action-informational',
      occurredAt: '2026-07-29T11:45:00.000Z',
      targetWord: {
        wordId: 'target',
        hanzi: '目标',
        pinyin: 'pinyin',
        meanings: ['meaning'],
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
        pinyin: 'pinyin',
        meanings: ['meaning'],
      },
      responseKind: 'matched_known_word',
    }],
  };
  const result: SessionReflectionResultV4 = {
    schemaVersion: 'session_reflection_result.v4',
    itemResults: [{
      itemId: 'informational',
      diagnosisTags: ['ordinary_retrieval_noise'],
      observation: 'Keep going.',
      learnerExplanation: 'Keep going.',
      proposals: [],
      questions: [],
      unhandledNeeds: [],
    }],
  };
  return {
    artifactId: 'artifact',
    sourceSessionId: 'session',
    sourceRunId: null,
    reflectionFlowVersion: 'initial_post_session_reflection.v1',
    generatedAt,
    provider: 'openai-compatible',
    model: 'gpt-5.6-luna',
    promptVersion: 'reflection-v2',
    bundleSchemaVersion: evidenceBundle.schemaVersion,
    resultSchemaVersion: result.schemaVersion,
    evidenceBundle,
    result,
    proposals: [],
    qualityItemTags: [],
    helpInbox: [{
      inboxId: 'inbox-informational',
      artifactId: 'artifact',
      itemId: 'informational',
      openedAt: generatedAt,
    }],
  };
}

function renderRuns(
  runs: ReflectionPageController['generationRuns'],
  retryStatus: ReflectionPageController['generationRetryStatus'] = null,
): string {
  return renderToStaticMarkup(createElement(TokenUsageView, {
    runs,
    retryStatus,
    onRetry: async () => {},
  }));
}

function run(overrides: {
  runId: string;
  state: 'succeeded' | 'failed';
  failureCode: string | null;
  finishReason: string | null;
  estimatedCostUsd: number | null;
  pricingAsOf: string | null;
  startedAt?: string;
  completedAt?: string;
  responseId?: string | null;
  clientRequestId?: string | null;
  outputTokens?: number | null;
  reasoningTokens?: number | null;
}): ReflectionPageController['generationRuns'][number] {
  return {
    runId: overrides.runId,
    sourceSessionId: 'session-1',
    reflectionFlowVersion: 'initial_post_session_reflection.v1',
    startedAt: overrides.startedAt ?? '2026-07-29T12:00:00.000Z',
    completedAt: overrides.completedAt ?? '2026-07-29T12:00:01.000Z',
    provider: 'openai',
    model: 'gpt-5.6-luna-high',
    providerModel: 'gpt-5.6-luna',
    promptVersion: 'reflection-v2',
    responseId: overrides.responseId === undefined ? 'response-1' : overrides.responseId,
    clientRequestId: overrides.clientRequestId === undefined ? null : overrides.clientRequestId,
    finishReason: overrides.finishReason,
    bundleSchemaVersion: 'session_reflection_bundle.v1',
    resultSchemaVersion: 'session_reflection_result.v4',
    state: overrides.state,
    failureCode: overrides.failureCode,
    eligibleItemCount: 3,
    includedItemCount: 2,
    usage: {
      inputTokens: 100,
      cachedInputTokens: null,
      cacheWriteInputTokens: null,
      outputTokens: overrides.outputTokens === undefined ? 10 : overrides.outputTokens,
      reasoningTokens: overrides.reasoningTokens === undefined ? null : overrides.reasoningTokens,
      totalTokens: 110,
    },
    pricingSnapshotId: overrides.estimatedCostUsd === null ? null : 'price-v1',
    pricingAsOf: overrides.pricingAsOf,
    pricingBasis: overrides.estimatedCostUsd === null ? null : { id: 'price-v1' },
    estimatedCostUsd: overrides.estimatedCostUsd,
    diagnostic: null,
    retryable: overrides.state === 'failed',
  };
}
