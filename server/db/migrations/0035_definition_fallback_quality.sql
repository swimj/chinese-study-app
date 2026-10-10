-- Preserve exact snapshots and all learner encounter/rating references while
-- admitting definition fallback as another rateable production content source.
CREATE TABLE content_quality_items_new (
  content_key TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('production_cue','definition_fallback','pure_cue','contrast_prompt','teaching_package','rehearsal','supplement')),
  source_id TEXT NOT NULL,
  word_id TEXT,
  title TEXT NOT NULL,
  content_json TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
INSERT INTO content_quality_items_new
  SELECT content_key,kind,source_id,word_id,title,content_json,provenance_json,created_at
  FROM content_quality_items;
DROP TABLE content_quality_items;
ALTER TABLE content_quality_items_new RENAME TO content_quality_items;
CREATE TRIGGER content_quality_items_immutable BEFORE UPDATE ON content_quality_items
BEGIN SELECT RAISE(ABORT, 'quality content snapshots are immutable'); END;
