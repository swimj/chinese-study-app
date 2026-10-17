-- Rebuild without renaming the referenced parent; immutable invocation IDs survive.
CREATE TABLE model_invocations_next (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  invocation_type TEXT NOT NULL,
  learner_id TEXT REFERENCES learners(learner_id),
  spend_usd REAL CHECK (spend_usd IS NULL OR spend_usd >= 0),
  spend_source TEXT NOT NULL CHECK (spend_source IN ('reported', 'estimated', 'unknown')),
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'timed_out', 'invalid_response')),
  pricing_json TEXT,
  latency_ms REAL CHECK (latency_ms IS NULL OR latency_ms >= 0),
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('learner', 'service')),
  actor_id TEXT NOT NULL CHECK (length(trim(actor_id)) > 0),
  requesting_learner_id TEXT REFERENCES learners(learner_id),
  workflow_id TEXT,
  step_name TEXT,
  attempt_number INTEGER CHECK (attempt_number IS NULL OR attempt_number > 0),
  prompt_name TEXT,
  prompt_version TEXT,
  prompt_hash TEXT,
  prompt_template TEXT,
  schema_name TEXT,
  schema_version TEXT,
  schema_json TEXT CHECK (schema_json IS NULL OR json_valid(schema_json)),
  input_projection_version TEXT,
  settings_json TEXT CHECK (settings_json IS NULL OR json_valid(settings_json)),
  request_snapshot_json TEXT CHECK (request_snapshot_json IS NULL OR json_valid(request_snapshot_json)),
  response_snapshot_json TEXT CHECK (response_snapshot_json IS NULL OR json_valid(response_snapshot_json)),
  finished_at TEXT,
  usage_json TEXT CHECK (usage_json IS NULL OR json_valid(usage_json)),
  resolved_model TEXT,
  provider_request_id TEXT,
  CHECK ((spend_source = 'unknown') = (spend_usd IS NULL)),
  CHECK ((actor_kind = 'learner' AND learner_id IS NOT NULL AND actor_id = learner_id)
    OR (actor_kind = 'service' AND learner_id IS NULL))
);
INSERT INTO model_invocations_next
  (id, timestamp, provider, model, invocation_type, learner_id, spend_usd, spend_source, status, pricing_json,
   latency_ms, actor_kind, actor_id, requesting_learner_id)
  SELECT id, timestamp, provider, model, invocation_type, learner_id, spend_usd, spend_source, status, pricing_json,
    latency_ms, 'learner', learner_id, learner_id FROM model_invocations;
DROP TABLE model_invocations;
ALTER TABLE model_invocations_next RENAME TO model_invocations;
CREATE INDEX idx_model_invocations_timestamp ON model_invocations(timestamp);
CREATE INDEX idx_model_invocations_prompt ON model_invocations(prompt_name, prompt_version, timestamp);
CREATE INDEX idx_model_invocations_workflow ON model_invocations(workflow_id, step_name, attempt_number);
