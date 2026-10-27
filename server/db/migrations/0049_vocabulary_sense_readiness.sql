-- One durable inventory attempt per word; interruption requires explicit retry.
CREATE TABLE vocabulary_sense_readiness (
  word_id TEXT PRIMARY KEY REFERENCES lexical_words(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('queued','running','ready','failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0 AND attempt_count <= 3),
  active_token TEXT,
  expires_at TEXT,
  expected_catalog_version INTEGER NOT NULL CHECK (expected_catalog_version >= 0),
  workflow_id TEXT NOT NULL,
  invocation_id TEXT REFERENCES model_invocations(id) ON DELETE RESTRICT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((status = 'running' AND active_token IS NOT NULL AND expires_at IS NOT NULL)
    OR (status != 'running' AND active_token IS NULL AND expires_at IS NULL))
);
CREATE INDEX idx_vocabulary_sense_readiness_status ON vocabulary_sense_readiness(status,updated_at,word_id);
