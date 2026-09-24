-- Word introductions are shared immutable content. Only an individual learner's
-- open/completion markers are private; publication disposition controls serving.
-- Rebuild the publication table to extend its content-kind CHECK, preserving
-- every existing publication and stable publication id (as in migration 0009).
DROP TRIGGER shared_content_publications_identity_immutable;
DROP TRIGGER shared_content_publications_no_delete;
DROP TRIGGER shared_content_publications_status_transition_guard;
DROP INDEX idx_shared_content_publications_eligibility;

CREATE TEMP TABLE word_introduction_migration_publications AS
  SELECT * FROM shared_content_publications;
DROP TABLE shared_content_publications;
CREATE TABLE shared_content_publications (
  publication_id TEXT PRIMARY KEY,
  content_kind TEXT NOT NULL CHECK (
    content_kind IN (
      'production_cue', 'contrast_cluster', 'production_cue_supplement',
      'pure_cue', 'word_content', 'teaching_package'
    )
  ),
  content_id TEXT NOT NULL,
  learning_purpose_key TEXT NOT NULL CHECK (length(trim(learning_purpose_key)) > 0),
  publication_status TEXT NOT NULL CHECK (
    publication_status IN ('shared_trial', 'available', 'quarantined', 'retired')
  ),
  published_at TEXT NOT NULL,
  status_updated_at TEXT NOT NULL,
  UNIQUE (content_kind, content_id)
);
INSERT INTO shared_content_publications (
  publication_id, content_kind, content_id, learning_purpose_key,
  publication_status, published_at, status_updated_at
)
SELECT publication_id, content_kind, content_id, learning_purpose_key,
       publication_status, published_at, status_updated_at
FROM word_introduction_migration_publications;
DROP TABLE word_introduction_migration_publications;

CREATE TRIGGER shared_content_publications_identity_immutable
BEFORE UPDATE OF publication_id, content_kind, content_id, learning_purpose_key, published_at
ON shared_content_publications
BEGIN
  SELECT RAISE(ABORT, 'shared content publication identity is immutable');
END;
CREATE TRIGGER shared_content_publications_no_delete
BEFORE DELETE ON shared_content_publications
BEGIN
  SELECT RAISE(ABORT, 'shared content publications cannot be deleted');
END;
CREATE TRIGGER shared_content_publications_status_transition_guard
BEFORE UPDATE OF publication_status, status_updated_at
ON shared_content_publications
WHEN NOT EXISTS (
  SELECT 1 FROM shared_content_publication_events AS event
  WHERE event.publication_id = OLD.publication_id
    AND event.from_status = OLD.publication_status
    AND event.to_status = NEW.publication_status
    AND event.occurred_at = NEW.status_updated_at
)
BEGIN
  SELECT RAISE(ABORT, 'shared content status changes require an attributable publication event');
END;
CREATE INDEX idx_shared_content_publications_eligibility
  ON shared_content_publications(
    content_kind, learning_purpose_key, publication_status, publication_id
  );

CREATE TABLE word_content_documents (
  content_id TEXT PRIMARY KEY,
  word_id TEXT NOT NULL REFERENCES lexical_words(id) ON DELETE RESTRICT,
  content_json TEXT NOT NULL,
  model TEXT NOT NULL CHECK (length(trim(model)) > 0),
  created_at TEXT NOT NULL,
  publication_id TEXT NOT NULL UNIQUE
    REFERENCES shared_content_publications(publication_id) ON DELETE RESTRICT,
  UNIQUE (word_id, content_id)
);
CREATE TABLE word_teaching_packages (
  package_id TEXT PRIMARY KEY,
  word_id TEXT NOT NULL,
  content_id TEXT NOT NULL,
  package_json TEXT NOT NULL,
  model TEXT NOT NULL CHECK (length(trim(model)) > 0),
  created_at TEXT NOT NULL,
  publication_id TEXT NOT NULL UNIQUE
    REFERENCES shared_content_publications(publication_id) ON DELETE RESTRICT,
  UNIQUE (word_id, package_id),
  FOREIGN KEY (word_id, content_id)
    REFERENCES word_content_documents(word_id, content_id) ON DELETE RESTRICT
);
CREATE INDEX idx_word_content_documents_word ON word_content_documents(word_id, created_at, content_id);
CREATE INDEX idx_word_teaching_packages_word ON word_teaching_packages(word_id, created_at, package_id);

-- One shared preparation slot per lexical word. A short lease makes a crash
-- recoverable without turning generation into an unbounded job subsystem.
CREATE TABLE word_introduction_preparation (
  word_id TEXT PRIMARY KEY REFERENCES lexical_words(id) ON DELETE RESTRICT,
  content_id TEXT,
  package_id TEXT,
  active_stage TEXT CHECK (active_stage IN ('bootstrap', 'teaching')),
  lease_token TEXT,
  lease_expires_at TEXT,
  FOREIGN KEY (word_id, content_id)
    REFERENCES word_content_documents(word_id, content_id) ON DELETE RESTRICT,
  FOREIGN KEY (word_id, package_id)
    REFERENCES word_teaching_packages(word_id, package_id) ON DELETE RESTRICT,
  CHECK ((active_stage IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL)
    OR (active_stage IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CHECK (package_id IS NULL OR content_id IS NOT NULL)
);

CREATE TABLE learner_word_introduction_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  learner_id TEXT NOT NULL DEFAULT (current_learner_id())
    REFERENCES learners(learner_id) ON DELETE RESTRICT,
  word_id TEXT NOT NULL,
  package_id TEXT NOT NULL,
  event_kind TEXT NOT NULL CHECK (event_kind IN ('opened', 'completed')),
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (word_id, package_id)
    REFERENCES word_teaching_packages(word_id, package_id) ON DELETE RESTRICT
);
CREATE INDEX idx_learner_word_introduction_events_latest
  ON learner_word_introduction_events(learner_id, word_id, sequence DESC);
CREATE INDEX idx_learner_word_introduction_events_completion
  ON learner_word_introduction_events(learner_id, package_id, event_kind);

CREATE TRIGGER word_content_documents_immutable BEFORE UPDATE ON word_content_documents
BEGIN SELECT RAISE(ABORT, 'word content documents are immutable'); END;
CREATE TRIGGER word_content_documents_no_delete BEFORE DELETE ON word_content_documents
BEGIN SELECT RAISE(ABORT, 'word content documents cannot be deleted'); END;
CREATE TRIGGER word_teaching_packages_immutable BEFORE UPDATE ON word_teaching_packages
BEGIN SELECT RAISE(ABORT, 'word teaching packages are immutable'); END;
CREATE TRIGGER word_teaching_packages_no_delete BEFORE DELETE ON word_teaching_packages
BEGIN SELECT RAISE(ABORT, 'word teaching packages cannot be deleted'); END;
CREATE TRIGGER learner_word_introduction_events_immutable BEFORE UPDATE ON learner_word_introduction_events
BEGIN SELECT RAISE(ABORT, 'word introduction events are immutable'); END;
CREATE TRIGGER learner_word_introduction_events_no_delete BEFORE DELETE ON learner_word_introduction_events
BEGIN SELECT RAISE(ABORT, 'word introduction events cannot be deleted'); END;
CREATE TRIGGER learner_word_introduction_events_same_learner BEFORE INSERT ON learner_word_introduction_events
WHEN NEW.learner_id != current_learner_id()
BEGIN SELECT RAISE(ABORT, 'word introduction event learner mismatch'); END;
CREATE TRIGGER word_content_documents_publication BEFORE INSERT ON word_content_documents
WHEN NOT EXISTS (
  SELECT 1 FROM shared_content_publications
  WHERE publication_id = NEW.publication_id AND content_kind = 'word_content'
    AND content_id = NEW.content_id AND learning_purpose_key = NEW.word_id
)
BEGIN SELECT RAISE(ABORT, 'word content publication mismatch'); END;
CREATE TRIGGER word_teaching_packages_publication BEFORE INSERT ON word_teaching_packages
WHEN NOT EXISTS (
  SELECT 1 FROM shared_content_publications
  WHERE publication_id = NEW.publication_id AND content_kind = 'teaching_package'
    AND content_id = NEW.package_id AND learning_purpose_key = NEW.word_id
)
BEGIN SELECT RAISE(ABORT, 'teaching package publication mismatch'); END;
