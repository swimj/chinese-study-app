-- Operational daily product-usage pulse snapshots (content-free cohort aggregates).
CREATE TABLE usage_daily_snapshots (
  day_key TEXT PRIMARY KEY,
  captured_at TEXT NOT NULL,
  dau INTEGER NOT NULL CHECK (dau >= 0),
  sessions_completed INTEGER NOT NULL CHECK (sessions_completed >= 0),
  new_words INTEGER NOT NULL CHECK (new_words >= 0),
  model_spend_usd REAL NOT NULL CHECK (model_spend_usd >= 0),
  median_stash_size REAL CHECK (median_stash_size IS NULL OR median_stash_size >= 0),
  median_session_active_ms REAL CHECK (
    median_session_active_ms IS NULL OR median_session_active_ms >= 0
  ),
  learners_inactive_7d INTEGER NOT NULL CHECK (learners_inactive_7d >= 0),
  sessions_abandoned INTEGER NOT NULL CHECK (sessions_abandoned >= 0),
  learners_spend_without_accepts INTEGER NOT NULL
    CHECK (learners_spend_without_accepts >= 0),
  study_commit_failures INTEGER NOT NULL CHECK (study_commit_failures >= 0)
);
