-- Deferral classifies operator attention without closing cases or altering content.
ALTER TABLE vocabulary_case_reviews ADD COLUMN deferred_at TEXT;
CREATE INDEX idx_vocabulary_case_deferred ON vocabulary_case_reviews(state,created_at,case_id) WHERE deferred_at IS NOT NULL;
