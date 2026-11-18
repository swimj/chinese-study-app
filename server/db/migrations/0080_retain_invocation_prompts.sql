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
