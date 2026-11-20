import type { Word } from '../../src/types.ts';
import type { SessionCompletionReport, SessionCompletionWord } from '../../src/domain/session-completion.ts';
import { getDb } from './connection.ts';
import { requireLearnerId } from './learner-context.ts';
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
