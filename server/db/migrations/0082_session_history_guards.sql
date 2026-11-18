DROP TRIGGER IF EXISTS vocabulary_session_context_immutable;
CREATE TRIGGER vocabulary_session_identity_immutable
BEFORE UPDATE OF session_id,learner_id,protocol_version,started_at ON vocabulary_sessions
BEGIN SELECT RAISE(ABORT,'session identity is immutable'); END;

CREATE TRIGGER vocabulary_session_context_immutable BEFORE UPDATE OF context_json ON vocabulary_sessions
WHEN OLD.status!='finalizing' OR NEW.status!='closed'
BEGIN SELECT RAISE(ABORT,'session context is immutable outside final closure'); END;

CREATE TRIGGER vocabulary_session_closed_history_insert BEFORE INSERT ON vocabulary_sessions
WHEN (NEW.status='closed' AND (json_extract(NEW.context_json,'$.closedHistory.version') IS NOT 1
                               OR json_type(NEW.context_json,'$.payload') IS NOT NULL))
  OR (NEW.status!='closed' AND json_type(NEW.context_json,'$.closedHistory') IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'session context does not match its status'); END;

CREATE TRIGGER vocabulary_session_final_closure BEFORE UPDATE OF status ON vocabulary_sessions
WHEN (OLD.status='closed' AND NEW.status!='closed')
  OR (NEW.status='closed' AND (OLD.status!='finalizing'
      OR json_extract(NEW.context_json,'$.closedHistory.version') IS NOT 1
      OR json_type(NEW.context_json,'$.payload') IS NOT NULL
      OR (SELECT c.status FROM vocabulary_session_completions c
          WHERE c.session_id=NEW.session_id AND c.learner_id=NEW.learner_id
          ORDER BY c.revision_number DESC LIMIT 1) IS NOT 'closed'))
BEGIN SELECT RAISE(ABORT,'closing session requires compact history and its closed completion'); END;
