CREATE TABLE sense_content_reconciliations (
  resolution_id TEXT PRIMARY KEY,
  word_id TEXT NOT NULL REFERENCES lexical_words(id),
  version INTEGER NOT NULL CHECK(version > 0),
  status TEXT NOT NULL CHECK(status IN ('draft','resolved','applied')),
  draft_json TEXT NOT NULL CHECK(json_valid(draft_json)),
  snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
  applied_plan_json TEXT CHECK(applied_plan_json IS NULL OR json_valid(applied_plan_json)),
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
