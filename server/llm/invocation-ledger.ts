import { finishModelInvocation, recordModelInvocationSpend, startModelInvocation } from '../db/model-invocations.ts';
import { estimateInitialReflectionRunCost } from '../reflection/run-pricing.ts';
import type { JsonValue, NormalizedTokenUsage } from './types.ts';

type Invocation = { provider: string; model: string; invocationType: string };
let enabled = false;

/** Enable for the application; standalone provider experiments stay independent of its database. */
export function installModelInvocationLedger(): void { enabled = true; }

export function beginInvocation(input: Invocation): string | null {
  return enabled ? startModelInvocation(input) : null;
}

function object(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}
function nonnegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/** Read accounting independently of content parsing, including refusals and malformed choices. */
export function recordInvocationResponse(id: string | null, input: Invocation, response: JsonValue): void {
  if (id === null) return;
  const usage = object(object(response).usage);
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
  const validUsage = (normalized.inputTokens === null || writes + (normalized.cachedInputTokens ?? 0) <= normalized.inputTokens)
    && !(input.provider === 'openai' && input.model === 'gpt-6.1-sol' && (normalized.inputTokens ?? 0) > 272_000);
  const estimate = (!validUsage && reportedCostUsd === null) ? null : estimateInitialReflectionRunCost({ provider: input.provider, providerModel: input.model,
    usage: { ...normalized, inputTokens: normalized.inputTokens === null ? null : normalized.inputTokens - writes }, ...(reportedCostUsd === null ? {} : { reportedCostUsd }), reportedAt: new Date().toISOString() });
  recordModelInvocationSpend(id, { spendUsd: estimate?.estimatedCostUsd ?? null,
    spendSource: reportedCostUsd !== null ? 'reported' : estimate ? 'estimated' : 'unknown',
    pricing: estimate?.pricing ?? null });
}
export function concludeInvocation(id: string | null, status: 'completed' | 'failed'): void {
  if (id !== null) finishModelInvocation(id, status);
}
