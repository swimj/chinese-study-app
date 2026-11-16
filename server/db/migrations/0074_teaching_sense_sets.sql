-- The default lane deliberately preserves historical default-lesson compatibility.
-- Its immutable documents retain their authored senses; it is not today's default set.
ALTER TABLE word_content_documents ADD COLUMN teaching_set_key TEXT NOT NULL DEFAULT 'default'
    CHECK (teaching_set_key = 'default' OR CASE WHEN json_valid(teaching_set_key) THEN json_type(teaching_set_key) = 'array' AND json_array_length(teaching_set_key) > 0 ELSE 0 END);

CREATE UNIQUE INDEX idx_word_content_teaching_set ON word_content_documents(word_id, content_id, teaching_set_key);

CREATE TABLE word_introduction_preparation_sets (
  word_id TEXT NOT NULL REFERENCES lexical_words(id) ON DELETE RESTRICT,
  teaching_set_key TEXT NOT NULL DEFAULT 'default'
    CHECK (teaching_set_key = 'default' OR CASE WHEN json_valid(teaching_set_key) THEN json_type(teaching_set_key) = 'array' AND json_array_length(teaching_set_key) > 0 ELSE 0 END),
  content_id TEXT,
  package_id TEXT,
  active_stage TEXT CHECK (active_stage IN ('bootstrap', 'teaching')),
  lease_token TEXT,
  lease_expires_at TEXT,
  preparation_epoch INTEGER NOT NULL DEFAULT 0 CHECK (preparation_epoch >= 0),
  PRIMARY KEY (word_id, teaching_set_key),
  FOREIGN KEY (word_id, content_id, teaching_set_key) REFERENCES word_content_documents(word_id, content_id, teaching_set_key) ON DELETE RESTRICT,
  FOREIGN KEY (word_id, package_id) REFERENCES word_teaching_packages(word_id, package_id) ON DELETE RESTRICT,
  CHECK ((active_stage IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL)
    OR (active_stage IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CHECK (package_id IS NULL OR content_id IS NOT NULL)
);
INSERT INTO word_introduction_preparation_sets
  (word_id,content_id,package_id,active_stage,lease_token,lease_expires_at,preparation_epoch)
SELECT word_id,content_id,package_id,active_stage,lease_token,lease_expires_at,preparation_epoch FROM word_introduction_preparation;
DROP TABLE word_introduction_preparation;
ALTER TABLE word_introduction_preparation_sets RENAME TO word_introduction_preparation;

CREATE TABLE word_preparation_work_sets (
  work_id TEXT PRIMARY KEY,
  word_id TEXT NOT NULL REFERENCES lexical_words(id) ON DELETE RESTRICT,
  teaching_set_key TEXT NOT NULL DEFAULT 'default'
    CHECK (teaching_set_key = 'default' OR CASE WHEN json_valid(teaching_set_key) THEN json_type(teaching_set_key) = 'array' AND json_array_length(teaching_set_key) > 0 ELSE 0 END),
  stage TEXT NOT NULL CHECK (stage IN ('bootstrap', 'teaching', 'review')),
  source_content_id TEXT REFERENCES word_content_documents(content_id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'ready', 'paused')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 3),
  next_attempt_at TEXT NOT NULL,
  active_token TEXT,
  expires_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  requested_by_learner_id TEXT REFERENCES learners(learner_id),
  UNIQUE (word_id, teaching_set_key, stage),
  FOREIGN KEY (word_id, source_content_id, teaching_set_key) REFERENCES word_content_documents(word_id, content_id, teaching_set_key) ON DELETE RESTRICT,
  CHECK ((status = 'running' AND active_token IS NOT NULL AND expires_at IS NOT NULL)
    OR (status != 'running' AND active_token IS NULL AND expires_at IS NULL)),
  CHECK (stage != 'bootstrap' OR source_content_id IS NULL),
  CHECK (stage != 'review' OR teaching_set_key = 'default')
);
INSERT INTO word_preparation_work_sets
  (work_id,word_id,stage,source_content_id,status,attempt_count,next_attempt_at,active_token,expires_at,last_error,created_at,updated_at,requested_by_learner_id)
SELECT work_id,word_id,stage,source_content_id,status,attempt_count,next_attempt_at,active_token,expires_at,last_error,created_at,updated_at,requested_by_learner_id FROM word_preparation_work;
DROP TABLE word_preparation_work;
ALTER TABLE word_preparation_work_sets RENAME TO word_preparation_work;
CREATE INDEX idx_word_preparation_due ON word_preparation_work(status, next_attempt_at);
