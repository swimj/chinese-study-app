-- Scheduling facts that review reads filter or order on become real columns,
-- moved out of scheduler_state_json so they have one home. Each word schedule
-- and skill state gains a due time: every time condition on a review objective is a "timestamp has
-- passed" test and they are all ANDed, so the latest of the stored due date,
-- last study plus interval, and any post-compensation check is exact. Triggers
-- keep the due times current from the row's own columns, so no writer computes
-- them. Covering indexes make each queue's first read one sequential index range.
-- (SQLite never treats an index as covering on a table with generated columns,
-- which is why these are triggers rather than generated columns.)

-- Production schedules ------------------------------------------------------
ALTER TABLE learner_word_schedules ADD COLUMN interval_hours REAL;
ALTER TABLE learner_word_schedules ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1));
ALTER TABLE learner_word_schedules ADD COLUMN reset_until TEXT;
ALTER TABLE learner_word_schedules ADD COLUMN post_compensation_check_at TEXT;
-- A schedule without study history is due once its stored dates pass. It sorts
-- with the due rows; the learner_words join drops unstudied words.
ALTER TABLE learner_word_schedules ADD COLUMN review_due_at TEXT;

UPDATE learner_word_schedules SET
  interval_hours = json_extract(scheduler_state_json, '$.intervalHours'),
  enabled = COALESCE(json_extract(scheduler_state_json, '$.enabled'), 1),
  reset_until = json_extract(scheduler_state_json, '$.resetUntil'),
  post_compensation_check_at = json_extract(scheduler_state_json, '$.postCompensationEarliestCheckAt'),
  scheduler_state_json = json_remove(scheduler_state_json, '$.intervalHours', '$.enabled', '$.resetUntil', '$.postCompensationEarliestCheckAt');
UPDATE learner_word_schedules SET review_due_at = max(
  COALESCE(next_eligible_at, ''),
  CASE WHEN last_practised_at IS NULL THEN '' ELSE strftime('%Y-%m-%dT%H:%M:%fZ', last_practised_at, '+' || interval_hours || ' hours') END,
  COALESCE(post_compensation_check_at, ''));

CREATE TRIGGER learner_word_schedules_columns_guard BEFORE INSERT ON learner_word_schedules
WHEN json_type(NEW.scheduler_state_json, '$.intervalHours') IS NOT NULL OR json_type(NEW.scheduler_state_json, '$.enabled') IS NOT NULL
  OR json_type(NEW.scheduler_state_json, '$.resetUntil') IS NOT NULL OR json_type(NEW.scheduler_state_json, '$.postCompensationEarliestCheckAt') IS NOT NULL
  OR NEW.interval_hours IS NULL OR NEW.interval_hours <= 0
BEGIN SELECT RAISE(ABORT, 'learner_word_schedules: scheduling facts belong in their columns'); END;
CREATE TRIGGER learner_word_schedules_columns_update_guard BEFORE UPDATE ON learner_word_schedules
WHEN json_type(NEW.scheduler_state_json, '$.intervalHours') IS NOT NULL OR json_type(NEW.scheduler_state_json, '$.enabled') IS NOT NULL
  OR json_type(NEW.scheduler_state_json, '$.resetUntil') IS NOT NULL OR json_type(NEW.scheduler_state_json, '$.postCompensationEarliestCheckAt') IS NOT NULL
  OR NEW.interval_hours IS NULL OR NEW.interval_hours <= 0
BEGIN SELECT RAISE(ABORT, 'learner_word_schedules: scheduling facts belong in their columns'); END;
CREATE TRIGGER learner_word_schedules_due_insert AFTER INSERT ON learner_word_schedules
BEGIN UPDATE learner_word_schedules SET review_due_at = max(COALESCE(NEW.next_eligible_at, ''),
  CASE WHEN NEW.last_practised_at IS NULL THEN '' ELSE strftime('%Y-%m-%dT%H:%M:%fZ', NEW.last_practised_at, '+' || NEW.interval_hours || ' hours') END,
  COALESCE(NEW.post_compensation_check_at, '')) WHERE rowid = NEW.rowid; END;
CREATE TRIGGER learner_word_schedules_due_update AFTER UPDATE OF next_eligible_at, last_practised_at, interval_hours, post_compensation_check_at ON learner_word_schedules
BEGIN UPDATE learner_word_schedules SET review_due_at = max(COALESCE(NEW.next_eligible_at, ''),
  CASE WHEN NEW.last_practised_at IS NULL THEN '' ELSE strftime('%Y-%m-%dT%H:%M:%fZ', NEW.last_practised_at, '+' || NEW.interval_hours || ' hours') END,
  COALESCE(NEW.post_compensation_check_at, '')) WHERE rowid = NEW.rowid; END;
CREATE INDEX idx_learner_word_schedules_review_due ON learner_word_schedules(
  learner_id, review_due_at, word_id, enabled, interval_hours, last_practised_at, next_eligible_at, post_compensation_check_at);

-- Recognition and contextual-selection states already keep real columns ------
ALTER TABLE learner_owned_word_skill_state ADD COLUMN review_due_at TEXT;
UPDATE learner_owned_word_skill_state SET review_due_at = max(COALESCE(next_due_at, ''),
  CASE WHEN last_studied_at IS NULL THEN '' ELSE strftime('%Y-%m-%dT%H:%M:%fZ', last_studied_at, '+' || interval_hours || ' hours') END);
CREATE TRIGGER learner_owned_word_skill_state_due_insert AFTER INSERT ON learner_owned_word_skill_state
BEGIN UPDATE learner_owned_word_skill_state SET review_due_at = max(COALESCE(NEW.next_due_at, ''),
  CASE WHEN NEW.last_studied_at IS NULL THEN '' ELSE strftime('%Y-%m-%dT%H:%M:%fZ', NEW.last_studied_at, '+' || NEW.interval_hours || ' hours') END)
  WHERE rowid = NEW.rowid; END;
CREATE TRIGGER learner_owned_word_skill_state_due_update AFTER UPDATE OF next_due_at, last_studied_at, interval_hours ON learner_owned_word_skill_state
BEGIN UPDATE learner_owned_word_skill_state SET review_due_at = max(COALESCE(NEW.next_due_at, ''),
  CASE WHEN NEW.last_studied_at IS NULL THEN '' ELSE strftime('%Y-%m-%dT%H:%M:%fZ', NEW.last_studied_at, '+' || NEW.interval_hours || ' hours') END)
  WHERE rowid = NEW.rowid; END;
CREATE INDEX idx_word_skill_state_review_due ON learner_owned_word_skill_state(
  learner_id, review_due_at, skill_id, word_id, enabled, interval_hours, last_studied_at, next_due_at);

-- Pure-cue schedules ----------------------------------------------------------
ALTER TABLE learner_pure_cue_schedules ADD COLUMN interval_hours REAL;
ALTER TABLE learner_pure_cue_schedules ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1));
ALTER TABLE learner_pure_cue_schedules ADD COLUMN reset_until TEXT;
ALTER TABLE learner_pure_cue_schedules ADD COLUMN strong_since TEXT;
ALTER TABLE learner_pure_cue_schedules ADD COLUMN strong_successes INTEGER NOT NULL DEFAULT 0 CHECK (strong_successes >= 0);
ALTER TABLE learner_pure_cue_schedules ADD COLUMN maintenance_identity TEXT;
ALTER TABLE learner_pure_cue_schedules ADD COLUMN recheck_at TEXT;

UPDATE learner_pure_cue_schedules SET
  interval_hours = json_extract(scheduler_state_json, '$.intervalHours'),
  enabled = COALESCE(json_extract(scheduler_state_json, '$.enabled'), 1),
  reset_until = json_extract(scheduler_state_json, '$.resetUntil'),
  strong_since = json_extract(scheduler_state_json, '$.strongSince'),
  strong_successes = COALESCE(json_extract(scheduler_state_json, '$.strongSuccesses'), 0),
  maintenance_identity = json_extract(scheduler_state_json, '$.maintenanceIdentity'),
  recheck_at = json_extract(scheduler_state_json, '$.postCompensationRecheckAt'),
  scheduler_state_json = json_remove(scheduler_state_json, '$.intervalHours', '$.enabled', '$.resetUntil', '$.strongSince',
    '$.strongSuccesses', '$.maintenanceIdentity', '$.postCompensationRecheckAt');

CREATE TRIGGER learner_pure_cue_schedules_columns_guard BEFORE INSERT ON learner_pure_cue_schedules
WHEN json_type(NEW.scheduler_state_json, '$.intervalHours') IS NOT NULL OR json_type(NEW.scheduler_state_json, '$.enabled') IS NOT NULL
  OR json_type(NEW.scheduler_state_json, '$.resetUntil') IS NOT NULL OR json_type(NEW.scheduler_state_json, '$.strongSince') IS NOT NULL
  OR json_type(NEW.scheduler_state_json, '$.strongSuccesses') IS NOT NULL OR json_type(NEW.scheduler_state_json, '$.maintenanceIdentity') IS NOT NULL
  OR json_type(NEW.scheduler_state_json, '$.postCompensationRecheckAt') IS NOT NULL OR NEW.interval_hours IS NULL OR NEW.interval_hours <= 0
BEGIN SELECT RAISE(ABORT, 'learner_pure_cue_schedules: scheduling facts belong in their columns'); END;
CREATE TRIGGER learner_pure_cue_schedules_columns_update_guard BEFORE UPDATE ON learner_pure_cue_schedules
WHEN json_type(NEW.scheduler_state_json, '$.intervalHours') IS NOT NULL OR json_type(NEW.scheduler_state_json, '$.enabled') IS NOT NULL
  OR json_type(NEW.scheduler_state_json, '$.resetUntil') IS NOT NULL OR json_type(NEW.scheduler_state_json, '$.strongSince') IS NOT NULL
  OR json_type(NEW.scheduler_state_json, '$.strongSuccesses') IS NOT NULL OR json_type(NEW.scheduler_state_json, '$.maintenanceIdentity') IS NOT NULL
  OR json_type(NEW.scheduler_state_json, '$.postCompensationRecheckAt') IS NOT NULL OR NEW.interval_hours IS NULL OR NEW.interval_hours <= 0
BEGIN SELECT RAISE(ABORT, 'learner_pure_cue_schedules: scheduling facts belong in their columns'); END;
-- Cue sets are small, so the first read loads every enabled cue for the learner
-- from one covering index and roles are decided in code; no cue due time is stored.
CREATE INDEX idx_learner_pure_cue_schedules_selection ON learner_pure_cue_schedules(
  learner_id, enabled, content_id, next_eligible_at, last_practised_at, strong_since, strong_successes,
  maintenance_identity, reset_until, recheck_at, interval_hours);
