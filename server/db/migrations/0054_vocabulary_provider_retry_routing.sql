-- Preserve bounded preparation retries independently of reflection routing.
ALTER TABLE vocabulary_practice_preparation ADD COLUMN next_attempt_at TEXT NOT NULL DEFAULT '';
ALTER TABLE vocabulary_practice_preparation ADD COLUMN total_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(total_attempt_count >= 0);
UPDATE vocabulary_practice_preparation SET next_attempt_at=updated_at,total_attempt_count=attempt_count;
ALTER TABLE vocabulary_sense_readiness ADD COLUMN next_attempt_at TEXT NOT NULL DEFAULT '';
ALTER TABLE vocabulary_sense_readiness ADD COLUMN total_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(total_attempt_count >= 0);
UPDATE vocabulary_sense_readiness SET next_attempt_at=updated_at,total_attempt_count=attempt_count;
CREATE TABLE vocabulary_preparation_attempts (
  attempt_id TEXT PRIMARY KEY,
  preparation_kind TEXT NOT NULL CHECK(preparation_kind IN ('practice','sense')),
  work_id TEXT NOT NULL,
  attempt_number INTEGER NOT NULL CHECK(attempt_number > 0),
  cycle_attempt INTEGER NOT NULL CHECK(cycle_attempt BETWEEN 1 AND 3),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  outcome TEXT CHECK(outcome IN ('ready','failed','interrupted')),
  diagnostic TEXT,
  invocation_id TEXT REFERENCES model_invocations(id) ON DELETE RESTRICT,
  UNIQUE(preparation_kind,work_id,attempt_number)
);
CREATE INDEX idx_vocabulary_preparation_attempts_work ON vocabulary_preparation_attempts(preparation_kind,work_id,attempt_number);
ALTER TABLE vocabulary_reflection_jobs ADD COLUMN model_choice TEXT;
UPDATE vocabulary_reflection_jobs SET model_choice='openai:gpt-5.6-luna-high'
WHERE EXISTS (SELECT 1 FROM model_invocations i WHERE i.workflow_id=vocabulary_reflection_jobs.job_id AND i.invocation_type GLOB 'vocabulary_reflection_*');
