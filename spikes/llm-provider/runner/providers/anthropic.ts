import type {
  JsonValue,
  ProviderAdapter,
  ProviderRawResult,
  ProviderRunConfig,
  ProviderRunRequest,
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

function requestBody(request: ProviderRunRequest): Record<string, JsonValue> {
  const body: Record<string, JsonValue> = {
    model: request.model,
    max_tokens: request.maxOutputTokens,
    system: request.cachePrompt
      ? [{ type: 'text', text: request.systemPrompt, cache_control: { type: 'ephemeral' } }]
      : request.systemPrompt,
    messages: [{ role: 'user', content: request.userPrompt }],
    output_config: {
      format: {
        type: 'json_schema',
        schema: request.outputSchema as JsonValue,
      },
    },
  };
  if (request.temperature !== null) body.temperature = request.temperature;
  return body;
}

function parseResponse(rawResponse: JsonValue): ProviderRawResult {
  const root = asRecord(rawResponse, 'anthropic response');
  const content = asArray(root.content, 'anthropic response.content');
  const textBlocks = content.filter((block) => {
    const record = asRecord(block, 'anthropic response.content[]');
    return record.type === 'text' && typeof record.text === 'string';
  });
  const rawText = textBlocks.map((block) => stringOrNull(asRecord(block, 'anthropic text block').text) ?? '').join('');
  if (rawText.length === 0) throw new Error('anthropic response did not contain a text block.');

  const usage = root.usage === undefined ? {} : asRecord(root.usage, 'anthropic response.usage');
  const inputTokens = numberOrNull(usage.input_tokens);
  const outputTokens = numberOrNull(usage.output_tokens);
  const cacheWriteInputTokens = numberOrNull(usage.cache_creation_input_tokens);
  const cachedInputTokens = numberOrNull(usage.cache_read_input_tokens);
  const totalTokens = [inputTokens, outputTokens, cacheWriteInputTokens, cachedInputTokens]
    .every((value) => value === null)
    ? null
    : [inputTokens, outputTokens, cacheWriteInputTokens, cachedInputTokens]
        .reduce<number>((total, value) => total + (value ?? 0), 0);

  return {
    provider: 'anthropic',
    model: stringOrNull(root.model) ?? 'unknown',
    responseId: stringOrNull(root.id),
    structuredOutputMode: 'json_schema',
    rawText,
    finishReason: stringOrNull(root.stop_reason),
    usage: {
      inputTokens,
      cachedInputTokens,
      cacheWriteInputTokens,
      outputTokens,
      reasoningTokens: null,
      totalTokens,
    },
    rawResponse,
  };
}

export function createAnthropicAdapter(fetchImplementation: FetchImplementation = globalThis.fetch): ProviderAdapter {
  const defaultBaseUrl = 'https://api.anthropic.com/v1';
  return {
    id: 'anthropic',
    defaultBaseUrl,
    apiKeyEnvironmentVariable: 'ANTHROPIC_API_KEY',
    structuredOutputMode: 'json_schema',
    async run(request: ProviderRunRequest, config: ProviderRunConfig): Promise<ProviderRawResult> {
      const rawResponse = await postJson(
        'anthropic',
        fetchImplementation,
        joinUrl(config.baseUrl ?? defaultBaseUrl, '/messages'),
        {
          'x-api-key': config.apiKey,
          'anthropic-version': '2023-06-01',
        },
        requestBody(request),
        request.timeoutMs,
      );
      return parseResponse(rawResponse);
    },
  };
}
