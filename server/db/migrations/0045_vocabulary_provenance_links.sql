CREATE TABLE invocation_content_links (
  invocation_id TEXT NOT NULL REFERENCES model_invocations(id) ON DELETE RESTRICT,
  content_id TEXT NOT NULL REFERENCES content_items(content_id) ON DELETE RESTRICT,
  content_version INTEGER NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('input','output','revised_from','evaluated')),
  PRIMARY KEY(invocation_id,content_id,content_version,role),
  FOREIGN KEY(content_id,content_version) REFERENCES content_revision_history(content_id,version)
);
CREATE INDEX idx_invocation_content_origin ON invocation_content_links(content_id,content_version,role,invocation_id);
CREATE TABLE invocation_sense_links (
  invocation_id TEXT NOT NULL REFERENCES model_invocations(id) ON DELETE RESTRICT,
  sense_id TEXT NOT NULL REFERENCES senses(sense_id) ON DELETE RESTRICT,
  sense_version INTEGER NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('input','output','evaluated')),
  PRIMARY KEY(invocation_id,sense_id,sense_version,role),
  FOREIGN KEY(sense_id,sense_version) REFERENCES sense_revision_history(sense_id,version)
);
CREATE INDEX idx_invocation_sense_origin ON invocation_sense_links(sense_id,sense_version,role,invocation_id);
CREATE TRIGGER invocation_content_links_access BEFORE INSERT ON invocation_content_links
WHEN EXISTS (
 SELECT 1 FROM content_items c JOIN model_invocations i ON i.id=NEW.invocation_id WHERE c.content_id=NEW.content_id
 AND (c.access_scope='private' AND (i.actor_kind!='learner' OR c.owner_learner_id!=i.learner_id))
) OR (NEW.role='output' AND NOT EXISTS (SELECT 1 FROM model_invocations WHERE id=NEW.invocation_id AND status='completed'))
BEGIN SELECT RAISE(ABORT,'invocation content scope or outcome mismatch'); END;
CREATE TRIGGER invocation_content_links_private_derivation BEFORE INSERT ON invocation_content_links
WHEN (NEW.role='output' AND EXISTS (SELECT 1 FROM content_items WHERE content_id=NEW.content_id AND access_scope='shared')
 AND EXISTS (SELECT 1 FROM invocation_content_links l JOIN content_items c ON c.content_id=l.content_id
  WHERE l.invocation_id=NEW.invocation_id AND l.role IN ('input','revised_from') AND c.access_scope='private'))
 OR (NEW.role IN ('input','revised_from') AND EXISTS (SELECT 1 FROM content_items WHERE content_id=NEW.content_id AND access_scope='private')
 AND EXISTS (SELECT 1 FROM invocation_content_links l JOIN content_items c ON c.content_id=l.content_id
  WHERE l.invocation_id=NEW.invocation_id AND l.role='output' AND c.access_scope='shared'))
 OR (NEW.role IN ('input','revised_from') AND EXISTS (SELECT 1 FROM content_items WHERE content_id=NEW.content_id AND access_scope='private')
 AND EXISTS (SELECT 1 FROM invocation_sense_links WHERE invocation_id=NEW.invocation_id AND role='output'))
BEGIN SELECT RAISE(ABORT,'private authored input cannot silently become shared output'); END;
CREATE TRIGGER invocation_sense_links_outcome BEFORE INSERT ON invocation_sense_links
WHEN NEW.role='output' AND (NOT EXISTS (SELECT 1 FROM model_invocations WHERE id=NEW.invocation_id AND status='completed')
 OR EXISTS (SELECT 1 FROM invocation_content_links l JOIN content_items c ON c.content_id=l.content_id
 WHERE l.invocation_id=NEW.invocation_id AND l.role IN ('input','revised_from') AND c.access_scope='private'))
BEGIN SELECT RAISE(ABORT,'sense output requires a completed invocation'); END;
CREATE TRIGGER invocation_content_links_immutable BEFORE UPDATE ON invocation_content_links BEGIN SELECT RAISE(ABORT,'invocation links are immutable'); END;
CREATE TRIGGER invocation_content_links_retained BEFORE DELETE ON invocation_content_links BEGIN SELECT RAISE(ABORT,'invocation links are retained'); END;
CREATE TRIGGER invocation_sense_links_immutable BEFORE UPDATE ON invocation_sense_links BEGIN SELECT RAISE(ABORT,'invocation links are immutable'); END;
CREATE TRIGGER invocation_sense_links_retained BEFORE DELETE ON invocation_sense_links BEGIN SELECT RAISE(ABORT,'invocation links are retained'); END;
-- One bounded shared pool preparation per exact source and generation brief.
CREATE TABLE vocabulary_practice_preparation (
  work_id TEXT PRIMARY KEY,
  word_id TEXT NOT NULL REFERENCES lexical_words(id),
  source_content_id TEXT NOT NULL REFERENCES word_content_documents(content_id),
  generation_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued','running','ready','failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 3),
  active_token TEXT, expires_at TEXT,
  invocation_id TEXT REFERENCES model_invocations(id),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  last_error TEXT,
  UNIQUE(word_id,source_content_id,generation_key),
  CHECK ((status='running' AND active_token IS NOT NULL AND expires_at IS NOT NULL)
    OR (status!='running' AND active_token IS NULL AND expires_at IS NULL))
);
CREATE INDEX idx_vocabulary_practice_queue ON vocabulary_practice_preparation(status,created_at,work_id);
