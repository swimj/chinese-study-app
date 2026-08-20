import type { NormalizedTokenUsage } from './types.ts';

export type RunPricingSnapshot = {
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

export type RunCostEstimate = {
  estimatedCostUsd: number;
  pricing: RunPricingSnapshot;
};

export const LUNA_STANDARD_SHORT_CONTEXT_PRICING: RunPricingSnapshot = {
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

export function estimateRunCostFromSnapshot(
  usage: NormalizedTokenUsage,
  pricing: RunPricingSnapshot,
): RunCostEstimate | null {
  if (usage.inputTokens === null || usage.outputTokens === null) return null;
  const cachedInputTokens = usage.cachedInputTokens ?? 0;
  if (cachedInputTokens > usage.inputTokens) return null;

  const cacheWriteInputTokens = usage.cacheWriteInputTokens ?? 0;
  const uncachedInputTokens = usage.inputTokens - cachedInputTokens;
  const estimatedCostUsd = (
    uncachedInputTokens * pricing.inputPerMillionUsd
    + cachedInputTokens * pricing.cachedInputPerMillionUsd
    + cacheWriteInputTokens * pricing.cacheWriteInputPerMillionUsd
    + usage.outputTokens * pricing.outputPerMillionUsd
  ) / 1_000_000;

  return { estimatedCostUsd, pricing };
}
