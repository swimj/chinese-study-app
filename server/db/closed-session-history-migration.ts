import type { DatabaseSync } from 'node:sqlite';
import type { VocabularySessionInitialContext } from '../../src/domain/vocabulary-session.ts';
import { compactClosedSessionContext } from './closed-session-context.ts';

/** The transaction applies the staged rows only after validating every closed session. */
export function stageClosedSessionHistories(db: DatabaseSync): void {
  db.exec(`CREATE TEMP TABLE closed_session_histories(session_id TEXT PRIMARY KEY, context_json TEXT NOT NULL)`);
  const stage = db.prepare('INSERT INTO closed_session_histories VALUES (?,?)');
  const sessions = db.prepare(`SELECT s.session_id,s.context_json FROM vocabulary_sessions s
    WHERE s.status='closed' AND EXISTS (
      SELECT 1 FROM vocabulary_session_completions c
      WHERE c.session_id=s.session_id AND c.learner_id=s.learner_id AND c.status='closed'
    )`);
  for (const row of sessions.iterate()) {
    const context = JSON.parse(String(row.context_json)) as VocabularySessionInitialContext;
    stage.run(row.session_id, JSON.stringify(compactClosedSessionContext(context)));
  }
}
