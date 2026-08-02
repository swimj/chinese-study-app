import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { estimateInitialReflectionRunCost } from '../server/reflection/run-pricing.ts';

const completeUsage = {
  inputTokens: 1_000_000,
  cachedInputTokens: 400_000,
  cacheWriteInputTokens: 200_000,
  outputTokens: 200_000,
  reasoningTokens: 150_000,
  totalTokens: 1_200_000,
};

describe('initial reflection run pricing', () => {
  test('prices each normalized token category from the pinned July 30 snapshot', () => {
    const estimate = estimateInitialReflectionRunCost({
      provider: 'openai',
      providerModel: 'gpt-5.6-luna',
      usage: completeUsage,
    });

    assert.deepEqual(estimate, {
      estimatedCostUsd: 0.418,
      pricing: {
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
    });
  });

  test('treats absent cache categories as zero but leaves incomplete or unknown pricing unavailable', () => {
    assert.deepEqual(estimateInitialReflectionRunCost({
      provider: 'openai',
      providerModel: 'gpt-5.6-luna',
      usage: {
        inputTokens: 100,
        cachedInputTokens: null,
        cacheWriteInputTokens: null,
        outputTokens: 10,
        reasoningTokens: null,
        totalTokens: 110,
      },
    })?.estimatedCostUsd, 0.000032);

    for (const usage of [
      { ...completeUsage, inputTokens: null },
      { ...completeUsage, outputTokens: null },
      { ...completeUsage, cachedInputTokens: 1_000_001 },
    ]) {
      assert.equal(estimateInitialReflectionRunCost({
        provider: 'openai',
        providerModel: 'gpt-5.6-luna',
        usage,
      }), null);
    }
    assert.equal(estimateInitialReflectionRunCost({
      provider: 'other',
      providerModel: 'gpt-5.6-luna',
      usage: completeUsage,
    }), null);
    assert.equal(estimateInitialReflectionRunCost({
      provider: 'openai',
      providerModel: 'unknown-model',
      usage: completeUsage,
    }), null);
  });
});
