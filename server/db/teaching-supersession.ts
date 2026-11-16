import { randomUUID } from 'node:crypto';
import { getDb } from './connection.ts';
import { VOCABULARY_PREPARATION_EPOCH } from './preparation-compatibility.ts';
import { DEFAULT_TEACHING_SET } from './teaching-sense-sets.ts';

export const TEACHING_SCOPE_SUPERSEDED = 'Teaching scope superseded by current defaults';
const exactReuseReason = 'Teaching scope superseded by current defaults; eligible for exact-scope reuse';
const serviceId = 'vocabulary-teaching-maintenance';

/** The same classification drives operator attention and automatic supersession. */
export const teachingScopeCtes = `teaching_scope AS (
  SELECT p.word_id,p.package_id,d.content_id,d.created_at,source.publication_id AS source_publication_id,
    lesson.publication_id AS package_publication_id,
    catalog.senses_established_at IS NOT NULL AND source.publication_status IN ('shared_trial','available')
      AND (p.package_id IS NULL OR lesson.publication_status IN ('shared_trial','available')) AS can_replace,
    EXISTS(SELECT 1 FROM json_each(d.content_json,'$.uses') use
      WHERE NOT EXISTS(SELECT 1 FROM legacy_sense_imports m JOIN senses s USING(sense_id)
        WHERE m.source_content_id=p.content_id AND m.source_use_id=json_extract(use.value,'$.id')
        AND s.word_id=p.word_id AND s.status='active' AND s.version=m.imported_sense_version))
    OR (SELECT count(DISTINCT m.sense_id) FROM legacy_sense_imports m
      WHERE m.source_content_id=p.content_id AND m.source_use_id IN (SELECT json_extract(use.value,'$.id') FROM json_each(d.content_json,'$.uses') use))
      !=json_array_length(d.content_json,'$.uses') AS mapping_mismatch,
    coalesce(json_array_length(coverage.default_useful_sense_ids_json),0) AS selected_count,
    EXISTS(SELECT 1 FROM json_each(coverage.default_useful_sense_ids_json) selected WHERE NOT EXISTS(
      SELECT 1 FROM legacy_sense_imports m WHERE m.source_content_id=p.content_id AND m.sense_id=selected.value
      AND m.source_use_id IN (SELECT json_extract(use.value,'$.id') FROM json_each(d.content_json,'$.uses') use))) AS missing_selected,
    coverage.default_useful_sense_ids_json IS NOT NULL AND EXISTS(
      SELECT 1 FROM legacy_sense_imports m WHERE m.source_content_id=p.content_id AND m.sense_id NOT IN(
        SELECT value FROM json_each(coverage.default_useful_sense_ids_json))) AS extra_mapped,
    json_array_length(d.content_json,'$.uses') AS teaching_count
  FROM word_introduction_preparation p JOIN word_content_documents d ON d.content_id=p.content_id
  JOIN shared_content_publications source ON source.publication_id=d.publication_id
  LEFT JOIN word_teaching_packages package ON package.package_id=p.package_id AND package.content_id=p.content_id
  LEFT JOIN shared_content_publications lesson ON lesson.publication_id=package.publication_id
  LEFT JOIN vocabulary_word_catalogs catalog ON catalog.word_id=p.word_id
  LEFT JOIN vocabulary_word_sense_coverage coverage ON coverage.word_id=p.word_id
  WHERE p.teaching_set_key='${DEFAULT_TEACHING_SET}'
), teaching_sources AS (
  SELECT *, mapping_mismatch OR missing_selected OR extra_mapped AS mismatch,
    can_replace AND NOT mapping_mismatch AND NOT missing_selected
      AND selected_count>0 AND selected_count<teaching_count AS scope_only
  FROM teaching_scope
)`;

/** A retained pin to superseded teaching has different recovery semantics from withdrawal. */
export function teachingScopeSupersededPublicationSql(publication: string, requireExactReuse = false): string {
  const reasons = requireExactReuse ? `('${exactReuseReason}')` : `('${TEACHING_SCOPE_SUPERSEDED}','${exactReuseReason}')`;
  return `(${publication}.publication_status='retired' AND EXISTS(
    SELECT 1 FROM shared_content_publication_events event
    WHERE event.publication_id=${publication}.publication_id AND event.to_status='retired'
    AND event.actor_kind='source_authorization' AND event.actor_id='${serviceId}'
    AND event.reason IN ${reasons} AND event.occurred_at=${publication}.status_updated_at))`;
}

type SupersededSource = {
  word_id: string; content_id: string; preparation_epoch: number;
  source_publication_id: string; package_publication_id: string | null;
};
const batchSize = 20;

/** Retire the stale teaching scope during maintenance. Fresh reserve demand owns regeneration. */
export function supersedeOutdatedTeaching(now: string): number {
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    const sources = db.prepare(`WITH ${teachingScopeCtes}
      SELECT t.word_id,t.content_id,t.source_publication_id,t.package_publication_id,p.preparation_epoch
      FROM teaching_sources t JOIN word_introduction_preparation p
        ON p.word_id=t.word_id AND p.teaching_set_key='${DEFAULT_TEACHING_SET}'
      WHERE t.scope_only AND (p.lease_expires_at IS NULL OR p.lease_expires_at<=?)
      AND NOT EXISTS(SELECT 1 FROM word_review_preparation r WHERE r.word_id=t.word_id AND r.lease_expires_at>?)
      AND NOT EXISTS(SELECT 1 FROM word_preparation_work w WHERE w.word_id=t.word_id AND w.teaching_set_key='${DEFAULT_TEACHING_SET}' AND w.status='running')
      AND NOT EXISTS(SELECT 1 FROM vocabulary_practice_preparation w WHERE w.source_content_id=t.content_id AND w.status='running')
      AND NOT EXISTS(SELECT 1 FROM sense_content_reconciliations r WHERE r.word_id=t.word_id
        AND r.rowid=(SELECT max(latest.rowid) FROM sense_content_reconciliations latest WHERE latest.word_id=t.word_id)
        AND (r.status!='applied' OR r.completed_at IS NULL))
      AND NOT EXISTS(SELECT 1 FROM word_teaching_packages package JOIN legacy_content_imports i
        ON i.source_id=package.package_id AND i.source_kind IN ('teaching_package','teaching_exercise')
        JOIN proposal_content_bases b ON b.content_id=i.content_id JOIN content_proposals proposal USING(proposal_id)
        WHERE package.content_id=t.content_id AND proposal.status NOT IN ('applied','closed'))
      AND NOT EXISTS(SELECT 1 FROM word_teaching_packages package JOIN legacy_content_imports i
        ON i.source_id=package.package_id AND i.source_kind IN ('teaching_package','teaching_exercise')
        JOIN reflection_cases c ON c.content_id=i.content_id
        JOIN vocabulary_reflection_jobs j ON j.case_id=c.case_id OR j.review_case_id=c.case_id
        WHERE package.content_id=t.content_id AND j.status IN ('queued','running'))
      ORDER BY t.created_at,t.word_id LIMIT ?`).all(now,now,batchSize) as SupersededSource[];
    for (const source of sources) supersedeTeaching(source, now);
    db.exec('COMMIT');
    return sources.length;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function supersedeTeaching(source: SupersededSource, now: string): void {
  const db = getDb();
  // Keep the materialized teaching available for an exact authored-scope match and prior completions.
  const reason = source.preparation_epoch >= VOCABULARY_PREPARATION_EPOCH ? exactReuseReason : TEACHING_SCOPE_SUPERSEDED;
  for (const publicationId of [source.source_publication_id, source.package_publication_id]) {
    if (publicationId === null) continue;
    db.prepare(`INSERT INTO shared_content_publication_events
      (event_id,publication_id,from_status,to_status,actor_kind,actor_id,reason,occurred_at)
      SELECT ?,publication_id,publication_status,'retired','source_authorization',?,?,?
      FROM shared_content_publications WHERE publication_id=?`)
      .run(randomUUID(), serviceId, reason, now, publicationId);
    db.prepare("UPDATE shared_content_publications SET publication_status='retired',status_updated_at=? WHERE publication_id=?")
      .run(now, publicationId);
  }
  db.prepare(`UPDATE word_introduction_preparation SET content_id=NULL,package_id=NULL,active_stage=NULL,
    lease_token=NULL,lease_expires_at=NULL,preparation_epoch=? WHERE word_id=? AND teaching_set_key=?`)
    .run(VOCABULARY_PREPARATION_EPOCH, source.word_id, DEFAULT_TEACHING_SET);
  db.prepare(`UPDATE word_preparation_work SET status='ready',last_error=?,updated_at=?
    WHERE word_id=? AND teaching_set_key=?
    AND (stage IN ('bootstrap','teaching') OR (stage='review' AND status='queued' AND source_content_id=?))`)
    .run(TEACHING_SCOPE_SUPERSEDED, now, source.word_id, DEFAULT_TEACHING_SET, source.content_id);
  db.prepare(`UPDATE vocabulary_practice_preparation SET status='ready',last_error=?,updated_at=?
    WHERE source_content_id=? AND status='queued'`).run(TEACHING_SCOPE_SUPERSEDED, now, source.content_id);
  db.prepare(`UPDATE learner_word_preparation_reserve AS reserve SET ready_at=NULL,checked_at=NULL
    WHERE word_id=? AND NOT EXISTS(SELECT 1 FROM learner_senses choice JOIN senses s USING(sense_id,word_id)
      WHERE choice.learner_id=reserve.learner_id AND choice.word_id=reserve.word_id AND s.status='active')`).run(source.word_id);
}
