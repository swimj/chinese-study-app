-- Operational shared work; learner demand and lesson opening remain separate.
CREATE TABLE word_preparation_work (
  work_id TEXT PRIMARY KEY,
  word_id TEXT NOT NULL REFERENCES lexical_words(id) ON DELETE RESTRICT,
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
  UNIQUE (word_id, stage),
  CHECK ((status = 'running' AND active_token IS NOT NULL AND expires_at IS NOT NULL)
    OR (status != 'running' AND active_token IS NULL AND expires_at IS NULL)),
  CHECK (stage != 'bootstrap' OR source_content_id IS NULL)
);
CREATE INDEX idx_word_preparation_due ON word_preparation_work(status, next_attempt_at);
CREATE TABLE word_preparation_attempts (
  attempt_id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL REFERENCES word_preparation_work(work_id) ON DELETE RESTRICT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  outcome TEXT CHECK (outcome IN ('ready', 'failed', 'interrupted')),
  diagnostic TEXT,
  CHECK ((finished_at IS NULL AND outcome IS NULL) OR (finished_at IS NOT NULL AND outcome IS NOT NULL))
);
CREATE TABLE word_preparation_retry_events (
  event_id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL REFERENCES word_preparation_work(work_id) ON DELETE RESTRICT,
  actor_id TEXT NOT NULL CHECK (length(trim(actor_id)) > 0),
  occurred_at TEXT NOT NULL
);
