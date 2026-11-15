import { appendChatEvent, finishChatTurn, getChatCard, getChatTurn, listChatTurnCards, startChatTurn, withChatTransaction, type ChatCard, type ChatTurn } from '../db/learner-chat.ts';
import { runChatToolLoop, type ChatLoopEvent, type ChatReadTool } from './tool-loop.ts';
import type { ChatProvider, ChatProviderRequest, ChatToolDefinition } from '../llm/chat-types.ts';
import type { JsonValue, ProviderRunConfig } from '../llm/types.ts';

export type ConversationCompletion = { explanation: string; card: ChatCard | null };
/** Domain writes must be synchronous so the final explanation and effects share one transaction. */
type ConversationOutput = ChatToolDefinition & { complete(value: JsonValue, turnId: string): ConversationCompletion };

/** One durable attempt per client identity. Failed/interrupted turns are never silently replayed. */
export async function runConversationTurn(input: {
  conversationId: string; clientTurnId: string; userRequest: JsonValue;
  provider: ChatProvider; config: ProviderRunConfig;
  request: Omit<ChatProviderRequest, 'tools'>;
  reads: ChatReadTool[];
  output: ConversationOutput;
  publish?(event: ChatLoopEvent): void | Promise<void>;
}): Promise<{ turnId: string; status: ChatTurn['status']; created: boolean }> {
  const { turn, created } = withChatTransaction(() => {
    const result = startChatTurn(input.conversationId, input.clientTurnId, input.userRequest);
    if (result.created) appendChatEvent(result.turn.id, { kind: 'completion_required', version: 1 });
    return result;
  });
  if (!created) return { turnId: turn.id, status: turn.status, created: false };
  try {
    await runChatToolLoop({ ...input,
      request: { ...input.request, provenance: { ...input.request.provenance, workflowId: turn.id } },
      output: { ...input.output, present: async value => withChatTransaction(() => {
        const result = input.output.complete(value, turn.id);
        if (typeof result.explanation !== 'string' || !result.explanation.trim() || result.explanation.length > 2000) {
          throw new Error('Completion requires a nonempty explanation of at most 2000 characters');
        }
        const attached = listChatTurnCards(turn.id);
        const stored = result.card === null ? null : getChatCard(result.card.id);
        if (result.card === null ? attached.length !== 0 : (!stored || stored.conversationId !== input.conversationId
          || stored.version !== result.card.version || attached.length !== 1 || attached[0]?.id !== stored.id)) {
          throw new Error('Completion must match the card committed to this learner turn');
        }
        appendChatEvent(turn.id, { kind: 'completion', version: 1, explanation: result.explanation, cardId: stored?.id ?? null });
        finishChatTurn(turn.id, 'completed');
        return { explanation: result.explanation, card: stored } as unknown as JsonValue;
      }) },
      onEvent: async event => {
        // Completion was committed with its effects; transient progress never enters history.
        if (event.kind !== 'progress' && event.kind !== 'completion') appendChatEvent(turn.id, event as unknown as JsonValue);
        // A client connection is an observer, not the owner of an already committed action.
        try { await input.publish?.(event); } catch { /* reconnect reads the durable completion */ }
      },
    });
    return { turnId: turn.id, status: 'completed', created: true };
  } catch (error) {
    if (getChatTurn(turn.id)?.status === 'running') {
      finishChatTurn(turn.id, input.request.signal?.aborted ? 'cancelled' : 'failed', error instanceof Error ? error.message : 'Chat turn failed');
    }
    throw error;
  }
}
