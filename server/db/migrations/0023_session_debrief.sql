-- Forward-only debriefs: do not infer inventories or enqueue historical sessions.
CREATE TABLE learner_session_debrief_jobs (
  learner_id TEXT NOT NULL REFERENCES learners(learner_id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  exercise_count INTEGER NOT NULL CHECK (exercise_count >= 0),
  input_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'ready', 'failed')),
  result_json TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  active_token TEXT,
  expires_at TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (learner_id, session_id),
  FOREIGN KEY (learner_id, session_id)
    REFERENCES learner_owned_review_session_summaries(learner_id, session_id) ON DELETE RESTRICT,
  CHECK ((status = 'running' AND active_token IS NOT NULL AND expires_at IS NOT NULL)
    OR (status != 'running' AND active_token IS NULL AND expires_at IS NULL)),
  CHECK ((status = 'ready' AND result_json IS NOT NULL) OR (status != 'ready' AND result_json IS NULL))
);
CREATE INDEX idx_session_debrief_due ON learner_session_debrief_jobs(status, completed_at);
CREATE TABLE learner_session_debrief_attempts (
  learner_id TEXT NOT NULL REFERENCES learners(learner_id) ON DELETE CASCADE,
  attempt_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  outcome TEXT CHECK (outcome IN ('ready', 'failed', 'interrupted')),
  error_code TEXT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  reasoning_effort TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  response_id TEXT,
  finish_reason TEXT,
  usage_json TEXT,
  duration_ms INTEGER CHECK (duration_ms >= 0),
  pricing_json TEXT,
  estimated_cost_usd REAL CHECK (estimated_cost_usd >= 0),
  PRIMARY KEY (learner_id, attempt_id),
  FOREIGN KEY (learner_id, session_id)
    REFERENCES learner_session_debrief_jobs(learner_id, session_id) ON DELETE RESTRICT,
  CHECK ((completed_at IS NULL AND outcome IS NULL) OR (completed_at IS NOT NULL AND outcome IS NOT NULL))
);
CREATE TRIGGER session_debrief_input_immutable
BEFORE UPDATE OF learner_id, session_id, completed_at, exercise_count, input_json ON learner_session_debrief_jobs
BEGIN SELECT RAISE(ABORT, 'debrief input is immutable'); END;
CREATE TRIGGER session_debrief_result_immutable
BEFORE UPDATE ON learner_session_debrief_jobs WHEN OLD.status = 'ready'
BEGIN SELECT RAISE(ABORT, 'ready debrief is immutable'); END;
CREATE TRIGGER session_debrief_attempt_identity_immutable
BEFORE UPDATE OF learner_id, attempt_id, session_id, started_at, provider, model, reasoning_effort, prompt_version ON learner_session_debrief_attempts
BEGIN SELECT RAISE(ABORT, 'debrief attempt identity is immutable'); END;
CREATE TRIGGER session_debrief_attempt_terminal_immutable
BEFORE UPDATE ON learner_session_debrief_attempts WHEN OLD.outcome IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'concluded debrief attempt is immutable'); END;
