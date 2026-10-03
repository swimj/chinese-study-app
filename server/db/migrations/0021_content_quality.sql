-- Exact content snapshots contain authored content only, never learner responses.
CREATE TABLE content_quality_items (
  content_key TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('production_cue','pure_cue','contrast_prompt','teaching_package','rehearsal','supplement')),
  source_id TEXT NOT NULL,
  word_id TEXT,
  title TEXT NOT NULL,
  content_json TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TRIGGER content_quality_items_immutable BEFORE UPDATE ON content_quality_items
BEGIN SELECT RAISE(ABORT, 'quality content snapshots are immutable'); END;
CREATE TABLE learner_content_quality_encounters (
  learner_id TEXT NOT NULL REFERENCES learners(learner_id) ON DELETE CASCADE,
  encounter_id TEXT NOT NULL,
  content_key TEXT NOT NULL REFERENCES content_quality_items(content_key),
  seen_at TEXT NOT NULL,
  PRIMARY KEY (learner_id, encounter_id, content_key)
);
CREATE INDEX idx_quality_encounters_content ON learner_content_quality_encounters(content_key, seen_at, learner_id);
CREATE TABLE learner_content_quality_ratings (
  learner_id TEXT NOT NULL REFERENCES learners(learner_id) ON DELETE CASCADE,
  content_key TEXT NOT NULL REFERENCES content_quality_items(content_key),
  rating TEXT NOT NULL CHECK (rating IN ('up','down')),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (learner_id, content_key)
);
CREATE TRIGGER quality_rating_requires_encounter BEFORE INSERT ON learner_content_quality_ratings
WHEN NOT EXISTS (SELECT 1 FROM learner_content_quality_encounters e WHERE e.learner_id = NEW.learner_id AND e.content_key = NEW.content_key)
BEGIN SELECT RAISE(ABORT, 'quality rating requires own encounter'); END;
CREATE TRIGGER quality_rating_identity_immutable BEFORE UPDATE OF learner_id, content_key ON learner_content_quality_ratings
BEGIN SELECT RAISE(ABORT, 'quality rating identity is immutable'); END;
CREATE TRIGGER quality_encounter_immutable BEFORE UPDATE ON learner_content_quality_encounters
BEGIN SELECT RAISE(ABORT, 'quality encounters are immutable'); END;
