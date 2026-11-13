import { createHash } from 'node:crypto';
import { getDb } from './connection.ts';
import { reviewUrgency } from './review-policy.ts';
import { vocabularyExerciseAnswersEligibleSql, isVocabularySessionWordEligible } from './vocabulary-sense-eligibility.ts';
import { resolveVocabularySenseCoverage } from './vocabulary-sense-coverage.ts';
import { emitBackendEvent, getVocabularySenseCatalog } from './vocabulary-content.ts';
import { repertoireEditorialWork } from './bulk-repertoire-selection.ts';

export const REPERTOIRE_SCAN_INTERVAL_MS = 6 * 60 * 60_000;
export const REPERTOIRE_LOOKAHEAD_MS = 2 * REPERTOIRE_SCAN_INTERVAL_MS;
export const REPERTOIRE_SCAN_LIMIT = 24;
const REPERTOIRE_SCAN_EVENT = 'vocabulary.proactive_repertoire.scanned';

type DemandRow = {
  wordId: string;
  mode: 'solidify' | 'practice';
  dueAt: string | null;
  lastPractisedAt: string | null;
  intervalHours: number;
};
type PoolRow = { senseId: string | null; fallback: number; pureCue: number };

const demandSql = `
  SELECT w.word_id AS wordId,w.mode,s.next_eligible_at AS dueAt,s.last_practised_at AS lastPractisedAt,
    json_extract(s.scheduler_state_json,'$.intervalHours') AS intervalHours
  FROM learners l JOIN learner_words w USING(learner_id)
  JOIN learner_word_schedules s USING(learner_id,word_id)
  LEFT JOIN learner_owned_word_skill_state legacy
    ON legacy.learner_id=w.learner_id AND legacy.word_id=w.word_id AND legacy.skill_id='production'
  LEFT JOIN learner_owned_word_skill_relevance relevance
    ON relevance.learner_id=w.learner_id AND relevance.word_id=w.word_id AND relevance.skill_id='production'
  LEFT JOIN learner_owned_word_study_admission_state admission
    ON admission.learner_id=w.learner_id AND admission.word_id=w.word_id
  WHERE l.disabled_at IS NULL AND w.dismissed_at IS NULL AND w.mode IN ('solidify','practice')
    AND (s.next_eligible_at IS NULL OR s.next_eligible_at<=?)
    AND (w.mode='solidify' OR (
      COALESCE(json_extract(s.scheduler_state_json,'$.enabled'),1)!=0 AND COALESCE(legacy.enabled,1)!=0
      AND COALESCE(relevance.relevance_state,'active')!='suppressed'
      AND (admission.earliest_next_study_at IS NULL OR admission.earliest_next_study_at<=?)
      AND (json_extract(s.scheduler_state_json,'$.postCompensationEarliestCheckAt') IS NULL
           OR json_extract(s.scheduler_state_json,'$.postCompensationEarliestCheckAt')<=?)
    ))
`;

/** Project production demand at a fixed horizon, before choosing a skill, applying the cap, or drawing timed items. */
export function dueRepertoireWords(horizon: string, wordId?: string): string[] {
  const rows = getDb().prepare(demandSql + (wordId === undefined ? '' : ' AND w.word_id=?'))
    .all(horizon, horizon, horizon, ...(wordId === undefined ? [] : [wordId])) as DemandRow[];
  const earliestDue = new Map<string, string>();
  for (const row of rows) {
    if (row.mode === 'practice' && reviewUrgency(row.intervalHours, row.lastPractisedAt || null, horizon) < 1) continue;
    const due = row.dueAt ?? '';
    const previous = earliestDue.get(row.wordId);
    if (previous === undefined || due < previous) earliestDue.set(row.wordId, due);
  }
  return [...earliestDue].sort(([a, first], [b, second]) => first.localeCompare(second) || a.localeCompare(b)).map(([id]) => id);
}

/** A usable older cue can cover a sense. Unmapped cues only count toward avoiding fallback. */
export function repertoireCoverageGap(wordId: string) {
  const coverage = resolveVocabularySenseCoverage(wordId);
  const catalog = getVocabularySenseCatalog(wordId);
  const rows = getDb().prepare(`
    SELECT w.sense_id AS senseId,c.exercise_type='pure_cue' AS pureCue,
      CASE WHEN json_extract(c.body_json,'$.source.kind')='dictionary_baseline'
        OR (json_extract(c.body_json,'$.source.kind')='production_cue_supplement'
          AND json_type(c.body_json,'$.source.cueId') IS 'null') THEN 1 ELSE 0 END AS fallback
    FROM exercise_answer_words a JOIN content_items c ON c.content_id=a.exercise_id
    LEFT JOIN content_words w ON w.content_id=c.content_id AND w.word_id=a.word_id AND w.relation='target'
    WHERE a.word_id=? AND (c.exercise_type='pure_cue' OR w.word_id IS NOT NULL)
      AND c.kind='exercise' AND c.exercise_role='general' AND c.skill='production'
      AND c.access_scope='shared' AND c.availability='active'
      AND c.exercise_type!='contrast' AND COALESCE(json_extract(c.assessment_json,'$.responseMode'),'')!='word_choice'
      AND ${vocabularyExerciseAnswersEligibleSql('c.content_id')}
  `).all(wordId) as PoolRow[];
  const selected = new Set(coverage.includedSenseIds);
  const excluded = new Set(coverage.word.excludedSenseIds);
  const targeted = rows.filter(row => !row.pureCue && !row.fallback &&
    (row.senseId === null || (coverage.selectionEstablished
      ? selected.has(row.senseId) : !excluded.has(row.senseId))));
  const covered = new Set(targeted.map(row => row.senseId));
  const missing = coverage.includedSenseIds.filter(id => !covered.has(id));
  return {
    scopeKey: `${catalog.version}/${coverage.fingerprint}`,
    unknown: coverage.word.defaultUsefulSenseIds?.length !== 0 && (catalog.establishedAt === null || !coverage.selectionEstablished),
    missing,
    hasTargeted: targeted.length > 0,
    proxied: targeted.length === 0 && rows.some(row => row.pureCue),
  };
}

export const PROACTIVE_DEFERRED = 'Proactive practice demand deferred';

export function proactiveHorizon(at: string): string {
  return new Date(Date.parse(at) + REPERTOIRE_LOOKAHEAD_MS).toISOString();
}

function inWriteTransaction(operation: () => void): void {
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    operation();
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/** Queue and journal the scan atomically so restarting never opens a second batch. */
export function scanProactiveRepertoire(timestamp: string, serviceId: string): number {
  const cutoff = new Date(Date.parse(timestamp) - REPERTOIRE_SCAN_INTERVAL_MS).toISOString();
  const db = getDb();
  const recentlyScanned = () => db.prepare('SELECT 1 FROM backend_events WHERE name=? AND occurred_at>? LIMIT 1')
    .get(REPERTOIRE_SCAN_EVENT, cutoff);
  if (recentlyScanned()) return 0;
  let queued = 0;
  inWriteTransaction(() => {
    if (recentlyScanned()) return;
    const horizon = proactiveHorizon(timestamp);
    const words = dueRepertoireWords(horizon);
    const editorial = repertoireEditorialWork(db);
    const active = new Set(db.prepare("SELECT DISTINCT word_id FROM vocabulary_practice_preparation WHERE status IN ('queued','running')")
      .all().map(row => String(row.word_id)));
    const prior = db.prepare('SELECT last_error FROM vocabulary_practice_preparation WHERE word_id=? AND proactive_scope_key=?');
    const fallback: Array<{ wordId: string; scopeKey: string }> = [];
    const other: typeof fallback = [];
    const counts = { covered: 0, ineligible: 0, proxied: 0, blocked: 0, previouslyAttempted: 0 };
    for (const wordId of words) {
      if (editorial.has(wordId) || active.has(wordId)) { counts.blocked++; continue; }
      if (!isVocabularySessionWordEligible(wordId)) { counts.ineligible++; continue; }
      const gap = repertoireCoverageGap(wordId);
      if (gap.proxied) { counts.proxied++; continue; }
      if (!gap.unknown && !gap.missing.length) { counts.covered++; continue; }
      const previous = prior.get(wordId, gap.scopeKey);
      if (previous && previous.last_error !== PROACTIVE_DEFERRED) { counts.previouslyAttempted++; continue; }
      (gap.hasTargeted ? other : fallback).push({ wordId, scopeKey: gap.scopeKey });
    }
    const activeProactive = Number(db.prepare(`SELECT count(*) AS count FROM vocabulary_practice_preparation
      WHERE proactive_scope_key IS NOT NULL AND status IN ('queued','running')`).get()!.count);
    const selected = [...fallback, ...other].slice(0, Math.max(0, REPERTOIRE_SCAN_LIMIT - activeProactive));
    const insert = db.prepare(`INSERT INTO vocabulary_practice_preparation
      (work_id,word_id,proactive_scope_key,generation_key,status,created_at,updated_at,next_attempt_at)
      VALUES (?,?,?,'pending','queued',?,?,?)
      ON CONFLICT(word_id,proactive_scope_key) DO UPDATE SET status='queued',last_error=NULL,
        next_attempt_at=excluded.next_attempt_at,updated_at=excluded.updated_at
      WHERE vocabulary_practice_preparation.status='ready' AND vocabulary_practice_preparation.last_error=?`);
    for (const {wordId, scopeKey} of selected) {
      const key = createHash('sha256').update(JSON.stringify([wordId,scopeKey])).digest('hex');
      queued += Number(insert.run(`vocabulary-practice:proactive:${key}`,wordId,scopeKey,
        timestamp,timestamp,timestamp,PROACTIVE_DEFERRED).changes);
    }
    emitBackendEvent({name:REPERTOIRE_SCAN_EVENT, entityKind:'service', entityId:serviceId,
      actorKind:'service', actorId:serviceId, occurredAt:timestamp,
      data:{horizon, candidates:words.length, ...counts, fallbackPriority:fallback.length, otherGaps:other.length,
        queued, activeProactive}});
  });
  return queued;
}

export function hasProactiveDemand(wordId: string, workId: string, horizon: string): boolean {
  if (!isVocabularySessionWordEligible(wordId) || !dueRepertoireWords(horizon, wordId).length) return false;
  if (repertoireEditorialWork(getDb(), wordId).has(wordId)) return false;
  return !getDb().prepare(`SELECT 1 FROM vocabulary_practice_preparation
    WHERE word_id=? AND work_id!=? AND proactive_scope_key IS NULL AND status IN ('queued','running') LIMIT 1`).get(wordId,workId);
}
