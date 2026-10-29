-- Bound summary recovery reads to the current learner's recent accepted history.
CREATE INDEX idx_study_attempt_events_learner_time
  ON learner_owned_study_attempt_events(learner_id, occurred_at)
  WHERE projected_at IS NOT NULL;
