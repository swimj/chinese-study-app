-- The before hook verifies and stages external references prior to rewriting any invocation.
ALTER TABLE model_invocations RENAME COLUMN prompt_template TO prompt_blob_hash;
ALTER TABLE model_invocations ADD COLUMN request_prompt_refs_json TEXT
  CHECK (request_prompt_refs_json IS NULL OR json_valid(request_prompt_refs_json));

UPDATE model_invocations AS i
SET prompt_blob_hash=u.template_hash, request_snapshot_json=u.request_json, request_prompt_refs_json=u.references_json
FROM invocation_prompt_updates u WHERE i.id=u.id;
DROP TABLE temp.invocation_prompt_updates;

CREATE TRIGGER model_invocation_prompt_immutable
BEFORE UPDATE OF prompt_hash,request_snapshot_json,prompt_blob_hash,request_prompt_refs_json ON model_invocations
BEGIN SELECT RAISE(ABORT, 'invocation prompt provenance is immutable'); END;

-- Improvement stage prompt retention
ALTER TABLE vocabulary_improvement_stages ADD COLUMN system_prompt_blob_hash TEXT
  CHECK (system_prompt_blob_hash IS NULL OR (length(system_prompt_blob_hash)=64
    AND system_prompt_blob_hash NOT GLOB '*[^a-f0-9]*' AND json_type(input_json,'$.contract.systemPrompt') IS 'null'));
DROP TRIGGER vocabulary_improvement_stage_immutable;
UPDATE vocabulary_improvement_stages AS s SET input_json=u.input_json,system_prompt_blob_hash=u.blob_hash
FROM improvement_stage_prompt_updates u WHERE s.job_id=u.job_id AND s.stage=u.stage AND s.input_hash=u.input_hash;
DROP TABLE temp.improvement_stage_prompt_updates;
CREATE TRIGGER vocabulary_improvement_stage_immutable BEFORE UPDATE ON vocabulary_improvement_stages
BEGIN SELECT RAISE(ABORT,'improvement stage evidence is immutable'); END;
CREATE TRIGGER vocabulary_improvement_stage_prompt_reference BEFORE INSERT ON vocabulary_improvement_stages
WHEN json_type(NEW.input_json,'$.contract.systemPrompt')='text'
BEGIN SELECT RAISE(ABORT,'improvement stage prompt requires an archive reference'); END;
