import type { JsonSchema } from '../../src/domain/reflection-result-schema.js';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type NormalizedTokenUsage = {
  inputTokens: number | null;
  cachedInputTokens: number | null;
  cacheWriteInputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  totalTokens: number | null;
};

export type StructuredOutputMode = 'json_schema' | 'json_object';

export type ProviderRunRequest = {
  model: string;
  reasoningEffort: string | null;
  systemPrompt: string;
  userPrompt: string;
  outputSchemaName: string;
  outputSchema: JsonSchema;
  maxOutputTokens: number;
  temperature: number | null;
  timeoutMs: number;
  cachePrompt: boolean;
  clientRequestId?: string | null;
};

export type ProviderRunConfig = {
  apiKey: string;
  baseUrl: string | null;
};

/**
 * Raw transport output. This is intentionally an internal boundary: production
 * provider services must validate and sanitize it before returning.
 */
export type ProviderRawResult = {
  provider: string;
  model: string;
  responseId: string | null;
  structuredOutputMode: StructuredOutputMode;
  rawText: string;
  finishReason: string | null;
  usage: NormalizedTokenUsage;
  rawResponse: JsonValue;
};

export type ProviderAdapter = {
  id: string;
  defaultBaseUrl: string;
  apiKeyEnvironmentVariable: string;
  structuredOutputMode: StructuredOutputMode;
  run(request: ProviderRunRequest, config: ProviderRunConfig): Promise<ProviderRawResult>;
};

/** Provider finish reasons that indicate the model stopped before completing its output. */
export function isOutputTruncationFinishReason(finishReason: string | null): boolean {
  if (finishReason === null) return false;
  const normalized = finishReason.trim().toLowerCase().replaceAll(/[-\s]+/g, '_');
  return [
    'length',
    'max_tokens',
    'max_output_tokens',
    'max_tokens_reached',
    'max_output_tokens_reached',
    'max_tokens_limit',
    'max_output_tokens_limit',
    'incomplete',
  ].includes(normalized);
}

export class ProviderHttpError extends Error {
  readonly status: number;
  readonly responseBody: string;
  readonly requestId: string | null;
  readonly processingMs: string | null;

  constructor(
    provider: string,
    status: number,
    responseBody: string,
    responseHeaders: Headers,
  ) {
    super(`${provider} returned HTTP ${status}: ${responseBody.slice(0, 1_000)}`);
    this.name = 'ProviderHttpError';
    this.status = status;
    this.responseBody = responseBody;
    this.requestId = responseHeaders.get('x-request-id');
    this.processingMs = responseHeaders.get('openai-processing-ms');
  }
}
