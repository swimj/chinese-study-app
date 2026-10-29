-- New completion intent only; never fabricate completion for historical sessions.
CREATE TABLE learner_session_word_outcomes (
  learner_id TEXT NOT NULL REFERENCES learners(learner_id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  word_id TEXT NOT NULL REFERENCES lexical_words(id),
  kind TEXT NOT NULL CHECK (kind IN ('introduction','learning')),
  before_status TEXT NOT NULL,
  after_status TEXT NOT NULL,
  word_json TEXT NOT NULL,
  committed_at TEXT NOT NULL,
  PRIMARY KEY (learner_id, session_id, word_id, kind)
);
CREATE TRIGGER session_word_outcome_immutable BEFORE UPDATE ON learner_session_word_outcomes
BEGIN SELECT RAISE(ABORT, 'session word outcome is immutable'); END;
CREATE TABLE learner_session_completions (
  learner_id TEXT NOT NULL REFERENCES learners(learner_id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  staged_at TEXT NOT NULL,
  close_at TEXT NOT NULL,
  input_json TEXT NOT NULL,
  report_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','cancelled','closed','failed')),
  closed_at TEXT,
  last_error TEXT,
  PRIMARY KEY (learner_id, session_id, revision_id)
);
CREATE UNIQUE INDEX idx_one_pending_completion ON learner_session_completions(learner_id)
  WHERE status IN ('pending','failed');
CREATE INDEX idx_due_session_completion ON learner_session_completions(status, close_at);
CREATE TRIGGER session_completion_input_immutable
BEFORE UPDATE OF learner_id, session_id, revision_id, staged_at, close_at, input_json ON learner_session_completions
BEGIN SELECT RAISE(ABORT, 'completion input is immutable'); END;
CREATE TRIGGER session_completion_terminal_immutable BEFORE UPDATE ON learner_session_completions
WHEN OLD.status IN ('cancelled','closed')
BEGIN SELECT RAISE(ABORT, 'concluded completion is immutable'); END;
CREATE TABLE learner_session_reflection_dispatches (
  learner_id TEXT NOT NULL REFERENCES learners(learner_id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','running','succeeded','skipped','failed')),
  active_token TEXT,
  expires_at TEXT,
  last_error TEXT,
  result_json TEXT,
  PRIMARY KEY (learner_id, session_id),
  FOREIGN KEY (learner_id, session_id, revision_id)
    REFERENCES learner_session_completions(learner_id, session_id, revision_id) ON DELETE RESTRICT
);
CREATE TRIGGER session_reflection_dispatch_input_immutable
BEFORE UPDATE OF learner_id, session_id, revision_id, evidence_json ON learner_session_reflection_dispatches
BEGIN SELECT RAISE(ABORT, 'reflection dispatch input is immutable'); END;
