import OpenAI from 'openai';
import type { ResponseCreateParamsStreaming, ResponseInputItem, ResponseOutputItem } from 'openai/resources/responses/responses';
import type { ReasoningEffort } from 'openai/resources/shared';
import type { ChatProvider, ChatProviderRequest } from './chat-types.ts';
import type { JsonValue } from './types.ts';
import { ProviderInvalidResponseError, ProviderTimeoutError } from './types.ts';
import { beginInvocation, concludeInvocation, recordInvocationResponse } from './invocation-ledger.ts';

function requestBody(request: ChatProviderRequest): ResponseCreateParamsStreaming {
  const effort = request.reasoningEffort;
  if (effort !== null && !['none','minimal','low','medium','high','xhigh','max'].includes(effort)) {
    throw new Error('Unsupported chat reasoning effort');
  }
  const input: ResponseInputItem[] = request.messages.flatMap((message): ResponseInputItem[] => {
    if (message.role === 'tool') return [{ type: 'function_call_output', call_id: message.toolCallId, output: message.content }];
    if (message.role !== 'assistant') return [{ role: message.role, content: message.content }];
    // The Responses contract requires the complete output, not reconstructed text/tool calls.
    // These JSON items came from a completed SDK response in this same bounded exchange.
    if (message.providerOutput) return message.providerOutput.items as unknown as ResponseInputItem[];
    return [...(message.content ? [{ role: 'assistant' as const, content: message.content }] : []),
      ...message.toolCalls.map(call => ({ type: 'function_call' as const, call_id: call.id, name: call.name, arguments: call.arguments }))];
  });
  return { model: request.model, input, stream: true, store: false,
    include: ['reasoning.encrypted_content'], parallel_tool_calls: false, tool_choice: request.toolChoice ?? 'auto',
    tools: request.tools.map(tool => ({ type: 'function', name: tool.name, description: tool.description,
      parameters: tool.parameters as Record<string, unknown>, strict: true })),
    max_output_tokens: request.maxOutputTokens,
    ...(effort === null ? {} : { reasoning: { effort: effort as ReasoningEffort } }),
  };
}

/** Standard Responses function loop, with the official SDK owning SSE decoding and cancellation. */
export function createOpenAiResponsesChatProvider(options: { fetchImplementation?: typeof globalThis.fetch } = {}): ChatProvider {
  return { async stream(request, config, onText) {
    const body = requestBody(request);
    const invocation = { provider: 'openai', model: request.model, invocationType: 'learner_chat',
      provenance: { ...request.provenance, requestSnapshot: body as unknown as JsonValue,
        settings: { api: 'responses', maxOutputTokens: request.maxOutputTokens,
          timeoutMs: request.timeoutMs, reasoningEffort: request.reasoningEffort } } };
    const invocationId = beginInvocation(invocation), startedAt = performance.now();
    const deadline = AbortSignal.timeout(request.timeoutMs);
    const signal = request.signal ? AbortSignal.any([deadline, request.signal]) : deadline;
    let text = '', bytes = 0, recorded = false;
    let response: JsonValue = null;
    const items: ResponseOutputItem[] = [];
    const events: JsonValue[] = [];
    const record = () => {
      if (recorded) return;
      recorded = true;
      recordInvocationResponse(invocationId, invocation, response ?? { stream_events: events });
    };
    try {
      const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseUrl ?? undefined,
        fetch: options.fetchImplementation, maxRetries: 0, timeout: request.timeoutMs });
      const stream = await client.responses.create(body, { signal });
      let completed = false;
      for await (const event of stream) {
        signal.throwIfAborted();
        const serialized = JSON.stringify(event);
        bytes += Buffer.byteLength(serialized);
        if (bytes > 1_048_576) { stream.controller.abort(); throw new ProviderInvalidResponseError('Chat response exceeded its byte limit'); }
        events.push(JSON.parse(serialized) as JsonValue);
        if (event.type === 'response.output_text.delta') { text += event.delta; await onText(event.delta); }
        else if (event.type === 'response.completed') {
          response = event.response as unknown as JsonValue;
          items.push(...event.response.output);
          completed = event.response.status === 'completed';
        } else if (event.type === 'response.failed' || event.type === 'response.incomplete') {
          response = event.response as unknown as JsonValue;
          throw new ProviderInvalidResponseError('Incomplete or failed chat response');
        } else if (event.type === 'error') throw new ProviderInvalidResponseError('Chat provider stream failed');
      }
      record();
      if (!completed || items.some(item => item.type === 'message' && item.content.some(part => part.type === 'refusal'))) {
        throw new ProviderInvalidResponseError('Incomplete or refused chat response');
      }
      const toolCalls = items.filter(item => item.type === 'function_call')
        .map(item => ({ id: item.call_id, name: item.name, arguments: item.arguments }));
      if ((!text && !toolCalls.length) || toolCalls.some(call => !call.id || !call.name)
        || new Set(toolCalls.map(call => call.id)).size !== toolCalls.length) throw new ProviderInvalidResponseError('Invalid chat output');
      concludeInvocation(invocationId, 'completed', performance.now() - startedAt);
      const result = response as unknown as { id: string; usage: JsonValue };
      return { message: { role: 'assistant', content: text, toolCalls,
        providerOutput: { provider: 'openai-responses', items: items as unknown as JsonValue[] } },
        invocationId, responseId: result.id, usage: result.usage };
    } catch (error) {
      record();
      const timedOut = deadline.aborted && !request.signal?.aborted;
      concludeInvocation(invocationId, timedOut ? 'timed_out' : error instanceof ProviderInvalidResponseError ? 'invalid_response' : 'failed', performance.now() - startedAt);
      if (timedOut) throw new ProviderTimeoutError('openai', request.timeoutMs);
      throw error;
    }
  } };
}
