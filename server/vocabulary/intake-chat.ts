import { readFileSync } from 'node:fs';
import { runConversationTurn, type ConversationCompletion } from '../chat/conversation.ts';
import type { ChatReadTool } from '../chat/tool-loop.ts';
import { getDb } from '../db/connection.ts';
import { normalizeMandarinHanziLookup } from '../db/hanzi-lookup.ts';
import { ChatConflictError, chatTurnAssistantText, findChatTurnByClientIdentity, listChatTurnCards, listRecentChatTurns, recoverInterruptedChatTurns, type ChatTurnStatus } from '../db/learner-chat.ts';
import { getVocabularyLearnerWord, VocabularyStateInputError } from '../db/vocabulary-learners.ts';
import { resolveVocabularyLearnerSenseScope } from '../db/vocabulary-learner-senses.ts';
import { intakeConversationId, projectVocabularyIntakeCard, reviseVocabularyIntakeCard, saveVocabularyIntakeCard,
  type IntakeCardDraft, type IntakeCardRevision } from '../db/vocabulary-intake.ts';
import { vocabularyIntakeContext } from './intake-context.ts';
import { VOCABULARY_INTAKE_SURFACE } from '../db/vocabulary-intake-pending.ts';
import { queueVocabularyIntakeReadiness } from '../db/vocabulary-intake-readiness.ts';
import { runHostedProviderWork } from '../hosted-runtime-controls.ts';
import { createOpenAiResponsesChatProvider } from '../llm/chat-openai-responses.ts';
import type { ChatProvider } from '../llm/chat-types.ts';
import { fetchImplementationForProvider } from '../llm/proxy-fetch.ts';
import type { JsonValue, ProviderRunConfig } from '../llm/types.ts';
import type { JsonSchema } from '../../src/domain/reflection-result-schema.ts';
import type { VocabularyIntakeHistory, VocabularyIntakeStreamEvent, VocabularyIntakeTurn } from '../../src/domain/vocabulary-intake.ts';

export const INTAKE_MODEL = 'gpt-6-sol';
const timeoutMs = 20_000;
const turnLifetimeMs = 90_000;
export const intakePrompt = readFileSync(new URL('./reflection-prompts/intake-chat.md', import.meta.url), 'utf8');

const text: JsonSchema = { type: 'string' };
const nullableText: JsonSchema = { type: ['string', 'null'] };
const senseIds: JsonSchema = { type: 'array', maxItems: 16, items: text };
function object(properties: Record<string, JsonSchema>): JsonSchema {
  return { type: 'object', additionalProperties: false, required: Object.keys(properties), properties };
}
const cardParameters = object({
  wordId: text,
  decision: { type: 'string', enum: ['bare', 'context_match', 'inventory_pending', 'proposal', 'correction', 'larger_expression', 'existing'] },
  requestedLexeme: nullableText,
  context: nullableText,
  selection: object({ senseIds, targetSenseId: nullableText, includeProposedSense: { type: 'boolean' } }),
  proposedSense: { anyOf: [{ type: 'null' }, object({ label: text, notes: { type: 'array', maxItems: 8, items: text } })] },
});
const revisionParameters = object({
  cardId: text,
  action: { type: 'string', enum: ['set_senses', 'undo', 'revise_proposal'] },
  selection: { anyOf: [{ type: 'null' }, object({ senseIds, targetSenseId: nullableText, includeProposedSense: { type: 'boolean' } })] },
  proposedSense: { anyOf: [{ type: 'null' }, object({ label: text, notes: { type: 'array', maxItems: 8, items: text } })] },
  context: nullableText,
});

type IntakeCompletion = { explanation: string; action: { kind: 'answer' } | { kind: 'present_card'; card: IntakeCardDraft } | { kind: 'revise_card'; revision: IntakeCardRevision } };
const completionParameters = object({
  explanation: { type: 'string', description: 'Nonempty learner-facing explanation, at most 2000 characters.' },
  action: { anyOf: [object({kind:{type:'string',enum:['answer']}}),
    object({kind:{type:'string',enum:['present_card']},card:cardParameters}),
    object({kind:{type:'string',enum:['revise_card']},revision:revisionParameters})] },
});

type Lexical = { wordId: string; hanzi: string; traditional: string | null; pinyin: string; meaning: string; priority: number };
const lexicalProjection = 'id AS wordId,hanzi,traditional,pinyin,meaning,priority';
function hanzi(value: JsonValue): string {
  if (typeof value !== 'string' || !/^[\p{Script=Han}A-Za-z0-9·・'’\-]{1,24}$/u.test(value) || !/\p{Script=Han}/u.test(value)) throw new VocabularyStateInputError('Expected a Chinese lexical expression');
  return value;
}
function exact(value: string): Lexical[] {
  return getDb().prepare(`SELECT ${lexicalProjection} FROM lexical_words
    WHERE normalized_hanzi=? OR hanzi=? OR traditional=? ORDER BY priority DESC,id LIMIT 9`)
    .all(normalizeMandarinHanziLookup(value), value, value) as Lexical[];
}
function find(value: string, kind: 'similar' | 'containing', gloss: string | null): Lexical[] {
  const normalized = normalizeMandarinHanziLookup(value);
  if (kind === 'containing') return getDb().prepare(`SELECT ${lexicalProjection} FROM lexical_words
    WHERE length(normalized_hanzi)>length(?) AND instr(normalized_hanzi,?)>0
    ORDER BY length(hanzi),priority DESC,id LIMIT 5`).all(normalized, normalized) as Lexical[];
  const chars = [...normalized];
  const signatures = chars.map((_,i) => chars.map((character,j) => i === j ? '_' : character).join(''));
  const glossHint = gloss?.trim().slice(0,80) ?? '';
  return getDb().prepare(`SELECT ${lexicalProjection} FROM lexical_words
    WHERE normalized_hanzi<>? AND (normalized_hanzi IN (SELECT value FROM json_each(?))
      OR EXISTS(SELECT 1 FROM json_each(?) WHERE normalized_hanzi LIKE value)
      OR (?<>'' AND instr(lower(meaning),lower(?))>0))
    ORDER BY CASE WHEN ?<>'' AND instr(lower(meaning),lower(?))>0 THEN 0 ELSE 1 END,
      abs(length(hanzi)-length(?)),priority DESC,id LIMIT 5`)
    .all(normalized, JSON.stringify(chars.map((_,i) => chars.filter((_,j) => j !== i).join(''))),
      JSON.stringify(signatures), glossHint, glossHint, glossHint, glossHint, normalized) as Lexical[];
}
function validatedDraft(value: JsonValue, userText: string, observed: Map<string, Lexical>, priorLearnerTexts: string[]): { draft: IntakeCardDraft; allowAutomatic: boolean } {
  const draft = value as unknown as IntakeCardDraft;
  const sourceTexts = [...priorLearnerTexts, userText];
  const entry = observed.get(draft.wordId);
  if (!entry) throw new VocabularyStateInputError('The word must have been looked up in this turn');
  if (draft.context !== null && (!draft.context.trim() || !sourceTexts.some(text => text.includes(draft.context!)))) {
    throw new VocabularyStateInputError('Context must be quoted from the learner request');
  }
  if (draft.requestedLexeme !== null && (!hanzi(draft.requestedLexeme) || !sourceTexts.some(text => text.includes(draft.requestedLexeme!)))) {
    throw new VocabularyStateInputError('The requested spelling must be quoted from the learner request');
  }
  const matchedSpelling = draft.requestedLexeme === null ? [] : exact(draft.requestedLexeme);
  const direct = matchedSpelling.length === 1 && matchedSpelling[0]?.wordId === draft.wordId;
  const promptText = userText.trim().replace(/^[「“"《]+|[」”"》。！？.!?]+$/gu, '');
  const source = draft.requestedLexeme;
  const contextual = !!source && promptText.startsWith(source) && /^[\s:：—–\-，,(（]/u.test(promptText.slice(source.length));
  const allowAutomatic = direct && (draft.decision === 'bare' ? promptText === source
    : draft.decision === 'context_match' ? contextual && !!draft.context
    : draft.decision === 'inventory_pending' && (promptText === source || (contextual && !!draft.context)));
  if (draft.proposedSense && draft.context && draft.context.length > 16 &&
    [draft.proposedSense.label,...draft.proposedSense.notes].some(value => value.includes(draft.context!))) {
    throw new VocabularyStateInputError('Shared sense notes require a general example');
  }
  if (draft.decision === 'larger_expression' && (!source ||
    entry.hanzi === source || !normalizeMandarinHanziLookup(entry.hanzi).includes(normalizeMandarinHanziLookup(source)))) {
    throw new VocabularyStateInputError('The proposed expression must contain the requested component');
  }
  return { draft, allowAutomatic };
}

export function makeVocabularyIntakeProvider(): ChatProvider {
  return createOpenAiResponsesChatProvider({ fetchImplementation: fetchImplementationForProvider('openai',timeoutMs) });
}
export function vocabularyIntakeProviderConfig(): ProviderRunConfig {
  return { apiKey: process.env.OPENAI_API_KEY?.trim() ?? '', baseUrl: process.env.OPENAI_BASE_URL?.trim() || null };
}
export function recoverVocabularyIntakeTurns(): void {
  recoverInterruptedChatTurns(VOCABULARY_INTAKE_SURFACE, new Date(Date.now() - turnLifetimeMs - 30_000).toISOString());
}
export function getVocabularyIntakeHistory(before?: string): VocabularyIntakeHistory {
  const conversationId = intakeConversationId(), result = listRecentChatTurns(conversationId, before);
  const cards: VocabularyIntakeHistory['cards'] = [];
  const turns = result.turns.map(turn => {
    const userText = (turn.request as { text: string }).text;
    const attached = listChatTurnCards(turn.id);
    cards.push(...attached.map(projectVocabularyIntakeCard));
    const status: VocabularyIntakeTurn['status'] = turn.status === 'completed' ? 'complete' : turn.status === 'running' ? 'running' : 'failed';
    return { id: turn.id, userText, assistantText: chatTurnAssistantText(turn.id), status, cardIds: attached.map(card => card.id) };
  });
  return { conversationId, turns, cards, before: result.before };
}

/** A fresh identity is safe only after the prior attempt is durably terminal. */
export function vocabularyIntakeRetryWithNewId(clientTurnId: string, text: string): boolean {
  try {
    const turn = findChatTurnByClientIdentity(intakeConversationId(),clientTurnId,{text});
    return turn?.status === 'failed' || turn?.status === 'cancelled';
  } catch (error) {
    // An externally supplied identity reused for different text is not a failed attempt.
    if (error instanceof ChatConflictError) return false;
    throw error;
  }
}

export async function sendVocabularyIntakeTurn(input: {
  clientTurnId: string; text: string; publish(event: VocabularyIntakeStreamEvent): void;
  provider?: ChatProvider; providerConfig?: ProviderRunConfig; wake?: () => void;
}): Promise<string> {
  const conversationId = intakeConversationId(), observed = new Map<string, Lexical>();
  const userRequest = { text: input.text };
  const replay = (turnId: string, status: ChatTurnStatus) => {
    if (status === 'running') throw new ChatConflictError('This message is still being processed.');
    if (status !== 'completed') throw new ChatConflictError('This attempt ended. Send a new message to try again.');
    input.publish({type:'completion',assistantText:chatTurnAssistantText(turnId),cards:listChatTurnCards(turnId).map(projectVocabularyIntakeCard)});
    return turnId;
  };
  recoverVocabularyIntakeTurns();
  const previous = findChatTurnByClientIdentity(conversationId,input.clientTurnId,userRequest);
  if (previous) return replay(previous.id,previous.status);
  const context = vocabularyIntakeContext(conversationId);
  const wake = () => {
    if (input.wake) setImmediate(() => {
      try { input.wake?.(); } catch { console.error('Vocabulary intake worker wake failed'); }
    });
  };
  const observe = (matches: Lexical[]) => {
    for (const word of matches) {
      observed.set(word.wordId, word);
      queueVocabularyIntakeReadiness(word.wordId);
    }
    if (matches.length) wake();
    return matches.map(({ priority, ...word }) => {
      const scope = resolveVocabularyLearnerSenseScope(word.wordId);
      const learner = getVocabularyLearnerWord(word.wordId);
      return { ...word, frequencyPriority: priority,
        inventoryEstablished: scope.inventoryEstablished, defaultSenseIds: scope.defaultSenseIds, senses: scope.senses,
        learner: { inStash: !!learner?.inStash && !learner.dismissedAt, mode: learner?.dismissedAt ? null : learner?.mode ?? null,
          includedSenseIds: scope.includedSenseIds } };
    });
  };
  const read = (name: string, description: string, properties: Record<string, JsonSchema>,
    execute: (args: Record<string, JsonValue>) => unknown): ChatReadTool => ({
    name, description, parameters: object(properties), execute: async value => execute(value as Record<string, JsonValue>) as JsonValue,
  });
  const reads = [
    read('lookup_word','Look up exact Simplified or Traditional Chinese spelling. Each distinct identity includes its active senses, defaults and current learner state. A null default set is unknown; an empty set is established.',
      { hanzi: text }, args => observe(exact(hanzi(args.hanzi!)))),
    read('find_similar','Find potential character corrections or lexical matches. Supply a short English meaning hint or null.',
      { hanzi: text, gloss: nullableText }, args => observe(find(hanzi(args.hanzi!), 'similar', args.gloss as string | null))),
    read('find_expressions_containing','Find larger lexical expressions containing the given component.',
      { hanzi: text }, args => observe(find(hanzi(args.hanzi!), 'containing', null))),
  ];
  const provider = input.provider ?? makeVocabularyIntakeProvider(), config = input.providerConfig ?? vocabularyIntakeProviderConfig();
  const result = await runHostedProviderWork(() => runConversationTurn({
    conversationId, clientTurnId: input.clientTurnId, userRequest, provider, config, reads,
    request: { model: INTAKE_MODEL, maxOutputTokens: 2600, reasoningEffort: 'low', timeoutMs,
      signal: AbortSignal.timeout(turnLifetimeMs), provenance: { promptName: 'vocabulary-intake-chat', promptVersion: '9.1', schemaVersion: '4' },
      messages: [{ role: 'system', content: intakePrompt }, ...context.messages, { role: 'user', content: input.text }] },
    output: { name: 'complete_turn', description: 'Finish this turn with an explanation and an answer, a new vocabulary card, or a revision of one supplied current card.',
      parameters: completionParameters, complete: (value, turnId) => {
        const completion = value as unknown as IntakeCompletion;
        if (completion.action.kind === 'answer') return {explanation:completion.explanation,card:null};
        if (completion.action.kind === 'present_card') {
          const { draft, allowAutomatic } = validatedDraft(completion.action.card as unknown as JsonValue,input.text,observed,context.learnerTexts);
          return {explanation:completion.explanation,card:saveVocabularyIntakeCard(turnId,draft,allowAutomatic)};
        }
        const revision = completion.action.revision;
        const snapshot = context.cards.get(revision.cardId);
        if (!snapshot) throw new VocabularyStateInputError('Choose a card from the supplied recent context');
        if (revision.context !== null && (!revision.context.trim() || !input.text.includes(revision.context))) {
          throw new VocabularyStateInputError('New context must be quoted from this learner message');
        }
        if (revision.proposedSense) {
          const proposed = [revision.proposedSense.label, ...revision.proposedSense.notes].join(' ');
          if (revision.context && revision.context.length > 16 && proposed.includes(revision.context)) {
            throw new VocabularyStateInputError('Shared sense notes require a general example');
          }
        }
        return {explanation:completion.explanation,card:reviseVocabularyIntakeCard(turnId,snapshot,revision)};
      } },
    publish: event => {
      if (event.kind === 'progress') input.publish({type:'progress',stage:event.stage});
      if (event.kind === 'completion') {
        const completion = event.result as unknown as ConversationCompletion;
        wake();
        input.publish({type:'completion',assistantText:completion.explanation,
          cards:completion.card ? [projectVocabularyIntakeCard(completion.card)] : []});
      }
    },
  }));
  return result.created ? result.turnId : replay(result.turnId,result.status);
}
