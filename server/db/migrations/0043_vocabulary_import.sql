-- Retain the exact bootstrap-local identity used to seed each stable sense.
CREATE TABLE legacy_sense_imports (
  source_content_id TEXT NOT NULL REFERENCES word_content_documents(content_id) ON DELETE RESTRICT,
  source_use_id TEXT NOT NULL,
  sense_id TEXT NOT NULL REFERENCES senses(sense_id) ON DELETE RESTRICT,
  imported_sense_version INTEGER NOT NULL,
  PRIMARY KEY (source_content_id,source_use_id),
  FOREIGN KEY (sense_id,imported_sense_version) REFERENCES sense_revision_history(sense_id,version)
);
CREATE TRIGGER legacy_sense_imports_immutable BEFORE UPDATE ON legacy_sense_imports
BEGIN SELECT RAISE(ABORT,'legacy sense mapping is immutable'); END;
CREATE TRIGGER legacy_sense_imports_retained BEFORE DELETE ON legacy_sense_imports
BEGIN SELECT RAISE(ABORT,'legacy sense mapping is retained'); END;
