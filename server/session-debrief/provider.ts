import { readFile } from 'node:fs/promises';
import { createOpenAiCompatibleAdapter } from '../llm/openai-compatible.ts';
import { fetchImplementationForProvider } from '../llm/proxy-fetch.ts';
import type { FetchImplementation } from '../llm/http.ts';
import { validateJsonSchema } from '../llm/json-schema-validator.ts';
import { isOutputTruncationFinishReason, type NormalizedTokenUsage } from '../llm/types.ts';
import { DEBRIEF_PRICING, estimateRunCostFromSnapshot, type RunPricingSnapshot } from '../llm/run-pricing.ts';
import type { JsonSchema } from '../../src/domain/reflection-result-schema.ts';
import { validateSessionDebriefResult, type SessionDebriefInput, type SessionDebriefResult } from '../../src/domain/session-debrief.ts';

export const DEBRIEF_TIMEOUT_MS = 180_000;
export { DEBRIEF_PRICING } from '../llm/run-pricing.ts';
export type DebriefRunMetadata = {
  responseId: string | null; finishReason: string | null; usage: NormalizedTokenUsage;
  pricing: RunPricingSnapshot | null; estimatedCostUsd: number | null;
};
export class SessionDebriefProviderError extends Error {
  constructor(readonly code: string, message: string, readonly metadata: DebriefRunMetadata | null = null) { super(message); }
}
export type SessionDebriefProvider = {
  isConfigured(): boolean;
  generate(input: SessionDebriefInput, token: string): Promise<{ result: SessionDebriefResult; metadata: DebriefRunMetadata }>;
};
export const DEBRIEF_RESULT_SCHEMA: JsonSchema = {
  type: 'object', additionalProperties: false, required: ['notes'], properties: {
    notes: { type: 'array', maxItems: 10, items: {
      type: 'object', additionalProperties: false, required: ['text', 'refs', 'followUp'], properties: {
        text: { type: 'string' }, refs: { type: 'array', items: { type: 'string' } }, followUp: { type: ['string', 'null'] },
      },
    } },
  },
};
export function createSessionDebriefProvider(options: { environment?: NodeJS.ProcessEnv; fetchImplementation?: FetchImplementation } = {}): SessionDebriefProvider {
  const environment = options.environment ?? process.env;
  const adapter = createOpenAiCompatibleAdapter({ id: 'openai', defaultBaseUrl: 'https://api.openai.com/v1',
    apiKeyEnvironmentVariable: 'OPENAI_API_KEY', structuredOutputMode: 'json_schema', maxTokensField: 'max_completion_tokens',
    fetchImplementation: options.fetchImplementation ?? fetchImplementationForProvider('openai', DEBRIEF_TIMEOUT_MS) });
  return {
    isConfigured: () => !!environment.OPENAI_API_KEY?.trim(),
    async generate(input, token) {
      const apiKey = environment.OPENAI_API_KEY?.trim();
      if (!apiKey) throw new SessionDebriefProviderError('missing_config', 'Debrief generation is not configured.');
      const systemPrompt = await readFile(new URL('./prompts/debrief-v7.txt', import.meta.url), 'utf8');
      const { schemaVersion: _schemaVersion, ...modelInput } = input;
      let raw;
      try {
        raw = await adapter.run({ model: 'gpt-6.1-sol', reasoningEffort: 'low', systemPrompt,
          userPrompt: JSON.stringify(modelInput), outputSchemaName: 'session_debrief', outputSchema: DEBRIEF_RESULT_SCHEMA,
          maxOutputTokens: 4096, temperature: null, timeoutMs: DEBRIEF_TIMEOUT_MS, cachePrompt: true, clientRequestId: token },
          { apiKey, baseUrl: environment.OPENAI_BASE_URL?.trim() || null });
      } catch { throw new SessionDebriefProviderError('upstream_failure', 'Debrief generation could not finish. You can retry.'); }
      // OpenAI prompt_tokens includes both hits and writes. A write replaces the ordinary input charge;
      // other provider conventions remain untouched in the shared reflection pricing primitive.
      const root = raw.rawResponse as { usage?: { prompt_tokens_details?: { cache_write_tokens?: unknown } } };
      const writes = root.usage?.prompt_tokens_details?.cache_write_tokens;
      const usage = { ...raw.usage, cacheWriteInputTokens: typeof writes === 'number' && Number.isInteger(writes) && writes >= 0 ? writes : null };
      const estimate = estimateDebriefCost(usage);
      const metadata: DebriefRunMetadata = { responseId: raw.responseId, finishReason: raw.finishReason, usage,
        pricing: estimate === null ? null : DEBRIEF_PRICING, estimatedCostUsd: estimate };
      if (isOutputTruncationFinishReason(raw.finishReason)) throw new SessionDebriefProviderError('output_truncated', 'Debrief generation was cut short. You can retry.', metadata);
      let parsed: unknown;
      try { parsed = JSON.parse(raw.rawText); }
      catch { throw new SessionDebriefProviderError('invalid_json', 'Debrief generation returned an unreadable result. You can retry.', metadata); }
      try {
        if (validateJsonSchema(parsed, DEBRIEF_RESULT_SCHEMA).length > 0) throw new Error('schema');
        validateSessionDebriefResult(parsed, input);
      } catch { throw new SessionDebriefProviderError('invalid_result', 'Debrief generation returned an invalid result. You can retry.', metadata); }
      return { result: parsed, metadata };
    },
  };
}
export function estimateDebriefCost(usage: NormalizedTokenUsage): number | null {
  if ([usage.inputTokens, usage.outputTokens, usage.cachedInputTokens, usage.cacheWriteInputTokens].some((value) =>
    value !== null && (!Number.isInteger(value) || value < 0))) return null;
  const writes = usage.cacheWriteInputTokens ?? 0;
  const cached = usage.cachedInputTokens ?? 0;
  if (usage.inputTokens === null || usage.inputTokens > 272_000 || writes + cached > usage.inputTokens) return null;
  // Generic estimator charges writes separately, so remove them from its ordinary input base.
  return estimateRunCostFromSnapshot({ ...usage, inputTokens: usage.inputTokens - writes }, DEBRIEF_PRICING)?.estimatedCostUsd ?? null;
}
