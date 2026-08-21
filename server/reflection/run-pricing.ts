import type { NormalizedTokenUsage } from '../llm/types.ts';
import {
  estimateRunCostFromSnapshot,
  LUNA_STANDARD_SHORT_CONTEXT_PRICING,
  type RunPricingSnapshot,
} from '../llm/run-pricing.ts';

export type ReflectionRunPricingSnapshot = RunPricingSnapshot;

export type OpenRouterReportedCostBasis = {
  id: 'openrouter-usage-cost.v1';
  pricingAsOf: string;
  provider: 'openrouter';
  providerModel: string;
  currency: 'USD';
  source: 'openrouter.usage.cost';
};

export type ReflectionRunPricingBasis = ReflectionRunPricingSnapshot | OpenRouterReportedCostBasis;

/**
 * A fixed dogfood estimate, not a billing integration. Keep the exact price
 * basis beside every persisted estimate so later price-table changes do not
 * rewrite historical cost intuition.
 */
export const INITIAL_LUNA_STANDARD_SHORT_CONTEXT_PRICING = LUNA_STANDARD_SHORT_CONTEXT_PRICING;

/**
 * Historical GLM-5.2 snapshot. Kept so persisted glm-5.2 runs still price
 * against the original basis and stay distinguishable from GLM-5.3.
 */
export const INITIAL_GLM_5_2_STANDARD_SHORT_CONTEXT_PRICING: ReflectionRunPricingSnapshot = {
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

export const INITIAL_GLM_STANDARD_SHORT_CONTEXT_PRICING: ReflectionRunPricingSnapshot = {
  id: 'zai-glm-5.3-standard-short-context-2026-08-21',
  pricingAsOf: '2026-08-21',
  provider: 'zai',
  providerModel: 'glm-5.3',
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

// OpenRouter list prices, pinned 2026-08-18. These deliberately use the
// transport/model pair rather than direct-provider rates: a routed run must
// not borrow a superficially similar direct price.
export const INITIAL_OPENROUTER_GEMINI_3_6_FLASH_PRICING: ReflectionRunPricingSnapshot = {
  id: 'openrouter-google-gemini-3.6-flash-standard-short-context-2026-08-18',
  pricingAsOf: '2026-08-18', provider: 'openrouter', providerModel: 'google/gemini-3.6-flash',
  serviceTier: 'standard', contextBand: 'short', currency: 'USD',
  inputPerMillionUsd: 0.75, cachedInputPerMillionUsd: 0.075, cacheWriteInputPerMillionUsd: 0,
  outputPerMillionUsd: 3.75,
};
export const INITIAL_OPENROUTER_DEEPSEEK_V4_PRO_PRICING: ReflectionRunPricingSnapshot = {
  id: 'openrouter-deepseek-v4-pro-standard-short-context-2026-08-18',
  pricingAsOf: '2026-08-18', provider: 'openrouter', providerModel: 'deepseek/deepseek-v4-pro',
  serviceTier: 'standard', contextBand: 'short', currency: 'USD',
  inputPerMillionUsd: 0.6943, cachedInputPerMillionUsd: 0.003625, cacheWriteInputPerMillionUsd: 0,
  outputPerMillionUsd: 1.389,
};
export const INITIAL_OPENROUTER_CLAUDE_SONNET_5_PRICING: ReflectionRunPricingSnapshot = {
  id: 'openrouter-anthropic-claude-sonnet-5-standard-short-context-2026-08-18',
  pricingAsOf: '2026-08-18', provider: 'openrouter', providerModel: 'anthropic/claude-sonnet-5',
  serviceTier: 'standard', contextBand: 'short', currency: 'USD',
  inputPerMillionUsd: 2, cachedInputPerMillionUsd: 0.2, cacheWriteInputPerMillionUsd: 0,
  outputPerMillionUsd: 10,
};
export const INITIAL_TERRA_STANDARD_SHORT_CONTEXT_PRICING: ReflectionRunPricingSnapshot = {
  id: 'openai-gpt-5.6-terra-standard-short-context-2026-08-18',
  pricingAsOf: '2026-08-18', provider: 'openai', providerModel: 'gpt-5.6-terra',
  serviceTier: 'standard', contextBand: 'short', currency: 'USD',
  inputPerMillionUsd: 2.5, cachedInputPerMillionUsd: 0.25, cacheWriteInputPerMillionUsd: 3.125,
  outputPerMillionUsd: 15,
};

export type ReflectionRunCostEstimate = {
  estimatedCostUsd: number;
  pricing: ReflectionRunPricingBasis;
};

const INITIAL_REFLECTION_RUN_PRICING: ReadonlyArray<ReflectionRunPricingSnapshot> = [
  INITIAL_LUNA_STANDARD_SHORT_CONTEXT_PRICING,
  INITIAL_GLM_5_2_STANDARD_SHORT_CONTEXT_PRICING,
  INITIAL_GLM_STANDARD_SHORT_CONTEXT_PRICING,
  INITIAL_QWEN_3_8_MAX_STANDARD_SHORT_CONTEXT_PRICING,
  INITIAL_OPENROUTER_GEMINI_3_6_FLASH_PRICING,
  INITIAL_OPENROUTER_DEEPSEEK_V4_PRO_PRICING,
  INITIAL_OPENROUTER_CLAUDE_SONNET_5_PRICING,
  INITIAL_TERRA_STANDARD_SHORT_CONTEXT_PRICING,
];

export function estimateInitialReflectionRunCost(input: {
  provider: string;
  providerModel: string;
  usage: NormalizedTokenUsage;
  reportedCostUsd?: number;
  reportedAt?: string;
}): ReflectionRunCostEstimate | null {
  if (
    input.provider === 'openrouter'
    && input.reportedCostUsd !== undefined
    && Number.isFinite(input.reportedCostUsd)
    && input.reportedCostUsd >= 0
    && input.reportedAt !== undefined
  ) {
    return {
      estimatedCostUsd: input.reportedCostUsd,
      pricing: {
        id: 'openrouter-usage-cost.v1',
        pricingAsOf: input.reportedAt.slice(0, 10),
        provider: 'openrouter',
        providerModel: input.providerModel,
        currency: 'USD',
        source: 'openrouter.usage.cost',
      },
    };
  }
  const pricing = INITIAL_REFLECTION_RUN_PRICING.find((candidate) => (
    input.provider === candidate.provider && input.providerModel === candidate.providerModel
  ));
  if (pricing === undefined) return null;
  return estimateRunCostFromSnapshot(input.usage, pricing);
}
