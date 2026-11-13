-- Learner reactions to app-written connections and feedback lessons.
-- One current reaction per subject; clearing deletes the row. The append-only
-- event table keeps every change, including clears, for later analysis.
CREATE TABLE learner_content_reactions (
  learner_id TEXT NOT NULL REFERENCES learners(learner_id),
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('connection', 'lesson')),
  session_id TEXT,
  note_index INTEGER CHECK (note_index >= 0),
  message_id TEXT REFERENCES learner_messages(message_id),
  reaction TEXT NOT NULL CHECK (reaction IN ('saved', 'not_for_me')),
  reasons_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(reasons_json) AND json_type(reasons_json) = 'array'),
  personal_note TEXT CHECK (personal_note IS NULL OR (length(trim(personal_note)) > 0 AND length(personal_note) <= 1000)),
  surface TEXT NOT NULL CHECK (surface IN ('home', 'feedback', 'saved')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((subject_kind = 'connection' AND session_id IS NOT NULL AND note_index IS NOT NULL AND message_id IS NULL)
    OR (subject_kind = 'lesson' AND message_id IS NOT NULL AND session_id IS NULL AND note_index IS NULL)),
  CHECK (reaction = 'not_for_me' OR reasons_json = '[]'),
  FOREIGN KEY (learner_id, session_id) REFERENCES learner_session_debrief_jobs(learner_id, session_id)
);
CREATE UNIQUE INDEX idx_learner_connection_reactions
  ON learner_content_reactions(learner_id, session_id, note_index) WHERE subject_kind = 'connection';
CREATE UNIQUE INDEX idx_learner_lesson_reactions
  ON learner_content_reactions(learner_id, message_id) WHERE subject_kind = 'lesson';

CREATE TABLE learner_content_reaction_events (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  learner_id TEXT NOT NULL REFERENCES learners(learner_id),
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('connection', 'lesson')),
  session_id TEXT,
  note_index INTEGER CHECK (note_index >= 0),
  message_id TEXT REFERENCES learner_messages(message_id),
  reaction TEXT CHECK (reaction IS NULL OR reaction IN ('saved', 'not_for_me')),
  reasons_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(reasons_json) AND json_type(reasons_json) = 'array'),
  surface TEXT NOT NULL CHECK (surface IN ('home', 'feedback', 'saved')),
  occurred_at TEXT NOT NULL,
  CHECK ((subject_kind = 'connection' AND session_id IS NOT NULL AND note_index IS NOT NULL AND message_id IS NULL)
    OR (subject_kind = 'lesson' AND message_id IS NOT NULL AND session_id IS NULL AND note_index IS NULL)),
  FOREIGN KEY (learner_id, session_id) REFERENCES learner_session_debrief_jobs(learner_id, session_id)
);
CREATE INDEX idx_learner_content_reaction_events ON learner_content_reaction_events(occurred_at);
CREATE TRIGGER learner_content_reaction_events_append_only BEFORE UPDATE ON learner_content_reaction_events
BEGIN SELECT RAISE(ABORT, 'reaction events are append-only'); END;
