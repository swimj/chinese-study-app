-- Each validated model stage is retained independently of job finalization.
-- Exact input identity permits bounded retry without repeating successful calls.
CREATE TABLE vocabulary_improvement_stages (
  job_id TEXT NOT NULL REFERENCES vocabulary_reflection_jobs(job_id),
  stage TEXT NOT NULL CHECK(stage IN ('sense_mapping','single_improvement','repertoire')),
  input_hash TEXT NOT NULL,
  input_json TEXT NOT NULL CHECK(json_valid(input_json)),
  result_json TEXT NOT NULL CHECK(json_valid(result_json)),
  invocation_id TEXT REFERENCES model_invocations(id),
  recorded_at TEXT NOT NULL,
  PRIMARY KEY(job_id,stage,input_hash)
);
CREATE INDEX idx_vocabulary_improvement_stage_invocation ON vocabulary_improvement_stages(invocation_id);
CREATE TRIGGER vocabulary_improvement_stage_immutable BEFORE UPDATE ON vocabulary_improvement_stages
BEGIN SELECT RAISE(ABORT,'improvement stage evidence is immutable'); END;
CREATE TRIGGER vocabulary_improvement_stage_retained BEFORE DELETE ON vocabulary_improvement_stages
BEGIN SELECT RAISE(ABORT,'improvement stage evidence is retained'); END;
