-- An authorized repair changes current shared wording, never a served snapshot.
CREATE TABLE pure_cue_stimulus_revisions (
  learner_id TEXT NOT NULL REFERENCES learners(learner_id) ON DELETE RESTRICT,
  invocation_id TEXT NOT NULL REFERENCES learner_owned_reflection_operation_invocations(invocation_id) ON DELETE RESTRICT,
  pure_cue_id TEXT NOT NULL REFERENCES pure_cues(id) ON DELETE RESTRICT,
  previous_stimulus TEXT NOT NULL,
  stimulus TEXT NOT NULL,
  revised_at TEXT NOT NULL,
  PRIMARY KEY (learner_id, invocation_id)
);
CREATE TRIGGER pure_cue_stimulus_revisions_immutable
BEFORE UPDATE ON pure_cue_stimulus_revisions
BEGIN
  SELECT RAISE(ABORT, 'pure cue stimulus revisions are immutable');
END;
CREATE TRIGGER pure_cue_stimulus_revisions_no_delete
BEFORE DELETE ON pure_cue_stimulus_revisions
BEGIN
  SELECT RAISE(ABORT, 'pure cue stimulus revisions cannot be deleted');
END;
CREATE TRIGGER pure_cue_stimulus_revisions_owner_guard
BEFORE INSERT ON pure_cue_stimulus_revisions
WHEN NOT EXISTS (
  SELECT 1 FROM learner_owned_reflection_operation_invocations AS invocation
  WHERE invocation.invocation_id = NEW.invocation_id AND invocation.learner_id = NEW.learner_id
    AND invocation.operation_kind = 'repair_pure_cue_stimulus'
    AND invocation.operation_version = 1 AND invocation.application_state = 'pending'
    AND json_extract(invocation.operation_json, '$.operation.pureCueId') = NEW.pure_cue_id
    AND json_extract(invocation.operation_json, '$.operation.expectedStimulus') = NEW.previous_stimulus
    AND json_extract(invocation.operation_json, '$.operation.stimulus') = NEW.stimulus
)
BEGIN
  SELECT RAISE(ABORT, 'pure cue stimulus revision requires its pending learner repair');
END;

DROP TRIGGER pure_cues_identity_content_immutable;
CREATE TRIGGER pure_cues_identity_content_immutable
BEFORE UPDATE OF id, axis_note, created_at ON pure_cues
BEGIN
  SELECT RAISE(ABORT, 'pure cue identity and axis are immutable');
END;
CREATE TRIGGER pure_cues_stimulus_repair_guard
BEFORE UPDATE OF stimulus ON pure_cues
WHEN NOT EXISTS (
  SELECT 1 FROM pure_cue_stimulus_revisions AS revision
  JOIN learner_owned_reflection_operation_invocations AS invocation
    ON invocation.invocation_id = revision.invocation_id AND invocation.learner_id = revision.learner_id
  WHERE revision.pure_cue_id = OLD.id AND revision.previous_stimulus = OLD.stimulus
    AND revision.stimulus = NEW.stimulus AND invocation.application_state = 'pending'
    AND invocation.operation_kind = 'repair_pure_cue_stimulus' AND invocation.operation_version = 1
)
BEGIN
  SELECT RAISE(ABORT, 'pure cue stimulus change requires an authorized revision');
END;

DROP TRIGGER pure_cue_assessment_scheduler_snapshots_restore_guard;
CREATE TRIGGER pure_cue_assessment_scheduler_snapshots_restore_guard
BEFORE UPDATE OF compensated_by_invocation_id, compensated_at
ON pure_cue_assessment_scheduler_snapshots
WHEN OLD.compensated_by_invocation_id IS NOT NULL OR NOT EXISTS (
  SELECT 1 FROM learner_owned_reflection_operation_invocations AS invocation
  WHERE invocation.invocation_id = NEW.compensated_by_invocation_id
    AND invocation.learner_id = NEW.learner_id
    AND invocation.operation_kind IN ('reconcile_pure_cue_response', 'repair_pure_cue_stimulus')
    AND invocation.operation_version = 1 AND invocation.application_state = 'pending'
)
BEGIN
  SELECT RAISE(ABORT, 'pure cue scheduler restore requires its pending learner repair');
END;
