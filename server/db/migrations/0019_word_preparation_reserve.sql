-- Reserve membership is bounded by application policy; content remains shared.
CREATE TABLE learner_word_preparation_reserve (
  learner_id TEXT NOT NULL REFERENCES learners(learner_id) ON DELETE CASCADE,
  word_id TEXT NOT NULL REFERENCES lexical_words(id) ON DELETE CASCADE,
  added_at TEXT NOT NULL,
  PRIMARY KEY (learner_id, word_id)
);
CREATE TABLE learner_word_reserve_requests (
  learner_id TEXT NOT NULL PRIMARY KEY REFERENCES learners(learner_id) ON DELETE CASCADE,
  requested_at TEXT NOT NULL
);
-- Existing larger settings become valid before the new strict validator runs.
UPDATE learner_settings SET value_json = '20'
WHERE setting_key = 'daily_new_word_limit' AND json_valid(value_json)
  AND json_type(value_json) IN ('integer', 'real') AND CAST(value_json AS REAL) > 20;
-- A dormant account does not acquire new work merely because the app upgraded.

CREATE TRIGGER reserve_request_learner_settings_insert
AFTER INSERT ON learner_settings
WHEN NEW.setting_key IN ('daily_new_word_limit', 'unstudied_admission_source', 'stash_diet_split', 'diet_profile')
BEGIN
  INSERT INTO learner_word_reserve_requests (learner_id, requested_at)
  VALUES (NEW.learner_id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT(learner_id) DO UPDATE SET requested_at = excluded.requested_at;
END;

CREATE TRIGGER reserve_request_learner_owned_user_word_priority_insert
AFTER INSERT ON learner_owned_user_word_priority
WHEN 1
BEGIN
  INSERT INTO learner_word_reserve_requests (learner_id, requested_at)
  VALUES (NEW.learner_id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT(learner_id) DO UPDATE SET requested_at = excluded.requested_at;
END;

CREATE TRIGGER reserve_request_learner_settings_update
AFTER UPDATE ON learner_settings
WHEN NEW.setting_key IN ('daily_new_word_limit', 'unstudied_admission_source', 'stash_diet_split', 'diet_profile')
BEGIN
  INSERT INTO learner_word_reserve_requests (learner_id, requested_at)
  VALUES (NEW.learner_id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT(learner_id) DO UPDATE SET requested_at = excluded.requested_at;
END;

CREATE TRIGGER reserve_request_learner_owned_user_word_priority_update
AFTER UPDATE ON learner_owned_user_word_priority
WHEN 1
BEGIN
  INSERT INTO learner_word_reserve_requests (learner_id, requested_at)
  VALUES (NEW.learner_id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT(learner_id) DO UPDATE SET requested_at = excluded.requested_at;
END;

CREATE TRIGGER reserve_request_learner_settings_delete
AFTER DELETE ON learner_settings
WHEN OLD.setting_key IN ('daily_new_word_limit', 'unstudied_admission_source', 'stash_diet_split', 'diet_profile')
  AND EXISTS (SELECT 1 FROM learners WHERE learner_id = OLD.learner_id)
BEGIN
  INSERT INTO learner_word_reserve_requests (learner_id, requested_at)
  VALUES (OLD.learner_id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT(learner_id) DO UPDATE SET requested_at = excluded.requested_at;
END;

CREATE TRIGGER reserve_request_learner_owned_user_word_priority_delete
AFTER DELETE ON learner_owned_user_word_priority
WHEN EXISTS (SELECT 1 FROM learners WHERE learner_id = OLD.learner_id)
BEGIN
  INSERT INTO learner_word_reserve_requests (learner_id, requested_at)
  VALUES (OLD.learner_id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT(learner_id) DO UPDATE SET requested_at = excluded.requested_at;
END;
