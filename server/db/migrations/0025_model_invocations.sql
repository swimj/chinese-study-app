CREATE TABLE model_invocations (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  invocation_type TEXT NOT NULL,
  learner_id TEXT NOT NULL REFERENCES learners(learner_id),
  spend_usd REAL CHECK (spend_usd IS NULL OR spend_usd >= 0),
  spend_source TEXT NOT NULL CHECK (spend_source IN ('reported', 'estimated', 'unknown')),
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  pricing_json TEXT,
  CHECK ((spend_source = 'unknown') = (spend_usd IS NULL))
);
CREATE INDEX idx_model_invocations_timestamp ON model_invocations(timestamp);
ALTER TABLE word_preparation_work ADD COLUMN requested_by_learner_id TEXT REFERENCES learners(learner_id);
