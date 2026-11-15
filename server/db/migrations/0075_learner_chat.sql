-- Empty learner-private storage. No historical learner/content records are rewritten.
CREATE TABLE learner_chat_conversations (
  learner_id TEXT NOT NULL REFERENCES learners(learner_id),
  id TEXT NOT NULL,
  surface TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (learner_id, id),
  UNIQUE (learner_id, surface)
);
CREATE TABLE learner_chat_turns (
  learner_id TEXT NOT NULL,
  id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  client_turn_id TEXT NOT NULL,
  request_json TEXT NOT NULL CHECK(json_valid(request_json)),
  status TEXT NOT NULL CHECK(status IN ('running','completed','failed','cancelled')),
  created_at TEXT NOT NULL,
  finished_at TEXT,
  error_text TEXT,
  PRIMARY KEY (learner_id, id),
  UNIQUE (learner_id, conversation_id, client_turn_id),
  UNIQUE (learner_id, conversation_id, id),
  FOREIGN KEY (learner_id, conversation_id) REFERENCES learner_chat_conversations(learner_id, id)
);
CREATE TABLE learner_chat_events (
  learner_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK(sequence > 0),
  event_json TEXT NOT NULL CHECK(json_valid(event_json)),
  created_at TEXT NOT NULL,
  PRIMARY KEY (learner_id, turn_id, sequence),
  FOREIGN KEY (learner_id, turn_id) REFERENCES learner_chat_turns(learner_id, id)
);
CREATE TABLE learner_chat_cards (
  learner_id TEXT NOT NULL,
  id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  body_json TEXT NOT NULL CHECK(json_valid(body_json)),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (learner_id, id),
  FOREIGN KEY (learner_id, conversation_id, turn_id) REFERENCES learner_chat_turns(learner_id, conversation_id, id)
);
CREATE INDEX idx_learner_chat_cards_page ON learner_chat_cards(learner_id, conversation_id, created_at, id);
CREATE INDEX idx_learner_chat_turns_page ON learner_chat_turns(learner_id, conversation_id, created_at, id);
CREATE TABLE learner_chat_commands (
  learner_id TEXT NOT NULL,
  client_action_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  result_json TEXT NOT NULL CHECK(json_valid(result_json)),
  created_at TEXT NOT NULL,
  PRIMARY KEY (learner_id, client_action_id),
  FOREIGN KEY (learner_id, card_id) REFERENCES learner_chat_cards(learner_id, id)
);
CREATE TRIGGER learner_chat_events_immutable BEFORE UPDATE ON learner_chat_events
BEGIN SELECT RAISE(ABORT, 'Chat events are immutable'); END;
CREATE TRIGGER learner_chat_commands_immutable BEFORE UPDATE ON learner_chat_commands
BEGIN SELECT RAISE(ABORT, 'Chat command receipts are immutable'); END;
