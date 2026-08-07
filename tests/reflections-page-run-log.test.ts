import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, test } from 'node:test';
import type { ReflectionPageController } from '../src/features/reflection/useReflectionPageController.ts';
import { TokenUsageView } from '../src/pages/ReflectionsPage.tsx';

describe('reflection run log presentation', () => {
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
        }),
        run({
          runId: 'succeeded',
          state: 'succeeded',
          failureCode: null,
          finishReason: 'stop',
          estimatedCostUsd: 0.000032,
          pricingAsOf: '2026-07-30',
        }),
      ]);

    assert.match(markup, /output truncated/);
    assert.match(markup, /finish: length/);
    assert.match(markup, /Cost estimate unavailable for this run/);
    assert.match(markup, /Rates as of 2026-07-30; price-v1/);
    assert.match(markup, /Cached/);
    assert.match(markup, /Retry failed reflection: output truncated/);
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
    assert.doesNotMatch(markup, /Retry failed reflection/);
  });
});

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
}): ReflectionPageController['generationRuns'][number] {
  return {
    runId: overrides.runId,
    sourceSessionId: 'session-1',
    reflectionFlowVersion: 'initial_post_session_reflection.v1',
    startedAt: '2026-07-29T12:00:00.000Z',
    completedAt: '2026-07-29T12:00:01.000Z',
    provider: 'openai',
    model: 'gpt-5.6-luna-high',
    providerModel: 'gpt-5.6-luna',
    promptVersion: 'reflection-v2',
    responseId: 'response-1',
    clientRequestId: null,
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
      outputTokens: 10,
      reasoningTokens: null,
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
