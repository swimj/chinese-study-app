-- Preserve historical application receipts while admitting explicit exercise retirement.
CREATE TABLE application_content_changes_next (
  application_id TEXT NOT NULL REFERENCES proposal_applications(application_id),
  operation_key TEXT NOT NULL,
  write_strategy TEXT NOT NULL CHECK(write_strategy IN ('create','update_existing','replace','retire')),
  source_content_id TEXT,
  source_version INTEGER,
  result_content_id TEXT NOT NULL,
  result_version INTEGER NOT NULL,
  source_history_change_id TEXT REFERENCES content_revision_history(change_id),
  PRIMARY KEY(application_id,operation_key),
  FOREIGN KEY(source_content_id,source_version) REFERENCES content_revision_history(content_id,version),
  FOREIGN KEY(result_content_id,result_version) REFERENCES content_revision_history(content_id,version)
);
INSERT INTO application_content_changes_next SELECT * FROM application_content_changes;
DROP TABLE application_content_changes;
ALTER TABLE application_content_changes_next RENAME TO application_content_changes;
CREATE TRIGGER vocabulary_application_content_changes_retained BEFORE DELETE ON application_content_changes BEGIN SELECT RAISE(ABORT,'reflection evidence is retained'); END;
CREATE TRIGGER vocabulary_application_content_changes_immutable BEFORE UPDATE ON application_content_changes BEGIN SELECT RAISE(ABORT,'reflection evidence is immutable'); END;
