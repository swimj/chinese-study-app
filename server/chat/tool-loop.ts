import type { ChatMessage, ChatProvider, ChatProviderRequest, ChatToolDefinition } from '../llm/chat-types.ts';
import type { JsonValue, ProviderRunConfig } from '../llm/types.ts';
import { validateJsonSchema } from '../llm/json-schema-validator.ts';
import { invalidateInvocation } from '../llm/invocation-ledger.ts';

export type ChatReadTool = ChatToolDefinition & { execute(input: JsonValue): Promise<JsonValue> };
export type ChatLoopEvent =
  | { kind: 'progress'; stage: 'checking' | 'looking_up' | 'preparing_reply' }
  | { kind: 'assistant'; message: Extract<ChatMessage, { role: 'assistant' }>; invocationId: string | null }
  | { kind: 'tool_result'; toolCallId: string; name: string; result: JsonValue }
  | { kind: 'completion'; result: JsonValue };

/** The output handler validates domain IDs and commits permitted effects before returning an actual card. */
export async function runChatToolLoop(input: {
  provider: ChatProvider; config: ProviderRunConfig;
  request: Omit<ChatProviderRequest, 'tools'>;
  reads: ChatReadTool[];
  output: ChatToolDefinition & { present(value: JsonValue): Promise<JsonValue> };
  onEvent(event: ChatLoopEvent): void | Promise<void>;
  maxIterations?: number;
  maxToolCalls?: number;
}): Promise<ChatMessage[]> {
  const maxIterations = input.maxIterations ?? 6, maxToolCalls = input.maxToolCalls ?? 12;
  if (!Number.isSafeInteger(maxIterations) || maxIterations < 1 || maxIterations > 16 ||
      !Number.isSafeInteger(maxToolCalls) || maxToolCalls < 1 || maxToolCalls > 32) throw new Error('Invalid chat loop bounds');
  const tools = [...input.reads, input.output];
  if (new Set(tools.map(tool => tool.name)).size !== tools.length) throw new Error('Duplicate chat tool names');
  const messages = [...input.request.messages];
  let calls = 0;
  const seenIds = new Set<string>();
  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    input.request.signal?.throwIfAborted();
    await input.onEvent({ kind: 'progress', stage: iteration === 1 ? 'checking' : 'preparing_reply' });
    const completion = await input.provider.stream({ ...input.request, toolChoice: 'required', messages, tools: tools.map(({ name, description, parameters }) => ({ name, description, parameters })),
      provenance: { ...input.request.provenance, stepName: 'chat', attemptNumber: iteration } }, input.config,
    () => undefined);
    const message = completion.message;
    messages.push(message);
    await input.onEvent({ kind: 'assistant', message, invocationId: completion.invocationId });
    if (message.toolCalls.length === 0) {
      invalidateInvocation(completion.invocationId);
      throw new Error('Chat requires an explicit completion call');
    }
    try {
      // Validate the complete batch before any tool runs; a malformed second call cannot follow a write.
      const validated = message.toolCalls.map(call => {
        if (++calls > maxToolCalls) throw new Error('Chat tool-call limit reached');
        if (seenIds.has(call.id)) throw new Error('Repeated chat tool-call identity');
        seenIds.add(call.id);
        const tool = tools.find(tool => tool.name === call.name);
        if (!tool) throw new Error(`Unknown chat tool: ${call.name}`);
        const value = JSON.parse(call.arguments) as JsonValue;
        const errors = validateJsonSchema(value, tool.parameters);
        if (errors.length) throw new Error(`Invalid ${call.name} arguments: ${errors.join('; ')}`);
        return { call, tool, value };
      });
      if (validated.some(({ tool }) => tool.name === input.output.name) && validated.length !== 1) {
        throw new Error('A completion must be the only tool call');
      }
      for (const { call, tool, value } of validated) {
        input.request.signal?.throwIfAborted();
        if (tool.name === input.output.name) {
          const card = await input.output.present(value);
          // Retain a complete tool exchange so a follow-up can reuse this context.
          messages.push({ role: 'tool', toolCallId: call.id, content: JSON.stringify(card) });
          // Do not abort between committed output and publishing its durable result.
          await input.onEvent({ kind: 'completion', result: card });
          return messages;
        }
        await input.onEvent({ kind: 'progress', stage: 'looking_up' });
        const result = await (tool as ChatReadTool).execute(value);
        messages.push({ role: 'tool', toolCallId: call.id, content: JSON.stringify(result) });
        await input.onEvent({ kind: 'tool_result', toolCallId: call.id, name: tool.name, result });
      }
    } catch (error) { invalidateInvocation(completion.invocationId); throw error; }
  }
  throw new Error('Chat iteration limit reached');
}
