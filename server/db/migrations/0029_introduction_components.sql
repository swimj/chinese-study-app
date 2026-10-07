-- Successful independently generated parts survive companion failure and lease recovery.
CREATE TABLE word_introduction_components (
  content_id TEXT NOT NULL REFERENCES word_content_documents(content_id) ON DELETE RESTRICT,
  stage TEXT NOT NULL CHECK (stage IN ('teaching', 'practice')),
  generation_key TEXT NOT NULL CHECK (length(trim(generation_key)) > 0),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  model TEXT NOT NULL CHECK (length(trim(model)) > 0),
  invocation_id TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (content_id, stage, generation_key)
);
CREATE TRIGGER word_introduction_components_immutable
BEFORE UPDATE ON word_introduction_components
BEGIN SELECT RAISE(ABORT, 'Introduction components are immutable'); END;
CREATE TABLE word_teaching_package_components (
  package_id TEXT NOT NULL REFERENCES word_teaching_packages(package_id) ON DELETE RESTRICT,
  content_id TEXT NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('teaching', 'practice')),
  generation_key TEXT NOT NULL,
  PRIMARY KEY (package_id, stage),
  FOREIGN KEY (content_id, stage, generation_key)
    REFERENCES word_introduction_components(content_id, stage, generation_key) ON DELETE RESTRICT
);
CREATE TRIGGER word_teaching_package_components_immutable
BEFORE UPDATE ON word_teaching_package_components
BEGIN SELECT RAISE(ABORT, 'Introduction component provenance is immutable'); END;
