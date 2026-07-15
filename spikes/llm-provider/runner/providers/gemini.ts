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
  const generationConfig: Record<string, JsonValue> = {
    max_output_tokens: request.maxOutputTokens,
  };
  if (request.temperature !== null) generationConfig.temperature = request.temperature;
  return {
    model: request.model,
    system_instruction: request.systemPrompt,
    input: request.userPrompt,
    response_format: {
      type: 'text',
      mime_type: 'application/json',
      schema: request.outputSchema as JsonValue,
    },
    generation_config: generationConfig,
    store: false,
  };
}

function parseResponse(rawResponse: JsonValue): ProviderRawResult {
  const root = asRecord(rawResponse, 'gemini response');
  const steps = asArray(root.steps, 'gemini response.steps');
  const outputText: string[] = [];
  for (const stepValue of steps) {
    const step = asRecord(stepValue, 'gemini response.steps[]');
    if (step.type !== 'model_output') continue;
    for (const contentValue of asArray(step.content, 'gemini model output content')) {
      const content = asRecord(contentValue, 'gemini model output content[]');
      if (content.type === 'text' && typeof content.text === 'string') outputText.push(content.text);
    }
  }
  const rawText = outputText.join('');
  if (rawText.length === 0) throw new Error('gemini response did not contain model output text.');

  const usage = root.usage === undefined ? {} : asRecord(root.usage, 'gemini response.usage');
  return {
    provider: 'gemini',
    model: stringOrNull(root.model) ?? 'unknown',
    responseId: stringOrNull(root.id),
    structuredOutputMode: 'json_schema',
    rawText,
    finishReason: stringOrNull(root.status),
    usage: {
      inputTokens: numberOrNull(usage.total_input_tokens),
      cachedInputTokens: numberOrNull(usage.total_cached_tokens),
      cacheWriteInputTokens: null,
      outputTokens: numberOrNull(usage.total_output_tokens),
      reasoningTokens: numberOrNull(usage.total_thought_tokens),
      totalTokens: numberOrNull(usage.total_tokens),
    },
    rawResponse,
  };
}

export function createGeminiAdapter(fetchImplementation: FetchImplementation = globalThis.fetch): ProviderAdapter {
  const defaultBaseUrl = 'https://generativelanguage.googleapis.com/v1beta';
  return {
    id: 'gemini',
    defaultBaseUrl,
    apiKeyEnvironmentVariable: 'GEMINI_API_KEY',
    structuredOutputMode: 'json_schema',
    async run(request: ProviderRunRequest, config: ProviderRunConfig): Promise<ProviderRawResult> {
      const rawResponse = await postJson(
        'gemini',
        fetchImplementation,
        joinUrl(config.baseUrl ?? defaultBaseUrl, '/interactions'),
        { 'x-goog-api-key': config.apiKey },
        requestBody(request),
        request.timeoutMs,
      );
      return parseResponse(rawResponse);
    },
  };
}
