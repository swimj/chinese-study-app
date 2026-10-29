import { PROVIDER_REQUEST_TIMEOUT_MS } from '../llm/types.ts';
import { GLM_FLASH_HIGH_REFLECTION_MODEL_CONFIG } from './glm-provider.ts';
import type { ReflectionProviderConfig } from './luna-provider.ts';

/**
 * The complete comparison-arm registry. Registration never sends learner data
 * or requires credentials. Each arm uses the fixed reflection prompt and
 * strict V7 validator supplied by createReflectionProvider. Arms with
 * enabledByDefault enter the initial-generation random pool and learner-facing
 * model pickers. Initial bundles of at most 10 items use GLM/Luna 70/30;
 * larger bundles use Sol/GLM/Luna 60/20/20. Keep withdrawn arms registered
 * so they can be re-offered by updating availability and weights.
 */
const OPENROUTER = {
  provider: 'openrouter',
  reasoningEffort: 'high' as const,
  maxOutputTokens: 50_000,
  timeoutMs: PROVIDER_REQUEST_TIMEOUT_MS,
  promptVersion: 'reflection-v9',
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
    dogfoodSelectionWeight: { smallBundle: 30, largeBundle: 20 },
    config: null,
  },
  {
    choice: 'zai:glm-5.3-flash-max',
    label: 'GLM-5.3 Flash max',
    enabledByDefault: false,
    dogfoodSelectionWeight: { smallBundle: 0, largeBundle: 0 },
    config: null,
  },
  {
    choice: 'zai:glm-5.3-flash-high',
    label: 'GLM-5.3 Flash high',
    enabledByDefault: true,
    dogfoodSelectionWeight: { smallBundle: 70, largeBundle: 20 },
    config: GLM_FLASH_HIGH_REFLECTION_MODEL_CONFIG satisfies ReflectionProviderConfig,
  },
  {
    choice: 'openrouter:gemini-3.6-flash',
    label: 'Gemini 3.6 Flash',
    enabledByDefault: false,
    dogfoodSelectionWeight: { smallBundle: 0, largeBundle: 0 },
    config: {
      ...OPENROUTER,
      modelConfig: 'gemini-3.6-flash',
      providerModel: 'google/gemini-3.6-flash',
    } satisfies ReflectionProviderConfig,
  },
  {
    choice: 'openai:gpt-5.6-terra-high',
    label: 'GPT-5.6 Terra high',
    enabledByDefault: false,
    dogfoodSelectionWeight: { smallBundle: 0, largeBundle: 0 },
    config: {
      provider: 'openai',
      modelConfig: 'gpt-5.6-terra-high',
      providerModel: 'gpt-5.6-terra',
      reasoningEffort: 'high',
      maxOutputTokens: 50_000,
      timeoutMs: PROVIDER_REQUEST_TIMEOUT_MS,
      promptVersion: 'reflection-v9',
      defaultBaseUrl: 'https://api.openai.com/v1',
      apiKeyEnvironmentVariable: 'OPENAI_API_KEY',
      structuredOutputMode: 'json_schema',
      maxTokensField: 'max_completion_tokens',
      baseUrlEnvironmentVariable: 'OPENAI_BASE_URL',
    } satisfies ReflectionProviderConfig,
  },
  {
    choice: 'openai:gpt-6-sol-high',
    label: 'GPT-6 Sol high',
    enabledByDefault: true,
    dogfoodSelectionWeight: { smallBundle: 0, largeBundle: 60 },
    config: {
      provider: 'openai',
      modelConfig: 'gpt-6-sol-high',
      providerModel: 'gpt-6-sol',
      reasoningEffort: 'high',
      maxOutputTokens: 50_000,
      timeoutMs: PROVIDER_REQUEST_TIMEOUT_MS,
      promptVersion: 'reflection-v9',
      defaultBaseUrl: 'https://api.openai.com/v1',
      apiKeyEnvironmentVariable: 'OPENAI_API_KEY',
      structuredOutputMode: 'json_schema',
      maxTokensField: 'max_completion_tokens',
      baseUrlEnvironmentVariable: 'OPENAI_BASE_URL',
    } satisfies ReflectionProviderConfig,
  },
] as const;

export type ReflectionModelChoice = (typeof REFLECTION_MODEL_ARMS)[number]['choice'];

export const LUNA_REFLECTION_MODEL_CHOICE = 'openai:gpt-5.6-luna-high' satisfies ReflectionModelChoice;

export function isReflectionModelChoice(value: unknown): value is ReflectionModelChoice {
  return typeof value === 'string' && REFLECTION_MODEL_ARMS.some((arm) => arm.choice === value);
}

export function isOfferedReflectionModelChoice(value: unknown): value is ReflectionModelChoice {
  return typeof value === 'string' && REFLECTION_MODEL_ARMS.some(
    (arm) => arm.choice === value && arm.enabledByDefault,
  );
}
