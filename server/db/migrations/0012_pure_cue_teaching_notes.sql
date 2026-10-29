-- Deliberately leave legacy axis commentary and served history unchanged.
ALTER TABLE pure_cues ADD COLUMN teaching_note TEXT NOT NULL DEFAULT '';
ALTER TABLE pure_cue_served_snapshots ADD COLUMN teaching_note TEXT NOT NULL DEFAULT '';

DROP TRIGGER pure_cue_served_snapshots_immutable;
CREATE TRIGGER pure_cue_served_snapshots_immutable
BEFORE UPDATE OF
  learner_id, snapshot_id, pure_cue_id, served_at, stimulus, axis_note, teaching_note, accepted_answers_json
ON pure_cue_served_snapshots
BEGIN
  SELECT RAISE(ABORT, 'pure cue served snapshot is immutable');
END;

-- Every teaching rewrite retains private authorization and the exact before/after.
CREATE TABLE pure_cue_teaching_revisions (
  learner_id TEXT NOT NULL REFERENCES learners(learner_id) ON DELETE RESTRICT,
  invocation_id TEXT NOT NULL REFERENCES learner_owned_reflection_operation_invocations(invocation_id) ON DELETE RESTRICT,
  pure_cue_id TEXT NOT NULL REFERENCES pure_cues(id) ON DELETE RESTRICT,
  previous_teaching_note TEXT NOT NULL,
  teaching_note TEXT NOT NULL,
  revised_at TEXT NOT NULL,
  PRIMARY KEY (learner_id, invocation_id)
);
CREATE TRIGGER pure_cue_teaching_revisions_immutable
BEFORE UPDATE ON pure_cue_teaching_revisions
BEGIN
  SELECT RAISE(ABORT, 'pure cue teaching revisions are immutable');
END;
CREATE TRIGGER pure_cue_teaching_revisions_no_delete
BEFORE DELETE ON pure_cue_teaching_revisions
BEGIN
  SELECT RAISE(ABORT, 'pure cue teaching revisions cannot be deleted');
END;

CREATE TRIGGER pure_cue_teaching_revisions_owner_guard
BEFORE INSERT ON pure_cue_teaching_revisions
WHEN NOT EXISTS (
  SELECT 1 FROM learner_owned_reflection_operation_invocations AS invocation
  WHERE invocation.invocation_id = NEW.invocation_id AND invocation.learner_id = NEW.learner_id
    AND invocation.operation_kind = 'reconcile_production_cues'
    AND invocation.operation_version = 1 AND invocation.application_state = 'pending'
)
BEGIN
  SELECT RAISE(ABORT, 'pure cue teaching revision requires its learner reconciliation');
END;
