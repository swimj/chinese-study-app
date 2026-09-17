-- Help "new" attention is not a review disposition. A nullable inbox_seen_at on
-- pending proposal reviews and open explanation-only Help rows records whether
-- the learner has already been shown that card (or left pending). Existing rows
-- are stamped so shipping this feature does not badge the current queue.

ALTER TABLE "learner_owned_reflection_proposal_reviews" ADD COLUMN inbox_seen_at TEXT;
ALTER TABLE "learner_owned_reflection_help_inbox" ADD COLUMN inbox_seen_at TEXT;

UPDATE "learner_owned_reflection_proposal_reviews"
SET inbox_seen_at = updated_at
WHERE inbox_seen_at IS NULL;

UPDATE "learner_owned_reflection_help_inbox"
SET inbox_seen_at = opened_at
WHERE inbox_seen_at IS NULL;

DROP VIEW reflection_proposal_reviews;
DROP VIEW reflection_help_inbox;

CREATE VIEW reflection_proposal_reviews AS
    SELECT proposal_id, artifact_id, item_id, proposal_index, disposition, updated_at, acceptance_mode, accepted_invocation_id, dismissal_reason, supersession_source, supersession_actor, supersession_reason, replacement_proposal_id, replacement_invocation_id, satisfying_effect_refs_json, inbox_seen_at
    FROM learner_owned_reflection_proposal_reviews
    WHERE learner_id = current_learner_id();

CREATE TRIGGER reflection_proposal_reviews_scoped_delete
    INSTEAD OF DELETE ON reflection_proposal_reviews
    BEGIN
      DELETE FROM learner_owned_reflection_proposal_reviews
      WHERE learner_id = current_learner_id() AND proposal_id = OLD.proposal_id;
    END;

CREATE TRIGGER reflection_proposal_reviews_scoped_insert
    INSTEAD OF INSERT ON reflection_proposal_reviews
    BEGIN
      INSERT INTO learner_owned_reflection_proposal_reviews (learner_id, proposal_id, artifact_id, item_id, proposal_index, disposition, updated_at, acceptance_mode, accepted_invocation_id, dismissal_reason, supersession_source, supersession_actor, supersession_reason, replacement_proposal_id, replacement_invocation_id, satisfying_effect_refs_json, inbox_seen_at)
      VALUES (current_learner_id(), NEW.proposal_id, NEW.artifact_id, NEW.item_id, NEW.proposal_index, NEW.disposition, NEW.updated_at, NEW.acceptance_mode, NEW.accepted_invocation_id, NEW.dismissal_reason, NEW.supersession_source, NEW.supersession_actor, NEW.supersession_reason, NEW.replacement_proposal_id, NEW.replacement_invocation_id, COALESCE(NEW.satisfying_effect_refs_json, '[]'), NEW.inbox_seen_at);
    END;

CREATE TRIGGER reflection_proposal_reviews_scoped_update
    INSTEAD OF UPDATE ON reflection_proposal_reviews
    BEGIN
      SELECT CASE WHEN NEW.proposal_id IS NOT OLD.proposal_id THEN RAISE(ABORT, 'reflection proposal identity is immutable') END;
      SELECT CASE WHEN NEW.artifact_id IS NOT OLD.artifact_id THEN RAISE(ABORT, 'reflection proposal identity is immutable') END;
      SELECT CASE WHEN NEW.item_id IS NOT OLD.item_id THEN RAISE(ABORT, 'reflection proposal identity is immutable') END;
      SELECT CASE WHEN NEW.proposal_index IS NOT OLD.proposal_index THEN RAISE(ABORT, 'reflection proposal identity is immutable') END;
      UPDATE learner_owned_reflection_proposal_reviews
      SET disposition = NEW.disposition, updated_at = NEW.updated_at, acceptance_mode = NEW.acceptance_mode, accepted_invocation_id = NEW.accepted_invocation_id, dismissal_reason = NEW.dismissal_reason, supersession_source = NEW.supersession_source, supersession_actor = NEW.supersession_actor, supersession_reason = NEW.supersession_reason, replacement_proposal_id = NEW.replacement_proposal_id, replacement_invocation_id = NEW.replacement_invocation_id, satisfying_effect_refs_json = NEW.satisfying_effect_refs_json, inbox_seen_at = NEW.inbox_seen_at
      WHERE learner_id = current_learner_id() AND proposal_id = OLD.proposal_id;
    END;

CREATE VIEW reflection_help_inbox AS
    SELECT inbox_id, artifact_id, item_id, opened_at, inbox_seen_at
    FROM learner_owned_reflection_help_inbox
    WHERE learner_id = current_learner_id();

CREATE TRIGGER reflection_help_inbox_scoped_delete
    INSTEAD OF DELETE ON reflection_help_inbox
    BEGIN
      DELETE FROM learner_owned_reflection_help_inbox
      WHERE learner_id = current_learner_id() AND inbox_id = OLD.inbox_id;
    END;

CREATE TRIGGER reflection_help_inbox_scoped_insert
    INSTEAD OF INSERT ON reflection_help_inbox
    BEGIN
      INSERT INTO learner_owned_reflection_help_inbox (learner_id, inbox_id, artifact_id, item_id, opened_at, inbox_seen_at)
      VALUES (current_learner_id(), NEW.inbox_id, NEW.artifact_id, NEW.item_id, NEW.opened_at, NEW.inbox_seen_at);
    END;

CREATE TRIGGER reflection_help_inbox_scoped_update
    INSTEAD OF UPDATE ON reflection_help_inbox
    BEGIN
      SELECT CASE WHEN NEW.inbox_id IS NOT OLD.inbox_id THEN RAISE(ABORT, 'reflection help inbox entries are immutable') END;
      SELECT CASE WHEN NEW.artifact_id IS NOT OLD.artifact_id THEN RAISE(ABORT, 'reflection help inbox entries are immutable') END;
      SELECT CASE WHEN NEW.item_id IS NOT OLD.item_id THEN RAISE(ABORT, 'reflection help inbox entries are immutable') END;
      SELECT CASE WHEN NEW.opened_at IS NOT OLD.opened_at THEN RAISE(ABORT, 'reflection help inbox entries are immutable') END;
      UPDATE learner_owned_reflection_help_inbox
      SET inbox_seen_at = NEW.inbox_seen_at
      WHERE learner_id = current_learner_id() AND inbox_id = OLD.inbox_id;
    END;
