import type { ModelInvocationRow } from '../../src/domain/model-invocations.ts';
import { estimateInitialReflectionRunCost, GPT_6_LUNA_STANDARD_SHORT_CONTEXT_PRICING, type ReflectionRunPricingBasis } from '../reflection/run-pricing.ts';
import { estimateRunCostFromSnapshot } from './run-pricing.ts';
import type { NormalizedTokenUsage } from './types.ts';

export type InvocationSpend = {
  spendUsd: number | null;
  spendSource: ModelInvocationRow['spendSource'];
  pricing: ReflectionRunPricingBasis | null;
};

// Decisions uses standard Luna input/cache rates and charges nothing for outputs.
// https://developers.openai.com/api/docs/guides/decisions#pricing-and-availability
const decisionsPricing = {
  ...GPT_6_LUNA_STANDARD_SHORT_CONTEXT_PRICING,
  id: 'openai-gpt-6-luna-decisions-short-context-2026-11-20',
  pricingAsOf: '2026-11-20', outputPerMillionUsd: 0,
};

function object(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}
function nonnegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/** Shared by response accounting and explicit repairs from the retained raw usage. */
export function priceInvocationUsage(input: {
  provider: string; model: string; usage: unknown; reportedAt: string; api?: 'decisions';
}): InvocationSpend {
  const usage = object(input.usage);
  const inputCount = usage.prompt_tokens ?? usage.input_tokens;
  const outputCount = usage.completion_tokens ?? usage.output_tokens;
  const inputDetails = usage.prompt_tokens_details ?? usage.input_tokens_details;
  const outputDetails = usage.completion_tokens_details ?? usage.output_tokens_details;
  const promptDetails = object(inputDetails);
  const completionDetails = object(outputDetails);
  const normalized: NormalizedTokenUsage = {
    inputTokens: nonnegative(inputCount),
    cachedInputTokens: nonnegative(usage.prompt_cache_hit_tokens) ?? nonnegative(promptDetails.cached_tokens),
    cacheWriteInputTokens: input.provider === 'openai' ? nonnegative(promptDetails.cache_write_tokens) : null,
    outputTokens: nonnegative(outputCount),
    reasoningTokens: nonnegative(completionDetails.reasoning_tokens),
    totalTokens: nonnegative(usage.total_tokens),
  };
  const reportedCostUsd = input.provider === 'openrouter' ? nonnegative(usage.cost) : null;
  const writes = normalized.cacheWriteInputTokens ?? 0;
  const luna = input.provider === 'openai' && input.model === 'gpt-6-luna';
  const validLunaDetails = !luna || [inputDetails, outputDetails]
    .every(value => value === undefined || value === null
      || (typeof value === 'object' && !Array.isArray(value)));
  // Do not turn malformed explicit token categories into a zero-charge category.
  const validLunaCounts = !luna || [inputCount, outputCount,
    usage.prompt_cache_hit_tokens, promptDetails.cached_tokens, promptDetails.cache_write_tokens]
    .every(value => value === undefined || value === null || (Number.isSafeInteger(value) && Number(value) >= 0));
  const validUsage = validLunaDetails && validLunaCounts
    && (normalized.inputTokens === null || writes + (normalized.cachedInputTokens ?? 0) <= normalized.inputTokens)
    && !(input.provider === 'openai' && (input.model === 'gpt-6.1-sol' || luna)
      && (normalized.inputTokens ?? 0) > 272_000);
  // Provider input counts include the separately priced cache writes.
  const billable = { ...normalized, inputTokens: normalized.inputTokens === null ? null : normalized.inputTokens - writes };
  if (input.api === 'decisions') {
    const estimate = luna && validUsage ? estimateRunCostFromSnapshot({ ...billable, outputTokens: 0 }, decisionsPricing) : null;
    return { spendUsd: estimate?.estimatedCostUsd ?? null, spendSource: estimate ? 'estimated' : 'unknown',
      pricing: estimate?.pricing ?? null };
  }
  const estimate = (!validUsage && reportedCostUsd === null) ? null : estimateInitialReflectionRunCost({
    provider: input.provider, providerModel: input.model,
    usage: billable,
    ...(reportedCostUsd === null ? {} : { reportedCostUsd }), reportedAt: input.reportedAt,
  });
  return {
    spendUsd: estimate?.estimatedCostUsd ?? null,
    spendSource: reportedCostUsd !== null ? 'reported' : estimate ? 'estimated' : 'unknown',
    pricing: estimate?.pricing ?? null,
  };
}
