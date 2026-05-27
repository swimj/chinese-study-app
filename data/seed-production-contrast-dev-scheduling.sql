PRAGMA foreign_keys = ON;

BEGIN;

-- Dev-only scheduling eligibility for the production-history contrast seed.
-- The content seed is safe for study databases; this script intentionally moves
-- the seeded words into review and makes contextual selection immediately due.

UPDATE words
SET status = 'review'
WHERE id IN (
  SELECT word_id
  FROM contrast_cluster_members
  WHERE cluster_id LIKE 'seed-contrast-%'
);

INSERT INTO word_study_admission_state (
  word_id,
  study_phase,
  earliest_next_study_at
)
SELECT DISTINCT
  word_id,
  'review',
  NULL
FROM contrast_cluster_members
WHERE cluster_id LIKE 'seed-contrast-%'
ON CONFLICT(word_id) DO UPDATE SET
  study_phase = excluded.study_phase,
  earliest_next_study_at = excluded.earliest_next_study_at;

INSERT INTO word_skill_state (
  word_id,
  skill_id,
  enabled,
  interval_hours,
  last_studied_at,
  next_due_at,
  ease_factor
)
SELECT DISTINCT
  word_id,
  'contextual_selection',
  1,
  24,
  '2026-01-01T00:00:00.000Z',
  '2026-01-02T00:00:00.000Z',
  2.5
FROM contrast_cluster_members
WHERE cluster_id LIKE 'seed-contrast-%'
ON CONFLICT(word_id, skill_id) DO UPDATE SET
  enabled = excluded.enabled,
  interval_hours = excluded.interval_hours,
  last_studied_at = excluded.last_studied_at,
  next_due_at = excluded.next_due_at,
  ease_factor = excluded.ease_factor;

INSERT INTO word_skill_relevance (
  word_id,
  skill_id,
  relevance_state,
  updated_at,
  source_event_id
)
SELECT DISTINCT
  word_id,
  'contextual_selection',
  'normal',
  '2026-05-27T00:00:00.000Z',
  NULL
FROM contrast_cluster_members
WHERE cluster_id LIKE 'seed-contrast-%'
ON CONFLICT(word_id, skill_id) DO UPDATE SET
  relevance_state = excluded.relevance_state,
  updated_at = excluded.updated_at,
  source_event_id = excluded.source_event_id;

COMMIT;
