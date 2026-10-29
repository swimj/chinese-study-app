import { getDb } from './connection.ts';
import { requireLearnerId } from './learner-context.ts';

/** Candidate membership is private; preparation jobs and generated content are shared. */
export function getWordReserveCandidates(): string[] {
  return (getDb().prepare(`SELECT word_id FROM learner_word_preparation_reserve
    WHERE learner_id = ? ORDER BY added_at, word_id`).all(requireLearnerId()) as Array<{ word_id: string }>)
    .map((row) => row.word_id);
}
export function replaceWordReserveCandidates(wordIds: readonly string[], now = new Date().toISOString()): void {
  const learnerId = requireLearnerId();
  if (wordIds.length > 40 || new Set(wordIds).size !== wordIds.length) throw new Error('Invalid word reserve membership');
  for (const wordId of getWordReserveCandidates()) {
    if (!wordIds.includes(wordId)) getDb().prepare(`DELETE FROM learner_word_preparation_reserve
      WHERE learner_id = ? AND word_id = ?`).run(learnerId, wordId);
  }
  for (const wordId of wordIds) getDb().prepare(`INSERT OR IGNORE INTO learner_word_preparation_reserve
    (learner_id, word_id, added_at) VALUES (?, ?, ?)`).run(learnerId, wordId, now);
}
export function requestWordReserveReconciliation(now = new Date().toISOString()): void {
  getDb().prepare(`INSERT INTO learner_word_reserve_requests (learner_id, requested_at)
    VALUES (?, ?) ON CONFLICT(learner_id) DO UPDATE SET requested_at = excluded.requested_at`)
    .run(requireLearnerId(), now);
}
export function listPendingWordReserveLearners(limit = 100): string[] {
  return (getDb().prepare(`SELECT request.learner_id FROM learner_word_reserve_requests AS request
    JOIN learners ON learners.learner_id = request.learner_id
    WHERE learners.disabled_at IS NULL ORDER BY request.requested_at, request.learner_id LIMIT ?`)
    .all(limit) as Array<{ learner_id: string }>).map((row) => row.learner_id);
}
export function finishWordReserveReconciliation(): void {
  getDb().prepare('DELETE FROM learner_word_reserve_requests WHERE learner_id = ?').run(requireLearnerId());
}
/** Failures are not a license to enqueue the entire corpus on repeated visits. */
export function getBlockedPreparationWordIds(): Set<string> {
  const rows = getDb().prepare(`SELECT word_id FROM word_preparation_work
    WHERE stage IN ('bootstrap', 'teaching') AND status = 'paused'
    UNION SELECT preparation.word_id FROM word_introduction_preparation AS preparation
    LEFT JOIN word_content_documents AS content ON content.content_id = preparation.content_id
    LEFT JOIN shared_content_publications AS source ON source.publication_id = content.publication_id
    LEFT JOIN word_teaching_packages AS package ON package.package_id = preparation.package_id
    LEFT JOIN shared_content_publications AS lesson ON lesson.publication_id = package.publication_id
    WHERE (preparation.content_id IS NOT NULL AND source.publication_status NOT IN ('shared_trial', 'available'))
       OR (preparation.package_id IS NOT NULL AND lesson.publication_status NOT IN ('shared_trial', 'available'))
    UNION SELECT event.word_id FROM learner_word_introduction_events AS event
    JOIN word_teaching_packages AS package ON package.package_id = event.package_id
    JOIN word_content_documents AS content ON content.content_id = package.content_id
    JOIN shared_content_publications AS lesson ON lesson.publication_id = package.publication_id
    JOIN shared_content_publications AS source ON source.publication_id = content.publication_id
    WHERE event.learner_id = ? AND event.event_kind = 'opened'
      AND event.sequence = (SELECT MAX(latest.sequence) FROM learner_word_introduction_events AS latest
        WHERE latest.learner_id = event.learner_id AND latest.word_id = event.word_id AND latest.event_kind = 'opened')
      AND (lesson.publication_status NOT IN ('shared_trial', 'available')
        OR source.publication_status NOT IN ('shared_trial', 'available'))`)
    .all(requireLearnerId()) as Array<{ word_id: string }>;
  return new Set(rows.map((row) => row.word_id));
}
