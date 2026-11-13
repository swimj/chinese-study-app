import { getDb } from './connection.ts';
import { requireLearnerId } from './learner-context.ts';
import { listOwnVocabularyMessages } from './vocabulary-reflection.ts';
import {
  ContentReactionInputError, NOT_FOR_ME_REASONS,
  type ContentReaction, type ContentReactionInput, type ContentReactionState, type ContentReactionSummary,
  type NotForMeReason, type ReactionSubject, type SavedCollection, type SavedConnection,
} from '../../src/domain/content-reactions.ts';
import type { SessionDebriefInput, SessionDebriefResult } from '../../src/domain/session-debrief.ts';

/** Most recent ready Connections sessions included in the All view; saved notes are always included. */
export const SAVED_COLLECTION_SESSION_LIMIT = 120;

export class ContentReactionNotFoundError extends Error {}

type ReactionRow = {
  subject_kind: 'connection' | 'lesson'; session_id: string | null; note_index: number | null; message_id: string | null;
  reaction: ContentReaction; reasons_json: string; personal_note: string | null; updated_at: string;
};

function subjectOf(row: Pick<ReactionRow, 'subject_kind' | 'session_id' | 'note_index' | 'message_id'>): ReactionSubject {
  if (row.subject_kind === 'connection') {
    if (row.session_id === null || row.note_index === null) throw new Error('Connection reaction lacks its note identity');
    return { kind: 'connection', sessionId: row.session_id, noteIndex: row.note_index };
  }
  if (row.message_id === null) throw new Error('Lesson reaction lacks its message identity');
  return { kind: 'lesson', messageId: row.message_id };
}
function stateOf(row: ReactionRow): ContentReactionState {
  return { subject: subjectOf(row), reaction: row.reaction, reasons: JSON.parse(row.reasons_json) as NotForMeReason[],
    note: row.personal_note, updatedAt: row.updated_at };
}
function columns(subject: ReactionSubject): [string | null, number | null, string | null] {
  return subject.kind === 'connection' ? [subject.sessionId, subject.noteIndex, null] : [null, null, subject.messageId];
}
const SUBJECT_MATCH = `subject_kind = ? AND session_id IS ? AND note_index IS ? AND message_id IS ?`;

function readReaction(subject: ReactionSubject): ReactionRow | undefined {
  return getDb().prepare(`SELECT * FROM learner_content_reactions WHERE learner_id = ? AND ${SUBJECT_MATCH}`)
    .get(requireLearnerId(), subject.kind, ...columns(subject)) as ReactionRow | undefined;
}

/** A learner can react only to their own ready connection note or their own lesson. */
function assertOwnSubject(subject: ReactionSubject): void {
  if (subject.kind === 'connection') {
    const row = getDb().prepare(`SELECT result_json FROM learner_session_debrief_jobs
      WHERE learner_id = ? AND session_id = ? AND status = 'ready'`).get(requireLearnerId(), subject.sessionId) as { result_json: string } | undefined;
    const notes = row ? (JSON.parse(row.result_json) as SessionDebriefResult).notes : [];
    if (subject.noteIndex >= notes.length) throw new ContentReactionNotFoundError('Connection not found');
    return;
  }
  const row = getDb().prepare('SELECT 1 FROM learner_messages WHERE learner_id = ? AND message_id = ?')
    .get(requireLearnerId(), subject.messageId);
  if (!row) throw new ContentReactionNotFoundError('Feedback lesson not found');
}

/** Replace one subject's reaction state. Reaction changes are appended to the event history; note-only edits are not. */
export function setContentReaction(input: ContentReactionInput, now = new Date().toISOString()): ContentReactionState | null {
  if (input.reasons.length && input.reaction !== 'not_for_me') throw new ContentReactionInputError('Reasons apply only to not_for_me');
  if (input.note !== null && input.reaction !== 'saved') throw new ContentReactionInputError('Notes apply only to saved items');
  return transaction(() => {
    assertOwnSubject(input.subject);
    const learnerId = requireLearnerId();
    const previous = readReaction(input.subject);
    const reasonsJson = JSON.stringify(input.reasons);
    const reactionChanged = (previous?.reaction ?? null) !== input.reaction || (previous?.reasons_json ?? '[]') !== reasonsJson;
    if (input.reaction === null) {
      if (previous) getDb().prepare(`DELETE FROM learner_content_reactions WHERE learner_id = ? AND ${SUBJECT_MATCH}`)
        .run(learnerId, input.subject.kind, ...columns(input.subject));
    } else if (previous) {
      getDb().prepare(`UPDATE learner_content_reactions SET reaction = ?, reasons_json = ?, personal_note = ?, surface = ?, updated_at = ?
        WHERE learner_id = ? AND ${SUBJECT_MATCH}`)
        .run(input.reaction, reasonsJson, input.note, input.surface, now, learnerId, input.subject.kind, ...columns(input.subject));
    } else {
      getDb().prepare(`INSERT INTO learner_content_reactions
        (learner_id, subject_kind, session_id, note_index, message_id, reaction, reasons_json, personal_note, surface, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(learnerId, input.subject.kind, ...columns(input.subject), input.reaction, reasonsJson, input.note, input.surface, now, now);
    }
    if (reactionChanged) getDb().prepare(`INSERT INTO learner_content_reaction_events
      (learner_id, subject_kind, session_id, note_index, message_id, reaction, reasons_json, surface, occurred_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(learnerId, input.subject.kind, ...columns(input.subject), input.reaction, reasonsJson, input.surface, now);
    const current = readReaction(input.subject);
    return current ? stateOf(current) : null;
  });
}

export function listContentReactions(): ContentReactionState[] {
  return (getDb().prepare('SELECT * FROM learner_content_reactions WHERE learner_id = ? ORDER BY updated_at DESC')
    .all(requireLearnerId()) as ReactionRow[]).map(stateOf);
}

type ReadyJobRow = { session_id: string; completed_at: string; input_json: string; result_json: string };

/** Saved items plus recent ready connections, newest first. */
export function getSavedCollection(sessionLimit = SAVED_COLLECTION_SESSION_LIMIT): SavedCollection {
  const learnerId = requireLearnerId();
  const reactions = listContentReactions();
  const byKey = new Map(reactions.map((state) => [JSON.stringify(state.subject), state]));
  const jobs = getDb().prepare(`SELECT session_id, completed_at, input_json, result_json FROM learner_session_debrief_jobs AS jobs
    WHERE learner_id = ? AND status = 'ready' AND json_array_length(result_json, '$.notes') > 0
      AND (session_id IN (SELECT session_id FROM learner_session_debrief_jobs WHERE learner_id = ? AND status = 'ready'
            AND json_array_length(result_json, '$.notes') > 0 ORDER BY completed_at DESC, session_id DESC LIMIT ?)
        OR EXISTS (SELECT 1 FROM learner_content_reactions AS r WHERE r.learner_id = jobs.learner_id
            AND r.subject_kind = 'connection' AND r.session_id = jobs.session_id AND r.reaction = 'saved'))
    ORDER BY completed_at DESC, session_id DESC`).all(learnerId, learnerId, sessionLimit) as ReadyJobRow[];
  const connections: SavedConnection[] = jobs.flatMap((job) => {
    const input = JSON.parse(job.input_json) as SessionDebriefInput;
    const items = new Map(input.items.map((item) => [item.ref, item]));
    return (JSON.parse(job.result_json) as SessionDebriefResult).notes.map((note, noteIndex) => ({
      sessionId: job.session_id, noteIndex, completedAt: job.completed_at, text: note.text,
      words: note.refs.flatMap((ref) => { const item = items.get(ref); return item ? [{ word: item.word, pinyin: item.pinyin }] : []; }),
      reaction: byKey.get(JSON.stringify({ kind: 'connection', sessionId: job.session_id, noteIndex })) ?? null,
    }));
  });
  const savedLessons = new Map(reactions.filter((state) => state.subject.kind === 'lesson' && state.reaction === 'saved')
    .map((state) => [(state.subject as { messageId: string }).messageId, state]));
  const lessons = listOwnVocabularyMessages().filter((message) => savedLessons.has(message.messageId)).reverse()
    .map((message) => ({ messageId: message.messageId, subjectLabel: message.subjectLabel, body: message.body,
      createdAt: message.createdAt, reaction: savedLessons.get(message.messageId)! }));
  return { connections, lessons };
}

/** Operator aggregate across learners. Only items flagged Wrong are returned with their text. */
export function getContentReactionSummary(flaggedLimit = 50): ContentReactionSummary {
  const db = getDb();
  const totals = db.prepare(`SELECT subject_kind AS kind, reaction, COUNT(*) AS count FROM learner_content_reactions
    GROUP BY subject_kind, reaction ORDER BY subject_kind, reaction`).all().map((row) => ({ ...row })) as ContentReactionSummary['totals'];
  const reasonCounts = db.prepare(`SELECT subject_kind AS kind, reason.value AS reason, COUNT(*) AS count
    FROM learner_content_reactions, json_each(reasons_json) AS reason GROUP BY subject_kind, reason.value`).all().map((row) => ({ ...row })) as ContentReactionSummary['reasons'];
  const reasons = reasonCounts.sort((a, b) => a.kind.localeCompare(b.kind)
    || NOT_FOR_ME_REASONS.indexOf(a.reason) - NOT_FOR_ME_REASONS.indexOf(b.reason));
  // The successful attempt carries the model and prompt that wrote the notes.
  const connectionsByPrompt = db.prepare(`WITH produced AS (
      SELECT jobs.learner_id, jobs.session_id, json_array_length(jobs.result_json, '$.notes') AS notes,
        attempt.prompt_version, attempt.model
      FROM learner_session_debrief_jobs AS jobs
      JOIN learner_session_debrief_attempts AS attempt ON attempt.learner_id = jobs.learner_id
        AND attempt.session_id = jobs.session_id AND attempt.outcome = 'ready'
      WHERE jobs.status = 'ready' AND json_array_length(jobs.result_json, '$.notes') > 0)
    SELECT produced.prompt_version AS promptVersion, produced.model AS model, SUM(produced.notes) AS notes,
      (SELECT COUNT(*) FROM learner_content_reactions AS r JOIN produced AS p ON p.learner_id = r.learner_id AND p.session_id = r.session_id
        WHERE p.prompt_version = produced.prompt_version AND p.model = produced.model AND r.reaction = 'saved') AS saved,
      (SELECT COUNT(*) FROM learner_content_reactions AS r JOIN produced AS p ON p.learner_id = r.learner_id AND p.session_id = r.session_id
        WHERE p.prompt_version = produced.prompt_version AND p.model = produced.model AND r.reaction = 'not_for_me') AS notForMe
    FROM produced GROUP BY produced.prompt_version, produced.model ORDER BY produced.prompt_version DESC, produced.model`)
    .all().map((row) => ({ ...row })) as ContentReactionSummary['connectionsByPrompt'];
  const flaggedRows = db.prepare(`SELECT r.subject_kind, r.learner_id, r.updated_at, r.note_index,
      jobs.result_json, messages.body_json, words.hanzi
    FROM learner_content_reactions AS r, json_each(r.reasons_json) AS reason
    LEFT JOIN learner_session_debrief_jobs AS jobs ON r.subject_kind = 'connection' AND jobs.learner_id = r.learner_id AND jobs.session_id = r.session_id
    LEFT JOIN learner_messages AS messages ON r.subject_kind = 'lesson' AND messages.message_id = r.message_id AND messages.learner_id = r.learner_id
    LEFT JOIN reflection_cases AS cases ON cases.case_id = messages.case_id
    LEFT JOIN lexical_words AS words ON words.id = cases.word_id
    WHERE reason.value = 'wrong' ORDER BY r.updated_at DESC LIMIT ?`).all(flaggedLimit) as Array<{
      subject_kind: 'connection' | 'lesson'; learner_id: string; updated_at: string; note_index: number | null;
      result_json: string | null; body_json: string | null; hanzi: string | null }>;
  const flaggedWrong = flaggedRows.map((row) => row.subject_kind === 'connection'
    ? { kind: row.subject_kind, learnerId: row.learner_id, at: row.updated_at, label: 'Connection',
        text: (JSON.parse(row.result_json!) as SessionDebriefResult).notes[row.note_index!]?.text ?? '' }
    : { kind: row.subject_kind, learnerId: row.learner_id, at: row.updated_at, label: row.hanzi ? `Lesson · ${row.hanzi}` : 'Lesson',
        text: flattenLessonText(JSON.parse(row.body_json!) as unknown) });
  return { totals, reasons, connectionsByPrompt, flaggedWrong };
}

function flattenLessonText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(flattenLessonText).filter(Boolean).join('\n\n');
  if (typeof value === 'object' && value !== null) return Object.values(value).map(flattenLessonText).filter(Boolean).join('\n\n');
  return '';
}

function transaction<T>(work: () => T): T {
  getDb().exec('BEGIN IMMEDIATE');
  try { const result = work(); getDb().exec('COMMIT'); return result; }
  catch (error) { getDb().exec('ROLLBACK'); throw error; }
}
