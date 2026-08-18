import {
  createReflectionProvider,
  type LunaReflectionProvider,
  type LunaReflectionProviderOptions,
} from './luna-provider.ts';

const QWEN_SHARED = {
  provider: 'dashscope',
  reasoningEffort: 'high' as const,
  maxOutputTokens: 50_000,
  timeoutMs: 900_000,
  promptVersion: 'reflection-v7',
  defaultBaseUrl: 'https://ws-k76i8wy95wc9oheq.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',
  apiKeyEnvironmentVariable: 'DASHSCOPE_API_KEY',
  structuredOutputMode: 'json_object' as const,
  maxTokensField: 'max_tokens' as const,
  baseUrlEnvironmentVariable: 'DASHSCOPE_BASE_URL',
};

export const QWEN_3_8_MAX_REFLECTION_MODEL_CONFIG = {
  ...QWEN_SHARED,
  modelConfig: 'qwen3.8-max',
  providerModel: 'qwen3.8-max',
} as const;

export function createQwen38MaxReflectionProvider(
  options: LunaReflectionProviderOptions = {},
): LunaReflectionProvider {
  return createReflectionProvider(QWEN_3_8_MAX_REFLECTION_MODEL_CONFIG, options);
}
