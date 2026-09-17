-- Per-learner key-value store for non-setting parameters (cursors, etc.).
-- New tables after the frozen baseline come from migrations only.
CREATE TABLE learner_params (
  learner_id TEXT NOT NULL REFERENCES learners(learner_id) ON DELETE CASCADE,
  param_key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (learner_id, param_key)
);

INSERT INTO learner_params (learner_id, param_key, value_json, updated_at)
SELECT learner_id, setting_key, value_json, updated_at
FROM learner_settings
WHERE setting_key = 'whats_new_seen_through_date';

DELETE FROM learner_settings
WHERE setting_key = 'whats_new_seen_through_date';
