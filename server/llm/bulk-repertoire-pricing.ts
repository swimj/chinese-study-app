import type { ProviderRawResult } from './types.ts';

export type BulkPricing = { model: string; asOf: string; source: string; serviceTier: 'standard'; context: 'at-most-272000-input-tokens';
  inputPerMillionUsd: number; cachedInputPerMillionUsd: number; cacheWriteInputPerMillionUsd: number; outputPerMillionUsd: number };
const prices: Record<string, readonly [number, number, number, number]> = {
  'gpt-6-sol': [2, 0.2, 2.5, 10], 'gpt-6-astra': [10, 1, 12.5, 50], 'gpt-6.1-terra': [1, 0.05, 1.25, 5],
};
export function costForBulkResult(result: ProviderRawResult): { spendUsd: number | null; spendSource: 'reported' | 'estimated' | 'unknown'; pricing: BulkPricing | null } {
  if (result.reportedCostUsd !== undefined && Number.isFinite(result.reportedCostUsd) && result.reportedCostUsd >= 0) return { spendUsd: result.reportedCostUsd, spendSource: 'reported', pricing: null };
  const unknown = { spendUsd: null, spendSource: 'unknown' as const, pricing: null };
  const model = Object.keys(prices).find(key => result.model === key || new RegExp(`^${key}-\\d{4}-\\d{2}-\\d{2}$`).test(result.model));
  if (result.provider !== 'openai' || !model) return unknown;
  const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const raw = record(result.rawResponse), rawUsage = record(raw.usage), rawPromptDetails = record(rawUsage.prompt_tokens_details), rawCompletionDetails = record(rawUsage.completion_tokens_details);
  if ([rawUsage.prompt_tokens_details, rawUsage.completion_tokens_details].some(value => value !== undefined && value !== null && (typeof value !== 'object' || Array.isArray(value)))) return unknown;
  const rawCounts = [rawUsage.prompt_tokens, rawUsage.completion_tokens, rawUsage.prompt_cache_hit_tokens, rawPromptDetails.cached_tokens, rawPromptDetails.cache_write_tokens, rawCompletionDetails.reasoning_tokens];
  if (rawCounts.some(value => value !== undefined && value !== null && (!Number.isSafeInteger(value) || Number(value) < 0))) return unknown;
  const usage = result.usage;
  if (usage.inputTokens === null || usage.outputTokens === null) return unknown;
  const rawWrites = typeof rawPromptDetails.cache_write_tokens === 'number' ? rawPromptDetails.cache_write_tokens : null;
  if (usage.cacheWriteInputTokens !== null && rawWrites !== null && usage.cacheWriteInputTokens !== rawWrites) return unknown;
  const { inputTokens, outputTokens } = usage, cached = usage.cachedInputTokens ?? 0, writes = usage.cacheWriteInputTokens ?? rawWrites ?? 0;
  if (![inputTokens, outputTokens, cached, writes].every(value => Number.isSafeInteger(value) && value >= 0)
    || cached + writes > inputTokens || inputTokens > 272_000) return unknown;
  // Estimates cover standard nonregional requests with ordinary cache retention only.
  if (raw.service_tier !== undefined && raw.service_tier !== null && !['default', 'standard'].includes(String(raw.service_tier))) return unknown;
  const [input, cache, write, output] = prices[model]!;
  const pricing: BulkPricing = { model, asOf: '2026-11-09', source: `https://developers.openai.com/api/docs/models/${model}`, serviceTier: 'standard', context: 'at-most-272000-input-tokens',
    inputPerMillionUsd: input, cachedInputPerMillionUsd: cache, cacheWriteInputPerMillionUsd: write, outputPerMillionUsd: output };
  return { spendUsd: ((inputTokens - cached - writes) * input + cached * cache + writes * write + outputTokens * output) / 1_000_000, spendSource: 'estimated', pricing };
}

/** Accounting does not depend on valid choices, content, or a successful schema parse. */
export function costForBulkResponse(requestedModel: string, body: unknown): ReturnType<typeof costForBulkResult> {
  const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const raw = record(body), usage = record(raw.usage), promptDetails = record(usage.prompt_tokens_details), completionDetails = record(usage.completion_tokens_details);
  if (typeof usage.cost === 'number' && Number.isFinite(usage.cost) && usage.cost >= 0)
    return { spendUsd: usage.cost, spendSource: 'reported', pricing: null };
  const unknown = { spendUsd: null, spendSource: 'unknown' as const, pricing: null };
  if ([usage.prompt_tokens_details, usage.completion_tokens_details].some(value => value !== undefined && value !== null && (typeof value !== 'object' || Array.isArray(value)))) return unknown;
  const fields = [usage.prompt_tokens, usage.completion_tokens, usage.total_tokens, usage.prompt_cache_hit_tokens, promptDetails.cached_tokens, promptDetails.cache_write_tokens, completionDetails.reasoning_tokens];
  if (fields.some(value => value !== undefined && value !== null && (!Number.isSafeInteger(value) || Number(value) < 0))) return unknown;
  const count = (value: unknown): number | null => typeof value === 'number' ? value : null;
  return costForBulkResult({ provider: 'openai', model: typeof raw.model === 'string' ? raw.model : requestedModel,
    responseId: typeof raw.id === 'string' ? raw.id : null, structuredOutputMode: 'json_schema', rawText: '', finishReason: null,
    rawResponse: typeof raw.service_tier === 'string' ? { service_tier: raw.service_tier } : {},
    usage: { inputTokens: count(usage.prompt_tokens), outputTokens: count(usage.completion_tokens),
      cachedInputTokens: count(usage.prompt_cache_hit_tokens) ?? count(promptDetails.cached_tokens), cacheWriteInputTokens: count(promptDetails.cache_write_tokens),
      reasoningTokens: count(completionDetails.reasoning_tokens), totalTokens: count(usage.total_tokens) } });
}
