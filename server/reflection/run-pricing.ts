import type { NormalizedTokenUsage } from '../llm/types.ts';

export type ReflectionRunPricingSnapshot = {
  id: string;
  pricingAsOf: string;
  provider: 'openai';
  providerModel: 'gpt-5.6-luna';
  serviceTier: 'standard';
  contextBand: 'short';
  currency: 'USD';
  inputPerMillionUsd: number;
  cachedInputPerMillionUsd: number;
  cacheWriteInputPerMillionUsd: number;
  outputPerMillionUsd: number;
};

/**
 * A fixed dogfood estimate, not a billing integration. Keep the exact price
 * basis beside every persisted estimate so later price-table changes do not
 * rewrite historical cost intuition.
 */
export const INITIAL_LUNA_STANDARD_SHORT_CONTEXT_PRICING: ReflectionRunPricingSnapshot = {
  id: 'openai-gpt-5.6-luna-standard-short-context-2026-07-30',
  pricingAsOf: '2026-07-30',
  provider: 'openai',
  providerModel: 'gpt-5.6-luna',
  serviceTier: 'standard',
  contextBand: 'short',
  currency: 'USD',
  inputPerMillionUsd: 0.20,
  cachedInputPerMillionUsd: 0.02,
  cacheWriteInputPerMillionUsd: 0.25,
  outputPerMillionUsd: 1.20,
};

export type ReflectionRunCostEstimate = {
  estimatedCostUsd: number;
  pricing: ReflectionRunPricingSnapshot;
};

export function estimateInitialReflectionRunCost(input: {
  provider: string;
  providerModel: string;
  usage: NormalizedTokenUsage;
}): ReflectionRunCostEstimate | null {
  const pricing = INITIAL_LUNA_STANDARD_SHORT_CONTEXT_PRICING;
  if (
    input.provider !== pricing.provider
    || input.providerModel !== pricing.providerModel
    || input.usage.inputTokens === null
    || input.usage.outputTokens === null
  ) {
    return null;
  }

  const cachedInputTokens = input.usage.cachedInputTokens ?? 0;
  if (cachedInputTokens > input.usage.inputTokens) return null;

  const cacheWriteInputTokens = input.usage.cacheWriteInputTokens ?? 0;
  const uncachedInputTokens = input.usage.inputTokens - cachedInputTokens;
  const estimatedCostUsd = (
    uncachedInputTokens * pricing.inputPerMillionUsd
    + cachedInputTokens * pricing.cachedInputPerMillionUsd
    + cacheWriteInputTokens * pricing.cacheWriteInputPerMillionUsd
    + input.usage.outputTokens * pricing.outputPerMillionUsd
  ) / 1_000_000;

  return { estimatedCostUsd, pricing };
}
