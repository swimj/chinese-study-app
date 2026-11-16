import { getDb } from './connection.ts';
import { emitBackendEvent, getVocabularySenseCatalog } from './vocabulary-content.ts';
import { getVocabularyWordSenseCoverage } from './vocabulary-sense-coverage.ts';
import { withChatTransaction } from './learner-chat.ts';

export type IntakePrerequisite = { wordId: string; kind: 'inventory' | 'defaults' };

/** Retain shared lookup demand even when no learner enrolls the word. Existing readiness leases own execution. */
export function queueVocabularyIntakeReadiness(wordId: string): void {
  withChatTransaction(() => {
    const catalog = getVocabularySenseCatalog(wordId);
    if (catalog.establishedAt && getVocabularyWordSenseCoverage(wordId).defaultUsefulSenseIds !== null) return;
    const db = getDb(), now = new Date().toISOString(), workflowId = `vocabulary-intake:${wordId}`;
    if (!db.prepare(`SELECT 1 FROM backend_events WHERE name='vocabulary.intake.readiness_requested'
      AND entity_kind='word' AND entity_id=?`).get(wordId)) {
      emitBackendEvent({ name: 'vocabulary.intake.readiness_requested', entityKind: 'word', entityId: wordId, data: {} });
    }
    if (catalog.establishedAt) {
      db.prepare(`INSERT OR IGNORE INTO vocabulary_default_selection_readiness
        (word_id,status,expected_catalog_version,workflow_id,created_at,updated_at) VALUES (?,'queued',?,?,?,?)`)
        .run(wordId, catalog.version, workflowId, now, now);
    } else {
      db.prepare(`INSERT OR IGNORE INTO vocabulary_sense_readiness
        (word_id,status,expected_catalog_version,workflow_id,created_at,updated_at) VALUES (?,'queued',?,?,?,?)`)
        .run(wordId, catalog.version, workflowId, now, now);
    }
  });
}

export function nextVocabularyIntakePrerequisite(now: string): IntakePrerequisite | null {
  const row = getDb().prepare(`WITH requested AS (
      SELECT entity_id AS wordId,MIN(occurred_at) AS requestedAt FROM backend_events
      WHERE name='vocabulary.intake.readiness_requested' GROUP BY entity_id
    ), due AS (
      SELECT r.wordId,'inventory' AS kind,r.requestedAt FROM requested r
      JOIN vocabulary_sense_readiness w ON w.word_id=r.wordId
      LEFT JOIN vocabulary_word_catalogs c ON c.word_id=r.wordId
      WHERE c.senses_established_at IS NULL
        AND ((w.status='queued' AND w.next_attempt_at<=?) OR (w.status='running' AND w.expires_at<=?))
      UNION ALL
      SELECT r.wordId,'defaults',r.requestedAt FROM requested r
      JOIN vocabulary_word_catalogs c ON c.word_id=r.wordId
      LEFT JOIN vocabulary_word_sense_coverage sc ON sc.word_id=r.wordId
      LEFT JOIN vocabulary_default_selection_readiness w ON w.word_id=r.wordId
      WHERE c.senses_established_at IS NOT NULL AND sc.default_useful_sense_ids_json IS NULL
        AND (w.word_id IS NULL OR (w.status='queued' AND w.next_attempt_at<=?) OR (w.status='running' AND w.expires_at<=?))
    ) SELECT wordId,kind FROM due ORDER BY requestedAt,wordId LIMIT 1`).get(now, now, now, now);
  return (row as IntakePrerequisite | undefined) ?? null;
}

/** Readiness guards (such as a partial preexisting inventory) can fail before a provider lease is taken. */
export function markUnclaimedVocabularyIntakePrerequisiteFailed(work: IntakePrerequisite, reason: string): void {
  queueVocabularyIntakeReadiness(work.wordId);
  const table = work.kind === 'inventory' ? 'vocabulary_sense_readiness' : 'vocabulary_default_selection_readiness';
  getDb().prepare(`UPDATE ${table} SET status='failed',last_error=?,updated_at=?
    WHERE word_id=? AND status='queued' AND attempt_count=0`).run(reason,new Date().toISOString(),work.wordId);
}
