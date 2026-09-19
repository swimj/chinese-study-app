-- Learner-private standalone elicitations with independent scheduling.
CREATE TABLE pure_cues (
  learner_id TEXT NOT NULL REFERENCES learners(learner_id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  stimulus TEXT NOT NULL CHECK (length(trim(stimulus)) > 0),
  axis_note TEXT NOT NULL DEFAULT '',
  interval_hours INTEGER NOT NULL CHECK (interval_hours > 0),
  ease_factor REAL NOT NULL CHECK (ease_factor >= 1.8),
  last_studied_at TEXT,
  next_due_at TEXT NOT NULL,
  strong_since TEXT,
  strong_successes INTEGER NOT NULL DEFAULT 0 CHECK (strong_successes >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  PRIMARY KEY (learner_id, id)
);

CREATE TABLE pure_cue_accepted_words (
  learner_id TEXT NOT NULL,
  pure_cue_id TEXT NOT NULL,
  word_id TEXT NOT NULL REFERENCES lexical_words(id) ON DELETE RESTRICT,
  position INTEGER NOT NULL CHECK (position >= 0),
  PRIMARY KEY (learner_id, pure_cue_id, word_id),
  UNIQUE (learner_id, pure_cue_id, position),
  FOREIGN KEY (learner_id, pure_cue_id)
    REFERENCES pure_cues(learner_id, id) ON DELETE CASCADE
);

CREATE TABLE pure_cue_served_snapshots (
  learner_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  pure_cue_id TEXT NOT NULL,
  served_at TEXT NOT NULL,
  stimulus TEXT NOT NULL,
  axis_note TEXT NOT NULL,
  accepted_answers_json TEXT NOT NULL,
  consumed_attempt_id TEXT,
  consumed_at TEXT,
  PRIMARY KEY (learner_id, snapshot_id),
  UNIQUE (learner_id, consumed_attempt_id),
  FOREIGN KEY (learner_id, pure_cue_id)
    REFERENCES pure_cues(learner_id, id) ON DELETE RESTRICT,
  CHECK (
    (consumed_attempt_id IS NULL AND consumed_at IS NULL)
    OR (consumed_attempt_id IS NOT NULL AND consumed_at IS NOT NULL)
  )
);

CREATE TABLE pure_cue_attempts (
  learner_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  pure_cue_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  session_action_id TEXT NOT NULL,
  committed_at TEXT NOT NULL,
  events_json TEXT NOT NULL,
  failure_count INTEGER NOT NULL CHECK (failure_count >= 0),
  terminal_rating TEXT CHECK (terminal_rating IN ('hard', 'good', 'easy')),
  PRIMARY KEY (learner_id, attempt_id),
  UNIQUE (learner_id, snapshot_id),
  UNIQUE (learner_id, session_id, session_action_id),
  FOREIGN KEY (learner_id, pure_cue_id)
    REFERENCES pure_cues(learner_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (learner_id, snapshot_id)
    REFERENCES pure_cue_served_snapshots(learner_id, snapshot_id) ON DELETE RESTRICT,
  CHECK (
    (failure_count = 0 AND terminal_rating IS NOT NULL)
    OR (failure_count > 0 AND terminal_rating IS NULL)
  )
);

-- Pre-projection state for post-release false-lapse compensation. The batch
-- key prevents different source events from restoring one projection twice.
CREATE TABLE pure_cue_scheduler_compensation_snapshots (
  learner_id TEXT NOT NULL REFERENCES learners(learner_id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  session_action_id TEXT NOT NULL,
  target_word_id TEXT NOT NULL REFERENCES lexical_words(id) ON DELETE RESTRICT,
  captured_at TEXT NOT NULL,
  production_skill_state_json TEXT NOT NULL,
  admission_state_json TEXT NOT NULL,
  compensated_by_invocation_id TEXT,
  compensated_at TEXT,
  PRIMARY KEY (learner_id, session_id, session_action_id),
  UNIQUE (learner_id, compensated_by_invocation_id),
  CHECK (
    (compensated_by_invocation_id IS NULL AND compensated_at IS NULL)
    OR (compensated_by_invocation_id IS NOT NULL AND compensated_at IS NOT NULL)
  )
);

CREATE TABLE pure_cue_scheduler_compensation_snapshot_attempts (
  learner_id TEXT NOT NULL,
  source_attempt_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  session_action_id TEXT NOT NULL,
  PRIMARY KEY (learner_id, source_attempt_id),
  FOREIGN KEY (learner_id, source_attempt_id)
    REFERENCES learner_owned_study_attempt_events(learner_id, id) ON DELETE CASCADE,
  FOREIGN KEY (learner_id, session_id, session_action_id)
    REFERENCES pure_cue_scheduler_compensation_snapshots(
      learner_id, session_id, session_action_id
    ) ON DELETE CASCADE
);

CREATE INDEX idx_pure_cues_due
  ON pure_cues(learner_id, active, strong_since, next_due_at);
CREATE INDEX idx_pure_cues_strong
  ON pure_cues(learner_id, active, strong_successes, last_studied_at)
  WHERE strong_since IS NOT NULL;
CREATE INDEX idx_pure_cue_accepted_words_word
  ON pure_cue_accepted_words(learner_id, word_id, pure_cue_id);
CREATE INDEX idx_pure_cue_compensation_target
  ON pure_cue_scheduler_compensation_snapshots(learner_id, target_word_id, captured_at);

CREATE TRIGGER pure_cues_identity_content_immutable
BEFORE UPDATE OF learner_id, id, stimulus, axis_note, created_at ON pure_cues
BEGIN
  SELECT RAISE(ABORT, 'pure cue identity and content are immutable');
END;

CREATE TRIGGER pure_cue_accepted_words_immutable
BEFORE UPDATE ON pure_cue_accepted_words
BEGIN
  SELECT RAISE(ABORT, 'pure cue accepted membership is immutable');
END;

CREATE TRIGGER pure_cue_accepted_words_no_delete
BEFORE DELETE ON pure_cue_accepted_words
BEGIN
  SELECT RAISE(ABORT, 'pure cue accepted membership cannot be deleted');
END;

CREATE TRIGGER pure_cue_served_snapshots_immutable
BEFORE UPDATE OF
  learner_id, snapshot_id, pure_cue_id, served_at, stimulus, axis_note, accepted_answers_json
ON pure_cue_served_snapshots
BEGIN
  SELECT RAISE(ABORT, 'pure cue served snapshot is immutable');
END;

CREATE TRIGGER pure_cue_served_snapshots_no_delete
BEFORE DELETE ON pure_cue_served_snapshots
BEGIN
  SELECT RAISE(ABORT, 'pure cue served snapshots cannot be deleted');
END;

CREATE TRIGGER pure_cue_attempts_immutable
BEFORE UPDATE ON pure_cue_attempts
BEGIN
  SELECT RAISE(ABORT, 'pure cue attempts are immutable');
END;

CREATE TRIGGER pure_cue_attempts_no_delete
BEFORE DELETE ON pure_cue_attempts
BEGIN
  SELECT RAISE(ABORT, 'pure cue attempts cannot be deleted');
END;

CREATE TRIGGER pure_cue_scheduler_snapshots_content_immutable
BEFORE UPDATE OF
  learner_id, session_id, session_action_id, target_word_id, captured_at,
  production_skill_state_json, admission_state_json
ON pure_cue_scheduler_compensation_snapshots
BEGIN
  SELECT RAISE(ABORT, 'pure cue scheduler compensation snapshot is immutable');
END;

CREATE TRIGGER pure_cue_scheduler_snapshot_attempts_immutable
BEFORE UPDATE ON pure_cue_scheduler_compensation_snapshot_attempts
BEGIN
  SELECT RAISE(ABORT, 'pure cue scheduler compensation links are immutable');
END;
