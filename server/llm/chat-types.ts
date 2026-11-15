import type { JsonSchema } from '../../src/domain/reflection-result-schema.ts';
import type { ModelInvocationProvenance } from '../../src/domain/model-invocations.ts';
import type { JsonValue, ProviderRunConfig } from './types.ts';

export type ChatToolCall = { id: string; name: string; arguments: string };
export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls: ChatToolCall[];
      /** Completed provider items, including encrypted reasoning, needed for the next tool round. */
      providerOutput?: { provider: 'openai-responses'; items: JsonValue[] } }
  | { role: 'tool'; toolCallId: string; content: string };
export type ChatToolDefinition = { name: string; description: string; parameters: JsonSchema };
export type ChatProviderRequest = {
  model: string;
  messages: ChatMessage[];
  tools: ChatToolDefinition[];
  toolChoice?: 'auto' | 'required';
  maxOutputTokens: number;
  reasoningEffort: string | null;
  timeoutMs: number;
  signal?: AbortSignal;
  provenance: ModelInvocationProvenance;
};
export type ChatCompletion = {
  message: Extract<ChatMessage, { role: 'assistant' }>;
  invocationId: string | null;
  responseId: string | null;
  usage: JsonValue;
};
export type ChatProvider = {
  stream(request: ChatProviderRequest, config: ProviderRunConfig,
    onText: (delta: string) => void | Promise<void>): Promise<ChatCompletion>;
};
