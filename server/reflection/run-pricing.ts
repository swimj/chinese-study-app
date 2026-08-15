import type { NormalizedTokenUsage } from '../llm/types.ts';

export type ReflectionRunPricingSnapshot = {
  id: string;
  pricingAsOf: string;
  provider: string;
  providerModel: string;
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

export const INITIAL_GLM_STANDARD_SHORT_CONTEXT_PRICING: ReflectionRunPricingSnapshot = {
  id: 'zai-glm-5.2-standard-short-context-2026-08-11',
  pricingAsOf: '2026-08-11',
  provider: 'zai',
  providerModel: 'glm-5.2',
  serviceTier: 'standard',
  contextBand: 'short',
  currency: 'USD',
  inputPerMillionUsd: 1.4,
  cachedInputPerMillionUsd: 0.26,
  // Z.AI lists cached-input storage as limited-time free; the null-free
  // convention records that no separately reported write rate was charged.
  cacheWriteInputPerMillionUsd: 0,
  outputPerMillionUsd: 4.4,
};

/**
 * International / Singapore Model Studio list prices (not limited-time promos).
 * Cached input uses the implicit-cache hit rate; cache write uses explicit
 * cache creation. Source: QwenCloud / Model Studio model pricing pages,
 * pinned 2026-08-15.
 */
export const INITIAL_QWEN_3_8_MAX_STANDARD_SHORT_CONTEXT_PRICING: ReflectionRunPricingSnapshot = {
  id: 'dashscope-qwen3.8-max-standard-short-context-2026-08-15',
  pricingAsOf: '2026-08-15',
  provider: 'dashscope',
  providerModel: 'qwen3.8-max',
  serviceTier: 'standard',
  contextBand: 'short',
  currency: 'USD',
  inputPerMillionUsd: 2,
  cachedInputPerMillionUsd: 0.25,
  cacheWriteInputPerMillionUsd: 2.5,
  outputPerMillionUsd: 6,
};

/**
 * Same source date. Pins the first International tier only
 * (0 < input tokens ≤ 256K). Higher context bands are 3× and intentionally
 * omitted while reflection bundles stay well under that threshold.
 */
export const INITIAL_QWEN_3_7_PLUS_STANDARD_SHORT_CONTEXT_PRICING: ReflectionRunPricingSnapshot = {
  id: 'dashscope-qwen3.7-plus-standard-short-context-2026-08-15',
  pricingAsOf: '2026-08-15',
  provider: 'dashscope',
  providerModel: 'qwen3.7-plus',
  serviceTier: 'standard',
  contextBand: 'short',
  currency: 'USD',
  inputPerMillionUsd: 0.4,
  cachedInputPerMillionUsd: 0.08,
  cacheWriteInputPerMillionUsd: 0.5,
  outputPerMillionUsd: 1.6,
};

export type ReflectionRunCostEstimate = {
  estimatedCostUsd: number;
  pricing: ReflectionRunPricingSnapshot;
};

const INITIAL_REFLECTION_RUN_PRICING: ReadonlyArray<ReflectionRunPricingSnapshot> = [
  INITIAL_LUNA_STANDARD_SHORT_CONTEXT_PRICING,
  INITIAL_GLM_STANDARD_SHORT_CONTEXT_PRICING,
  INITIAL_QWEN_3_8_MAX_STANDARD_SHORT_CONTEXT_PRICING,
  INITIAL_QWEN_3_7_PLUS_STANDARD_SHORT_CONTEXT_PRICING,
];

export function estimateInitialReflectionRunCost(input: {
  provider: string;
  providerModel: string;
  usage: NormalizedTokenUsage;
}): ReflectionRunCostEstimate | null {
  const pricing = INITIAL_REFLECTION_RUN_PRICING.find((candidate) => (
    input.provider === candidate.provider && input.providerModel === candidate.providerModel
  ));
  if (
    pricing === undefined
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
