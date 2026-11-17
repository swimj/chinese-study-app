-- One-time cleanup of trivial unstudied learner-word associations (an early bulk
-- import associated nearly the whole dictionary with one learner). By rule, for
-- every learner: delete a learner_words row only when it is a never-touched,
-- non-stash, non-dismissed unstudied word with a default schedule, a default (or
-- absent) legacy word-state row, and no reference anywhere else in learner data
-- or in any session. The shared dictionary is not touched. The same-transaction
-- hooks in trivial-unstudied-words-migration.ts verify the result and record it.

CREATE TEMP TABLE trivial_unstudied_attached (learner_id TEXT NOT NULL, word_id TEXT NOT NULL, PRIMARY KEY (learner_id, word_id)) WITHOUT ROWID;
INSERT OR IGNORE INTO trivial_unstudied_attached SELECT learner_id, word_id FROM encounter_words;
INSERT OR IGNORE INTO trivial_unstudied_attached SELECT learner_id, word_id FROM learner_feedback WHERE word_id IS NOT NULL;
INSERT OR IGNORE INTO trivial_unstudied_attached SELECT learner_id, word_id FROM learner_owned_intake_triage_assessments;
INSERT OR IGNORE INTO trivial_unstudied_attached SELECT learner_id, word_id FROM learner_owned_user_word_priority;
INSERT OR IGNORE INTO trivial_unstudied_attached SELECT learner_id, word_id FROM learner_owned_word_skill_relevance;
INSERT OR IGNORE INTO trivial_unstudied_attached SELECT learner_id, word_id FROM learner_owned_word_skill_state;
INSERT OR IGNORE INTO trivial_unstudied_attached SELECT learner_id, word_id FROM learner_owned_word_study_admission_state;
INSERT OR IGNORE INTO trivial_unstudied_attached SELECT learner_id, word_id FROM learner_senses;
INSERT OR IGNORE INTO trivial_unstudied_attached SELECT learner_id, word_id FROM learner_session_word_outcomes;
INSERT OR IGNORE INTO trivial_unstudied_attached SELECT learner_id, word_id FROM learner_state_effects WHERE word_id IS NOT NULL;
INSERT OR IGNORE INTO trivial_unstudied_attached SELECT learner_id, word_id FROM learner_word_introduction_events;
INSERT OR IGNORE INTO trivial_unstudied_attached SELECT learner_id, word_id FROM learner_word_preparation_reserve;
INSERT OR IGNORE INTO trivial_unstudied_attached SELECT learner_id, word_id FROM reflection_cases WHERE word_id IS NOT NULL;
INSERT OR IGNORE INTO trivial_unstudied_attached SELECT learner_id, word_id FROM session_actions WHERE word_id IS NOT NULL;
INSERT OR IGNORE INTO trivial_unstudied_attached SELECT learner_id, word_id FROM teaching_completions;
-- Learner-scoped evidence that names a word under another column.
INSERT OR IGNORE INTO trivial_unstudied_attached SELECT learner_id, target_word_id FROM learner_owned_study_events WHERE target_word_id IS NOT NULL;
INSERT OR IGNORE INTO trivial_unstudied_attached SELECT learner_id, target_word_id FROM learner_owned_study_attempt_events WHERE target_word_id IS NOT NULL;
INSERT OR IGNORE INTO trivial_unstudied_attached SELECT learner_id, submitted_word_id FROM learner_owned_production_cue_evidence_records WHERE submitted_word_id IS NOT NULL;
INSERT OR IGNORE INTO trivial_unstudied_attached SELECT learner_id, target_word_id FROM pure_cue_scheduler_compensation_snapshots;
INSERT OR IGNORE INTO trivial_unstudied_attached SELECT learner_id, selected_through_word_id FROM exercise_encounters WHERE selected_through_word_id IS NOT NULL;
-- Any session, open or closed, that froze the word into its context (this covers
-- words enrolled at session start and not yet acted on).
INSERT OR IGNORE INTO trivial_unstudied_attached
  SELECT s.learner_id, json_extract(j.value, '$.wordId') FROM vocabulary_sessions s, json_each(s.context_json, '$.words') j
  WHERE json_extract(j.value, '$.wordId') IS NOT NULL;
INSERT OR IGNORE INTO trivial_unstudied_attached
  SELECT s.learner_id, json_extract(j.value, '$.id') FROM vocabulary_sessions s, json_each(s.context_json, '$.reviewOrder') j
  WHERE json_extract(j.value, '$.kind') = 'word' AND json_extract(j.value, '$.id') IS NOT NULL;

CREATE TEMP TABLE trivial_unstudied_candidates (
  learner_id TEXT NOT NULL, word_id TEXT NOT NULL, had_legacy_state INTEGER NOT NULL, PRIMARY KEY (learner_id, word_id)
) WITHOUT ROWID;
INSERT INTO trivial_unstudied_candidates
SELECT w.learner_id, w.word_id, old.word_id IS NOT NULL
FROM learner_words w
JOIN learner_word_schedules s ON s.learner_id = w.learner_id AND s.word_id = w.word_id
LEFT JOIN learner_word_state old ON old.learner_id = w.learner_id AND old.word_id = w.word_id
WHERE w.mode = 'unstudied' AND w.in_stash = 0 AND w.dismissed_at IS NULL AND w.intended_use_text IS NULL
  AND w.state_version = 1 AND w.scope_established_at IS NULL AND w.automatic_promotion_paused = 0
  -- Untouched schedule: enrolment ('vocabulary-v1') or the 0041 import ('legacy-import-v1') defaults only.
  AND s.policy_version IN ('vocabulary-v1', 'legacy-import-v1') AND s.state_version = 1
  AND s.next_eligible_at IS NULL AND s.last_practised_at IS NULL
  AND s.refresh_requested_at IS NULL AND s.refresh_until IS NULL
  AND json_type(s.scheduler_state_json) = 'object'
  AND NOT EXISTS (SELECT 1 FROM json_each(s.scheduler_state_json) k
    WHERE k.key NOT IN ('intervalHours', 'easeFactor', 'enabled', 'cleanCoveredSessions', 'legacyAdmissionAt'))
  -- Enrolment and the 0041 import both write these four keys; a missing key keeps the word.
  AND json_extract(s.scheduler_state_json, '$.intervalHours') = 24
  AND json_extract(s.scheduler_state_json, '$.easeFactor') = 2.5
  AND json_extract(s.scheduler_state_json, '$.enabled') = 1
  AND json_extract(s.scheduler_state_json, '$.cleanCoveredSessions') = 0
  AND json_extract(s.scheduler_state_json, '$.legacyAdmissionAt') IS NULL
  -- Legacy word state: absent or the untouched default. Notes, status, streaks or coverage keep the word.
  AND (old.word_id IS NULL OR (old.status = 'unstudied' AND old.personal_notes = '' AND old.learning_streak = 0
    AND old.last_learning_success_on IS NULL AND old.last_learning_covered_on IS NULL))
  AND NOT EXISTS (SELECT 1 FROM trivial_unstudied_attached a WHERE a.learner_id = w.learner_id AND a.word_id = w.word_id);

DELETE FROM learner_word_state WHERE EXISTS (SELECT 1 FROM trivial_unstudied_candidates c
  WHERE c.learner_id = learner_word_state.learner_id AND c.word_id = learner_word_state.word_id);
DELETE FROM learner_word_schedules WHERE EXISTS (SELECT 1 FROM trivial_unstudied_candidates c
  WHERE c.learner_id = learner_word_schedules.learner_id AND c.word_id = learner_word_schedules.word_id);
DELETE FROM learner_words WHERE EXISTS (SELECT 1 FROM trivial_unstudied_candidates c
  WHERE c.learner_id = learner_words.learner_id AND c.word_id = learner_words.word_id);
