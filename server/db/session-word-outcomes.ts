import type { Word } from '../../src/types.ts';
import type { SessionCompletionReport, SessionCompletionWord } from '../../src/domain/session-completion.ts';
import { getDb } from './connection.ts';
import { requireLearnerId } from './learner-context.ts';

export class SessionWordOutcomeConflictError extends Error {}
export function assertSessionAcceptsNewWordOutcome(sessionId: string): void {
  if (getDb().prepare(`SELECT 1 FROM learner_session_completions
    WHERE learner_id = ? AND session_id = ? AND status IN ('pending','failed','closed')`)
    .get(requireLearnerId(), sessionId)) throw new SessionWordOutcomeConflictError('Session is closing or already closed');
}
type OutcomeKind = 'introduction' | 'learning';
export function getSessionWordOutcome(sessionId: string, wordId: string, kind: OutcomeKind): Word | null {
  const row = getDb().prepare(`SELECT word_json FROM learner_session_word_outcomes
    WHERE learner_id = ? AND session_id = ? AND word_id = ? AND kind = ?`)
    .get(requireLearnerId(), sessionId, wordId, kind) as { word_json: string } | undefined;
  return row ? JSON.parse(row.word_json) as Word : null;
}
export function recordSessionWordOutcome(sessionId: string, beforeStatus: string, word: Word, kind: OutcomeKind): void {
  if (!sessionId.trim()) throw new Error('Expected non-empty session id');
  getDb().prepare(`INSERT INTO learner_session_word_outcomes
    (learner_id, session_id, word_id, kind, before_status, after_status, word_json, committed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(requireLearnerId(), sessionId, word.id, kind, beforeStatus, word.status, JSON.stringify(word), new Date().toISOString());
}
export function getSessionWordReport(sessionId: string): SessionCompletionReport {
  const rows = getDb().prepare(`SELECT before_status, after_status, word_json FROM learner_session_word_outcomes
    WHERE learner_id = ? AND session_id = ? ORDER BY committed_at, word_id`)
    .all(requireLearnerId(), sessionId) as Array<{ before_status: string; after_status: string; word_json: string }>;
  const newWords: SessionCompletionWord[] = []; const graduatedWords: SessionCompletionWord[] = [];
  for (const row of rows) {
    const word = JSON.parse(row.word_json) as Word;
    const snapshot = { id: word.id, hanzi: word.hanzi, traditional: word.traditional, pinyin: word.pinyin, meaning: word.meaning };
    if (row.before_status === 'unstudied' && row.after_status === 'learning') newWords.push(snapshot);
    if (row.before_status !== 'review' && row.after_status === 'review') graduatedWords.push(snapshot);
  }
  return { newWords, graduatedWords };
}
