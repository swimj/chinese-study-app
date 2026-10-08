-- Unknown historical learning counts remain NULL, including old-client summaries.
ALTER TABLE learner_owned_review_session_summaries
  ADD COLUMN learning_completed_count INTEGER CHECK (learning_completed_count >= 0);

DROP VIEW review_session_summaries;
CREATE VIEW review_session_summaries AS
SELECT session_id, completed_at, day_key, completed_count, failed_count,
  active_duration_ms, learning_completed_count
FROM learner_owned_review_session_summaries WHERE learner_id = current_learner_id();
CREATE TRIGGER review_session_summaries_scoped_insert INSTEAD OF INSERT ON review_session_summaries
BEGIN
  INSERT INTO learner_owned_review_session_summaries
    (learner_id, session_id, completed_at, day_key, completed_count, failed_count, active_duration_ms, learning_completed_count)
  VALUES (current_learner_id(), NEW.session_id, NEW.completed_at, NEW.day_key,
    NEW.completed_count, NEW.failed_count, COALESCE(NEW.active_duration_ms, 0), NEW.learning_completed_count);
END;
CREATE TRIGGER review_session_summaries_scoped_update INSTEAD OF UPDATE ON review_session_summaries
BEGIN
  UPDATE learner_owned_review_session_summaries SET session_id = NEW.session_id,
    completed_at = NEW.completed_at, day_key = NEW.day_key, completed_count = NEW.completed_count,
    failed_count = NEW.failed_count, active_duration_ms = NEW.active_duration_ms,
    learning_completed_count = NEW.learning_completed_count
  WHERE learner_id = current_learner_id() AND session_id = OLD.session_id;
END;
CREATE TRIGGER review_session_summaries_scoped_delete INSTEAD OF DELETE ON review_session_summaries
BEGIN
  DELETE FROM learner_owned_review_session_summaries
  WHERE learner_id = current_learner_id() AND session_id = OLD.session_id;
END;

CREATE INDEX idx_usage_proposal_acceptance_time
ON learner_owned_reflection_operation_invocations(created_at)
WHERE origin_kind = 'proposal_acceptance';

-- Retain legacy snapshot fields as historical records; new reads use the added fields.
ALTER TABLE usage_daily_snapshots ADD COLUMN practice_completed INTEGER CHECK (practice_completed >= 0);
ALTER TABLE usage_daily_snapshots ADD COLUMN review_correct INTEGER NOT NULL DEFAULT 0 CHECK (review_correct >= 0);
ALTER TABLE usage_daily_snapshots ADD COLUMN review_wrong INTEGER NOT NULL DEFAULT 0 CHECK (review_wrong >= 0);
ALTER TABLE usage_daily_snapshots ADD COLUMN proposals_accepted INTEGER NOT NULL DEFAULT 0 CHECK (proposals_accepted >= 0);
ALTER TABLE usage_daily_snapshots ADD COLUMN mean_stash_size REAL CHECK (mean_stash_size >= 0);
ALTER TABLE usage_daily_snapshots ADD COLUMN session_active_ms INTEGER NOT NULL DEFAULT 0 CHECK (session_active_ms >= 0);

-- Reaggregate durable completed exercises and acceptance events, without inferring practice or stash.
UPDATE usage_daily_snapshots SET
  review_correct = (SELECT COALESCE(SUM(completed_count - failed_count), 0)
    FROM learner_owned_review_session_summaries WHERE day_key = usage_daily_snapshots.day_key),
  review_wrong = (SELECT COALESCE(SUM(failed_count), 0)
    FROM learner_owned_review_session_summaries WHERE day_key = usage_daily_snapshots.day_key),
  session_active_ms = (SELECT COALESCE(SUM(active_duration_ms), 0)
    FROM learner_owned_review_session_summaries WHERE day_key = usage_daily_snapshots.day_key),
  proposals_accepted = (SELECT COUNT(*) FROM learner_owned_reflection_operation_invocations
    WHERE origin_kind = 'proposal_acceptance'
      AND created_at >= usage_daily_snapshots.day_key || 'T00:00:00.000Z'
      AND created_at < strftime('%Y-%m-%d', usage_daily_snapshots.day_key, '+1 day') || 'T00:00:00.000Z');
