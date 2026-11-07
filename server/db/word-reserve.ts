import { getDb } from './connection.ts';
import { requireLearnerId } from './learner-context.ts';
import { vocabularySessionWordEligibleSql } from './vocabulary-sense-eligibility.ts';
import { emitBackendEvent } from './vocabulary-content.ts';

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

/** Composition reads only bounded reserve membership; source planning belongs to maintenance. */
export function getReadyWordReserveCandidates(now: string): Array<{wordId:string;readyAt:string;addedAt:string}> {
  return getDb().prepare(`SELECT r.word_id AS wordId,r.ready_at AS readyAt,r.added_at AS addedAt
    FROM learner_word_preparation_reserve r
    LEFT JOIN learner_words w ON w.learner_id=r.learner_id AND w.word_id=r.word_id
    LEFT JOIN learner_word_schedules s ON s.learner_id=r.learner_id AND s.word_id=r.word_id
    LEFT JOIN learner_owned_user_word_priority p ON p.learner_id=r.learner_id AND p.word_id=r.word_id
    WHERE r.learner_id=? AND r.ready_at IS NOT NULL
      AND (w.word_id IS NULL OR (w.mode='unstudied' AND w.dismissed_at IS NULL))
      AND ${vocabularySessionWordEligibleSql('r.word_id')}
      AND (s.next_eligible_at IS NULL OR s.next_eligible_at<=?)
      AND COALESCE(json_extract(s.scheduler_state_json,'$.enabled'),1)!=0
    ORDER BY CASE WHEN p.priority_tier=1 THEN 0 ELSE 1 END,
      CASE WHEN p.priority_tier=1 THEN p.updated_at END DESC,r.added_at,r.word_id LIMIT 40`)
    .all(requireLearnerId(),now) as Array<{wordId:string;readyAt:string;addedAt:string}>;
}
export function setWordReserveReadiness(wordId:string,ready:boolean,now:string):void {
  getDb().prepare(`UPDATE learner_word_preparation_reserve SET ready_at=CASE WHEN ? THEN COALESCE(ready_at,?) ELSE NULL END,
    checked_at=? WHERE learner_id=? AND word_id=?`).run(ready?1:0,now,now,requireLearnerId(),wordId);
}
export function getTopWordReserveCandidates():string[] {
  return (getDb().prepare(`SELECT w.word_id FROM learner_words w
    JOIN learner_owned_user_word_priority p ON p.learner_id=w.learner_id AND p.word_id=w.word_id
    WHERE w.learner_id=? AND w.mode='unstudied' AND w.dismissed_at IS NULL AND p.priority_tier=1
      AND ${vocabularySessionWordEligibleSql('w.word_id')}
    ORDER BY p.updated_at DESC,w.word_id LIMIT 40`).all(requireLearnerId()) as {word_id:string}[]).map(r=>r.word_id);
}
/** Oldest checks first: bounded periodic recovery catches publication and missed requests without session visits. */
export function listWordReserveAuditLearners(before:string,limit=5):string[] {
  return (getDb().prepare(`SELECT r.learner_id FROM learner_word_preparation_reserve r
    JOIN learners l ON l.learner_id=r.learner_id WHERE l.disabled_at IS NULL
    GROUP BY r.learner_id HAVING MIN(COALESCE(r.checked_at,''))<=?
    ORDER BY MIN(COALESCE(r.checked_at,'')),r.learner_id LIMIT ?`).all(before,limit) as {learner_id:string}[]).map(r=>r.learner_id);
}
/** One indexed event per membership/readiness epoch, rather than one event per Home poll. */
export function reportStaleWordReserveHint(hint:{wordId:string;readyAt:string;addedAt:string},now:string):void {
  const learner=requireLearnerId();
  const prior=getDb().prepare(`SELECT 1 FROM backend_events WHERE entity_kind='word' AND entity_id=?
    AND name='vocabulary.reserve.stale_hint' AND learner_id=?
    AND json_extract(data_json,'$.readyAt')=? AND json_extract(data_json,'$.addedAt')=? LIMIT 1`)
    .get(hint.wordId,learner,hint.readyAt,hint.addedAt);
  if(!prior)emitBackendEvent({name:'vocabulary.reserve.stale_hint',learnerId:learner,entityKind:'word',entityId:hint.wordId,
    occurredAt:now,data:{readyAt:hint.readyAt,addedAt:hint.addedAt,reason:'No current usable teaching resolved'}});
}

/** Failed passes rotate their audit priority without asserting readiness or discarding the request. */
export function deferWordReserveAudit(now:string):void {
  getDb().prepare('UPDATE learner_word_preparation_reserve SET checked_at=? WHERE learner_id=?').run(now,requireLearnerId());
}

export function hasPendingWordReserveCandidates():boolean {
  return Boolean(getDb().prepare(`SELECT 1 FROM learner_word_preparation_reserve r
    LEFT JOIN learner_words w ON w.learner_id=r.learner_id AND w.word_id=r.word_id
    WHERE r.learner_id=? AND r.ready_at IS NULL AND (w.word_id IS NULL OR (w.mode='unstudied' AND w.dismissed_at IS NULL)) LIMIT 1`).get(requireLearnerId()));
}
