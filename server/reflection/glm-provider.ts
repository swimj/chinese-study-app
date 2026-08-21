import {
  createReflectionProvider,
  type LunaReflectionProvider,
  type LunaReflectionProviderOptions,
} from './luna-provider.ts';

export const GLM_REFLECTION_MODEL_CONFIG = {
  provider: 'zai',
  modelConfig: 'glm-5.3-high',
  providerModel: 'glm-5.3',
  reasoningEffort: 'high',
  maxOutputTokens: 50_000,
  timeoutMs: 900_000,
  promptVersion: 'reflection-v7',
  defaultBaseUrl: 'https://api.z.ai/api/paas/v4',
  apiKeyEnvironmentVariable: 'ZAI_API_KEY',
  structuredOutputMode: 'json_object',
  maxTokensField: 'max_tokens',
} as const;

export function createGlmReflectionProvider(
  options: LunaReflectionProviderOptions = {},
): LunaReflectionProvider {
  return createReflectionProvider(GLM_REFLECTION_MODEL_CONFIG, options);
}
