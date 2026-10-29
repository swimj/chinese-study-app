CREATE TABLE operator_reflection_cue_recoveries (
  invocation_id TEXT PRIMARY KEY REFERENCES learner_owned_reflection_operation_invocations(invocation_id),
  learner_id TEXT NOT NULL REFERENCES learners(learner_id),
  actor_id TEXT NOT NULL CHECK (length(trim(actor_id)) > 0),
  recovered_at TEXT NOT NULL,
  plan_digest TEXT NOT NULL,
  original_failure_json TEXT NOT NULL CHECK (json_valid(original_failure_json)),
  recovered_application_json TEXT NOT NULL CHECK (json_valid(recovered_application_json))
);
CREATE TRIGGER operator_reflection_cue_recoveries_same_owner
BEFORE INSERT ON operator_reflection_cue_recoveries
WHEN NOT EXISTS (
  SELECT 1 FROM learner_owned_reflection_operation_invocations i
  WHERE i.invocation_id=NEW.invocation_id AND i.learner_id=NEW.learner_id
)
BEGIN SELECT RAISE(ABORT, 'cue repair recovery learner mismatch'); END;
CREATE TRIGGER operator_reflection_cue_recoveries_no_update
BEFORE UPDATE ON operator_reflection_cue_recoveries
BEGIN SELECT RAISE(ABORT, 'cue repair recovery audit is immutable'); END;
CREATE TRIGGER operator_reflection_cue_recoveries_no_delete
BEFORE DELETE ON operator_reflection_cue_recoveries
BEGIN SELECT RAISE(ABORT, 'cue repair recovery audit is immutable'); END;
