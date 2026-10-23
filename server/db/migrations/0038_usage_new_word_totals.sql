-- Usage follows the completed session's UTC day, independently of admission.
-- NULL preserves unknown counts for historical sessions without outcome evidence.
ALTER TABLE learner_owned_review_session_summaries
  ADD COLUMN new_word_count INTEGER CHECK (new_word_count >= 0);

UPDATE learner_owned_review_session_summaries AS summaries SET new_word_count = COALESCE(
  (SELECT json_array_length(completions.report_json, '$.newWords')
   FROM learner_session_completions AS completions
   WHERE completions.learner_id = summaries.learner_id
     AND completions.session_id = summaries.session_id AND completions.status = 'closed'),
  (SELECT COUNT(*) FROM learner_session_word_outcomes AS outcomes
   WHERE outcomes.learner_id = summaries.learner_id AND outcomes.session_id = summaries.session_id
     AND outcomes.before_status = 'unstudied' AND outcomes.after_status = 'learning'
   HAVING EXISTS (SELECT 1 FROM learner_session_word_outcomes AS evidence
     WHERE evidence.learner_id = summaries.learner_id AND evidence.session_id = summaries.session_id))
);

DROP VIEW review_session_summaries;
CREATE VIEW review_session_summaries AS
SELECT session_id, completed_at, day_key, completed_count, failed_count,
  active_duration_ms, learning_completed_count, new_word_count
FROM learner_owned_review_session_summaries WHERE learner_id = current_learner_id();
CREATE TRIGGER review_session_summaries_scoped_insert INSTEAD OF INSERT ON review_session_summaries
BEGIN
  INSERT INTO learner_owned_review_session_summaries
    (learner_id, session_id, completed_at, day_key, completed_count, failed_count,
      active_duration_ms, learning_completed_count, new_word_count)
  VALUES (current_learner_id(), NEW.session_id, NEW.completed_at, NEW.day_key,
    NEW.completed_count, NEW.failed_count, COALESCE(NEW.active_duration_ms, 0),
    NEW.learning_completed_count, NEW.new_word_count);
END;
CREATE TRIGGER review_session_summaries_scoped_update INSTEAD OF UPDATE ON review_session_summaries
BEGIN
  UPDATE learner_owned_review_session_summaries SET session_id = NEW.session_id,
    completed_at = NEW.completed_at, day_key = NEW.day_key, completed_count = NEW.completed_count,
    failed_count = NEW.failed_count, active_duration_ms = NEW.active_duration_ms,
    learning_completed_count = NEW.learning_completed_count, new_word_count = NEW.new_word_count
  WHERE learner_id = current_learner_id() AND session_id = OLD.session_id;
END;
CREATE TRIGGER review_session_summaries_scoped_delete INSTEAD OF DELETE ON review_session_summaries
BEGIN
  DELETE FROM learner_owned_review_session_summaries
  WHERE learner_id = current_learner_id() AND session_id = OLD.session_id;
END;

-- Correct previously captured intake-day totals once, without changing other metrics.
UPDATE usage_daily_snapshots SET new_words = (
  SELECT COALESCE(SUM(new_word_count), 0) FROM learner_owned_review_session_summaries
  WHERE day_key = usage_daily_snapshots.day_key
);
