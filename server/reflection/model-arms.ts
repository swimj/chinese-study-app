import type { ReflectionProviderConfig } from './luna-provider.ts';

/**
 * The complete comparison-arm registry. Registration never sends learner data
 * or requires credentials. Each arm uses the fixed reflection prompt and
 * strict V7 validator supplied by createReflectionProvider. Arms with
 * enabledByDefault enter the initial-generation random pool.
 */
const OPENROUTER = {
  provider: 'openrouter',
  reasoningEffort: 'high' as const,
  maxOutputTokens: 50_000,
  timeoutMs: 900_000,
  promptVersion: 'reflection-v8',
  defaultBaseUrl: 'https://openrouter.ai/api/v1',
  apiKeyEnvironmentVariable: 'OPENROUTER_API_KEY',
  structuredOutputMode: 'json_schema' as const,
  maxTokensField: 'max_tokens' as const,
};

export const REFLECTION_MODEL_ARMS = [
  {
    choice: 'openai:gpt-5.6-luna-high',
    label: 'Luna high',
    enabledByDefault: true,
    dogfoodSelectionWeight: 1,
    config: null,
  },
  {
    choice: 'zai:glm-5.3-high',
    label: 'GLM-5.3 high',
    enabledByDefault: true,
    dogfoodSelectionWeight: 1,
    config: null,
  },
  {
    choice: 'openrouter:gemini-3.6-flash',
    label: 'Gemini 3.6 Flash',
    enabledByDefault: true,
    dogfoodSelectionWeight: 1,
    config: {
      ...OPENROUTER,
      modelConfig: 'gemini-3.6-flash',
      providerModel: 'google/gemini-3.6-flash',
    } satisfies ReflectionProviderConfig,
  },
  {
    choice: 'openrouter:claude-sonnet-5',
    label: 'Claude Sonnet 5',
    enabledByDefault: true,
    dogfoodSelectionWeight: 1,
    config: {
      ...OPENROUTER,
      modelConfig: 'claude-sonnet-5',
      providerModel: 'anthropic/claude-sonnet-5',
      // This arm is only useful through Anthropic's native structured-output
      // path. Other OpenRouter endpoints have returned fenced, legacy-shaped
      // JSON despite accepting the strict response_format request.
      additionalRequestBody: {
        provider: {
          order: ['anthropic'],
          allow_fallbacks: false,
          require_parameters: true,
        },
      },
    } satisfies ReflectionProviderConfig,
  },
  {
    choice: 'openai:gpt-5.6-terra-high',
    label: 'GPT-5.6 Terra high',
    enabledByDefault: true,
    dogfoodSelectionWeight: 1,
    config: {
      provider: 'openai',
      modelConfig: 'gpt-5.6-terra-high',
      providerModel: 'gpt-5.6-terra',
      reasoningEffort: 'high',
      maxOutputTokens: 50_000,
      timeoutMs: 180_000,
      promptVersion: 'reflection-v8',
      defaultBaseUrl: 'https://api.openai.com/v1',
      apiKeyEnvironmentVariable: 'OPENAI_API_KEY',
      structuredOutputMode: 'json_schema',
      maxTokensField: 'max_completion_tokens',
      baseUrlEnvironmentVariable: 'OPENAI_BASE_URL',
    } satisfies ReflectionProviderConfig,
  },
] as const;

export type ReflectionModelChoice = (typeof REFLECTION_MODEL_ARMS)[number]['choice'];

export function isReflectionModelChoice(value: unknown): value is ReflectionModelChoice {
  return typeof value === 'string' && REFLECTION_MODEL_ARMS.some((arm) => arm.choice === value);
}
