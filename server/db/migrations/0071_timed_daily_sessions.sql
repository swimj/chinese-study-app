-- Timed daily practice prototype. The operator control defaults on; switching it
-- off is the rollback to classic sessions. Skip counts and session records are
-- read only by the timed paradigm, so classic sessions ignore them.
CREATE TABLE service_controls_next (
  control_key TEXT PRIMARY KEY CHECK (
    control_key IN ('maintenance_mode', 'provider_work_enabled', 'operator_only', 'timed_sessions')
  ),
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  updated_at TEXT NOT NULL,
  actor_id TEXT NOT NULL CHECK (length(trim(actor_id)) > 0)
);
INSERT INTO service_controls_next (control_key, enabled, updated_at, actor_id)
SELECT control_key, enabled, updated_at, actor_id FROM service_controls;
INSERT INTO service_controls_next (control_key, enabled, updated_at, actor_id)
VALUES ('timed_sessions', 1, '1970-01-01T00:00:00.000Z', 'system_default');
DROP TABLE service_controls;
ALTER TABLE service_controls_next RENAME TO service_controls;

-- Separate local study days on which a due held item was passed over.
-- Serving the item deletes its row. Due dates are never moved.
CREATE TABLE learner_timed_skip_counts (
  learner_id TEXT NOT NULL REFERENCES learners(learner_id),
  target_kind TEXT NOT NULL CHECK (target_kind IN ('word', 'pure_cue')),
  target_id TEXT NOT NULL CHECK (length(trim(target_id)) > 0),
  skip_days INTEGER NOT NULL CHECK (skip_days >= 1),
  last_skipped_day TEXT NOT NULL CHECK (last_skipped_day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (learner_id, target_kind, target_id)
);

-- What the timed policy served against the classic rule, for later reading.
-- Active time is the client's visibility-and-focus measure; the latest value
-- accepted with each Next keeps an abandoned session's time in its day.
CREATE TABLE vocabulary_timed_session_records (
  session_id TEXT PRIMARY KEY REFERENCES vocabulary_sessions(session_id),
  learner_id TEXT NOT NULL REFERENCES learners(learner_id),
  day_key TEXT NOT NULL CHECK (day_key GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  budget_ms INTEGER NOT NULL CHECK (budget_ms > 0),
  budget_source TEXT NOT NULL CHECK (budget_source IN ('chosen', 'default')),
  day_active_ms_at_start INTEGER NOT NULL CHECK (day_active_ms_at_start >= 0),
  last_active_ms INTEGER NOT NULL DEFAULT 0 CHECK (last_active_ms >= 0),
  gate_held INTEGER NOT NULL DEFAULT 0 CHECK (gate_held IN (0, 1)),
  started_at TEXT NOT NULL,
  closed_at TEXT,
  session_active_ms INTEGER CHECK (session_active_ms IS NULL OR session_active_ms >= 0),
  day_active_ms INTEGER CHECK (day_active_ms IS NULL OR day_active_ms >= 0),
  budget_wrapped INTEGER CHECK (budget_wrapped IS NULL OR budget_wrapped IN (0, 1)),
  extensions INTEGER CHECK (extensions IS NULL OR extensions >= 0),
  new_words_started INTEGER CHECK (new_words_started IS NULL OR new_words_started >= 0),
  unstarted_pressing_json TEXT CHECK (unstarted_pressing_json IS NULL OR json_valid(unstarted_pressing_json)),
  served_json TEXT CHECK (served_json IS NULL OR json_valid(served_json)),
  note TEXT CHECK (note IS NULL OR length(note) BETWEEN 1 AND 500),
  note_at TEXT
);
CREATE INDEX idx_timed_session_records_day ON vocabulary_timed_session_records(learner_id, day_key);
