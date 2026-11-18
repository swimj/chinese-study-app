-- Reconstruct the list on demand from the immutable journal, including an
-- earlier revision's shorter prefix after the learner cancels and resumes.
CREATE VIEW vocabulary_completion_action_lists AS
SELECT c.completion_id, c.learner_id, c.session_id, (
  SELECT json_group_array(json(a.action_json) ORDER BY a.sequence_number)
  FROM session_actions a WHERE a.session_id=c.session_id AND a.learner_id=c.learner_id
    AND a.sequence_number<=c.through_sequence
) AS actions_json
FROM vocabulary_session_completions c;

-- Sequence numbers are positive and unique per session. A prefix of N rows
-- ending at or before N therefore contains every action from 1 through N.
CREATE TEMP TABLE completion_action_check (
  verified INTEGER NOT NULL CONSTRAINT completion_actions_must_match_journal CHECK (verified = 1)
);
INSERT INTO completion_action_check
SELECT 0 FROM vocabulary_session_completions c
JOIN vocabulary_completion_action_lists j USING (completion_id,learner_id,session_id)
WHERE json_type(c.input_json,'$.actions') IS NOT 'array'
   OR json_array_length(c.input_json,'$.actions') != c.through_sequence
   OR json_extract(c.input_json,'$.actions') IS NOT j.actions_json
LIMIT 1;
DROP TABLE completion_action_check;

DROP TRIGGER vocabulary_completion_input_immutable;
DROP TRIGGER vocabulary_completion_terminal;
UPDATE vocabulary_session_completions SET input_json=json_remove(input_json,'$.actions');
CREATE TRIGGER vocabulary_completion_input_immutable BEFORE UPDATE OF learner_id,session_id,revision_number,through_sequence,staged_at,close_at,input_json,policy_version ON vocabulary_session_completions
BEGIN SELECT RAISE(ABORT,'completion input is immutable'); END;
CREATE TRIGGER vocabulary_completion_terminal BEFORE UPDATE ON vocabulary_session_completions WHEN OLD.status IN ('closed','cancelled')
BEGIN SELECT RAISE(ABORT,'concluded completion is immutable'); END;

CREATE TRIGGER vocabulary_completion_action_reference BEFORE INSERT ON vocabulary_session_completions
WHEN json_type(NEW.input_json) IS NOT 'object' OR json_type(NEW.input_json,'$.actions') IS NOT NULL
  OR NEW.through_sequence != (SELECT count(*) FROM session_actions
      WHERE session_id=NEW.session_id AND learner_id=NEW.learner_id AND sequence_number<=NEW.through_sequence)
BEGIN SELECT RAISE(ABORT,'completion requires an existing action boundary and no embedded actions'); END;
