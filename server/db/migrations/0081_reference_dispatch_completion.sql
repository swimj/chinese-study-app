-- Every dispatch envelope must be byte-recoverable from its own closed revision.
-- A divergent historical envelope must be investigated before dropping this column.
CREATE TEMP TABLE dispatch_evidence_check (
  verified INTEGER NOT NULL CONSTRAINT dispatch_must_match_closed_completion CHECK (verified = 1)
);
INSERT INTO dispatch_evidence_check
SELECT 0 FROM vocabulary_post_session_dispatches d
LEFT JOIN vocabulary_session_completions c USING (learner_id, session_id, completion_id)
WHERE c.completion_id IS NULL OR c.status != 'closed'
   OR json_type(c.input_json,'$.actions') IS NOT 'array'
   OR json_type(c.report_json) IS NOT 'object'
   OR d.evidence_json IS NOT json_object('actions',json_extract(c.input_json,'$.actions'),'projection',json(c.report_json))
LIMIT 1;
DROP TABLE dispatch_evidence_check;

DROP TRIGGER vocabulary_dispatch_context_reference;
DROP TRIGGER vocabulary_dispatch_evidence_immutable;
ALTER TABLE vocabulary_post_session_dispatches DROP COLUMN evidence_json;

CREATE TRIGGER vocabulary_dispatch_completion_reference BEFORE INSERT ON vocabulary_post_session_dispatches
WHEN NOT EXISTS (
  SELECT 1 FROM vocabulary_session_completions c
  WHERE c.completion_id = NEW.completion_id AND c.learner_id = NEW.learner_id
    AND c.session_id = NEW.session_id AND c.status = 'closed'
)
BEGIN SELECT RAISE(ABORT,'dispatch requires its closed completion'); END;
CREATE TRIGGER vocabulary_dispatch_source_immutable BEFORE UPDATE OF learner_id,session_id,completion_id,created_at ON vocabulary_post_session_dispatches
BEGIN SELECT RAISE(ABORT,'dispatch source is immutable'); END;
