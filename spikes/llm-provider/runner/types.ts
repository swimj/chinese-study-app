import type { SessionReflectionBundleV0, SessionReflectionResultV2 } from '../contracts.js';
import type { JsonSchema } from './result-schema.js';

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
  systemPrompt: string;
  userPrompt: string;
  outputSchemaName: string;
  outputSchema: JsonSchema;
  maxOutputTokens: number;
  temperature: number | null;
  timeoutMs: number;
  cachePrompt: boolean;
};

export type ProviderRunConfig = {
  apiKey: string;
  baseUrl: string | null;
};

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

export type ReflectionRunStatus =
  | 'success'
  | 'provider_error'
  | 'invalid_json'
  | 'schema_invalid'
  | 'contract_invalid';

export type ReflectionRunArtifactV0 = {
  schemaVersion: 'llm_provider_run.v0';
  runId: string;
  fixtureId: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  request: {
    provider: string;
    model: string;
    systemPromptFile: string;
    systemPromptSha256: string;
    userPromptSha256: string;
    outputSchemaSha256: string;
    maxOutputTokens: number;
    temperature: number | null;
    timeoutMs: number;
    cachePrompt: boolean;
  };
  inputBundle: SessionReflectionBundleV0;
  response: {
    status: ReflectionRunStatus;
    responseId: string | null;
    providerModel: string | null;
    structuredOutputMode: StructuredOutputMode;
    finishReason: string | null;
    rawText: string | null;
    parsedResult: SessionReflectionResultV2 | null;
    usage: NormalizedTokenUsage | null;
    validationErrors: string[];
    providerError: string | null;
    rawProviderResponse: JsonValue | null;
  };
};

export class ProviderHttpError extends Error {
  readonly status: number;
  readonly responseBody: string;

  constructor(provider: string, status: number, responseBody: string) {
    super(`${provider} returned HTTP ${status}: ${responseBody.slice(0, 1_000)}`);
    this.name = 'ProviderHttpError';
    this.status = status;
    this.responseBody = responseBody;
  }
}
