-- Production mode and scheduling are independent. Legacy recognition remains intact.
CREATE TABLE learner_words (
  learner_id TEXT NOT NULL REFERENCES learners(learner_id),
  word_id TEXT NOT NULL REFERENCES lexical_words(id),
  in_stash INTEGER NOT NULL CHECK (in_stash IN (0, 1)),
  added_at TEXT NOT NULL,
  intended_use_text TEXT,
  mode TEXT NOT NULL CHECK (mode IN ('unstudied', 'solidify', 'practice', 'maintain')),
  mode_changed_at TEXT NOT NULL,
  state_version INTEGER NOT NULL DEFAULT 1 CHECK (state_version > 0),
  scope_established_at TEXT,
  PRIMARY KEY (learner_id, word_id)
);
CREATE INDEX idx_learner_words_stash ON learner_words(learner_id, in_stash, mode, added_at);
CREATE TABLE learner_senses (
  learner_id TEXT NOT NULL,
  word_id TEXT NOT NULL,
  sense_id TEXT NOT NULL,
  disposition TEXT NOT NULL CHECK (disposition IN ('active', 'excluded')),
  PRIMARY KEY (learner_id, sense_id),
  FOREIGN KEY (learner_id, word_id) REFERENCES learner_words(learner_id, word_id),
  FOREIGN KEY (sense_id, word_id) REFERENCES senses(sense_id, word_id)
);
CREATE INDEX idx_learner_senses_word ON learner_senses(learner_id, word_id, disposition);
CREATE TABLE learner_word_schedules (
  learner_id TEXT NOT NULL,
  word_id TEXT NOT NULL,
  next_eligible_at TEXT,
  last_practised_at TEXT,
  policy_version TEXT NOT NULL,
  scheduler_state_json TEXT NOT NULL CHECK (json_valid(scheduler_state_json)),
  state_version INTEGER NOT NULL DEFAULT 1 CHECK (state_version > 0),
  refresh_requested_at TEXT,
  refresh_until TEXT,
  PRIMARY KEY (learner_id, word_id),
  FOREIGN KEY (learner_id, word_id) REFERENCES learner_words(learner_id, word_id),
  CHECK ((refresh_requested_at IS NULL) = (refresh_until IS NULL))
);
CREATE INDEX idx_vocabulary_word_due ON learner_word_schedules(learner_id, next_eligible_at);
CREATE INDEX idx_vocabulary_word_refresh ON learner_word_schedules(learner_id, refresh_until)
  WHERE refresh_requested_at IS NOT NULL;
CREATE TABLE learner_pure_cue_schedules (
  learner_id TEXT NOT NULL REFERENCES learners(learner_id),
  content_id TEXT NOT NULL REFERENCES content_items(content_id),
  next_eligible_at TEXT,
  last_practised_at TEXT,
  policy_version TEXT NOT NULL,
  scheduler_state_json TEXT NOT NULL CHECK (json_valid(scheduler_state_json)),
  state_version INTEGER NOT NULL DEFAULT 1 CHECK (state_version > 0),
  PRIMARY KEY (learner_id, content_id)
);
CREATE INDEX idx_vocabulary_pure_cue_due ON learner_pure_cue_schedules(learner_id, next_eligible_at);
CREATE TRIGGER vocabulary_pure_cue_schedule_kind BEFORE INSERT ON learner_pure_cue_schedules
WHEN NOT EXISTS (SELECT 1 FROM content_items c WHERE c.content_id = NEW.content_id
  AND c.exercise_type = 'pure_cue' AND (c.access_scope = 'shared' OR c.owner_learner_id = NEW.learner_id))
BEGIN SELECT RAISE(ABORT, 'pure cue schedule requires accessible pure cue'); END;
CREATE TABLE learner_content_deactivations (
  learner_id TEXT NOT NULL REFERENCES learners(learner_id),
  content_id TEXT NOT NULL REFERENCES content_items(content_id),
  deactivated_at TEXT NOT NULL,
  PRIMARY KEY (learner_id, content_id)
);

-- Do not use the words view: its default rows would enroll the whole lexicon.
INSERT INTO learner_words (learner_id, word_id, in_stash, added_at, mode, mode_changed_at)
SELECT s.learner_id, s.word_id, CASE WHEN p.priority_tier >= 0 THEN 1 ELSE 0 END,
  COALESCE(p.updated_at, w.created_at),
  CASE s.status WHEN 'learning' THEN 'solidify' WHEN 'review' THEN 'practice' ELSE 'unstudied' END,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM learner_word_state s JOIN lexical_words w ON w.id = s.word_id
LEFT JOIN learner_owned_user_word_priority p ON p.learner_id = s.learner_id AND p.word_id = s.word_id;
INSERT OR IGNORE INTO learner_words (learner_id, word_id, in_stash, added_at, mode, mode_changed_at)
SELECT p.learner_id, p.word_id, 1, p.updated_at, 'unstudied', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM learner_owned_user_word_priority p WHERE p.priority_tier >= 0;
INSERT INTO learner_word_schedules (learner_id, word_id, next_eligible_at,
  last_practised_at, policy_version, scheduler_state_json)
SELECT w.learner_id, w.word_id,
  CASE WHEN w.mode = 'solidify' AND old.last_learning_covered_on IS NOT NULL
    THEN strftime('%Y-%m-%dT00:00:00.000Z', old.last_learning_covered_on, '+1 day')
    ELSE COALESCE(s.next_due_at, a.earliest_next_study_at) END,
  NULLIF(s.last_studied_at, ''), 'legacy-import-v1',
  json_object('intervalHours', COALESCE(s.interval_hours, 24),
    'easeFactor', COALESCE(s.ease_factor, 2.5), 'enabled', COALESCE(s.enabled, 1),
    'cleanCoveredSessions', COALESCE(old.learning_streak, 0),
    'legacyAdmissionAt', a.earliest_next_study_at)
FROM learner_words w
LEFT JOIN learner_owned_word_skill_state s ON s.learner_id = w.learner_id AND s.word_id = w.word_id AND s.skill_id = 'production'
LEFT JOIN learner_owned_word_study_admission_state a ON a.learner_id = w.learner_id AND a.word_id = w.word_id
LEFT JOIN learner_word_state old ON old.learner_id = w.learner_id AND old.word_id = w.word_id;
