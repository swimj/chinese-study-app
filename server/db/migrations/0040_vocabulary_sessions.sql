-- Sessions retain observations immediately; learning effects apply only at closure.
CREATE TABLE vocabulary_sessions (
  session_id TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL REFERENCES learners(learner_id),
  protocol_version INTEGER NOT NULL CHECK (protocol_version = 1),
  context_json TEXT NOT NULL CHECK (json_valid(context_json)),
  started_at TEXT NOT NULL, closed_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('active','finalizing','closed')),
  UNIQUE(learner_id, session_id)
);
CREATE TABLE session_actions (
  action_id TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL, session_id TEXT NOT NULL,
  sequence_number INTEGER NOT NULL CHECK (sequence_number > 0),
  client_action_id TEXT NOT NULL, kind TEXT NOT NULL,
  action_json TEXT NOT NULL CHECK (json_valid(action_json)),
  encounter_id TEXT, word_id TEXT REFERENCES lexical_words(id),
  undoes_action_id TEXT REFERENCES session_actions(action_id),
  occurred_at TEXT NOT NULL, recorded_at TEXT NOT NULL,
  UNIQUE(session_id,sequence_number), UNIQUE(session_id,client_action_id),
  UNIQUE(learner_id,session_id,action_id),
  FOREIGN KEY(learner_id,session_id) REFERENCES vocabulary_sessions(learner_id,session_id)
);
CREATE INDEX idx_vocabulary_action_encounter ON session_actions(encounter_id,sequence_number) WHERE encounter_id IS NOT NULL;
CREATE TABLE exercise_encounters (
  encounter_id TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL, session_id TEXT NOT NULL,
  presented_action_id TEXT NOT NULL UNIQUE,
  content_id TEXT NOT NULL, content_version INTEGER NOT NULL,
  selected_through_word_id TEXT REFERENCES lexical_words(id),
  context_json TEXT NOT NULL CHECK(json_valid(context_json)),
  served_snapshot_json TEXT NOT NULL CHECK(json_valid(served_snapshot_json)),
  presented_at TEXT NOT NULL,
  UNIQUE(learner_id,session_id,encounter_id), UNIQUE(learner_id,encounter_id),
  FOREIGN KEY(learner_id,session_id,presented_action_id) REFERENCES session_actions(learner_id,session_id,action_id),
  FOREIGN KEY(content_id,content_version) REFERENCES content_revision_history(content_id,version)
);
CREATE TABLE encounter_words (
  learner_id TEXT NOT NULL, encounter_id TEXT NOT NULL,
  word_id TEXT NOT NULL REFERENCES lexical_words(id),
  role TEXT NOT NULL CHECK(role IN ('selected_through','target','context')),
  PRIMARY KEY(encounter_id,word_id,role),
  FOREIGN KEY(learner_id,encounter_id) REFERENCES exercise_encounters(learner_id,encounter_id)
);
CREATE INDEX idx_vocabulary_encounter_word ON encounter_words(learner_id,word_id,encounter_id);
CREATE TABLE learner_feedback (
  feedback_id TEXT PRIMARY KEY, learner_id TEXT NOT NULL,
  session_id TEXT NOT NULL, source_action_id TEXT NOT NULL UNIQUE,
  encounter_id TEXT NOT NULL, content_id TEXT NOT NULL,
  content_version INTEGER NOT NULL, word_id TEXT REFERENCES lexical_words(id),
  kind TEXT NOT NULL, payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), created_at TEXT NOT NULL,
  FOREIGN KEY(learner_id,session_id,source_action_id) REFERENCES session_actions(learner_id,session_id,action_id),
  FOREIGN KEY(learner_id,session_id,encounter_id) REFERENCES exercise_encounters(learner_id,session_id,encounter_id),
  FOREIGN KEY(content_id,content_version) REFERENCES content_revision_history(content_id,version)
);
CREATE TABLE vocabulary_session_completions (
  completion_id TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL, session_id TEXT NOT NULL,
  revision_number INTEGER NOT NULL CHECK(revision_number > 0),
  through_sequence INTEGER NOT NULL CHECK(through_sequence >= 0),
  staged_at TEXT NOT NULL, close_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','cancelled','closed','failed')),
  input_json TEXT NOT NULL CHECK(json_valid(input_json)), report_json TEXT NOT NULL CHECK(json_valid(report_json)),
  policy_version TEXT NOT NULL, closed_at TEXT, last_error TEXT,
  UNIQUE(session_id,revision_number), UNIQUE(learner_id,completion_id),
  FOREIGN KEY(learner_id,session_id) REFERENCES vocabulary_sessions(learner_id,session_id)
);
CREATE UNIQUE INDEX idx_vocabulary_one_pending_completion ON vocabulary_session_completions(learner_id) WHERE status IN ('pending','failed');
CREATE INDEX idx_vocabulary_completion_due ON vocabulary_session_completions(status,close_at);
CREATE TABLE learner_state_effects (
  effect_id TEXT PRIMARY KEY, learner_id TEXT NOT NULL REFERENCES learners(learner_id),
  word_id TEXT REFERENCES lexical_words(id), pure_cue_content_id TEXT REFERENCES content_items(content_id),
  completion_id TEXT, judgment_id TEXT, source_action_id TEXT REFERENCES session_actions(action_id),
  effect_key TEXT NOT NULL UNIQUE, kind TEXT NOT NULL,
  before_json TEXT NOT NULL CHECK(json_valid(before_json)), after_json TEXT NOT NULL CHECK(json_valid(after_json)), applied_at TEXT NOT NULL,
  FOREIGN KEY(learner_id,completion_id) REFERENCES vocabulary_session_completions(learner_id,completion_id)
);
CREATE INDEX idx_vocabulary_effect_word ON learner_state_effects(learner_id,word_id,applied_at);
CREATE TABLE teaching_completions (
  teaching_completion_id TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL REFERENCES learners(learner_id), word_id TEXT NOT NULL REFERENCES lexical_words(id),
  completion_id TEXT REFERENCES vocabulary_session_completions(completion_id),
  source_kind TEXT NOT NULL CHECK(source_kind IN ('session','legacy_import')), source_id TEXT NOT NULL,
  snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)), completed_at TEXT NOT NULL,
  UNIQUE(learner_id,source_kind,source_id),
  CHECK(source_kind = 'legacy_import' OR completion_id IS NOT NULL),
  FOREIGN KEY(learner_id,completion_id) REFERENCES vocabulary_session_completions(learner_id,completion_id)
);
CREATE TABLE vocabulary_post_session_dispatches (
  dispatch_id TEXT PRIMARY KEY, learner_id TEXT NOT NULL,
  session_id TEXT NOT NULL UNIQUE, completion_id TEXT NOT NULL UNIQUE,
  evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)),
  status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','failed')),
  created_at TEXT NOT NULL, active_token TEXT, expires_at TEXT, last_error TEXT, result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
  FOREIGN KEY(learner_id,session_id) REFERENCES vocabulary_sessions(learner_id,session_id),
  FOREIGN KEY(learner_id,completion_id) REFERENCES vocabulary_session_completions(learner_id,completion_id)
);
CREATE TRIGGER vocabulary_session_context_immutable BEFORE UPDATE OF session_id,learner_id,protocol_version,context_json,started_at ON vocabulary_sessions
BEGIN SELECT RAISE(ABORT,'session context is immutable'); END;
CREATE TRIGGER vocabulary_actions_immutable BEFORE UPDATE ON session_actions BEGIN SELECT RAISE(ABORT,'session actions are immutable'); END;
CREATE TRIGGER vocabulary_actions_retained BEFORE DELETE ON session_actions BEGIN SELECT RAISE(ABORT,'session actions are retained'); END;
CREATE TRIGGER vocabulary_encounter_immutable BEFORE UPDATE ON exercise_encounters BEGIN SELECT RAISE(ABORT,'encounters are immutable'); END;
CREATE TRIGGER vocabulary_feedback_immutable BEFORE UPDATE ON learner_feedback BEGIN SELECT RAISE(ABORT,'feedback is immutable'); END;
CREATE TRIGGER vocabulary_completion_input_immutable BEFORE UPDATE OF learner_id,session_id,revision_number,through_sequence,staged_at,close_at,input_json,policy_version ON vocabulary_session_completions
BEGIN SELECT RAISE(ABORT,'completion input is immutable'); END;
CREATE TRIGGER vocabulary_completion_terminal BEFORE UPDATE ON vocabulary_session_completions WHEN OLD.status IN ('closed','cancelled')
BEGIN SELECT RAISE(ABORT,'concluded completion is immutable'); END;
CREATE TRIGGER vocabulary_effect_immutable BEFORE UPDATE ON learner_state_effects BEGIN SELECT RAISE(ABORT,'learner effects are immutable'); END;
CREATE TRIGGER vocabulary_effect_retained BEFORE DELETE ON learner_state_effects BEGIN SELECT RAISE(ABORT,'learner effects are retained'); END;
CREATE TRIGGER vocabulary_teaching_completion_immutable BEFORE UPDATE ON teaching_completions BEGIN SELECT RAISE(ABORT,'teaching completion is immutable'); END;
CREATE TRIGGER vocabulary_dispatch_evidence_immutable BEFORE UPDATE OF learner_id,session_id,completion_id,evidence_json,created_at ON vocabulary_post_session_dispatches
BEGIN SELECT RAISE(ABORT,'post-session evidence is immutable'); END;
