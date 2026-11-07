CREATE TABLE sense_content_reconciliations (
  resolution_id TEXT PRIMARY KEY,
  word_id TEXT NOT NULL REFERENCES lexical_words(id),
  version INTEGER NOT NULL CHECK(version > 0),
  status TEXT NOT NULL CHECK(status IN ('draft','resolved','applied')),
  draft_json TEXT NOT NULL CHECK(json_valid(draft_json)),
  snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
  applied_plan_json TEXT CHECK(applied_plan_json IS NULL OR json_valid(applied_plan_json)),
  practice_source_json TEXT CHECK(practice_source_json IS NULL OR json_valid(practice_source_json)),
  authority_json TEXT CHECK(authority_json IS NULL OR json_valid(authority_json)),
  actor_id TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, applied_at TEXT, completed_at TEXT,
  CHECK((status='applied')=(applied_at IS NOT NULL))
);
CREATE INDEX sense_content_reconciliations_word ON sense_content_reconciliations(word_id);
CREATE TABLE sense_content_reconciliation_history (
  resolution_id TEXT NOT NULL REFERENCES sense_content_reconciliations(resolution_id),
  version INTEGER NOT NULL,
  record_json TEXT NOT NULL CHECK(json_valid(record_json)),
  actor_id TEXT NOT NULL, recorded_at TEXT NOT NULL,
  PRIMARY KEY(resolution_id,version)
);
CREATE TRIGGER sense_content_reconciliation_history_immutable BEFORE UPDATE ON sense_content_reconciliation_history
BEGIN SELECT RAISE(ABORT,'reconciliation history is immutable'); END;
CREATE TRIGGER sense_content_reconciliation_history_retained BEFORE DELETE ON sense_content_reconciliation_history
BEGIN SELECT RAISE(ABORT,'reconciliation history is retained'); END;

-- Preserve existing teaching-source jobs while admitting canonical reconciliation sources.
CREATE TABLE vocabulary_practice_preparation_next (
  work_id TEXT PRIMARY KEY,
  word_id TEXT NOT NULL REFERENCES lexical_words(id),
  source_content_id TEXT REFERENCES word_content_documents(content_id),
  reconciliation_id TEXT REFERENCES sense_content_reconciliations(resolution_id),
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
  CHECK((source_content_id IS NULL) != (reconciliation_id IS NULL)),
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
