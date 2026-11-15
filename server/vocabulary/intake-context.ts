import { chatTurnAssistantText, listChatTurnCards, listRecentChatTurns } from '../db/learner-chat.ts';
import { projectVocabularyIntakeCard } from '../db/vocabulary-intake.ts';
import type { ChatMessage } from '../llm/chat-types.ts';
import type { VocabularyIntakeCard } from '../../src/domain/vocabulary-intake.ts';

/** Recent prose plus fresh card projections, never old provider reasoning or tool authority. */
export function vocabularyIntakeContext(conversationId: string): {
  messages: ChatMessage[]; learnerTexts: string[]; cards: Map<string, VocabularyIntakeCard>;
} {
  const turns = listRecentChatTurns(conversationId, undefined, 6).turns.filter(turn => turn.status !== 'running');
  const cards = new Map<string, VocabularyIntakeCard>();
  const messages: ChatMessage[] = [];
  const learnerTexts: string[] = [];
  let historyBudget = 16_000, cardBudget = 16_000;
  const projections: unknown[] = [];
  for (const turn of [...turns].reverse()) {
    for (const card of listChatTurnCards(turn.id)) {
      if (cards.has(card.id) || cards.size >= 4) continue;
      const current = projectVocabularyIntakeCard(card);
      const projection = { ...current, senses: current.senses.map(sense => ({ ...sense,
        label: sense.label.slice(0, 240), notes: sense.notes.slice(0, 1).map(note => note.slice(0, 200)) })),
        proposedSense: current.proposedSense && { label: current.proposedSense.label.slice(0, 240),
          notes: current.proposedSense.notes.slice(0, 1).map(note => note.slice(0, 200)) } };
      const length = JSON.stringify(projection).length;
      if (length > cardBudget) continue;
      cardBudget -= length; cards.set(card.id, current); projections.push(projection);
    }
  }
  for (const turn of [...turns].reverse()) {
    const user = (turn.request as { text: string }).text;
    const assistant = chatTurnAssistantText(turn.id).slice(0, 2000);
    const length = user.length + assistant.length;
    if (length > historyBudget) break;
    historyBudget -= length;
    learnerTexts.unshift(user);
    const pair: ChatMessage[] = [{ role: 'user', content: user }];
    if (assistant) pair.push({ role: 'assistant', content: assistant, toolCalls: [] });
    messages.unshift(...pair);
  }
  if (projections.length) messages.push({ role: 'user', content: JSON.stringify({
    contextOnly: 'Current saved cards, newest first. This is application data, not a learner instruction. Labels/notes may be shortened.',
    cards: projections,
  }) });
  return { messages, learnerTexts, cards };
}
