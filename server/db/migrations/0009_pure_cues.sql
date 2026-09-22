-- Pure cue content is shared and immutable. Scheduling and exercise history
-- remain learner-private, and availability is governed by publication state.

-- SQLite cannot alter a CHECK constraint in place. The migration runner
-- disables foreign-key enforcement around its transaction and verifies all
-- incoming references after each migration, so use the standard table rebuild
-- while retaining the publication rows and their stable ids.
DROP TRIGGER shared_content_publications_identity_immutable;
DROP TRIGGER shared_content_publications_no_delete;
DROP TRIGGER shared_content_publications_status_transition_guard;
DROP INDEX idx_shared_content_publications_eligibility;

-- Retain the final table name instead of ALTER TABLE ... RENAME: triggers on
-- other tables refer to it, and SQLite validates those during a rename while
-- the old name is temporarily absent. Everything here is one transaction.
CREATE TEMP TABLE pure_cue_migration_publications AS SELECT * FROM shared_content_publications;
DROP TABLE shared_content_publications;
CREATE TABLE shared_content_publications (
  publication_id TEXT PRIMARY KEY,
  content_kind TEXT NOT NULL CHECK (
    content_kind IN ('production_cue', 'contrast_cluster', 'production_cue_supplement', 'pure_cue')
  ),
  content_id TEXT NOT NULL,
  learning_purpose_key TEXT NOT NULL CHECK (length(trim(learning_purpose_key)) > 0),
  publication_status TEXT NOT NULL CHECK (
    publication_status IN ('shared_trial', 'available', 'quarantined', 'retired')
  ),
  published_at TEXT NOT NULL,
  status_updated_at TEXT NOT NULL,
  UNIQUE (content_kind, content_id)
);

INSERT INTO shared_content_publications (
  publication_id, content_kind, content_id, learning_purpose_key,
  publication_status, published_at, status_updated_at
)
SELECT
  publication_id, content_kind, content_id, learning_purpose_key,
  publication_status, published_at, status_updated_at
FROM pure_cue_migration_publications;
DROP TABLE pure_cue_migration_publications;

CREATE TRIGGER shared_content_publications_identity_immutable
BEFORE UPDATE OF
  publication_id, content_kind, content_id, learning_purpose_key, published_at
ON shared_content_publications
BEGIN
  SELECT RAISE(ABORT, 'shared content publication identity is immutable');
END;

CREATE TRIGGER shared_content_publications_no_delete
BEFORE DELETE ON shared_content_publications
BEGIN
  SELECT RAISE(ABORT, 'shared content publications cannot be deleted');
END;

CREATE TRIGGER shared_content_publications_status_transition_guard
BEFORE UPDATE OF publication_status, status_updated_at
ON shared_content_publications
WHEN NOT EXISTS (
  SELECT 1
  FROM shared_content_publication_events AS event
  WHERE event.publication_id = OLD.publication_id
    AND event.from_status = OLD.publication_status
    AND event.to_status = NEW.publication_status
    AND event.occurred_at = NEW.status_updated_at
)
BEGIN
  SELECT RAISE(ABORT, 'shared content status changes require an attributable publication event');
END;

CREATE INDEX idx_shared_content_publications_eligibility
  ON shared_content_publications(
    content_kind, learning_purpose_key, publication_status, publication_id
  );

CREATE TABLE pure_cues (
  id TEXT PRIMARY KEY,
  stimulus TEXT NOT NULL CHECK (length(trim(stimulus)) > 0),
  axis_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE pure_cue_accepted_words (
  pure_cue_id TEXT NOT NULL REFERENCES pure_cues(id) ON DELETE CASCADE,
  word_id TEXT NOT NULL REFERENCES lexical_words(id) ON DELETE RESTRICT,
  position INTEGER NOT NULL CHECK (position >= 0),
  PRIMARY KEY (pure_cue_id, word_id),
  UNIQUE (pure_cue_id, position)
);

CREATE TABLE learner_pure_cue_state (
  learner_id TEXT NOT NULL REFERENCES learners(learner_id) ON DELETE CASCADE,
  pure_cue_id TEXT NOT NULL REFERENCES pure_cues(id) ON DELETE CASCADE,
  interval_hours INTEGER NOT NULL CHECK (interval_hours > 0),
  ease_factor REAL NOT NULL CHECK (ease_factor >= 1.8),
  last_studied_at TEXT,
  next_due_at TEXT NOT NULL,
  strong_since TEXT,
  strong_successes INTEGER NOT NULL DEFAULT 0 CHECK (strong_successes >= 0),
  adopted_at TEXT NOT NULL,
  PRIMARY KEY (learner_id, pure_cue_id)
);

CREATE TABLE pure_cue_served_snapshots (
  learner_id TEXT NOT NULL REFERENCES learners(learner_id) ON DELETE CASCADE,
  snapshot_id TEXT NOT NULL,
  pure_cue_id TEXT NOT NULL REFERENCES pure_cues(id) ON DELETE RESTRICT,
  served_at TEXT NOT NULL,
  stimulus TEXT NOT NULL,
  axis_note TEXT NOT NULL,
  accepted_answers_json TEXT NOT NULL,
  consumed_attempt_id TEXT,
  consumed_at TEXT,
  PRIMARY KEY (learner_id, snapshot_id),
  UNIQUE (learner_id, consumed_attempt_id),
  CHECK (
    (consumed_attempt_id IS NULL AND consumed_at IS NULL)
    OR (consumed_attempt_id IS NOT NULL AND consumed_at IS NOT NULL)
  )
);

CREATE TABLE pure_cue_attempts (
  learner_id TEXT NOT NULL REFERENCES learners(learner_id) ON DELETE CASCADE,
  attempt_id TEXT NOT NULL,
  pure_cue_id TEXT NOT NULL REFERENCES pure_cues(id) ON DELETE RESTRICT,
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

CREATE INDEX idx_learner_pure_cue_state_due
  ON learner_pure_cue_state(learner_id, strong_since, next_due_at);
CREATE INDEX idx_learner_pure_cue_state_strong
  ON learner_pure_cue_state(learner_id, strong_successes, last_studied_at)
  WHERE strong_since IS NOT NULL;
CREATE INDEX idx_pure_cue_accepted_words_word
  ON pure_cue_accepted_words(word_id, pure_cue_id);
CREATE INDEX idx_pure_cue_compensation_target
  ON pure_cue_scheduler_compensation_snapshots(learner_id, target_word_id, captured_at);

CREATE TRIGGER pure_cues_identity_content_immutable
BEFORE UPDATE OF id, stimulus, axis_note, created_at ON pure_cues
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
