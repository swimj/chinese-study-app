import type { ModelInvocationRow } from '../../src/domain/model-invocations.ts';
import { finishModelInvocation, invalidateModelInvocation, recordModelInvocationSpend, startModelInvocation,
  finishServiceModelInvocation, invalidateServiceModelInvocation, recordServiceModelInvocationSpend, startServiceModelInvocation,
  recordModelInvocationResponseSnapshot, recordServiceModelInvocationResponseSnapshot, type ModelInvocationStart } from '../db/model-invocations.ts';
import { estimateInitialReflectionRunCost } from '../reflection/run-pricing.ts';
import type { JsonValue, NormalizedTokenUsage } from './types.ts';

type Invocation = ModelInvocationStart;
let enabled = false;

/** Enable for the application; standalone provider experiments stay independent of its database. */
export function installModelInvocationLedger(): void { enabled = true; }

export function beginInvocation(input: Invocation): string | null {
  return enabled ? startModelInvocation(input) : null;
}

export function beginServiceInvocation(input: Invocation & { serviceId: string; requestingLearnerId?: string }): string | null {
  return enabled ? startServiceModelInvocation(input) : null;
}

function object(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}
function nonnegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/** Read accounting independently of content parsing, including refusals and malformed choices. */
export function recordInvocationResponse(id: string | null, input: Invocation, response: JsonValue, serviceId?: string): void {
  if (id === null) return;
  if (serviceId === undefined) recordModelInvocationResponseSnapshot(id, response);
  else recordServiceModelInvocationResponseSnapshot(id, serviceId, response);
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
  const recordSpend = (input: Parameters<typeof recordModelInvocationSpend>[1]) => serviceId === undefined
    ? recordModelInvocationSpend(id, input) : recordServiceModelInvocationSpend(id, serviceId, input);
  recordSpend({ spendUsd: estimate?.estimatedCostUsd ?? null,
    spendSource: reportedCostUsd !== null ? 'reported' : estimate ? 'estimated' : 'unknown',
    pricing: estimate?.pricing ?? null });
}
export function concludeInvocation(id: string | null, status: Exclude<ModelInvocationRow['status'], 'running'>, latencyMs: number): void {
  if (id !== null) finishModelInvocation(id, status, latencyMs);
}

export function invalidateInvocation(id: string | null | undefined): void {
  if (id != null) invalidateModelInvocation(id);
}

export function recordServiceInvocationResponse(id: string | null, serviceId: string, input: Invocation, response: JsonValue): void {
  recordInvocationResponse(id, input, response, serviceId);
}
export function concludeServiceInvocation(id: string | null, serviceId: string, status: Exclude<ModelInvocationRow['status'], 'running'>, latencyMs: number): void {
  if (id !== null) finishServiceModelInvocation(id, serviceId, status, latencyMs);
}
export function invalidateServiceInvocation(id: string | null | undefined, serviceId: string): void {
  if (id != null) invalidateServiceModelInvocation(id, serviceId);
}
