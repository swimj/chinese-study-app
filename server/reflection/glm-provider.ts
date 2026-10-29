import { PROVIDER_REQUEST_TIMEOUT_MS } from '../llm/types.ts';
import {
  createReflectionProvider,
  type LunaReflectionProvider,
  type LunaReflectionProviderOptions,
} from './luna-provider.ts';

const GLM_FLASH_TRANSPORT = {
  provider: 'zai',
  providerModel: 'glm-5.3-flash',
  // Z.AI rejects max_tokens above 131072 (error 1210).
  maxOutputTokens: 131_072,
  timeoutMs: PROVIDER_REQUEST_TIMEOUT_MS,
  promptVersion: 'reflection-v9',
  defaultBaseUrl: 'https://api.z.ai/api/paas/v4',
  apiKeyEnvironmentVariable: 'ZAI_API_KEY',
  structuredOutputMode: 'json_object',
  maxTokensField: 'max_tokens',
} as const;

export const GLM_REFLECTION_MODEL_CONFIG = {
  ...GLM_FLASH_TRANSPORT,
  modelConfig: 'glm-5.3-flash-max',
  reasoningEffort: 'max',
} as const;

export const GLM_FLASH_HIGH_REFLECTION_MODEL_CONFIG = {
  ...GLM_FLASH_TRANSPORT,
  modelConfig: 'glm-5.3-flash-high',
  reasoningEffort: 'high',
} as const;

export function createGlmReflectionProvider(
  options: LunaReflectionProviderOptions = {},
): LunaReflectionProvider {
  return createReflectionProvider(GLM_REFLECTION_MODEL_CONFIG, options);
}

export function createGlmFlashHighReflectionProvider(
  options: LunaReflectionProviderOptions = {},
): LunaReflectionProvider {
  return createReflectionProvider(GLM_FLASH_HIGH_REFLECTION_MODEL_CONFIG, options);
}
