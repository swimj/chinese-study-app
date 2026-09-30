-- Historical attempts deliberately remain without reconstructable scheduler state.
CREATE TABLE pure_cue_assessment_scheduler_snapshots (
  learner_id TEXT NOT NULL REFERENCES learners(learner_id) ON DELETE RESTRICT,
  source_attempt_id TEXT NOT NULL,
  pure_cue_id TEXT NOT NULL REFERENCES pure_cues(id) ON DELETE RESTRICT,
  captured_at TEXT NOT NULL,
  scheduler_state_json TEXT NOT NULL,
  compensated_by_invocation_id TEXT REFERENCES learner_owned_reflection_operation_invocations(invocation_id) ON DELETE RESTRICT,
  compensated_at TEXT,
  PRIMARY KEY (learner_id, source_attempt_id),
  UNIQUE (learner_id, compensated_by_invocation_id),
  FOREIGN KEY (learner_id, source_attempt_id)
    REFERENCES pure_cue_attempts(learner_id, attempt_id) ON DELETE RESTRICT,
  CHECK ((compensated_by_invocation_id IS NULL AND compensated_at IS NULL)
    OR (compensated_by_invocation_id IS NOT NULL AND compensated_at IS NOT NULL))
);

CREATE TRIGGER pure_cue_assessment_scheduler_snapshots_immutable
BEFORE UPDATE OF learner_id, source_attempt_id, pure_cue_id, captured_at, scheduler_state_json
ON pure_cue_assessment_scheduler_snapshots
BEGIN
  SELECT RAISE(ABORT, 'pure cue assessment scheduler snapshot is immutable');
END;

CREATE TRIGGER pure_cue_assessment_scheduler_snapshots_no_delete
BEFORE DELETE ON pure_cue_assessment_scheduler_snapshots
BEGIN
  SELECT RAISE(ABORT, 'pure cue assessment scheduler snapshots cannot be deleted');
END;

CREATE TRIGGER pure_cue_assessment_scheduler_snapshots_restore_guard
BEFORE UPDATE OF compensated_by_invocation_id, compensated_at
ON pure_cue_assessment_scheduler_snapshots
WHEN OLD.compensated_by_invocation_id IS NOT NULL OR NOT EXISTS (
  SELECT 1 FROM learner_owned_reflection_operation_invocations AS invocation
  WHERE invocation.invocation_id = NEW.compensated_by_invocation_id
    AND invocation.learner_id = NEW.learner_id
    AND invocation.operation_kind = 'reconcile_pure_cue_response'
    AND invocation.operation_version = 1 AND invocation.application_state = 'pending'
)
BEGIN
  SELECT RAISE(ABORT, 'pure cue scheduler restore requires its pending learner reconciliation');
END;

DROP TRIGGER pure_cue_teaching_revisions_owner_guard;
CREATE TRIGGER pure_cue_teaching_revisions_owner_guard
BEFORE INSERT ON pure_cue_teaching_revisions
WHEN NOT EXISTS (
  SELECT 1 FROM learner_owned_reflection_operation_invocations AS invocation
  WHERE invocation.invocation_id = NEW.invocation_id AND invocation.learner_id = NEW.learner_id
    AND invocation.operation_kind IN ('reconcile_production_cues', 'reconcile_pure_cue_response')
    AND invocation.operation_version = 1 AND invocation.application_state = 'pending'
)
BEGIN
  SELECT RAISE(ABORT, 'pure cue teaching revision requires its learner reconciliation');
END;
