import { deriveRecoveryHighlights, type RecoveryEncounter, type RecoveryHighlight } from '../../src/domain/recovery-highlights.ts';
import type { ReflectionOperation } from '../../src/domain/reflection.ts';
import { getDb } from './connection.ts';
import { requireLearnerId } from './learner-context.ts';

type AttemptRow = {
  id: string; session_id: string; session_action_id: string; occurred_at: string;
  action_attempt_sequence: number; action_kind: 'recognition' | 'production';
  target_word_id: string; outcome: string; rating: string | null;
  metadata_json: string; hanzi: string; traditional: string | null;
};

/** Null means no completed summary owned by this learner, including foreign IDs. */
export function getSessionRecoveryHighlights(sessionId: string): RecoveryHighlight[] | null {
  requireLearnerId();
  const db = getDb();
  const summary = db.prepare(`SELECT completed_at FROM review_session_summaries WHERE session_id = ?`)
    .get(sessionId) as { completed_at: string } | undefined;
  if (!summary) return null;
  const windowStart = new Date(summary.completed_at);
  windowStart.setUTCHours(0, 0, 0, 0);
  windowStart.setUTCDate(windowStart.getUTCDate() - 29);
  // The partial learner/time index bounds reads before filtering and ranking.
  // Retain earlier accepted encounters even from unfinished overall sessions.
  const rows = db.prepare(`
    WITH ranked AS (
      SELECT a.*, w.hanzi, w.traditional,
        ROW_NUMBER() OVER (PARTITION BY a.session_id, a.target_word_id, a.action_kind
          ORDER BY a.session_event_sequence, a.action_attempt_sequence, a.id) AS encounter_rank
      FROM study_attempt_events a
      JOIN words w ON w.id = a.target_word_id
      WHERE a.projected_at IS NOT NULL AND a.occurred_at >= ? AND a.occurred_at <= ?
        AND a.action_kind IN ('recognition', 'production')
        AND a.target_word_id IN (SELECT target_word_id FROM study_attempt_events WHERE session_id = ?)
    ) SELECT * FROM ranked WHERE encounter_rank = 1
  `).all(windowStart.toISOString(), summary.completed_at, sessionId) as AttemptRow[];
  if (rows.length === 0) return [];
  const corrected = correctedProductionAttempts();
  const encounters: RecoveryEncounter[] = rows.map((row) => ({
    attemptId: row.id, sessionId: row.session_id, actionId: row.session_action_id,
    occurredAt: row.occurred_at, wordId: row.target_word_id, hanzi: row.hanzi,
    traditional: row.traditional, skill: row.action_kind,
    result: classifyAttempt(row, corrected),
  }));
  return deriveRecoveryHighlights(encounters)
    .filter((highlight) => highlight.successAttempts.at(-1)?.sessionId === sessionId);
}

function classifyAttempt(row: AttemptRow, corrected: ReadonlySet<string>): RecoveryEncounter['result'] {
  if (row.action_attempt_sequence !== 1 || corrected.has(row.id)) return 'excluded';
  if (row.outcome === 'incorrect' && row.rating === 'forgot') return 'miss';
  if (row.outcome !== 'correct' || !['hard', 'good', 'easy'].includes(row.rating ?? '')) return 'excluded';
  if (row.action_kind === 'production') {
    const metadata = JSON.parse(row.metadata_json) as {
      production?: { result?: string; submittedWordId?: string; anchorWordId?: string; acceptedWordIds?: string[] };
    };
    const production = metadata.production;
    // Old broad answer spaces and missing snapshots cannot prove target recall.
    if (production?.result !== 'accepted_anchor'
      || production.submittedWordId !== row.target_word_id
      || production.anchorWordId !== row.target_word_id
      || production.acceptedWordIds?.length !== 1
      || production.acceptedWordIds[0] !== row.target_word_id) return 'excluded';
  }
  return 'success';
}

function correctedProductionAttempts(): Set<string> {
  const db = getDb();
  const corrected = new Set<string>();
  // Cue-evidence compensation retracts a judgment; it is distinct from the
  // scheduler restoration below. Respect active judgments, even without a snapshot.
  const judgments = db.prepare(`
    SELECT j.source_attempt_id FROM production_cue_evidence_records j
    JOIN reflection_operation_invocations i ON i.invocation_id = j.invocation_id
    WHERE j.record_kind = 'judgment' AND i.application_state IN ('applied', 'already_satisfied')
      AND NOT EXISTS (SELECT 1 FROM production_cue_evidence_records c
        WHERE c.record_kind = 'compensation' AND c.source_evidence_id = j.evidence_id)
  `).all() as Array<{ source_attempt_id: string }>;
  for (const row of judgments) corrected.add(row.source_attempt_id);
  const restorations = db.prepare(`
    SELECT link.source_attempt_id
    FROM pure_cue_scheduler_compensation_snapshot_attempts link
    JOIN pure_cue_scheduler_compensation_snapshots s
      ON s.learner_id = link.learner_id
      AND s.session_id = link.session_id AND s.session_action_id = link.session_action_id
    WHERE s.learner_id = ? AND s.compensated_at IS NOT NULL
  `).all(requireLearnerId()) as Array<{ source_attempt_id: string }>;
  for (const row of restorations) corrected.add(row.source_attempt_id);
  // Pair reconciliation records source fairness on the applied invocation, not
  // necessarily a cue-evidence judgment. Missing scheduler snapshots do not erase it.
  const invocations = db.prepare(`SELECT operation_json FROM reflection_operation_invocations
    WHERE application_state IN ('applied', 'already_satisfied')
      AND operation_kind IN ('reconcile_production_cues', 'promote_pure_elicitation')`)
    .all() as Array<{ operation_json: string }>;
  for (const row of invocations) {
    const operation = JSON.parse(row.operation_json) as ReflectionOperation;
    if (operation.kind === 'promote_pure_elicitation'
      || (operation.kind === 'reconcile_production_cues' && operation.sourceAttemptFairness === 'misleading_or_overloaded_cue')) {
      corrected.add(operation.sourceAttemptId);
    }
  }
  return corrected;
}
