import type { ModelInvocationRow } from '../../src/domain/model-invocations.ts';
import { estimateInitialReflectionRunCost, type ReflectionRunPricingBasis } from '../reflection/run-pricing.ts';
import type { NormalizedTokenUsage } from './types.ts';

export type InvocationSpend = {
  spendUsd: number | null;
  spendSource: ModelInvocationRow['spendSource'];
  pricing: ReflectionRunPricingBasis | null;
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
  provider: string; model: string; usage: unknown; reportedAt: string;
}): InvocationSpend {
  const usage = object(input.usage);
  const promptDetails = object(usage.prompt_tokens_details);
  const completionDetails = object(usage.completion_tokens_details);
  const normalized: NormalizedTokenUsage = {
    inputTokens: nonnegative(usage.prompt_tokens),
    cachedInputTokens: nonnegative(usage.prompt_cache_hit_tokens) ?? nonnegative(promptDetails.cached_tokens),
    cacheWriteInputTokens: input.provider === 'openai' ? nonnegative(promptDetails.cache_write_tokens) : null,
    outputTokens: nonnegative(usage.completion_tokens),
    reasoningTokens: nonnegative(completionDetails.reasoning_tokens),
    totalTokens: nonnegative(usage.total_tokens),
  };
  const reportedCostUsd = input.provider === 'openrouter' ? nonnegative(usage.cost) : null;
  const writes = normalized.cacheWriteInputTokens ?? 0;
  const luna = input.provider === 'openai' && input.model === 'gpt-6-luna';
  const validLunaDetails = !luna || [usage.prompt_tokens_details, usage.completion_tokens_details]
    .every(value => value === undefined || value === null
      || (typeof value === 'object' && !Array.isArray(value)));
  // Do not turn malformed explicit token categories into a zero-charge category.
  const validLunaCounts = !luna || [usage.prompt_tokens, usage.completion_tokens,
    usage.prompt_cache_hit_tokens, promptDetails.cached_tokens, promptDetails.cache_write_tokens]
    .every(value => value === undefined || value === null || (Number.isSafeInteger(value) && Number(value) >= 0));
  const validUsage = validLunaDetails && validLunaCounts
    && (normalized.inputTokens === null || writes + (normalized.cachedInputTokens ?? 0) <= normalized.inputTokens)
    && !(input.provider === 'openai' && (input.model === 'gpt-6.1-sol' || luna)
      && (normalized.inputTokens ?? 0) > 272_000);
  const estimate = (!validUsage && reportedCostUsd === null) ? null : estimateInitialReflectionRunCost({
    provider: input.provider, providerModel: input.model,
    // Provider prompt_tokens includes writes; normalized pricing treats them separately.
    usage: { ...normalized, inputTokens: normalized.inputTokens === null ? null : normalized.inputTokens - writes },
    ...(reportedCostUsd === null ? {} : { reportedCostUsd }), reportedAt: input.reportedAt,
  });
  return {
    spendUsd: estimate?.estimatedCostUsd ?? null,
    spendSource: reportedCostUsd !== null ? 'reported' : estimate ? 'estimated' : 'unknown',
    pricing: estimate?.pricing ?? null,
  };
}
