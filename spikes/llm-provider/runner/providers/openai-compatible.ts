import type {
  JsonValue,
  ProviderAdapter,
  ProviderRawResult,
  ProviderRunConfig,
  ProviderRunRequest,
  StructuredOutputMode,
} from '../types.js';
import {
  asArray,
  asRecord,
  joinUrl,
  numberOrNull,
  postJson,
  stringOrNull,
  type FetchImplementation,
} from './http.js';

type OpenAiCompatibleOptions = {
  id: string;
  defaultBaseUrl: string;
  apiKeyEnvironmentVariable: string;
  structuredOutputMode: StructuredOutputMode;
  maxTokensField: 'max_completion_tokens' | 'max_tokens';
  fetchImplementation?: FetchImplementation;
};

function requestBody(
  request: ProviderRunRequest,
  mode: StructuredOutputMode,
  maxTokensField: OpenAiCompatibleOptions['maxTokensField'],
): Record<string, JsonValue> {
  const systemPrompt = mode === 'json_schema'
    ? request.systemPrompt
    : [
        request.systemPrompt,
        '',
        'Return exactly one JSON object matching the following JSON Schema. Do not add prose or Markdown outside the object.',
        JSON.stringify(request.outputSchema),
      ].join('\n');
  const body: Record<string, JsonValue> = {
    model: request.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: request.userPrompt },
    ],
    [maxTokensField]: request.maxOutputTokens,
    response_format: mode === 'json_schema'
      ? {
          type: 'json_schema',
          json_schema: {
            name: request.outputSchemaName,
            strict: true,
            schema: request.outputSchema as JsonValue,
          },
        }
      : { type: 'json_object' },
  };
  if (request.temperature !== null) body.temperature = request.temperature;
  return body;
}

function parseResponse(
  provider: string,
  mode: StructuredOutputMode,
  rawResponse: JsonValue,
): ProviderRawResult {
  const root = asRecord(rawResponse, `${provider} response`);
  const firstChoice = asRecord(asArray(root.choices, `${provider} response.choices`)[0], `${provider} response.choices[0]`);
  const message = asRecord(firstChoice.message, `${provider} response.choices[0].message`);
  const rawText = stringOrNull(message.content);
  if (rawText === null) {
    const refusal = stringOrNull(message.refusal);
    if (refusal !== null) throw new Error(`${provider} refused the request: ${refusal}`);
    throw new Error(`${provider} response did not contain text content.`);
  }

  const usage = root.usage === undefined ? {} : asRecord(root.usage, `${provider} response.usage`);
  const promptDetails = usage.prompt_tokens_details === undefined
    ? {}
    : asRecord(usage.prompt_tokens_details, `${provider} response.usage.prompt_tokens_details`);
  const completionDetails = usage.completion_tokens_details === undefined
    ? {}
    : asRecord(usage.completion_tokens_details, `${provider} response.usage.completion_tokens_details`);

  return {
    provider,
    model: stringOrNull(root.model) ?? 'unknown',
    responseId: stringOrNull(root.id),
    structuredOutputMode: mode,
    rawText,
    finishReason: stringOrNull(firstChoice.finish_reason),
    usage: {
      inputTokens: numberOrNull(usage.prompt_tokens),
      cachedInputTokens: numberOrNull(usage.prompt_cache_hit_tokens) ?? numberOrNull(promptDetails.cached_tokens),
      cacheWriteInputTokens: null,
      outputTokens: numberOrNull(usage.completion_tokens),
      reasoningTokens: numberOrNull(completionDetails.reasoning_tokens),
      totalTokens: numberOrNull(usage.total_tokens),
    },
    rawResponse,
  };
}

export function createOpenAiCompatibleAdapter(options: OpenAiCompatibleOptions): ProviderAdapter {
  const fetchImplementation = options.fetchImplementation ?? globalThis.fetch;
  return {
    id: options.id,
    defaultBaseUrl: options.defaultBaseUrl,
    apiKeyEnvironmentVariable: options.apiKeyEnvironmentVariable,
    structuredOutputMode: options.structuredOutputMode,
    async run(request: ProviderRunRequest, config: ProviderRunConfig): Promise<ProviderRawResult> {
      const rawResponse = await postJson(
        options.id,
        fetchImplementation,
        joinUrl(config.baseUrl ?? options.defaultBaseUrl, '/chat/completions'),
        { authorization: `Bearer ${config.apiKey}` },
        requestBody(request, options.structuredOutputMode, options.maxTokensField),
        request.timeoutMs,
      );
      return parseResponse(options.id, options.structuredOutputMode, rawResponse);
    },
  };
}
