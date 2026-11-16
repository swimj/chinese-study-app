import { createHash, randomUUID } from 'node:crypto';
import { getDb } from './connection.ts';
import { requireLearnerId } from './learner-context.ts';
import type { JsonValue } from '../llm/types.ts';

export class ChatConflictError extends Error {}
export type ChatTurnStatus = 'running' | 'completed' | 'failed' | 'cancelled';
export type ChatTurn = { id: string; conversationId: string; request: JsonValue; status: ChatTurnStatus; createdAt: string; error: string | null };
export type ChatCard = { id: string; conversationId: string; turnId: string; body: JsonValue; version: number; createdAt: string; updatedAt: string };
export type ChatCursor = { createdAt: string; id: string };
let transactionSequence = 0;
/** Savepoints deliberately compose with the vocabulary adapter's learner-effects transaction. */
export function withChatTransaction<T>(operation: () => T): T {
  const name = `learner_chat_${++transactionSequence}`;
  getDb().exec(`SAVEPOINT ${name}`);
  try { const result = operation(); getDb().exec(`RELEASE ${name}`); return result; }
  catch (error) { getDb().exec(`ROLLBACK TO ${name}`); getDb().exec(`RELEASE ${name}`); throw error; }
}
function nonempty(value: string): void { if (!value.trim() || value.length > 200) throw new Error('Invalid chat identifier'); }
function canonical(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key]!)}`).join(',')}}`;
  return JSON.stringify(value);
}
function requireConversation(id: string): void {
  if (!getDb().prepare('SELECT 1 FROM learner_chat_conversations WHERE learner_id=? AND id=?').get(requireLearnerId(), id)) throw new Error('Chat conversation not found');
}
export function getOrCreateChatConversation(surface: string): string {
  nonempty(surface);
  const learner = requireLearnerId();
  return withChatTransaction(() => {
    const existing = getDb().prepare('SELECT id FROM learner_chat_conversations WHERE learner_id=? AND surface=?').get(learner, surface);
    if (existing) return String(existing.id);
    const id = randomUUID();
    getDb().prepare('INSERT INTO learner_chat_conversations(learner_id,id,surface,created_at) VALUES (?,?,?,?)').run(learner, id, surface, new Date().toISOString());
    return id;
  });
}
export function getChatTurn(id: string): ChatTurn | null {
  const row = getDb().prepare(`SELECT id,conversation_id AS conversationId,request_json AS request,status,created_at AS createdAt,error_text AS error
    FROM learner_chat_turns WHERE learner_id=? AND id=?`).get(requireLearnerId(), id) as Omit<ChatTurn, 'request'> & { request: string } | undefined;
  return row ? { ...row, request: JSON.parse(row.request) as JsonValue } : null;
}
export function startChatTurn(conversationId: string, clientTurnId: string, request: JsonValue): { turn: ChatTurn; created: boolean } {
  nonempty(clientTurnId); requireConversation(conversationId);
  return withChatTransaction(() => {
    const learner = requireLearnerId(), requestJson = canonical(request);
    const existing = findChatTurnByClientIdentity(conversationId,clientTurnId,request);
    if (existing) return { turn: existing, created: false };
    const id = randomUUID();
    getDb().prepare(`INSERT INTO learner_chat_turns(learner_id,id,conversation_id,client_turn_id,request_json,status,created_at)
      VALUES (?,?,?,?,?,'running',?)`).run(learner, id, conversationId, clientTurnId, requestJson, new Date().toISOString());
    return { turn: getChatTurn(id)!, created: true };
  });
}
export function appendChatEvent(turnId: string, event: JsonValue): number {
  return withChatTransaction(() => {
    if (getChatTurn(turnId)?.status !== 'running') throw new ChatConflictError('Chat turn is not running');
    const learner = requireLearnerId();
    const row = getDb().prepare('SELECT COALESCE(MAX(sequence),0)+1 AS sequence FROM learner_chat_events WHERE learner_id=? AND turn_id=?').get(learner, turnId)!;
    const sequence = Number(row.sequence);
    getDb().prepare('INSERT INTO learner_chat_events(learner_id,turn_id,sequence,event_json,created_at) VALUES (?,?,?,?,?)')
      .run(learner, turnId, sequence, JSON.stringify(event), new Date().toISOString());
    return sequence;
  });
}
export function finishChatTurn(turnId: string, status: Exclude<ChatTurnStatus, 'running'>, error: string | null = null): void {
  const result = getDb().prepare(`UPDATE learner_chat_turns SET status=?,finished_at=?,error_text=? WHERE learner_id=? AND id=? AND status='running'`)
    .run(status, new Date().toISOString(), error, requireLearnerId(), turnId);
  if (result.changes !== 1) throw new ChatConflictError('Chat turn is not running');
}
export function listChatEvents(turnId: string, afterSequence = 0, limit = 100): Array<{ sequence: number; event: JsonValue }> {
  pageLimit(limit);
  if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) throw new Error('Invalid chat event cursor');
  if (!getChatTurn(turnId)) throw new Error('Chat turn not found');
  return (getDb().prepare(`SELECT sequence,event_json FROM learner_chat_events WHERE learner_id=? AND turn_id=? AND sequence>? ORDER BY sequence LIMIT ?`)
    .all(requireLearnerId(), turnId, afterSequence, limit) as Array<{ sequence: number; event_json: string }>).map(row => ({ sequence: row.sequence, event: JSON.parse(row.event_json) as JsonValue }));
}
/** New turns expose only their atomic terminal explanation; legacy transcripts remain readable. */
export function chatTurnAssistantText(turnId: string): string {
  const events = getDb().prepare(`SELECT json_extract(event_json,'$.kind') AS kind,
    json_extract(event_json,'$.explanation') AS explanation,
    CASE WHEN json_extract(event_json,'$.kind')='text_delta' THEN json_extract(event_json,'$.text')
      WHEN json_extract(event_json,'$.kind')='assistant' THEN json_extract(event_json,'$.message.content') END AS text
    FROM learner_chat_events WHERE learner_id=? AND turn_id=? ORDER BY sequence`)
    .all(requireLearnerId(), turnId) as Array<{ kind: string; explanation: string | null; text: string | null }>;
  const final = events.find(event => event.kind === 'completion');
  if (final) return final.explanation ?? '';
  if (events.some(event => event.kind === 'completion_required')) return '';
  const deltas = events.filter(event => event.kind === 'text_delta').map(event => event.text ?? '').join('');
  return deltas || events.filter(event => event.kind === 'assistant').map(event => event.text ?? '').join('');
}
function pageLimit(limit: number): void { if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid chat page size'); }
export function listChatTurns(conversationId: string, cursor?: ChatCursor, limit = 30): ChatTurn[] {
  pageLimit(limit); requireConversation(conversationId);
  const rows = getDb().prepare(`SELECT id FROM learner_chat_turns WHERE learner_id=? AND conversation_id=?
    AND (created_at,id)>(?,?) ORDER BY created_at,id LIMIT ?`).all(requireLearnerId(), conversationId, cursor?.createdAt ?? '', cursor?.id ?? '', limit);
  return rows.map(row => getChatTurn(String(row.id))!);
}
export function getChatCard(id: string): ChatCard | null {
  const row = getDb().prepare(`SELECT id,conversation_id AS conversationId,turn_id AS turnId,body_json AS body,version,created_at AS createdAt,updated_at AS updatedAt
    FROM learner_chat_cards WHERE learner_id=? AND id=?`).get(requireLearnerId(), id) as Omit<ChatCard, 'body'> & { body: string } | undefined;
  return row ? { ...row, body: JSON.parse(row.body) as JsonValue } : null;
}
export function createChatCard(turnId: string, body: JsonValue): ChatCard {
  return withChatTransaction(() => {
    const turn = getChatTurn(turnId);
    if (turn?.status !== 'running') throw new ChatConflictError('Chat turn is not running');
    const id = randomUUID(), now = new Date().toISOString();
    getDb().prepare(`INSERT INTO learner_chat_cards(learner_id,id,conversation_id,turn_id,body_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`)
      .run(requireLearnerId(), id, turn.conversationId, turnId, JSON.stringify(body), now, now);
    appendChatEvent(turnId, { kind: 'card_created', cardId: id, body, version: 1 });
    return getChatCard(id)!;
  });
}
export function updateChatCard(cardId: string, expectedVersion: number, body: JsonValue): ChatCard {
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new Error('Invalid chat card version');
  const result = getDb().prepare(`UPDATE learner_chat_cards SET body_json=?,version=version+1,updated_at=? WHERE learner_id=? AND id=? AND version=?`)
    .run(JSON.stringify(body), new Date().toISOString(), requireLearnerId(), cardId, expectedVersion);
  if (result.changes !== 1) throw new ChatConflictError('Chat card changed or is unavailable');
  return getChatCard(cardId)!;
}
export function listChatCards(surface: string, cursor?: ChatCursor, limit = 30): ChatCard[] {
  pageLimit(limit);
  const rows = getDb().prepare(`SELECT c.id FROM learner_chat_cards c JOIN learner_chat_conversations v ON v.learner_id=c.learner_id AND v.id=c.conversation_id
    WHERE c.learner_id=? AND v.surface=? AND (c.created_at,c.id)>(?,?) ORDER BY c.created_at,c.id LIMIT ?`)
    .all(requireLearnerId(), surface, cursor?.createdAt ?? '', cursor?.id ?? '', limit);
  return rows.map(row => getChatCard(String(row.id))!);
}
/** Receipts replay the original result, even if the card subsequently changes. No provider callback here. */
export function runChatCardCommand(input: {
  cardId: string; clientActionId: string; request: JsonValue; expectedVersion: number;
  apply(card: ChatCard): JsonValue;
}): ChatCard {
  nonempty(input.clientActionId);
  const learner = requireLearnerId();
  const fingerprint = createHash('sha256').update(canonical({ cardId: input.cardId, expectedVersion: input.expectedVersion, request: input.request })).digest('hex');
  return withChatTransaction(() => {
    const receipt = getDb().prepare('SELECT card_id,request_fingerprint,result_json FROM learner_chat_commands WHERE learner_id=? AND client_action_id=?').get(learner, input.clientActionId);
    if (receipt) {
      if (receipt.card_id !== input.cardId || receipt.request_fingerprint !== fingerprint) throw new ChatConflictError('Chat action identity reused with different input');
      return JSON.parse(String(receipt.result_json)) as ChatCard;
    }
    const card = getChatCard(input.cardId);
    if (!card || card.version !== input.expectedVersion) throw new ChatConflictError('Chat card changed or is unavailable');
    const next = updateChatCard(card.id, card.version, input.apply(card));
    getDb().prepare('INSERT INTO learner_chat_commands(learner_id,client_action_id,card_id,request_fingerprint,result_json,created_at) VALUES (?,?,?,?,?,?)')
      .run(learner, input.clientActionId, card.id, fingerprint, JSON.stringify(next), new Date().toISOString());
    return next;
  });
}

/** Read the newest page, or the page preceding a turn in this conversation. */
export function listRecentChatTurns(conversationId: string, beforeId?: string, limit = 30): { turns: ChatTurn[]; before: string | null } {
  pageLimit(limit); requireConversation(conversationId);
  const learner = requireLearnerId();
  const before = beforeId ? getChatTurn(beforeId) : null;
  if (beforeId && before?.conversationId !== conversationId) throw new ChatConflictError('Unknown history cursor');
  const bound = before ? 'AND (created_at,id)<(?,?)' : '';
  const rows = getDb().prepare(`SELECT id FROM learner_chat_turns WHERE learner_id=? AND conversation_id=?
    ${bound} ORDER BY created_at DESC,id DESC LIMIT ?`)
    .all(learner, conversationId, ...(before ? [before.createdAt, before.id] : []), limit + 1);
  const page = rows.slice(0, limit).map(row => getChatTurn(String(row.id))!).reverse();
  return { turns: page, before: rows.length > limit ? page[0]!.id : null };
}
export function listChatTurnCards(turnId: string): ChatCard[] {
  const rows = getDb().prepare('SELECT id FROM learner_chat_cards WHERE learner_id=? AND turn_id=? ORDER BY created_at,id')
    .all(requireLearnerId(), turnId);
  return rows.map(row => getChatCard(String(row.id))!);
}

/** Recover old attempts only after the maximum turn lifetime. New attempts need a terminal receipt; legacy cards retain their recovery behavior. */
export function recoverInterruptedChatTurns(surface: string, createdBefore: string, now = new Date().toISOString()): void {
  const hasEvent = (kind: string) => `EXISTS (SELECT 1 FROM learner_chat_events e WHERE e.learner_id=t.learner_id
    AND e.turn_id=t.id AND json_extract(e.event_json,'$.kind')='${kind}')`;
  const committed = `(${hasEvent('completion')} OR (NOT ${hasEvent('completion_required')} AND
    EXISTS (SELECT 1 FROM learner_chat_cards c WHERE c.learner_id=t.learner_id AND c.turn_id=t.id)))`;
  getDb().prepare(`UPDATE learner_chat_turns AS t SET finished_at=?,
    status=CASE WHEN ${committed}
      THEN 'completed' ELSE 'failed' END,
    error_text=CASE WHEN ${committed}
      THEN NULL ELSE 'Chat turn was interrupted' END
    WHERE t.status='running' AND t.created_at<? AND EXISTS (
      SELECT 1 FROM learner_chat_conversations v WHERE v.learner_id=t.learner_id AND v.id=t.conversation_id AND v.surface=?)`)
    .run(now, createdBefore, surface);
}

/** Check replay identity before dispatching any provider work for a turn. */
export function findChatTurnByClientIdentity(conversationId: string, clientTurnId: string, request: JsonValue): ChatTurn | null {
  nonempty(clientTurnId);
  const existing = getDb().prepare('SELECT id,request_json FROM learner_chat_turns WHERE learner_id=? AND conversation_id=? AND client_turn_id=?')
    .get(requireLearnerId(), conversationId, clientTurnId);
  if (!existing) return null;
  if (existing.request_json !== canonical(request)) throw new ChatConflictError('Chat turn identity reused with different input');
  return getChatTurn(String(existing.id));
}
