-- Add a canonical, additive practice job alongside teaching and reconciliation jobs.
CREATE TABLE vocabulary_practice_preparation_next (
  work_id TEXT PRIMARY KEY,
  word_id TEXT NOT NULL REFERENCES lexical_words(id),
  source_content_id TEXT REFERENCES word_content_documents(content_id),
  reconciliation_id TEXT REFERENCES sense_content_reconciliations(resolution_id),
  proactive_scope_key TEXT,
  generation_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued','running','ready','failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 3),
  active_token TEXT, expires_at TEXT,
  invocation_id TEXT REFERENCES model_invocations(id),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  last_error TEXT,
  next_attempt_at TEXT NOT NULL DEFAULT '',
  total_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(total_attempt_count >= 0),
  UNIQUE(word_id,source_content_id,generation_key),
  UNIQUE(reconciliation_id),
  UNIQUE(word_id,proactive_scope_key),
  CHECK((source_content_id IS NOT NULL) + (reconciliation_id IS NOT NULL) + (proactive_scope_key IS NOT NULL) = 1),
  CHECK ((status='running' AND active_token IS NOT NULL AND expires_at IS NOT NULL)
    OR (status!='running' AND active_token IS NULL AND expires_at IS NULL))
);
INSERT INTO vocabulary_practice_preparation_next
  (work_id,word_id,source_content_id,generation_key,status,attempt_count,active_token,expires_at,invocation_id,created_at,updated_at,last_error,next_attempt_at,total_attempt_count)
SELECT work_id,word_id,source_content_id,generation_key,status,attempt_count,active_token,expires_at,invocation_id,created_at,updated_at,last_error,next_attempt_at,total_attempt_count
FROM vocabulary_practice_preparation;
DROP TABLE vocabulary_practice_preparation;
ALTER TABLE vocabulary_practice_preparation_next RENAME TO vocabulary_practice_preparation;
CREATE INDEX idx_vocabulary_practice_queue ON vocabulary_practice_preparation(status,created_at,work_id);
CREATE INDEX idx_vocabulary_practice_word_status ON vocabulary_practice_preparation(word_id,status);

-- The scan is independently switchable while ordinary provider work continues.
CREATE TABLE service_controls_next (
  control_key TEXT PRIMARY KEY CHECK (
    control_key IN ('maintenance_mode', 'provider_work_enabled', 'operator_only', 'timed_sessions', 'proactive_repertoire')
  ),
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  updated_at TEXT NOT NULL,
  actor_id TEXT NOT NULL CHECK (length(trim(actor_id)) > 0)
);
INSERT INTO service_controls_next SELECT * FROM service_controls;
INSERT INTO service_controls_next VALUES ('proactive_repertoire', 1, '1970-01-01T00:00:00.000Z', 'system_default');
DROP TABLE service_controls;
ALTER TABLE service_controls_next RENAME TO service_controls;
