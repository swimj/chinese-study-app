import { getDb } from '../db/connection.ts';
import { requireLearnerId } from '../db/learner-context.ts';
import { reviewUrgency, compareReviewCandidates } from '../db/review-policy.ts';
import { canServeVocabularyReviewProduction } from './production-coverage.ts';

export type VocabularyReviewSkill = 'recognition' | 'production' | 'contextual_selection';
export type VocabularyReviewSelection = { wordId: string; skillId: VocabularyReviewSkill };
type Candidate = VocabularyReviewSelection & { urgency: number; nextDueAt: string | null };
type ScheduleRow = {
  word_id: string; mode: 'practice' | 'maintain'; skill_id: VocabularyReviewSkill; interval_hours: number;
  last_studied_at: string | null; next_due_at: string | null; enabled: number;
};

/** Select a single due objective per established review word, using its current model's schedule. */
export function selectVocabularyReviewSkills(options: {
  now: string;
  canUseSkill?: (wordId: string, skillId: VocabularyReviewSkill) => boolean;
}): VocabularyReviewSelection[] {
  const learnerId = requireLearnerId();
  const nowTime = Date.parse(options.now);
  if (!Number.isFinite(nowTime)) throw new Error('Review selection requires a valid timestamp');
  const rows = getDb().prepare(`
    WITH schedules AS (
      SELECT s.word_id, 'production' AS skill_id,
        json_extract(s.scheduler_state_json, '$.intervalHours') AS interval_hours,
        s.last_practised_at AS last_studied_at, s.next_eligible_at AS next_due_at,
        COALESCE(json_extract(s.scheduler_state_json, '$.enabled'), 1) AS enabled
      FROM learner_word_schedules s WHERE s.learner_id = ?
      UNION ALL
      SELECT word_id, skill_id, interval_hours, last_studied_at, next_due_at, enabled
      FROM learner_owned_word_skill_state WHERE learner_id = ? AND skill_id IN ('recognition', 'contextual_selection')
    )
    SELECT s.*, w.mode FROM schedules s
    JOIN learner_words w ON w.word_id = s.word_id AND w.learner_id = ?
    LEFT JOIN learner_owned_word_study_admission_state a ON a.word_id = s.word_id AND a.learner_id = w.learner_id
    LEFT JOIN learner_owned_word_skill_relevance r ON r.word_id = s.word_id AND r.learner_id = w.learner_id AND r.skill_id = s.skill_id
    LEFT JOIN learner_owned_word_skill_state legacy ON legacy.word_id = s.word_id AND legacy.learner_id = w.learner_id AND legacy.skill_id = s.skill_id
    WHERE w.mode IN ('practice', 'maintain') AND w.dismissed_at IS NULL
      AND s.enabled != 0 AND COALESCE(legacy.enabled, 1) != 0
      AND COALESCE(r.relevance_state, 'active') != 'suppressed'
      AND (a.earliest_next_study_at IS NULL OR a.earliest_next_study_at <= ?)
  `).all(learnerId, learnerId, learnerId, options.now) as ScheduleRow[];
  const best = new Map<string, Candidate>();
  for (const row of rows) {
    if (options.canUseSkill ? !options.canUseSkill(row.word_id, row.skill_id) : row.skill_id === 'contextual_selection') continue;
    // A newly enabled objective has no recall evidence and is immediately eligible.
    const urgency = reviewUrgency(row.interval_hours, row.last_studied_at || null, options.now);
    if (urgency < 1 || (row.next_due_at !== null && row.next_due_at > options.now)) continue;
    if (row.skill_id === 'production' && !canServeVocabularyReviewProduction(row.word_id, row.mode)) continue;
    const candidate: Candidate = { wordId: row.word_id, skillId: row.skill_id, urgency, nextDueAt: row.next_due_at };
    const previous = best.get(candidate.wordId);
    if (!previous || compareReviewCandidates(candidate, previous) < 0) best.set(candidate.wordId, candidate);
  }
  return [...best.values()].sort(compareReviewCandidates).map(({ wordId, skillId }) => ({ wordId, skillId }));
}
