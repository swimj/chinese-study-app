import { vocabularySessionWordEligibleSql } from '../db/vocabulary-sense-eligibility.ts';
import { getDb } from '../db/connection.ts';
import { requireLearnerId } from '../db/learner-context.ts';
import { reviewUrgency, compareReviewCandidates } from '../db/review-policy.ts';
import { canServeVocabularyReviewProduction } from './production-coverage.ts';

export type VocabularyReviewSkill = 'recognition' | 'production' | 'contextual_selection';
export type VocabularyReviewSelection = { wordId: string; skillId: VocabularyReviewSkill };
/** A due objective that passed the SQL policy filters, before content-dependent checks. */
export type VocabularyDueReviewObjective = VocabularyReviewSelection & {
  mode: 'practice' | 'maintain'; urgency: number; nextDueAt: string | null;
};
type ScheduleRow = {
  word_id: string; mode: 'practice' | 'maintain'; skill_id: VocabularyReviewSkill; interval_hours: number;
  last_studied_at: string | null; next_due_at: string | null; post_compensation_earliest_check_at: string | null;
};

/**
 * Every due review objective for the learner. Each queue's first read is one
 * covering due-index range; it over-reads history-free schedules of unstudied
 * words, which the per-row learner_words probe drops. Policy filters (mode,
 * dismissal, enablement, relevance, word recency guard, sense eligibility) apply
 * to the rows read; the in-memory urgency rule stays authoritative.
 */
export function readVocabularyDueReviewObjectives(now: string): VocabularyDueReviewObjective[] {
  const learnerId = requireLearnerId();
  if (!Number.isFinite(Date.parse(now))) throw new Error('Review selection requires a valid timestamp');
  const rows = getDb().prepare(`
    WITH schedules AS (
      SELECT word_id, 'production' AS skill_id, interval_hours, last_practised_at AS last_studied_at,
        next_eligible_at AS next_due_at, enabled, post_compensation_check_at AS post_compensation_earliest_check_at
      FROM learner_word_schedules WHERE learner_id = :learner AND review_due_at <= :now
      UNION ALL
      SELECT word_id, skill_id, interval_hours, last_studied_at, next_due_at, enabled, NULL
      FROM learner_owned_word_skill_state
      WHERE learner_id = :learner AND review_due_at <= :now AND skill_id IN ('recognition', 'contextual_selection')
    )
    SELECT s.*, w.mode FROM schedules s
    JOIN learner_words w ON w.word_id = s.word_id AND w.learner_id = :learner
    LEFT JOIN learner_owned_word_study_admission_state a ON a.word_id = s.word_id AND a.learner_id = w.learner_id
    LEFT JOIN learner_owned_word_skill_relevance r ON r.word_id = s.word_id AND r.learner_id = w.learner_id AND r.skill_id = s.skill_id
    LEFT JOIN learner_owned_word_skill_state legacy ON legacy.word_id = s.word_id AND legacy.learner_id = w.learner_id AND legacy.skill_id = s.skill_id
    WHERE w.mode IN ('practice', 'maintain') AND w.dismissed_at IS NULL
      AND ${vocabularySessionWordEligibleSql('w.word_id')}
      AND s.enabled != 0 AND COALESCE(legacy.enabled, 1) != 0
      AND COALESCE(r.relevance_state, 'active') != 'suppressed'
      AND (a.earliest_next_study_at IS NULL OR a.earliest_next_study_at <= :now)
  `).all({ learner: learnerId, now }) as ScheduleRow[];
  const due: VocabularyDueReviewObjective[] = [];
  for (const row of rows) {
    // The index read is exact; these checks keep the in-memory rule authoritative.
    if (row.post_compensation_earliest_check_at !== null && row.post_compensation_earliest_check_at > now) continue;
    // A newly enabled objective has no recall evidence and is immediately eligible.
    const urgency = reviewUrgency(row.interval_hours, row.last_studied_at || null, now);
    if (urgency < 1 || (row.next_due_at !== null && row.next_due_at > now)) continue;
    due.push({ wordId: row.word_id, skillId: row.skill_id, mode: row.mode, urgency, nextDueAt: row.next_due_at });
  }
  return due.sort(compareReviewCandidates);
}

/** Content-dependent checks for one due objective, in the order selection has always applied them. */
export function canUseVocabularyReviewObjective(objective: VocabularyDueReviewObjective,
  canUseSkill?: (wordId: string, skillId: VocabularyReviewSkill) => boolean): boolean {
  if (canUseSkill ? !canUseSkill(objective.wordId, objective.skillId) : objective.skillId === 'contextual_selection') return false;
  return objective.skillId !== 'production' || canServeVocabularyReviewProduction(objective.wordId, objective.mode);
}

/** Select a single due objective per established review word, using its current model's schedule. */
export function selectVocabularyReviewSkills(options: {
  now: string;
  canUseSkill?: (wordId: string, skillId: VocabularyReviewSkill) => boolean;
}): VocabularyReviewSelection[] {
  const best = new Map<string, VocabularyDueReviewObjective>();
  // Objectives arrive in ranking order, so the first usable one per word is its best.
  for (const objective of readVocabularyDueReviewObjectives(options.now)) {
    if (best.has(objective.wordId) || !canUseVocabularyReviewObjective(objective, options.canUseSkill)) continue;
    best.set(objective.wordId, objective);
  }
  return [...best.values()].map(({ wordId, skillId }) => ({ wordId, skillId }));
}
