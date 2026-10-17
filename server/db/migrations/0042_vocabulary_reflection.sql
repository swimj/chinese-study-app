CREATE TABLE vocabulary_reflection_session_evidence (
  completion_id TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  projection_json TEXT NOT NULL CHECK (json_valid(projection_json)),
  created_at TEXT NOT NULL,
  UNIQUE(learner_id,completion_id),
  FOREIGN KEY (learner_id, completion_id) REFERENCES vocabulary_session_completions(learner_id, completion_id)
);
CREATE TABLE reflection_cases (
  case_id TEXT PRIMARY KEY,
  completion_id TEXT NOT NULL REFERENCES vocabulary_reflection_session_evidence(completion_id),
  learner_id TEXT NOT NULL REFERENCES learners(learner_id),
  kind TEXT NOT NULL CHECK (kind IN ('learner_feedback','exercise_improvement','teaching_review')),
  subject_key TEXT NOT NULL,
  word_id TEXT REFERENCES lexical_words(id),
  content_id TEXT REFERENCES content_items(content_id),
  status TEXT NOT NULL CHECK (status IN ('open','completed','closed')),
  evidence_snapshot_json TEXT NOT NULL CHECK (json_valid(evidence_snapshot_json)),
  created_at TEXT NOT NULL,
  UNIQUE (completion_id, kind, subject_key),
  UNIQUE (learner_id,case_id),
  FOREIGN KEY (learner_id,completion_id) REFERENCES vocabulary_reflection_session_evidence(learner_id,completion_id),
  CHECK (kind != 'learner_feedback' OR ((word_id IS NULL) != (content_id IS NULL)))
);
CREATE INDEX idx_vocabulary_cases_inbox ON reflection_cases(kind,status,created_at);
CREATE INDEX idx_vocabulary_cases_learner ON reflection_cases(learner_id,word_id,kind,created_at);
CREATE TABLE reflection_case_evidence (
  case_id TEXT NOT NULL REFERENCES reflection_cases(case_id),
  encounter_id TEXT NOT NULL REFERENCES exercise_encounters(encounter_id),
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  PRIMARY KEY (case_id,encounter_id)
);
CREATE INDEX idx_vocabulary_case_encounter ON reflection_case_evidence(encounter_id,case_id);
CREATE TABLE vocabulary_reflection_jobs (
  job_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL UNIQUE REFERENCES reflection_cases(case_id),
  kind TEXT NOT NULL CHECK (kind IN ('learner_feedback','exercise_improvement')),
  dedupe_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','running','succeeded','failed')),
  next_attempt_at TEXT NOT NULL,
  attempt_number INTEGER NOT NULL DEFAULT 0 CHECK (attempt_number >= 0),
  lease_token TEXT,
  lease_expires_at TEXT,
  result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  last_error TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(kind,dedupe_key),
  CHECK (status != 'running' OR (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL))
);
CREATE INDEX idx_vocabulary_reflection_jobs_due ON vocabulary_reflection_jobs(status,next_attempt_at);
CREATE INDEX idx_vocabulary_reflection_jobs_lease ON vocabulary_reflection_jobs(lease_expires_at) WHERE status='running';
CREATE TABLE teacher_judgments (
  judgment_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES reflection_cases(case_id),
  job_id TEXT NOT NULL UNIQUE REFERENCES vocabulary_reflection_jobs(job_id),
  invocation_id TEXT REFERENCES model_invocations(id),
  diagnosis_json TEXT NOT NULL CHECK (json_valid(diagnosis_json)),
  created_at TEXT NOT NULL,
  UNIQUE(judgment_id,case_id)
);
CREATE TABLE learner_messages (
  message_id TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL REFERENCES learners(learner_id),
  case_id TEXT NOT NULL REFERENCES reflection_cases(case_id),
  judgment_id TEXT NOT NULL UNIQUE REFERENCES teacher_judgments(judgment_id),
  source_key TEXT NOT NULL UNIQUE,
  body_json TEXT NOT NULL CHECK (json_valid(body_json)),
  created_at TEXT NOT NULL,
  seen_at TEXT,
  FOREIGN KEY(learner_id,case_id) REFERENCES reflection_cases(learner_id,case_id),
  FOREIGN KEY(judgment_id,case_id) REFERENCES teacher_judgments(judgment_id,case_id)
);
CREATE INDEX idx_vocabulary_learner_messages ON learner_messages(learner_id,created_at);
CREATE TABLE content_proposals (
  proposal_id TEXT PRIMARY KEY,
  case_id TEXT REFERENCES reflection_cases(case_id),
  version INTEGER NOT NULL CHECK (version > 0),
  status TEXT NOT NULL CHECK (status IN ('draft','awaiting_review','approved','applied','closed')),
  operations_json TEXT NOT NULL CHECK (json_valid(operations_json)),
  rationale TEXT NOT NULL,
  author_kind TEXT NOT NULL CHECK (author_kind IN ('operator','service')),
  author_id TEXT NOT NULL,
  invocation_id TEXT REFERENCES model_invocations(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(proposal_id,version) REFERENCES proposal_revision_history(proposal_id,version) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX idx_vocabulary_proposal_status ON content_proposals(status,updated_at);
CREATE TABLE proposal_revision_history (
  proposal_id TEXT NOT NULL REFERENCES content_proposals(proposal_id),
  version INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  actor_kind TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  PRIMARY KEY(proposal_id,version)
);
CREATE TABLE proposal_content_bases (
  proposal_id TEXT NOT NULL REFERENCES content_proposals(proposal_id),
  content_id TEXT NOT NULL REFERENCES content_items(content_id),
  expected_content_version INTEGER NOT NULL,
  PRIMARY KEY(proposal_id,content_id),
  FOREIGN KEY(content_id,expected_content_version) REFERENCES content_revision_history(content_id,version)
);
CREATE TABLE proposal_reviews (
  review_id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL,
  proposal_version INTEGER NOT NULL,
  operator_id TEXT NOT NULL,
  disposition TEXT NOT NULL CHECK(disposition IN ('approved','rejected')),
  notes_json TEXT CHECK(notes_json IS NULL OR json_valid(notes_json)),
  reviewed_at TEXT NOT NULL,
  UNIQUE(review_id,proposal_id,proposal_version),
  FOREIGN KEY(proposal_id,proposal_version) REFERENCES proposal_revision_history(proposal_id,version)
);
CREATE TABLE proposal_applications (
  application_id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL,
  proposal_version INTEGER NOT NULL,
  authorized_review_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  effects_json TEXT NOT NULL CHECK(json_valid(effects_json)),
  applied_at TEXT NOT NULL,
  UNIQUE(proposal_id,proposal_version),
  FOREIGN KEY(authorized_review_id,proposal_id,proposal_version) REFERENCES proposal_reviews(review_id,proposal_id,proposal_version)
);
CREATE TABLE application_content_changes (
  application_id TEXT NOT NULL REFERENCES proposal_applications(application_id),
  operation_key TEXT NOT NULL,
  write_strategy TEXT NOT NULL CHECK(write_strategy IN ('create','update_existing','replace')),
  source_content_id TEXT,
  source_version INTEGER,
  result_content_id TEXT NOT NULL,
  result_version INTEGER NOT NULL,
  source_history_change_id TEXT REFERENCES content_revision_history(change_id),
  PRIMARY KEY(application_id,operation_key),
  FOREIGN KEY(source_content_id,source_version) REFERENCES content_revision_history(content_id,version),
  FOREIGN KEY(result_content_id,result_version) REFERENCES content_revision_history(content_id,version)
);
CREATE TRIGGER vocabulary_reflection_session_evidence_immutable BEFORE UPDATE ON vocabulary_reflection_session_evidence BEGIN SELECT RAISE(ABORT,'reflection session evidence is immutable'); END;
CREATE TRIGGER vocabulary_case_evidence_immutable BEFORE UPDATE ON reflection_case_evidence BEGIN SELECT RAISE(ABORT,'reflection evidence is immutable'); END;
CREATE TRIGGER vocabulary_judgment_immutable BEFORE UPDATE ON teacher_judgments BEGIN SELECT RAISE(ABORT,'judgment evidence is immutable'); END;
CREATE TRIGGER vocabulary_proposal_history_immutable BEFORE UPDATE ON proposal_revision_history BEGIN SELECT RAISE(ABORT,'proposal history is immutable'); END;
CREATE TRIGGER vocabulary_proposal_review_immutable BEFORE UPDATE ON proposal_reviews BEGIN SELECT RAISE(ABORT,'proposal review is immutable'); END;
CREATE TRIGGER vocabulary_proposal_application_immutable BEFORE UPDATE ON proposal_applications BEGIN SELECT RAISE(ABORT,'proposal application is immutable'); END;

CREATE TRIGGER vocabulary_case_subject_immutable BEFORE UPDATE OF completion_id,learner_id,kind,subject_key,word_id,content_id,evidence_snapshot_json,created_at ON reflection_cases
BEGIN SELECT RAISE(ABORT,'reflection case evidence is immutable'); END;
CREATE TRIGGER vocabulary_job_case_kind BEFORE INSERT ON vocabulary_reflection_jobs
WHEN NOT EXISTS(SELECT 1 FROM reflection_cases WHERE case_id=NEW.case_id AND kind=NEW.kind AND kind!='teaching_review')
BEGIN SELECT RAISE(ABORT,'job kind must match an automatic reflection case'); END;
CREATE TRIGGER vocabulary_message_content_immutable BEFORE UPDATE OF learner_id,case_id,judgment_id,source_key,body_json,created_at ON learner_messages
BEGIN SELECT RAISE(ABORT,'learner feedback is read-only'); END;
CREATE TRIGGER vocabulary_compensation_judgment BEFORE INSERT ON learner_state_effects
WHEN NEW.judgment_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM teacher_judgments j JOIN reflection_cases c ON c.case_id=j.case_id
  WHERE j.judgment_id=NEW.judgment_id AND c.kind='learner_feedback' AND c.learner_id=NEW.learner_id
    AND c.completion_id=NEW.completion_id AND c.word_id IS NEW.word_id AND (c.word_id IS NOT NULL OR c.content_id IS NEW.pure_cue_content_id))
BEGIN SELECT RAISE(ABORT,'compensation requires its designated learner feedback judgment'); END;
CREATE TRIGGER vocabulary_vocabulary_reflection_session_evidence_retained BEFORE DELETE ON vocabulary_reflection_session_evidence BEGIN SELECT RAISE(ABORT,'reflection evidence is retained'); END;
CREATE TRIGGER vocabulary_reflection_cases_retained BEFORE DELETE ON reflection_cases BEGIN SELECT RAISE(ABORT,'reflection evidence is retained'); END;
CREATE TRIGGER vocabulary_reflection_case_evidence_retained BEFORE DELETE ON reflection_case_evidence BEGIN SELECT RAISE(ABORT,'reflection evidence is retained'); END;
CREATE TRIGGER vocabulary_teacher_judgments_retained BEFORE DELETE ON teacher_judgments BEGIN SELECT RAISE(ABORT,'reflection evidence is retained'); END;
CREATE TRIGGER vocabulary_learner_messages_retained BEFORE DELETE ON learner_messages BEGIN SELECT RAISE(ABORT,'reflection evidence is retained'); END;
CREATE TRIGGER vocabulary_proposal_revision_history_retained BEFORE DELETE ON proposal_revision_history BEGIN SELECT RAISE(ABORT,'reflection evidence is retained'); END;
CREATE TRIGGER vocabulary_proposal_reviews_retained BEFORE DELETE ON proposal_reviews BEGIN SELECT RAISE(ABORT,'reflection evidence is retained'); END;
CREATE TRIGGER vocabulary_proposal_applications_retained BEFORE DELETE ON proposal_applications BEGIN SELECT RAISE(ABORT,'reflection evidence is retained'); END;
CREATE TRIGGER vocabulary_application_content_changes_retained BEFORE DELETE ON application_content_changes BEGIN SELECT RAISE(ABORT,'reflection evidence is retained'); END;
