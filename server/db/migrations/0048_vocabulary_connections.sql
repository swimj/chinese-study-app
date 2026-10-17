-- Reuse the durable Connections queue without manufacturing legacy summaries.
-- The migration runner disables foreign keys for this rebuild and validates them before commit.
CREATE UNIQUE INDEX idx_vocabulary_completion_source_ref ON vocabulary_session_completions(learner_id,session_id,completion_id);
CREATE TABLE learner_session_debrief_jobs_next (
  learner_id TEXT NOT NULL REFERENCES learners(learner_id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  exercise_count INTEGER NOT NULL CHECK (exercise_count >= 0),
  input_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','running','ready','failed')),
  result_json TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  active_token TEXT,
  expires_at TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL,
  source_kind TEXT NOT NULL DEFAULT 'legacy' CHECK(source_kind IN ('legacy','vocabulary')),
  legacy_session_id TEXT GENERATED ALWAYS AS (CASE WHEN source_kind='legacy' THEN session_id ELSE NULL END) STORED,
  vocabulary_completion_id TEXT,
  PRIMARY KEY(learner_id,session_id),
  FOREIGN KEY(learner_id,legacy_session_id) REFERENCES learner_owned_review_session_summaries(learner_id,session_id) ON DELETE RESTRICT,
  FOREIGN KEY(learner_id,session_id,vocabulary_completion_id) REFERENCES vocabulary_session_completions(learner_id,session_id,completion_id) ON DELETE RESTRICT,
  CHECK((source_kind='legacy' AND vocabulary_completion_id IS NULL) OR (source_kind='vocabulary' AND vocabulary_completion_id IS NOT NULL)),
  CHECK((status='running' AND active_token IS NOT NULL AND expires_at IS NOT NULL) OR (status!='running' AND active_token IS NULL AND expires_at IS NULL)),
  CHECK((status='ready' AND result_json IS NOT NULL) OR (status!='ready' AND result_json IS NULL))
);
INSERT INTO learner_session_debrief_jobs_next
  (learner_id,session_id,completed_at,exercise_count,input_json,status,result_json,attempt_count,active_token,expires_at,last_error,updated_at)
SELECT learner_id,session_id,completed_at,exercise_count,input_json,status,result_json,attempt_count,active_token,expires_at,last_error,updated_at
FROM learner_session_debrief_jobs;
DROP TABLE learner_session_debrief_jobs;
ALTER TABLE learner_session_debrief_jobs_next RENAME TO learner_session_debrief_jobs;
CREATE INDEX idx_session_debrief_due ON learner_session_debrief_jobs(status,completed_at);
CREATE TRIGGER session_debrief_input_immutable
BEFORE UPDATE OF learner_id,session_id,completed_at,exercise_count,input_json,source_kind,vocabulary_completion_id ON learner_session_debrief_jobs
BEGIN SELECT RAISE(ABORT,'debrief input is immutable'); END;
CREATE TRIGGER session_debrief_result_immutable BEFORE UPDATE ON learner_session_debrief_jobs WHEN OLD.status='ready'
BEGIN SELECT RAISE(ABORT,'ready debrief is immutable'); END;
