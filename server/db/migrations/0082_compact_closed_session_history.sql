-- Only this explicitly abandoned November 1 session may be discarded. Its
-- immutable audit events survive. Any unexpected dependent FK rolls back the batch.
CREATE TEMP TABLE abandoned_session_to_remove(session_id TEXT PRIMARY KEY);
INSERT INTO abandoned_session_to_remove
SELECT s.session_id FROM vocabulary_sessions s
WHERE s.session_id='b9aa613b-7c80-47be-91f6-45d0af5b45d5' AND s.status='closed'
  AND s.started_at='2026-11-01T00:58:05.231Z' AND s.closed_at='2026-11-07T15:43:39.300Z'
  AND NOT EXISTS (SELECT 1 FROM vocabulary_session_completions c WHERE c.session_id=s.session_id)
  AND EXISTS (SELECT 1 FROM backend_events e WHERE e.session_id=s.session_id
              AND e.name='vocabulary.session.abandoned' AND e.actor_kind='operator'
              AND e.occurred_at=s.closed_at);

CREATE TEMP TABLE closed_history_check (
  verified INTEGER NOT NULL CONSTRAINT closed_session_requires_one_closed_completion CHECK (verified=1)
);
INSERT INTO closed_history_check
SELECT 0 FROM vocabulary_sessions s WHERE s.status='closed'
  AND s.session_id NOT IN (SELECT session_id FROM abandoned_session_to_remove)
  AND ((SELECT COUNT(*) FROM vocabulary_session_completions c
        WHERE c.session_id=s.session_id AND c.learner_id=s.learner_id AND c.status='closed') != 1
       OR (SELECT c.status FROM vocabulary_session_completions c
           WHERE c.session_id=s.session_id AND c.learner_id=s.learner_id
           ORDER BY c.revision_number DESC LIMIT 1) IS NOT 'closed'
       OR s.session_id NOT IN (SELECT session_id FROM closed_session_histories))
LIMIT 1;
DROP TABLE closed_history_check;

DELETE FROM encounter_words WHERE encounter_id IN (
  SELECT encounter_id FROM exercise_encounters WHERE session_id IN (SELECT session_id FROM abandoned_session_to_remove)
);
DELETE FROM exercise_encounters WHERE session_id IN (SELECT session_id FROM abandoned_session_to_remove);
DROP TRIGGER vocabulary_actions_retained;
DELETE FROM session_actions WHERE session_id IN (SELECT session_id FROM abandoned_session_to_remove);
CREATE TRIGGER vocabulary_actions_retained BEFORE DELETE ON session_actions BEGIN SELECT RAISE(ABORT,'session actions are retained'); END;
DELETE FROM vocabulary_sessions WHERE session_id IN (SELECT session_id FROM abandoned_session_to_remove);
DROP TABLE abandoned_session_to_remove;

DROP TRIGGER vocabulary_session_context_immutable;
UPDATE vocabulary_sessions AS s SET context_json=h.context_json
FROM closed_session_histories h WHERE h.session_id=s.session_id;
DROP TABLE closed_session_histories;
