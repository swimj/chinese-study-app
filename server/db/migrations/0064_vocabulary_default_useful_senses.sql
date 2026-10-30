-- Default selection initialization has a distinct bounded lifecycle from inventory creation.
CREATE TABLE vocabulary_default_selection_readiness (
  word_id TEXT PRIMARY KEY REFERENCES lexical_words(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK(status IN ('queued','running','ready','failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 3),
  total_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(total_attempt_count >= 0),
  active_token TEXT, expires_at TEXT,
  expected_catalog_version INTEGER NOT NULL CHECK(expected_catalog_version >= 0),
  workflow_id TEXT NOT NULL,
  invocation_id TEXT REFERENCES model_invocations(id) ON DELETE RESTRICT,
  recommendation_json TEXT CHECK(recommendation_json IS NULL OR json_valid(recommendation_json)),
  last_error TEXT,
  next_attempt_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  CHECK((status='running' AND active_token IS NOT NULL AND expires_at IS NOT NULL)
    OR (status!='running' AND active_token IS NULL AND expires_at IS NULL))
);
CREATE INDEX idx_vocabulary_default_selection_due ON vocabulary_default_selection_readiness(status,next_attempt_at,word_id);
