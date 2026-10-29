-- Complete authored objects; legacy source tables remain retained evidence.
CREATE TABLE vocabulary_word_catalogs (
  word_id TEXT PRIMARY KEY REFERENCES lexical_words(id) ON DELETE RESTRICT,
  sense_catalog_version INTEGER NOT NULL DEFAULT 0 CHECK (sense_catalog_version >= 0),
  senses_established_at TEXT
);
CREATE TABLE senses (
  sense_id TEXT PRIMARY KEY,
  word_id TEXT NOT NULL REFERENCES lexical_words(id) ON DELETE RESTRICT,
  description_json TEXT NOT NULL CHECK (json_valid(description_json)),
  status TEXT NOT NULL CHECK (status IN ('active','retired')),
  version INTEGER NOT NULL CHECK (version > 0),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE (sense_id, word_id),
  FOREIGN KEY (sense_id, version) REFERENCES sense_revision_history(sense_id, version) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE sense_revision_history (
  change_id TEXT PRIMARY KEY,
  sense_id TEXT NOT NULL REFERENCES senses(sense_id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK (version > 0),
  previous_version INTEGER,
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  change_kind TEXT NOT NULL CHECK (change_kind IN ('created','updated','retired')),
  actor_kind TEXT NOT NULL, actor_id TEXT NOT NULL, reason_json TEXT CHECK (reason_json IS NULL OR json_valid(reason_json)),
  recorded_at TEXT NOT NULL,
  UNIQUE (sense_id, version),
  CHECK ((version = 1 AND previous_version IS NULL) OR (previous_version IS NOT NULL AND previous_version = version - 1)),
  FOREIGN KEY (sense_id, previous_version) REFERENCES sense_revision_history(sense_id, version)
);
CREATE INDEX idx_vocabulary_senses_word ON senses(word_id, status);
CREATE TABLE content_items (
  content_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('exercise','introduction')),
  payload_version INTEGER NOT NULL CHECK (payload_version > 0),
  body_json TEXT NOT NULL CHECK (json_valid(body_json)),
  exercise_type TEXT, skill TEXT,
  exercise_role TEXT CHECK (exercise_role IN ('teaching','general')),
  assessment_json TEXT CHECK (assessment_json IS NULL OR json_valid(assessment_json)),
  access_scope TEXT NOT NULL CHECK (access_scope IN ('shared','private')),
  owner_learner_id TEXT REFERENCES learners(learner_id) ON DELETE RESTRICT,
  availability TEXT NOT NULL CHECK (availability IN ('active','quarantined','retired')),
  origin_kind TEXT NOT NULL CHECK (origin_kind IN ('model','human','import')),
  author_kind TEXT, author_id TEXT,
  version INTEGER NOT NULL CHECK (version > 0),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  CHECK ((access_scope = 'shared' AND owner_learner_id IS NULL) OR (access_scope = 'private' AND owner_learner_id IS NOT NULL)),
  CHECK ((kind = 'exercise' AND exercise_type IS NOT NULL AND length(trim(exercise_type)) > 0
    AND skill IS NOT NULL AND length(trim(skill)) > 0 AND exercise_role IS NOT NULL AND assessment_json IS NOT NULL)
    OR (kind = 'introduction' AND exercise_type IS NULL AND skill IS NULL AND exercise_role IS NULL AND assessment_json IS NULL)),
  FOREIGN KEY (content_id, version) REFERENCES content_revision_history(content_id, version) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE content_revision_history (
  change_id TEXT PRIMARY KEY,
  content_id TEXT NOT NULL REFERENCES content_items(content_id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK (version > 0), previous_version INTEGER,
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  change_kind TEXT NOT NULL CHECK (change_kind IN ('created','updated','retired')),
  write_strategy TEXT NOT NULL CHECK (write_strategy IN ('create','update_existing','replace')),
  actor_kind TEXT NOT NULL, actor_id TEXT NOT NULL, reason_json TEXT CHECK (reason_json IS NULL OR json_valid(reason_json)),
  recorded_at TEXT NOT NULL,
  UNIQUE (content_id, version),
  CHECK ((version = 1 AND previous_version IS NULL) OR (previous_version IS NOT NULL AND previous_version = version - 1)),
  FOREIGN KEY (content_id, previous_version) REFERENCES content_revision_history(content_id, version)
);
CREATE INDEX idx_vocabulary_content_revision_change ON content_revision_history(change_kind, recorded_at);
CREATE INDEX idx_vocabulary_content_revision_strategy ON content_revision_history(write_strategy, recorded_at);
CREATE TABLE content_words (
  content_id TEXT NOT NULL REFERENCES content_items(content_id) ON DELETE RESTRICT,
  word_id TEXT NOT NULL REFERENCES lexical_words(id) ON DELETE RESTRICT,
  relation TEXT NOT NULL CHECK (relation IN ('target','context')),
  sense_id TEXT, sense_mapping_established_at TEXT,
  PRIMARY KEY (content_id, word_id),
  FOREIGN KEY (sense_id, word_id) REFERENCES senses(sense_id, word_id) ON DELETE RESTRICT,
  CHECK (sense_id IS NULL OR sense_mapping_established_at IS NOT NULL)
);
CREATE INDEX idx_vocabulary_content_words_word ON content_words(word_id, relation, content_id);
CREATE INDEX idx_vocabulary_content_words_sense ON content_words(sense_id, content_id) WHERE sense_id IS NOT NULL;
CREATE INDEX idx_vocabulary_content_words_mapping ON content_words(word_id, sense_mapping_established_at, content_id);
CREATE TABLE exercise_answer_words (
  exercise_id TEXT NOT NULL REFERENCES content_items(content_id) ON DELETE RESTRICT,
  word_id TEXT NOT NULL REFERENCES lexical_words(id) ON DELETE RESTRICT,
  accepted_forms_json TEXT NOT NULL CHECK (json_valid(accepted_forms_json) AND json_type(accepted_forms_json) = 'array' AND json_array_length(accepted_forms_json) > 0),
  PRIMARY KEY (exercise_id, word_id),
  FOREIGN KEY (exercise_id, word_id) REFERENCES content_words(content_id, word_id) ON DELETE RESTRICT
);
CREATE INDEX idx_vocabulary_answers_word ON exercise_answer_words(word_id, exercise_id);
CREATE TABLE content_mode_suitability (
  content_id TEXT NOT NULL REFERENCES content_items(content_id) ON DELETE RESTRICT,
  mode TEXT NOT NULL CHECK (mode IN ('solidify','practice','maintain')),
  suitability TEXT NOT NULL CHECK (suitability IN ('candidate','curated')),
  assessed_content_version INTEGER NOT NULL,
  PRIMARY KEY (content_id, mode),
  FOREIGN KEY (content_id, assessed_content_version) REFERENCES content_revision_history(content_id, version)
);
CREATE INDEX idx_vocabulary_suitability ON content_mode_suitability(mode, suitability, content_id);
CREATE TABLE introduction_exercises (
  introduction_id TEXT NOT NULL REFERENCES content_items(content_id) ON DELETE RESTRICT,
  position INTEGER NOT NULL CHECK (position >= 0),
  exercise_id TEXT NOT NULL REFERENCES content_items(content_id) ON DELETE RESTRICT,
  exercise_version INTEGER NOT NULL,
  PRIMARY KEY (introduction_id, position),
  FOREIGN KEY (exercise_id, exercise_version) REFERENCES content_revision_history(content_id, version)
);
CREATE TABLE legacy_content_imports (
  source_kind TEXT NOT NULL, source_id TEXT NOT NULL, source_sub_id TEXT NOT NULL DEFAULT '',
  content_id TEXT NOT NULL REFERENCES content_items(content_id) ON DELETE RESTRICT,
  imported_content_version INTEGER NOT NULL,
  PRIMARY KEY (source_kind, source_id, source_sub_id),
  FOREIGN KEY (content_id, imported_content_version) REFERENCES content_revision_history(content_id, version)
);
CREATE TABLE backend_events (
  event_id TEXT PRIMARY KEY, occurred_at TEXT NOT NULL, recorded_at TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0), payload_version INTEGER NOT NULL CHECK (payload_version > 0),
  data_json TEXT NOT NULL CHECK (json_valid(data_json)),
  actor_kind TEXT, actor_id TEXT, learner_id TEXT, session_id TEXT, job_id TEXT,
  causal_event_id TEXT, entity_kind TEXT, entity_id TEXT
);
CREATE INDEX idx_backend_events_time ON backend_events(recorded_at, event_id);
CREATE INDEX idx_backend_events_name ON backend_events(name, occurred_at);
CREATE INDEX idx_backend_events_entity ON backend_events(entity_kind, entity_id, occurred_at);
CREATE INDEX idx_backend_events_session ON backend_events(session_id, recorded_at) WHERE session_id IS NOT NULL;
CREATE INDEX idx_backend_events_job ON backend_events(job_id, recorded_at) WHERE job_id IS NOT NULL;
CREATE TRIGGER content_revision_history_immutable BEFORE UPDATE ON content_revision_history BEGIN SELECT RAISE(ABORT,'content history is immutable'); END;
CREATE TRIGGER content_revision_history_retained BEFORE DELETE ON content_revision_history BEGIN SELECT RAISE(ABORT,'content history is retained'); END;
CREATE TRIGGER sense_revision_history_immutable BEFORE UPDATE ON sense_revision_history BEGIN SELECT RAISE(ABORT,'sense history is immutable'); END;
CREATE TRIGGER sense_revision_history_retained BEFORE DELETE ON sense_revision_history BEGIN SELECT RAISE(ABORT,'sense history is retained'); END;
CREATE TRIGGER backend_events_immutable BEFORE UPDATE ON backend_events BEGIN SELECT RAISE(ABORT,'backend events are immutable'); END;
CREATE TRIGGER backend_events_retained BEFORE DELETE ON backend_events BEGIN SELECT RAISE(ABORT,'backend events are retained'); END;
CREATE TRIGGER vocabulary_content_identity BEFORE UPDATE OF content_id,kind,exercise_role,access_scope,owner_learner_id,origin_kind,author_kind,author_id,created_at ON content_items
WHEN NEW.content_id IS NOT OLD.content_id OR NEW.kind IS NOT OLD.kind OR NEW.exercise_role IS NOT OLD.exercise_role
  OR NEW.access_scope IS NOT OLD.access_scope OR NEW.owner_learner_id IS NOT OLD.owner_learner_id OR NEW.origin_kind IS NOT OLD.origin_kind
  OR NEW.author_kind IS NOT OLD.author_kind OR NEW.author_id IS NOT OLD.author_id OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT,'content identity and serving role are immutable; replace the item'); END;
CREATE TRIGGER vocabulary_sense_identity BEFORE UPDATE OF sense_id,word_id,created_at ON senses
WHEN NEW.sense_id IS NOT OLD.sense_id OR NEW.word_id IS NOT OLD.word_id OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT,'sense identity is immutable'); END;
CREATE TRIGGER vocabulary_answer_exercise_insert BEFORE INSERT ON exercise_answer_words
WHEN NOT EXISTS (SELECT 1 FROM content_items WHERE content_id = NEW.exercise_id AND kind = 'exercise')
BEGIN SELECT RAISE(ABORT,'answer words require an exercise'); END;
CREATE TRIGGER vocabulary_answer_exercise_update BEFORE UPDATE ON exercise_answer_words
WHEN NOT EXISTS (SELECT 1 FROM content_items WHERE content_id = NEW.exercise_id AND kind = 'exercise')
BEGIN SELECT RAISE(ABORT,'answer words require an exercise'); END;
CREATE TRIGGER vocabulary_teaching_binding_insert BEFORE INSERT ON introduction_exercises
WHEN NOT EXISTS (
 SELECT 1 FROM content_items i JOIN content_items e ON e.content_id = NEW.exercise_id
 JOIN content_revision_history h ON h.content_id = e.content_id AND h.version = NEW.exercise_version
 WHERE i.content_id = NEW.introduction_id AND i.kind = 'introduction' AND e.kind = 'exercise' AND e.exercise_role = 'teaching'
 AND json_extract(h.snapshot_json,'$.exerciseRole') = 'teaching'
 AND (e.access_scope = 'shared' OR (i.access_scope = 'private' AND e.owner_learner_id = i.owner_learner_id))
)
BEGIN SELECT RAISE(ABORT,'introduction requires accessible teaching exercise versions'); END;
CREATE TRIGGER vocabulary_teaching_binding_update BEFORE UPDATE ON introduction_exercises
BEGIN SELECT RAISE(ABORT,'replace teaching bindings in the authored-content transaction'); END;
CREATE TRIGGER vocabulary_suitability_insert BEFORE INSERT ON content_mode_suitability
WHEN NOT EXISTS (SELECT 1 FROM content_items WHERE content_id = NEW.content_id AND kind = 'exercise' AND exercise_role = 'general')
BEGIN SELECT RAISE(ABORT,'suitability requires a general exercise'); END;
CREATE TRIGGER vocabulary_suitability_update BEFORE UPDATE ON content_mode_suitability
WHEN NOT EXISTS (SELECT 1 FROM content_items WHERE content_id = NEW.content_id AND kind = 'exercise' AND exercise_role = 'general')
BEGIN SELECT RAISE(ABORT,'suitability requires a general exercise'); END;
