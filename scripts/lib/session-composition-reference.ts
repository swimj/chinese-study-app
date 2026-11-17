import { vocabularyExerciseAnswersEligibleSql, vocabularySessionWordEligibleSql } from '../../server/db/vocabulary-sense-eligibility.ts';
import { isSenseContentReconciliationPending } from '../../server/db/sense-content-reconciliation-state.ts';
import { getDb } from '../../server/db/connection.ts';
import { requireLearnerId } from '../../server/db/learner-context.ts';
import { reviewUrgency, compareReviewCandidates } from '../../server/db/review-policy.ts';
import { hasScheduleColumns, mergePureCueSchedulerState } from '../../server/db/vocabulary-schedule-columns.ts';
import { selectPureCuesForSession, type PureCueSelectionCandidate } from '../../src/domain/pure-cues.ts';
import { createHash } from 'node:crypto';
import type { VocabularyDueReviewObjective, VocabularyReviewSkill } from '../../server/vocabulary/review-selection.ts';

/**
 * Full-scan reference for the indexed composition reads: the pre-index algorithm
 * and SQL, which read every schedule, decide dueness in memory, and check every
 * pure cue's eligibility and reconciliation. Equivalence tests and the rehearsal
 * alignment script compare the indexed reads against it. It reads either the
 * pre-0077 JSON shape or the columns, so it runs before and after migration.
 */
export function referenceDueReviewObjectives(now: string): VocabularyDueReviewObjective[] {
  const learnerId = requireLearnerId();
  // The pre-index query, verbatim apart from where the production facts live.
  const columns = hasScheduleColumns(getDb(), 'learner_word_schedules');
  const production = columns
    ? `s.interval_hours AS interval_hours, s.last_practised_at AS last_studied_at, s.next_eligible_at AS next_due_at,
        s.enabled AS enabled, s.post_compensation_check_at AS post_compensation_earliest_check_at`
    : `json_extract(s.scheduler_state_json, '$.intervalHours') AS interval_hours,
        s.last_practised_at AS last_studied_at, s.next_eligible_at AS next_due_at,
        COALESCE(json_extract(s.scheduler_state_json, '$.enabled'), 1) AS enabled,
        json_extract(s.scheduler_state_json, '$.postCompensationEarliestCheckAt') AS post_compensation_earliest_check_at`;
  const rows = getDb().prepare(`
    WITH schedules AS (
      SELECT s.word_id, 'production' AS skill_id, ${production}
      FROM learner_word_schedules s WHERE s.learner_id = ?
      UNION ALL
      SELECT word_id, skill_id, interval_hours, last_studied_at, next_due_at, enabled, NULL
      FROM learner_owned_word_skill_state WHERE learner_id = ? AND skill_id IN ('recognition', 'contextual_selection')
    )
    SELECT s.*, w.mode FROM schedules s
    JOIN learner_words w ON w.word_id = s.word_id AND w.learner_id = ?
    LEFT JOIN learner_owned_word_study_admission_state a ON a.word_id = s.word_id AND a.learner_id = w.learner_id
    LEFT JOIN learner_owned_word_skill_relevance r ON r.word_id = s.word_id AND r.learner_id = w.learner_id AND r.skill_id = s.skill_id
    LEFT JOIN learner_owned_word_skill_state legacy ON legacy.word_id = s.word_id AND legacy.learner_id = w.learner_id AND legacy.skill_id = s.skill_id
    WHERE w.mode IN ('practice', 'maintain') AND w.dismissed_at IS NULL
      AND ${vocabularySessionWordEligibleSql('w.word_id')}
      AND s.enabled != 0 AND COALESCE(legacy.enabled, 1) != 0
      AND COALESCE(r.relevance_state, 'active') != 'suppressed'
      AND (a.earliest_next_study_at IS NULL OR a.earliest_next_study_at <= ?)
  `).all(learnerId, learnerId, learnerId, now) as { word_id: string; mode: 'practice' | 'maintain'; skill_id: VocabularyReviewSkill; interval_hours: number;
    last_studied_at: string | null; next_due_at: string | null; post_compensation_earliest_check_at: string | null }[];
  const due: VocabularyDueReviewObjective[] = [];
  for (const row of rows) {
    if (row.post_compensation_earliest_check_at !== null && row.post_compensation_earliest_check_at > now) continue;
    const urgency = reviewUrgency(row.interval_hours, row.last_studied_at || null, now);
    if (urgency < 1 || (row.next_due_at !== null && row.next_due_at > now)) continue;
    due.push({ wordId: row.word_id, skillId: row.skill_id, mode: row.mode, urgency, nextDueAt: row.next_due_at });
  }
  return due.sort(compareReviewCandidates);
}

const eligibleContent = `c.kind='exercise' AND c.exercise_type='pure_cue' AND c.exercise_role='general' AND c.availability='active'
  AND (c.access_scope='shared' OR c.owner_learner_id=:learner)
  AND ${vocabularyExerciseAnswersEligibleSql('c.content_id')}
  AND NOT EXISTS(SELECT 1 FROM learner_content_deactivations d WHERE d.learner_id=:learner AND d.content_id=c.content_id)
  AND EXISTS(SELECT 1 FROM exercise_answer_words a JOIN learner_words w ON w.word_id=a.word_id AND w.learner_id=:learner
    LEFT JOIN learner_owned_word_skill_state s ON s.learner_id=w.learner_id AND s.word_id=w.word_id AND s.skill_id='production'
    LEFT JOIN learner_owned_word_skill_relevance r ON r.learner_id=w.learner_id AND r.word_id=w.word_id AND r.skill_id='production'
    WHERE a.exercise_id=c.content_id AND w.mode IN ('practice','maintain') AND w.dismissed_at IS NULL
      AND COALESCE(s.enabled,1)=1 AND COALESCE(r.relevance_state,'normal')!='suppressed')`;

/** Pre-index pure-cue planning without adoption: identities of rechecks and routine cues, in session order. */
export function referencePureCuePlan(input: { ordinaryReviewCount: number; sessionSeed: string; now: string }): { rechecks: string[]; routine: string[] } {
  const now = input.now;
  const rows = (getDb().prepare(`SELECT s.* FROM learner_pure_cue_schedules s JOIN content_items c USING(content_id)
    WHERE s.learner_id=:learner AND ${eligibleContent} ORDER BY c.created_at,c.content_id`).all({ learner: requireLearnerId() }) as Record<string, unknown>[])
    .filter((row) => (mergePureCueSchedulerState(row).enabled ?? 1) === 1);
  const cues = rows.filter((row) => (getDb().prepare(`SELECT word_id FROM content_words WHERE content_id=?
      UNION SELECT word_id FROM exercise_answer_words WHERE exercise_id=?`).all(String(row.content_id), String(row.content_id)) as { word_id: string }[])
    .every((word) => !isSenseContentReconciliationPending(word.word_id)))
    .map((row): PureCueSelectionCandidate & { recheckAt: string | null } => {
      const state = mergePureCueSchedulerState(row);
      return { id: String(row.content_id), maintenanceIdentity: state.maintenanceIdentity, active: state.resetUntil == null || state.resetUntil <= now,
        lastStudiedAt: row.last_practised_at as string | null, nextDueAt: (row.next_eligible_at as string | null) ?? now,
        strongSince: state.strongSince ?? null, strongSuccesses: state.strongSuccesses ?? 0, recheckAt: state.postCompensationRecheckAt ?? null };
    });
  let draw = 0; const random = () => parseInt(createHash('sha256').update(`${input.sessionSeed}/${draw++}`).digest('hex').slice(0, 8), 16) / 0x100000000;
  const rechecks = cues.flatMap((cue) => cue.active && cue.recheckAt !== null && cue.recheckAt <= now ? [{ id: cue.id, recheckAt: cue.recheckAt }] : []);
  const routine = selectPureCuesForSession({ learnerId: requireLearnerId(), cues: cues.filter((cue) => cue.recheckAt === null),
    ordinaryReviewCount: input.ordinaryReviewCount, now, random }).selected;
  return { rechecks: rechecks.sort((a, b) => a.recheckAt.localeCompare(b.recheckAt) || a.id.localeCompare(b.id)).map((cue) => cue.id),
    routine: routine.map((cue) => cue.id) };
}
