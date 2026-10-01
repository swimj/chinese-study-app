-- New review authoring keeps canonical structured sources alongside the exact
-- existing cue/supplement/pure identities used by study evidence and repair.
CREATE TABLE scoped_review_content_records (
  record_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('production_cue', 'production_cue_supplement', 'pure_cue')),
  content_id TEXT NOT NULL,
  exercise_id TEXT UNIQUE,
  revision INTEGER NOT NULL CHECK (revision > 0),
  word_id TEXT REFERENCES lexical_words(id) ON DELETE RESTRICT,
  source_word_content_id TEXT,
  document_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  model TEXT CHECK (model IS NULL OR length(trim(model)) > 0),
  UNIQUE(kind, content_id, revision),
  FOREIGN KEY (word_id, source_word_content_id)
    REFERENCES word_content_documents(word_id, content_id) ON DELETE RESTRICT,
  CHECK ((kind = 'pure_cue' AND word_id IS NULL AND source_word_content_id IS NULL)
    OR (kind != 'pure_cue' AND word_id IS NOT NULL)),
  CHECK ((kind = 'production_cue_supplement' AND exercise_id IS NULL)
    OR (kind != 'production_cue_supplement' AND exercise_id IS NOT NULL))
);
CREATE INDEX idx_review_content_records_latest
  ON scoped_review_content_records(kind, content_id, revision DESC);
CREATE VIEW review_content_records AS
SELECT record_id, kind, content_id, exercise_id, revision, word_id, source_word_content_id,
       document_json, created_at, model
FROM scoped_review_content_records AS record
WHERE record.kind = 'pure_cue'
  OR (record.kind = 'production_cue' AND EXISTS (
    SELECT 1 FROM scoped_production_cues AS cue WHERE cue.cue_id = record.content_id
      AND (cue.content_scope = 'shared' OR cue.owner_learner_id = current_learner_id())
  ))
  OR (record.kind = 'production_cue_supplement' AND EXISTS (
    SELECT 1 FROM scoped_production_cue_supplements AS supplement
    WHERE supplement.supplement_id = record.content_id
      AND (supplement.content_scope = 'shared' OR supplement.owner_learner_id = current_learner_id())
  ));
CREATE TRIGGER review_content_records_immutable BEFORE UPDATE ON scoped_review_content_records
BEGIN SELECT RAISE(ABORT, 'review content records are immutable'); END;
CREATE TRIGGER review_content_records_no_delete BEFORE DELETE ON scoped_review_content_records
BEGIN SELECT RAISE(ABORT, 'review content records cannot be deleted'); END;

-- A durable one-time preparation claim prevents concurrent provider workers
-- from creating duplicate first-review exercises for one bootstrapped word.
CREATE TABLE word_review_preparation (
  word_id TEXT PRIMARY KEY REFERENCES lexical_words(id) ON DELETE RESTRICT,
  source_content_id TEXT NOT NULL,
  ready_at TEXT,
  lease_token TEXT,
  lease_expires_at TEXT,
  FOREIGN KEY (word_id, source_content_id)
    REFERENCES word_content_documents(word_id, content_id) ON DELETE RESTRICT,
  CHECK ((lease_token IS NULL AND lease_expires_at IS NULL)
    OR (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL))
);
