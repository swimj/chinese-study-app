-- Keep explanation-only review separate from proposal disposition.
DROP TRIGGER reflection_help_inbox_scoped_delete;
DROP TRIGGER reflection_help_inbox_scoped_insert;
DROP TRIGGER reflection_help_inbox_scoped_update;
DROP VIEW reflection_help_inbox;

ALTER TABLE learner_owned_reflection_help_inbox
  ADD COLUMN disposition TEXT NOT NULL DEFAULT 'open'
  CHECK (disposition IN ('open', 'deferred', 'requested_second_opinion'));
ALTER TABLE learner_owned_reflection_help_inbox ADD COLUMN disposition_at TEXT;

CREATE VIEW reflection_help_inbox AS
  SELECT inbox_id, artifact_id, item_id, opened_at, inbox_seen_at,
    disposition, disposition_at
  FROM learner_owned_reflection_help_inbox
  WHERE learner_id = current_learner_id();

CREATE TRIGGER reflection_help_inbox_scoped_delete
INSTEAD OF DELETE ON reflection_help_inbox
BEGIN
  DELETE FROM learner_owned_reflection_help_inbox
  WHERE learner_id = current_learner_id() AND inbox_id = OLD.inbox_id;
END;

-- Selected explanation rows are durable continuation provenance. Provider runs
-- already link to the continuation; its selection survives retry and recovery.
ALTER TABLE reflection_generation_continuations ADD COLUMN source_help_inbox_ids_json TEXT;
DROP TRIGGER reflection_generation_continuations_identity_immutable;
CREATE TRIGGER reflection_generation_continuations_identity_immutable
BEFORE UPDATE OF
  learner_id, continuation_id, source_session_id, reflection_flow_version,
  created_at, eligible_item_count, included_item_count, overlap_omitted_item_count,
  diagnosis_bundle_json, source_proposal_ids_json, source_help_inbox_ids_json
ON reflection_generation_continuations
BEGIN
  SELECT RAISE(ABORT, 'reflection generation continuation identity and diagnosis input are immutable');
END;

CREATE TRIGGER reflection_help_inbox_scoped_insert
INSTEAD OF INSERT ON reflection_help_inbox
BEGIN
  INSERT INTO learner_owned_reflection_help_inbox
    (learner_id, inbox_id, artifact_id, item_id, opened_at, inbox_seen_at,
      disposition, disposition_at)
  VALUES
    (current_learner_id(), NEW.inbox_id, NEW.artifact_id, NEW.item_id,
      NEW.opened_at, NEW.inbox_seen_at, COALESCE(NEW.disposition, 'open'), NEW.disposition_at);
END;

CREATE TRIGGER reflection_help_inbox_scoped_update
INSTEAD OF UPDATE ON reflection_help_inbox
BEGIN
  SELECT CASE WHEN NEW.inbox_id IS NOT OLD.inbox_id
    THEN RAISE(ABORT, 'reflection help inbox entries are immutable') END;
  SELECT CASE WHEN NEW.artifact_id IS NOT OLD.artifact_id
    THEN RAISE(ABORT, 'reflection help inbox entries are immutable') END;
  SELECT CASE WHEN NEW.item_id IS NOT OLD.item_id
    THEN RAISE(ABORT, 'reflection help inbox entries are immutable') END;
  SELECT CASE WHEN NEW.opened_at IS NOT OLD.opened_at
    THEN RAISE(ABORT, 'reflection help inbox entries are immutable') END;
  UPDATE learner_owned_reflection_help_inbox
  SET inbox_seen_at = NEW.inbox_seen_at,
      disposition = NEW.disposition,
      disposition_at = NEW.disposition_at
  WHERE learner_id = current_learner_id() AND inbox_id = OLD.inbox_id;
END;
