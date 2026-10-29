-- Deliberate content cutover: word-owned cues accept exactly their owner.
-- Includes inactive and shared cues; historical attempt/artifact JSON is untouched.
DROP TRIGGER production_cue_accepted_words_no_delete;
DELETE FROM scoped_production_cue_accepted_words;
INSERT INTO scoped_production_cue_accepted_words (cue_id, word_id, position)
SELECT cue.cue_id, task.word_id, 0
FROM scoped_production_cues AS cue
JOIN production_tasks AS task ON task.task_id = cue.task_id;
CREATE TRIGGER production_cue_accepted_words_no_delete
BEFORE DELETE ON scoped_production_cue_accepted_words
BEGIN
  SELECT RAISE(ABORT, 'production cue accepted words cannot be deleted');
END;
CREATE TRIGGER production_cue_accepted_words_owner_only
BEFORE INSERT ON scoped_production_cue_accepted_words
WHEN NEW.position <> 0 OR NOT EXISTS (
  SELECT 1 FROM scoped_production_cues AS cue
  JOIN production_tasks AS task ON task.task_id = cue.task_id
  WHERE cue.cue_id = NEW.cue_id AND task.word_id = NEW.word_id
)
BEGIN
  SELECT RAISE(ABORT, 'word-owned cues must accept only their target word');
END;

-- These temporary 48-hour demands no longer participate in scheduling.
DROP VIEW production_recheck_demands;
DROP TABLE learner_owned_production_recheck_demands;
