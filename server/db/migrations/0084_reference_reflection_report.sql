-- Every ingestion receipt must resolve to the identical immutable report
-- before we remove its copy. Cases continue to reference the receipt.
CREATE TEMP TABLE reflection_report_check (
  verified INTEGER NOT NULL CONSTRAINT reflection_report_must_match_closed_completion CHECK (verified = 1)
);
INSERT INTO reflection_report_check
SELECT 0 FROM vocabulary_reflection_session_evidence e
LEFT JOIN vocabulary_session_completions c USING (learner_id, session_id, completion_id)
WHERE c.status IS NOT 'closed' OR e.projection_json IS NOT c.report_json
LIMIT 1;
DROP TABLE reflection_report_check;

ALTER TABLE vocabulary_reflection_session_evidence DROP COLUMN projection_json;

CREATE TRIGGER vocabulary_reflection_receipt_source BEFORE INSERT ON vocabulary_reflection_session_evidence
WHEN NOT EXISTS (
  SELECT 1 FROM vocabulary_session_completions c
  WHERE c.learner_id=NEW.learner_id AND c.session_id=NEW.session_id
    AND c.completion_id=NEW.completion_id AND c.status='closed'
)
BEGIN SELECT RAISE(ABORT,'reflection receipt requires its closed completion'); END;
