import type { ProviderAdapter } from '../types.js';
import { createAnthropicAdapter } from './anthropic.js';
import { createGeminiAdapter } from './gemini.js';
import { createOpenAiCompatibleAdapter } from './openai-compatible.js';
import { proxiedFetch } from './proxy-fetch.js';

export const providerAdapters: ProviderAdapter[] = [
  createOpenAiCompatibleAdapter({
    id: 'openai',
    defaultBaseUrl: 'https://api.openai.com/v1',
    apiKeyEnvironmentVariable: 'OPENAI_API_KEY',
    structuredOutputMode: 'json_schema',
    maxTokensField: 'max_completion_tokens',
    fetchImplementation: proxiedFetch,
  }),
  createAnthropicAdapter(),
  createGeminiAdapter(),
  createOpenAiCompatibleAdapter({
    id: 'deepseek',
    defaultBaseUrl: 'https://api.deepseek.com',
    apiKeyEnvironmentVariable: 'DEEPSEEK_API_KEY',
    structuredOutputMode: 'json_object',
    maxTokensField: 'max_tokens',
  }),
  createOpenAiCompatibleAdapter({
    id: 'zai',
    defaultBaseUrl: 'https://api.z.ai/api/paas/v4',
    apiKeyEnvironmentVariable: 'ZAI_API_KEY',
    structuredOutputMode: 'json_object',
    maxTokensField: 'max_tokens',
  }),
];

export function getProviderAdapter(providerId: string): ProviderAdapter {
  const adapter = providerAdapters.find((candidate) => candidate.id === providerId);
  if (adapter === undefined) {
    throw new Error(`Unknown provider ${providerId}. Available providers: ${providerAdapters.map((item) => item.id).join(', ')}`);
  }
  return adapter;
}

export { createAnthropicAdapter, createGeminiAdapter, createOpenAiCompatibleAdapter };
