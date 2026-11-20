
import { PROVIDER_REQUEST_TIMEOUT_MS, type JsonValue } from '../llm/types.js';
import {
  PURE_CUE_PROMOTION_PROMPT_VERSION,
  STAGED_REFLECTION_DIAGNOSIS_PROMPT_VERSION,
} from '../../src/domain/reflection-contracts.ts';

export const LUNA_REFLECTION_MODEL_CONFIG = {
  provider: 'openai',
  modelConfig: 'gpt-6-luna-high',
  providerModel: 'gpt-6-luna',
  reasoningEffort: 'high',
  maxOutputTokens: 50_000,
  timeoutMs: PROVIDER_REQUEST_TIMEOUT_MS,
  promptVersion: 'reflection-v9',
  defaultBaseUrl: 'https://api.openai.com/v1',
  apiKeyEnvironmentVariable: 'OPENAI_API_KEY',
  structuredOutputMode: 'json_schema',
  maxTokensField: 'max_completion_tokens',
  baseUrlEnvironmentVariable: 'OPENAI_BASE_URL',
} as const;
export const LUNA_REFLECTION_PROMPT_VERSION = 'reflection-v9' as const;
export {
  PURE_CUE_PROMOTION_PROMPT_VERSION,
  STAGED_REFLECTION_DIAGNOSIS_PROMPT_VERSION,
} from '../../src/domain/reflection-contracts.ts';

export type ReflectionProviderConfig = {
  provider: string;
  modelConfig: string;
  providerModel: string;
  reasoningEffort: 'high' | 'max';
  maxOutputTokens: number;
  timeoutMs: number;
  promptVersion: string;
  defaultBaseUrl: string;
  apiKeyEnvironmentVariable: string;
  structuredOutputMode: 'json_schema' | 'json_object';
  maxTokensField: 'max_completion_tokens' | 'max_tokens';
  baseUrlEnvironmentVariable?: string;
  /** Transport-specific request fields for OpenAI-compatible providers. */
  additionalRequestBody?: Record<string, JsonValue>;
};
