import type { NormalizedTokenUsage } from './runner/types.js';

export type ModelTokenPricing = {
  inputPerMillionUsd: number;
  cachedInputPerMillionUsd: number;
  cacheWriteInputPerMillionUsd: number | null;
  outputPerMillionUsd: number;
};

export type EstimatedRunCost = {
  usd: number;
  pricing: ModelTokenPricing;
};

// Published on 2026-07-20. Keep this separate from raw artifacts: an artifact
// records what the provider reported, while this is a current estimate.
const pricingByModel: Readonly<Record<string, ModelTokenPricing>> = {
  'gpt-5.6-terra-high': { inputPerMillionUsd: 2.5, cachedInputPerMillionUsd: 0.25, cacheWriteInputPerMillionUsd: 3.125, outputPerMillionUsd: 15 },
  'gpt-5.6-terra-xhigh': { inputPerMillionUsd: 2.5, cachedInputPerMillionUsd: 0.25, cacheWriteInputPerMillionUsd: 3.125, outputPerMillionUsd: 15 },
  'gpt-5.6-terra-max': { inputPerMillionUsd: 2.5, cachedInputPerMillionUsd: 0.25, cacheWriteInputPerMillionUsd: 3.125, outputPerMillionUsd: 15 },
  'gpt-5.6-luna-high': { inputPerMillionUsd: 1, cachedInputPerMillionUsd: 0.1, cacheWriteInputPerMillionUsd: 1.25, outputPerMillionUsd: 6 },
  'gpt-5.6-luna-xhigh': { inputPerMillionUsd: 1, cachedInputPerMillionUsd: 0.1, cacheWriteInputPerMillionUsd: 1.25, outputPerMillionUsd: 6 },
  'gpt-5.6-luna-max': { inputPerMillionUsd: 1, cachedInputPerMillionUsd: 0.1, cacheWriteInputPerMillionUsd: 1.25, outputPerMillionUsd: 6 },
  'gpt-5.4-mini-high': { inputPerMillionUsd: 0.75, cachedInputPerMillionUsd: 0.075, cacheWriteInputPerMillionUsd: 0.9375, outputPerMillionUsd: 4.5 },
  'gpt-5.4-mini-xhigh': { inputPerMillionUsd: 0.75, cachedInputPerMillionUsd: 0.075, cacheWriteInputPerMillionUsd: 0.9375, outputPerMillionUsd: 4.5 },
  'glm-5.2-high': { inputPerMillionUsd: 1.4, cachedInputPerMillionUsd: 0.26, cacheWriteInputPerMillionUsd: null, outputPerMillionUsd: 4.4 },
  'glm-5.2-max': { inputPerMillionUsd: 1.4, cachedInputPerMillionUsd: 0.26, cacheWriteInputPerMillionUsd: null, outputPerMillionUsd: 4.4 },
  'gpt-5.6-terra': { inputPerMillionUsd: 2.5, cachedInputPerMillionUsd: 0.25, cacheWriteInputPerMillionUsd: 3.125, outputPerMillionUsd: 15 },
  'gpt-5.6-luna': { inputPerMillionUsd: 1, cachedInputPerMillionUsd: 0.1, cacheWriteInputPerMillionUsd: 1.25, outputPerMillionUsd: 6 },
  'gpt-5.4': { inputPerMillionUsd: 2.5, cachedInputPerMillionUsd: 0.25, cacheWriteInputPerMillionUsd: 3.125, outputPerMillionUsd: 15 },
  'gpt-5.4-mini': { inputPerMillionUsd: 0.75, cachedInputPerMillionUsd: 0.075, cacheWriteInputPerMillionUsd: 0.9375, outputPerMillionUsd: 4.5 },
  'gpt-5.4-nano': { inputPerMillionUsd: 0.2, cachedInputPerMillionUsd: 0.02, cacheWriteInputPerMillionUsd: 0.25, outputPerMillionUsd: 1.25 },
  'glm-5.2': { inputPerMillionUsd: 1.4, cachedInputPerMillionUsd: 0.26, cacheWriteInputPerMillionUsd: null, outputPerMillionUsd: 4.4 },
  'glm-5': { inputPerMillionUsd: 1, cachedInputPerMillionUsd: 0.2, cacheWriteInputPerMillionUsd: null, outputPerMillionUsd: 3.2 },
  'glm-4.7': { inputPerMillionUsd: 0.6, cachedInputPerMillionUsd: 0.11, cacheWriteInputPerMillionUsd: null, outputPerMillionUsd: 2.2 },
  'glm-4.7-flashx': { inputPerMillionUsd: 0.07, cachedInputPerMillionUsd: 0.01, cacheWriteInputPerMillionUsd: null, outputPerMillionUsd: 0.4 },
  'glm-4.7-flash': { inputPerMillionUsd: 0, cachedInputPerMillionUsd: 0, cacheWriteInputPerMillionUsd: null, outputPerMillionUsd: 0 },
};

export function getModelTokenPricing(model: string): ModelTokenPricing | null {
  return pricingByModel[model] ?? null;
}

export function estimateRunCost(model: string, usage: NormalizedTokenUsage | null): EstimatedRunCost | null {
  const pricing = getModelTokenPricing(model);
  if (pricing === null || usage?.inputTokens === null || usage?.inputTokens === undefined || usage.outputTokens === null || usage.outputTokens === undefined) return null;

  const cachedInputTokens = usage.cachedInputTokens ?? 0;
  const uncachedInputTokens = Math.max(usage.inputTokens - cachedInputTokens, 0);
  const cacheWriteCost = pricing.cacheWriteInputPerMillionUsd === null || usage.cacheWriteInputTokens === null || usage.cacheWriteInputTokens === undefined
    ? 0
    : usage.cacheWriteInputTokens * pricing.cacheWriteInputPerMillionUsd;
  const usd = (
    uncachedInputTokens * pricing.inputPerMillionUsd
    + cachedInputTokens * pricing.cachedInputPerMillionUsd
    + cacheWriteCost
    + usage.outputTokens * pricing.outputPerMillionUsd
  ) / 1_000_000;
  return { usd, pricing };
}
