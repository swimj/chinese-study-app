-- A completion revision and its dispatch already reference the immutable session.
-- Abort before rewriting either body if a copy would lose distinct evidence.
CREATE TEMP TABLE session_context_check (
  verified INTEGER NOT NULL CONSTRAINT copied_session_context_must_match CHECK (verified = 1)
);
INSERT INTO session_context_check
SELECT 0 FROM vocabulary_session_completions c
LEFT JOIN vocabulary_sessions s USING (learner_id, session_id)
WHERE json_type(c.input_json,'$.context') IS NOT NULL
  AND (s.session_id IS NULL OR json_extract(c.input_json,'$.context') IS NOT json(s.context_json))
LIMIT 1;
INSERT INTO session_context_check
SELECT 0 FROM vocabulary_post_session_dispatches d
LEFT JOIN vocabulary_sessions s USING (learner_id, session_id)
WHERE json_type(d.evidence_json,'$.context') IS NOT NULL
  AND (s.session_id IS NULL OR json_extract(d.evidence_json,'$.context') IS NOT json(s.context_json))
LIMIT 1;
DROP TABLE session_context_check;

DROP TRIGGER vocabulary_completion_input_immutable;
DROP TRIGGER vocabulary_completion_terminal;
DROP TRIGGER vocabulary_dispatch_evidence_immutable;
UPDATE vocabulary_session_completions SET input_json=json_remove(input_json,'$.context')
WHERE json_type(input_json,'$.context') IS NOT NULL;
UPDATE vocabulary_post_session_dispatches SET evidence_json=json_remove(evidence_json,'$.context')
WHERE json_type(evidence_json,'$.context') IS NOT NULL;

CREATE TRIGGER vocabulary_completion_input_immutable BEFORE UPDATE OF learner_id,session_id,revision_number,through_sequence,staged_at,close_at,input_json,policy_version ON vocabulary_session_completions
BEGIN SELECT RAISE(ABORT,'completion input is immutable'); END;
CREATE TRIGGER vocabulary_completion_terminal BEFORE UPDATE ON vocabulary_session_completions WHEN OLD.status IN ('closed','cancelled')
BEGIN SELECT RAISE(ABORT,'concluded completion is immutable'); END;
CREATE TRIGGER vocabulary_dispatch_evidence_immutable BEFORE UPDATE OF learner_id,session_id,completion_id,evidence_json,created_at ON vocabulary_post_session_dispatches
BEGIN SELECT RAISE(ABORT,'post-session evidence is immutable'); END;

CREATE TRIGGER vocabulary_completion_context_reference BEFORE INSERT ON vocabulary_session_completions
WHEN json_type(NEW.input_json,'$.context') IS NOT NULL
BEGIN SELECT RAISE(ABORT,'completion context belongs to the session'); END;
CREATE TRIGGER vocabulary_dispatch_context_reference BEFORE INSERT ON vocabulary_post_session_dispatches
WHEN json_type(NEW.evidence_json,'$.context') IS NOT NULL
BEGIN SELECT RAISE(ABORT,'dispatch context belongs to the session'); END;
