-- Preserve custom requests whose standalone template cannot be read from the wire body.
ALTER TABLE model_invocations RENAME COLUMN prompt_template TO standalone_prompt_template;
ALTER TABLE model_invocations ADD COLUMN prompt_template_bytes INTEGER
  CHECK (prompt_template_bytes IS NULL OR (
    typeof(prompt_template_bytes) = 'integer' AND prompt_template_bytes >= 0
    AND standalone_prompt_template IS NULL AND prompt_hash IS NOT NULL
    AND json_extract(request_snapshot_json, '$.messages[0].role') IS 'system'
    AND json_type(request_snapshot_json, '$.messages[0].content') IS 'text'
    AND prompt_template_bytes <= length(CAST(json_extract(request_snapshot_json, '$.messages[0].content') AS BLOB))
  ));

-- UTF-8 byte boundaries also cover providers that append instructions to the system message.
UPDATE model_invocations
SET prompt_template_bytes = length(CAST(standalone_prompt_template AS BLOB)), standalone_prompt_template = NULL
WHERE standalone_prompt_template IS NOT NULL AND prompt_hash IS NOT NULL
  AND json_extract(request_snapshot_json, '$.messages[0].role') = 'system'
  AND json_type(request_snapshot_json, '$.messages[0].content') = 'text'
  AND (standalone_prompt_template = '' OR
    substr(CAST(json_extract(request_snapshot_json, '$.messages[0].content') AS BLOB),
      1, length(CAST(standalone_prompt_template AS BLOB))) = CAST(standalone_prompt_template AS BLOB));

CREATE TRIGGER model_invocation_prompt_immutable
BEFORE UPDATE OF prompt_hash,request_snapshot_json,standalone_prompt_template,prompt_template_bytes ON model_invocations
BEGIN SELECT RAISE(ABORT, 'invocation prompt provenance is immutable'); END;

CREATE VIEW model_invocation_prompts AS
SELECT id, prompt_hash,
  CASE WHEN prompt_template_bytes IS NULL THEN standalone_prompt_template
       WHEN prompt_template_bytes = 0 THEN ''
       ELSE CAST(substr(CAST(json_extract(request_snapshot_json, '$.messages[0].content') AS BLOB),
              1, prompt_template_bytes) AS TEXT) END AS prompt_template
FROM model_invocations;
