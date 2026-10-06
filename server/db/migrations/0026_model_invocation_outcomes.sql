CREATE TABLE model_invocations_next (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  invocation_type TEXT NOT NULL,
  learner_id TEXT NOT NULL REFERENCES learners(learner_id),
  spend_usd REAL CHECK (spend_usd IS NULL OR spend_usd >= 0),
  spend_source TEXT NOT NULL CHECK (spend_source IN ('reported', 'estimated', 'unknown')),
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'timed_out', 'invalid_response')),
  pricing_json TEXT,
  latency_ms REAL CHECK (latency_ms IS NULL OR latency_ms >= 0),
  CHECK ((spend_source = 'unknown') = (spend_usd IS NULL))
);
INSERT INTO model_invocations_next
  (id, timestamp, provider, model, invocation_type, learner_id, spend_usd, spend_source, status, pricing_json)
  SELECT id, timestamp, provider, model, invocation_type, learner_id, spend_usd, spend_source, status, pricing_json
  FROM model_invocations;
DROP TABLE model_invocations;
ALTER TABLE model_invocations_next RENAME TO model_invocations;
CREATE INDEX idx_model_invocations_timestamp ON model_invocations(timestamp);
