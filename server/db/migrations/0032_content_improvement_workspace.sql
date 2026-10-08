CREATE TABLE content_improvement_cases (
  id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL CHECK (revision > 0),
  status TEXT NOT NULL CHECK (status IN ('draft', 'applied', 'closed')),
  source_kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  case_json TEXT NOT NULL CHECK (json_valid(case_json)),
  updated_at TEXT NOT NULL
);
CREATE INDEX content_improvement_queue ON content_improvement_cases(status, updated_at DESC, id);
CREATE TABLE content_improvement_revisions (
  case_id TEXT NOT NULL REFERENCES content_improvement_cases(id),
  revision INTEGER NOT NULL,
  actor_id TEXT NOT NULL,
  saved_at TEXT NOT NULL,
  case_json TEXT NOT NULL CHECK (json_valid(case_json)),
  PRIMARY KEY (case_id, revision)
);
CREATE TRIGGER content_improvement_revision_immutable BEFORE UPDATE ON content_improvement_revisions
BEGIN SELECT RAISE(ABORT, 'Content improvement evidence is immutable'); END;
CREATE TRIGGER content_improvement_revision_retained BEFORE DELETE ON content_improvement_revisions
BEGIN SELECT RAISE(ABORT, 'Content improvement evidence must be retained'); END;
CREATE TRIGGER content_improvement_resolved_immutable BEFORE UPDATE ON content_improvement_cases
WHEN OLD.status <> 'draft'
BEGIN SELECT RAISE(ABORT, 'Resolved content improvement cases are immutable'); END;
CREATE TRIGGER content_improvement_case_retained BEFORE DELETE ON content_improvement_cases
BEGIN SELECT RAISE(ABORT, 'Content improvement cases must be retained'); END;
