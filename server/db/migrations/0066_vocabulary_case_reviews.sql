-- Cases own review identity; historical child rows remain immutable provenance.
CREATE TABLE vocabulary_case_reviews (
  case_id TEXT PRIMARY KEY REFERENCES reflection_cases(case_id),
  state TEXT NOT NULL DEFAULT 'open' CHECK(state IN ('open','resolved')),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  current_job_id TEXT REFERENCES vocabulary_reflection_jobs(job_id),
  current_proposal_id TEXT REFERENCES content_proposals(proposal_id),
  approval_request_id TEXT,
  approval_state TEXT CHECK(approval_state IS NULL OR approval_state IN ('pending','attention')),
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE INDEX idx_vocabulary_case_review_queue ON vocabulary_case_reviews(state,created_at,case_id);
CREATE INDEX idx_vocabulary_case_review_history ON vocabulary_case_reviews(state,resolved_at,case_id);
CREATE TABLE vocabulary_case_lineage (
  member_case_id TEXT PRIMARY KEY REFERENCES reflection_cases(case_id),
  case_id TEXT NOT NULL REFERENCES vocabulary_case_reviews(case_id)
);
CREATE INDEX idx_vocabulary_case_lineage_root ON vocabulary_case_lineage(case_id,member_case_id);
CREATE TABLE vocabulary_reflection_jobs_next (
  job_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES reflection_cases(case_id),
  kind TEXT NOT NULL CHECK(kind IN ('learner_feedback','exercise_improvement')),
  dedupe_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','failed')),
  next_attempt_at TEXT NOT NULL,
  attempt_number INTEGER NOT NULL DEFAULT 0 CHECK(attempt_number>=0),
  lease_token TEXT,
  lease_expires_at TEXT,
  result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
  last_error TEXT,
  created_at TEXT NOT NULL,
  second_opinion_json TEXT CHECK(second_opinion_json IS NULL OR json_valid(second_opinion_json)),
  model_choice TEXT,
  reassessment_source_job_id TEXT REFERENCES vocabulary_reflection_jobs(job_id),
  reassessment_source_json TEXT CHECK(reassessment_source_json IS NULL OR json_valid(reassessment_source_json)),
  sense_mapping_availability_failures INTEGER NOT NULL DEFAULT 0 CHECK(sense_mapping_availability_failures BETWEEN 0 AND 6),
  review_case_id TEXT REFERENCES vocabulary_case_reviews(case_id),
  case_sequence INTEGER NOT NULL DEFAULT 1 CHECK(case_sequence>0),
  UNIQUE(kind,dedupe_key),
  CHECK(status!='running' OR (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL))
);
INSERT INTO vocabulary_reflection_jobs_next(job_id,case_id,kind,dedupe_key,status,next_attempt_at,attempt_number,lease_token,lease_expires_at,result_json,last_error,created_at,second_opinion_json,model_choice,reassessment_source_job_id,reassessment_source_json,sense_mapping_availability_failures)
SELECT job_id,case_id,kind,dedupe_key,status,next_attempt_at,attempt_number,lease_token,lease_expires_at,result_json,last_error,created_at,second_opinion_json,model_choice,reassessment_source_job_id,reassessment_source_json,sense_mapping_availability_failures FROM vocabulary_reflection_jobs;
DROP TABLE vocabulary_reflection_jobs;
ALTER TABLE vocabulary_reflection_jobs_next RENAME TO vocabulary_reflection_jobs;
CREATE INDEX idx_vocabulary_reflection_jobs_case ON vocabulary_reflection_jobs(case_id,created_at,job_id);
CREATE INDEX idx_vocabulary_reflection_jobs_due ON vocabulary_reflection_jobs(status,next_attempt_at);
CREATE INDEX idx_vocabulary_reflection_jobs_lease ON vocabulary_reflection_jobs(lease_expires_at) WHERE status='running';
CREATE UNIQUE INDEX idx_vocabulary_case_job_sequence ON vocabulary_reflection_jobs(review_case_id,case_sequence);
CREATE UNIQUE INDEX idx_vocabulary_case_active_job ON vocabulary_reflection_jobs(review_case_id) WHERE status IN ('queued','running');
CREATE INDEX idx_vocabulary_proposal_case ON content_proposals(case_id,created_at,proposal_id);
CREATE TRIGGER vocabulary_job_case_kind BEFORE INSERT ON vocabulary_reflection_jobs
WHEN NOT EXISTS(SELECT 1 FROM reflection_cases WHERE case_id=NEW.case_id AND kind=NEW.kind AND kind!='teaching_review')
BEGIN SELECT RAISE(ABORT,'job kind must match an automatic reflection case'); END;

ALTER TABLE content_proposals ADD COLUMN assessment_job_id TEXT REFERENCES vocabulary_reflection_jobs(job_id);
UPDATE content_proposals SET assessment_job_id=(SELECT job_id FROM vocabulary_reflection_jobs j WHERE json_extract(j.result_json,'$.output.proposalId')=content_proposals.proposal_id LIMIT 1);
-- Queue consumers observe job state changes through the case revision, including timeouts.
CREATE TRIGGER vocabulary_case_job_status AFTER UPDATE OF status ON vocabulary_reflection_jobs
WHEN NEW.review_case_id IS NOT NULL AND NEW.status!=OLD.status
BEGIN UPDATE vocabulary_case_reviews SET version=version+1 WHERE case_id=NEW.review_case_id; END;
