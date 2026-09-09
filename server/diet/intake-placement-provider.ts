import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dietIntakePlacementResultSchema, validateDietIntakePlacementResult, type DietIntakePlacementRequest, type DietIntakePlacementResult } from '../../src/domain/diet-intake-placement.ts';
import type { FetchImplementation } from '../llm/http.ts';
import { validateJsonSchema } from '../llm/json-schema-validator.ts';
import { createOpenAiCompatibleAdapter } from '../llm/openai-compatible.ts';
import { fetchImplementationForProvider } from '../llm/proxy-fetch.ts';
import { isOutputTruncationFinishReason, PROVIDER_REQUEST_TIMEOUT_MS, type NormalizedTokenUsage } from '../llm/types.ts';

export const DIET_INTAKE_PLACEMENT_PROMPT_VERSION = 'diet-intake-placement-v1' as const;
export const DIET_INTAKE_PLACEMENT_MODEL_CONFIG = { provider: 'openai', modelConfig: 'gpt-5.6-luna-high', providerModel: 'gpt-5.6-luna', reasoningEffort: 'high', maxOutputTokens: 12_000, timeoutMs: PROVIDER_REQUEST_TIMEOUT_MS, defaultBaseUrl: 'https://api.openai.com/v1', apiKeyEnvironmentVariable: 'OPENAI_API_KEY', baseUrlEnvironmentVariable: 'OPENAI_BASE_URL' } as const;
export type DietIntakePlacementProviderFailureCode = 'missing_config' | 'upstream_failure' | 'output_truncated' | 'invalid_json' | 'schema_invalid' | 'domain_contract_invalid';
const failureMessages: Record<DietIntakePlacementProviderFailureCode, string> = {
  missing_config: 'Diet intake assessment is not configured.',
  upstream_failure: 'Diet intake assessment is temporarily unavailable.',
  output_truncated: 'Diet intake assessment did not complete.',
  invalid_json: 'Diet intake assessment returned an invalid result.',
  schema_invalid: 'Diet intake assessment returned an unsupported result.',
  domain_contract_invalid: 'Diet intake assessment returned an unsupported result.',
};
export type DietIntakePlacementRunMetadata = { provider: string; modelConfig: string; providerModel: string; promptVersion: string; clientRequestId: string; responseId: string | null; finishReason: string | null; usage: NormalizedTokenUsage };
export class DietIntakePlacementProviderError extends Error { constructor(readonly code: DietIntakePlacementProviderFailureCode, readonly metadata: DietIntakePlacementRunMetadata) { super(failureMessages[code]); this.name = 'DietIntakePlacementProviderError'; } }
export type DietIntakePlacementProvider = { assess(request: DietIntakePlacementRequest, options?: { clientRequestId?: string }): Promise<{ result: DietIntakePlacementResult; metadata: DietIntakePlacementRunMetadata }> };
const promptUrl = new URL('./prompts/intake-placement.md', import.meta.url); let promptPromise: Promise<string> | null = null;

export function createDietIntakePlacementProvider(options: { fetchImplementation?: FetchImplementation; environment?: NodeJS.ProcessEnv; systemPrompt?: string } = {}): DietIntakePlacementProvider {
  const environment = options.environment ?? process.env;
  const adapter = createOpenAiCompatibleAdapter({ id: DIET_INTAKE_PLACEMENT_MODEL_CONFIG.provider, defaultBaseUrl: DIET_INTAKE_PLACEMENT_MODEL_CONFIG.defaultBaseUrl, apiKeyEnvironmentVariable: DIET_INTAKE_PLACEMENT_MODEL_CONFIG.apiKeyEnvironmentVariable, structuredOutputMode: 'json_schema', maxTokensField: 'max_completion_tokens', fetchImplementation: options.fetchImplementation ?? fetchImplementationForProvider(DIET_INTAKE_PLACEMENT_MODEL_CONFIG.provider, DIET_INTAKE_PLACEMENT_MODEL_CONFIG.timeoutMs) });
  return { async assess(request, requestOptions = {}) {
    const clientRequestId = requestOptions.clientRequestId ?? randomUUID(); const emptyMetadata = emptyRunMetadata(clientRequestId);
    const apiKey = configuredValue(environment[DIET_INTAKE_PLACEMENT_MODEL_CONFIG.apiKeyEnvironmentVariable]);
    if (apiKey === null) throw new DietIntakePlacementProviderError('missing_config', emptyMetadata);
    let providerResult;
    try { providerResult = await adapter.run({ model: DIET_INTAKE_PLACEMENT_MODEL_CONFIG.providerModel, reasoningEffort: DIET_INTAKE_PLACEMENT_MODEL_CONFIG.reasoningEffort, systemPrompt: options.systemPrompt ?? await loadPrompt(), userPrompt: JSON.stringify(request), outputSchemaName: 'diet_intake_placement_result', outputSchema: dietIntakePlacementResultSchema, maxOutputTokens: DIET_INTAKE_PLACEMENT_MODEL_CONFIG.maxOutputTokens, temperature: null, timeoutMs: DIET_INTAKE_PLACEMENT_MODEL_CONFIG.timeoutMs, cachePrompt: true, clientRequestId }, { apiKey, baseUrl: configuredValue(environment[DIET_INTAKE_PLACEMENT_MODEL_CONFIG.baseUrlEnvironmentVariable]) }); } catch { throw new DietIntakePlacementProviderError('upstream_failure', emptyMetadata); }
    const metadata: DietIntakePlacementRunMetadata = { ...emptyMetadata, providerModel: providerResult.model, responseId: providerResult.responseId, finishReason: providerResult.finishReason, usage: providerResult.usage };
    if (isOutputTruncationFinishReason(providerResult.finishReason)) throw new DietIntakePlacementProviderError('output_truncated', metadata);
    let parsed: unknown; try { parsed = JSON.parse(providerResult.rawText); } catch { throw new DietIntakePlacementProviderError('invalid_json', metadata); }
    if (validateJsonSchema(parsed, dietIntakePlacementResultSchema).length > 0) throw new DietIntakePlacementProviderError('schema_invalid', metadata);
    const result = parsed as DietIntakePlacementResult;
    if (validateDietIntakePlacementResult(result).length > 0) throw new DietIntakePlacementProviderError('domain_contract_invalid', metadata);
    return { result: { ...result, rationale: result.rationale.trim() }, metadata };
  } };
}
function loadPrompt(): Promise<string> { promptPromise ??= readFile(promptUrl, 'utf8'); return promptPromise; }
function configuredValue(value: string | undefined): string | null { return value?.trim() || null; }
function emptyRunMetadata(clientRequestId: string): DietIntakePlacementRunMetadata { return { provider: DIET_INTAKE_PLACEMENT_MODEL_CONFIG.provider, modelConfig: DIET_INTAKE_PLACEMENT_MODEL_CONFIG.modelConfig, providerModel: DIET_INTAKE_PLACEMENT_MODEL_CONFIG.providerModel, promptVersion: DIET_INTAKE_PLACEMENT_PROMPT_VERSION, clientRequestId, responseId: null, finishReason: null, usage: { inputTokens: null, cachedInputTokens: null, cacheWriteInputTokens: null, outputTokens: null, reasoningTokens: null, totalTokens: null } }; }
