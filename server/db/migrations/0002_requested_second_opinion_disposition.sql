-- Split second-opinion retirement out of dismissed. SQLite cannot ALTER a CHECK,
-- so this rebuilds the physical review table. Incoming FKs and same-owner
-- triggers name that table, and the current-learner view must be dropped before
-- the table is replaced; indexes and triggers are recreated after.

DROP VIEW reflection_proposal_reviews;

CREATE TABLE "learner_owned_reflection_proposal_reviews__new" (
      proposal_id TEXT PRIMARY KEY,
      learner_id TEXT NOT NULL DEFAULT (current_learner_id()) REFERENCES learners(learner_id) ON DELETE CASCADE,
      artifact_id TEXT NOT NULL
        REFERENCES "learner_owned_reflection_artifacts"(artifact_id) ON DELETE RESTRICT,
      item_id TEXT NOT NULL,
      proposal_index INTEGER NOT NULL CHECK (proposal_index >= 0),
      disposition TEXT NOT NULL
        CHECK (disposition IN ('pending', 'deferred', 'accepted', 'dismissed', 'requested_second_opinion', 'superseded')),
      updated_at TEXT NOT NULL,
      acceptance_mode TEXT
        CHECK (acceptance_mode IS NULL OR acceptance_mode IN ('exact', 'revised')),
      accepted_invocation_id TEXT
        REFERENCES "learner_owned_reflection_operation_invocations"(invocation_id) ON DELETE RESTRICT,
      dismissal_reason TEXT,
      supersession_source TEXT
        CHECK (
          supersession_source IS NULL
          OR supersession_source IN ('competing_proposal', 'user_replacement', 'external_state')
        ),
      supersession_actor TEXT
        CHECK (supersession_actor IS NULL OR supersession_actor IN ('user', 'system')),
      supersession_reason TEXT,
      replacement_proposal_id TEXT
        REFERENCES "learner_owned_reflection_proposal_reviews__new"(proposal_id) ON DELETE RESTRICT,
      replacement_invocation_id TEXT
        REFERENCES "learner_owned_reflection_operation_invocations"(invocation_id) ON DELETE RESTRICT,
      satisfying_effect_refs_json TEXT NOT NULL DEFAULT '[]',
      UNIQUE (artifact_id, item_id, proposal_index),
      CHECK (
        (
          disposition IN ('pending', 'deferred', 'requested_second_opinion')
          AND acceptance_mode IS NULL
          AND accepted_invocation_id IS NULL
          AND dismissal_reason IS NULL
          AND supersession_source IS NULL
          AND supersession_actor IS NULL
          AND supersession_reason IS NULL
          AND replacement_proposal_id IS NULL
          AND replacement_invocation_id IS NULL
          AND satisfying_effect_refs_json = '[]'
        )
        OR (
          disposition = 'accepted'
          AND acceptance_mode IS NOT NULL
          AND accepted_invocation_id IS NOT NULL
          AND dismissal_reason IS NULL
          AND supersession_source IS NULL
          AND supersession_actor IS NULL
          AND supersession_reason IS NULL
          AND replacement_proposal_id IS NULL
          AND replacement_invocation_id IS NULL
          AND satisfying_effect_refs_json = '[]'
        )
        OR (
          disposition = 'dismissed'
          AND acceptance_mode IS NULL
          AND accepted_invocation_id IS NULL
          AND supersession_source IS NULL
          AND supersession_actor IS NULL
          AND supersession_reason IS NULL
          AND replacement_proposal_id IS NULL
          AND replacement_invocation_id IS NULL
          AND satisfying_effect_refs_json = '[]'
        )
        OR (
          disposition = 'superseded'
          AND acceptance_mode IS NULL
          AND accepted_invocation_id IS NULL
          AND dismissal_reason IS NULL
          AND supersession_source IS NOT NULL
          AND supersession_actor IS NOT NULL
          AND supersession_reason IS NOT NULL
          AND (
            (
              supersession_source = 'competing_proposal'
              AND replacement_proposal_id IS NOT NULL
              AND replacement_invocation_id IS NULL
              AND satisfying_effect_refs_json = '[]'
            )
            OR (
              supersession_source = 'user_replacement'
              AND replacement_proposal_id IS NULL
              AND replacement_invocation_id IS NOT NULL
              AND satisfying_effect_refs_json = '[]'
            )
            OR (
              supersession_source = 'external_state'
              AND replacement_proposal_id IS NULL
              AND replacement_invocation_id IS NULL
              AND satisfying_effect_refs_json != '[]'
            )
          )
        )
      )
    );

INSERT INTO "learner_owned_reflection_proposal_reviews__new" (
  proposal_id,
  learner_id,
  artifact_id,
  item_id,
  proposal_index,
  disposition,
  updated_at,
  acceptance_mode,
  accepted_invocation_id,
  dismissal_reason,
  supersession_source,
  supersession_actor,
  supersession_reason,
  replacement_proposal_id,
  replacement_invocation_id,
  satisfying_effect_refs_json
)
SELECT
  proposal_id,
  learner_id,
  artifact_id,
  item_id,
  proposal_index,
  CASE
    WHEN disposition = 'dismissed' AND dismissal_reason = 'requested_second_opinion'
      THEN 'requested_second_opinion'
    ELSE disposition
  END,
  updated_at,
  acceptance_mode,
  accepted_invocation_id,
  CASE
    WHEN disposition = 'dismissed' AND dismissal_reason = 'requested_second_opinion'
      THEN NULL
    ELSE dismissal_reason
  END,
  supersession_source,
  supersession_actor,
  supersession_reason,
  replacement_proposal_id,
  replacement_invocation_id,
  satisfying_effect_refs_json
FROM "learner_owned_reflection_proposal_reviews";

DROP TRIGGER learner_owned_reflection_operation_invocations_origin_proposal_id_same_owner_insert;
DROP TRIGGER learner_owned_reflection_operation_invocations_origin_proposal_id_same_owner_update;
DROP TRIGGER learner_owned_reflection_operation_invocations_origin_superseded_proposal_id_same_owner_insert;
DROP TRIGGER learner_owned_reflection_operation_invocations_origin_superseded_proposal_id_same_owner_update;

DROP TABLE "learner_owned_reflection_proposal_reviews";

ALTER TABLE "learner_owned_reflection_proposal_reviews__new" RENAME TO "learner_owned_reflection_proposal_reviews";

CREATE VIEW reflection_proposal_reviews AS
    SELECT proposal_id, artifact_id, item_id, proposal_index, disposition, updated_at, acceptance_mode, accepted_invocation_id, dismissal_reason, supersession_source, supersession_actor, supersession_reason, replacement_proposal_id, replacement_invocation_id, satisfying_effect_refs_json
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
      INSERT INTO learner_owned_reflection_proposal_reviews (learner_id, proposal_id, artifact_id, item_id, proposal_index, disposition, updated_at, acceptance_mode, accepted_invocation_id, dismissal_reason, supersession_source, supersession_actor, supersession_reason, replacement_proposal_id, replacement_invocation_id, satisfying_effect_refs_json)
      VALUES (current_learner_id(), NEW.proposal_id, NEW.artifact_id, NEW.item_id, NEW.proposal_index, NEW.disposition, NEW.updated_at, NEW.acceptance_mode, NEW.accepted_invocation_id, NEW.dismissal_reason, NEW.supersession_source, NEW.supersession_actor, NEW.supersession_reason, NEW.replacement_proposal_id, NEW.replacement_invocation_id, COALESCE(NEW.satisfying_effect_refs_json, '[]'));
    END;

CREATE TRIGGER reflection_proposal_reviews_scoped_update
    INSTEAD OF UPDATE ON reflection_proposal_reviews
    BEGIN
      SELECT CASE WHEN NEW.proposal_id IS NOT OLD.proposal_id THEN RAISE(ABORT, 'reflection proposal identity is immutable') END;
      SELECT CASE WHEN NEW.artifact_id IS NOT OLD.artifact_id THEN RAISE(ABORT, 'reflection proposal identity is immutable') END;
      SELECT CASE WHEN NEW.item_id IS NOT OLD.item_id THEN RAISE(ABORT, 'reflection proposal identity is immutable') END;
      SELECT CASE WHEN NEW.proposal_index IS NOT OLD.proposal_index THEN RAISE(ABORT, 'reflection proposal identity is immutable') END;
      UPDATE learner_owned_reflection_proposal_reviews
      SET disposition = NEW.disposition, updated_at = NEW.updated_at, acceptance_mode = NEW.acceptance_mode, accepted_invocation_id = NEW.accepted_invocation_id, dismissal_reason = NEW.dismissal_reason, supersession_source = NEW.supersession_source, supersession_actor = NEW.supersession_actor, supersession_reason = NEW.supersession_reason, replacement_proposal_id = NEW.replacement_proposal_id, replacement_invocation_id = NEW.replacement_invocation_id, satisfying_effect_refs_json = NEW.satisfying_effect_refs_json
      WHERE learner_id = current_learner_id() AND proposal_id = OLD.proposal_id;
    END;

CREATE INDEX idx_reflection_proposal_reviews_open
      ON "learner_owned_reflection_proposal_reviews"(disposition, artifact_id);

CREATE UNIQUE INDEX idx_reflection_proposal_reviews_accepted_invocation
      ON "learner_owned_reflection_proposal_reviews"(accepted_invocation_id)
      WHERE accepted_invocation_id IS NOT NULL;

CREATE TRIGGER reflection_proposal_identity_immutable
    BEFORE UPDATE OF proposal_id, artifact_id, item_id, proposal_index
    ON "learner_owned_reflection_proposal_reviews"
    BEGIN
      SELECT RAISE(ABORT, 'reflection proposal identity is immutable');
    END;

CREATE TRIGGER learner_owned_reflection_proposal_reviews_artifact_id_same_owner_insert
    BEFORE INSERT ON learner_owned_reflection_proposal_reviews
    WHEN NEW.artifact_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM learner_owned_reflection_artifacts AS parent
    WHERE parent.artifact_id = NEW.artifact_id
      AND parent.learner_id = NEW.learner_id
  )
    BEGIN
      SELECT RAISE(ABORT, 'cross-learner private reference');
    END;

CREATE TRIGGER learner_owned_reflection_proposal_reviews_artifact_id_same_owner_update
    BEFORE UPDATE OF learner_id, artifact_id ON learner_owned_reflection_proposal_reviews
    WHEN NEW.artifact_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM learner_owned_reflection_artifacts AS parent
    WHERE parent.artifact_id = NEW.artifact_id
      AND parent.learner_id = NEW.learner_id
  )
    BEGIN
      SELECT RAISE(ABORT, 'cross-learner private reference');
    END;

CREATE TRIGGER learner_owned_reflection_proposal_reviews_accepted_invocation_id_same_owner_insert
    BEFORE INSERT ON learner_owned_reflection_proposal_reviews
    WHEN NEW.accepted_invocation_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM learner_owned_reflection_operation_invocations AS parent
    WHERE parent.invocation_id = NEW.accepted_invocation_id
      AND parent.learner_id = NEW.learner_id
  )
    BEGIN
      SELECT RAISE(ABORT, 'cross-learner private reference');
    END;

CREATE TRIGGER learner_owned_reflection_proposal_reviews_accepted_invocation_id_same_owner_update
    BEFORE UPDATE OF learner_id, accepted_invocation_id ON learner_owned_reflection_proposal_reviews
    WHEN NEW.accepted_invocation_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM learner_owned_reflection_operation_invocations AS parent
    WHERE parent.invocation_id = NEW.accepted_invocation_id
      AND parent.learner_id = NEW.learner_id
  )
    BEGIN
      SELECT RAISE(ABORT, 'cross-learner private reference');
    END;

CREATE TRIGGER learner_owned_reflection_proposal_reviews_replacement_proposal_id_same_owner_insert
    BEFORE INSERT ON learner_owned_reflection_proposal_reviews
    WHEN NEW.replacement_proposal_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM learner_owned_reflection_proposal_reviews AS parent
    WHERE parent.proposal_id = NEW.replacement_proposal_id
      AND parent.learner_id = NEW.learner_id
  )
    BEGIN
      SELECT RAISE(ABORT, 'cross-learner private reference');
    END;

CREATE TRIGGER learner_owned_reflection_proposal_reviews_replacement_proposal_id_same_owner_update
    BEFORE UPDATE OF learner_id, replacement_proposal_id ON learner_owned_reflection_proposal_reviews
    WHEN NEW.replacement_proposal_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM learner_owned_reflection_proposal_reviews AS parent
    WHERE parent.proposal_id = NEW.replacement_proposal_id
      AND parent.learner_id = NEW.learner_id
  )
    BEGIN
      SELECT RAISE(ABORT, 'cross-learner private reference');
    END;

CREATE TRIGGER learner_owned_reflection_proposal_reviews_replacement_invocation_id_same_owner_insert
    BEFORE INSERT ON learner_owned_reflection_proposal_reviews
    WHEN NEW.replacement_invocation_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM learner_owned_reflection_operation_invocations AS parent
    WHERE parent.invocation_id = NEW.replacement_invocation_id
      AND parent.learner_id = NEW.learner_id
  )
    BEGIN
      SELECT RAISE(ABORT, 'cross-learner private reference');
    END;

CREATE TRIGGER learner_owned_reflection_proposal_reviews_replacement_invocation_id_same_owner_update
    BEFORE UPDATE OF learner_id, replacement_invocation_id ON learner_owned_reflection_proposal_reviews
    WHEN NEW.replacement_invocation_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM learner_owned_reflection_operation_invocations AS parent
    WHERE parent.invocation_id = NEW.replacement_invocation_id
      AND parent.learner_id = NEW.learner_id
  )
    BEGIN
      SELECT RAISE(ABORT, 'cross-learner private reference');
    END;

CREATE TRIGGER learner_owned_reflection_operation_invocations_origin_proposal_id_same_owner_insert
    BEFORE INSERT ON learner_owned_reflection_operation_invocations
    WHEN NEW.origin_proposal_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM learner_owned_reflection_proposal_reviews AS parent
    WHERE parent.proposal_id = NEW.origin_proposal_id
      AND parent.learner_id = NEW.learner_id
  )
    BEGIN
      SELECT RAISE(ABORT, 'cross-learner private reference');
    END;

CREATE TRIGGER learner_owned_reflection_operation_invocations_origin_proposal_id_same_owner_update
    BEFORE UPDATE OF learner_id, origin_proposal_id ON learner_owned_reflection_operation_invocations
    WHEN NEW.origin_proposal_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM learner_owned_reflection_proposal_reviews AS parent
    WHERE parent.proposal_id = NEW.origin_proposal_id
      AND parent.learner_id = NEW.learner_id
  )
    BEGIN
      SELECT RAISE(ABORT, 'cross-learner private reference');
    END;

CREATE TRIGGER learner_owned_reflection_operation_invocations_origin_superseded_proposal_id_same_owner_insert
    BEFORE INSERT ON learner_owned_reflection_operation_invocations
    WHEN NEW.origin_superseded_proposal_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM learner_owned_reflection_proposal_reviews AS parent
    WHERE parent.proposal_id = NEW.origin_superseded_proposal_id
      AND parent.learner_id = NEW.learner_id
  )
    BEGIN
      SELECT RAISE(ABORT, 'cross-learner private reference');
    END;

CREATE TRIGGER learner_owned_reflection_operation_invocations_origin_superseded_proposal_id_same_owner_update
    BEFORE UPDATE OF learner_id, origin_superseded_proposal_id ON learner_owned_reflection_operation_invocations
    WHEN NEW.origin_superseded_proposal_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM learner_owned_reflection_proposal_reviews AS parent
    WHERE parent.proposal_id = NEW.origin_superseded_proposal_id
      AND parent.learner_id = NEW.learner_id
  )
    BEGIN
      SELECT RAISE(ABORT, 'cross-learner private reference');
    END;
