-- Membership is a best-effort readiness hint, never a content-version pin.
ALTER TABLE learner_word_preparation_reserve ADD COLUMN ready_at TEXT;
ALTER TABLE learner_word_preparation_reserve ADD COLUMN checked_at TEXT;
CREATE INDEX idx_word_reserve_checked ON learner_word_preparation_reserve(checked_at, learner_id);
INSERT INTO learner_word_reserve_requests(learner_id,requested_at)
SELECT DISTINCT learner_id,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM learner_word_preparation_reserve WHERE true
ON CONFLICT(learner_id) DO NOTHING;

-- Top is explicit admission, including when automatic daily intake is zero.
CREATE TRIGGER reserve_admit_top_insert
AFTER INSERT ON learner_owned_user_word_priority
WHEN NEW.priority_tier=1 AND EXISTS(SELECT 1 FROM learner_words w
  WHERE w.learner_id=NEW.learner_id AND w.word_id=NEW.word_id AND w.mode='unstudied' AND w.dismissed_at IS NULL)
  AND NOT EXISTS(SELECT 1 FROM vocabulary_word_catalogs c WHERE c.word_id=NEW.word_id AND c.senses_established_at IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM senses s WHERE s.word_id=c.word_id AND s.status='active'))
BEGIN
  INSERT OR IGNORE INTO learner_word_preparation_reserve(learner_id,word_id,added_at)
  VALUES(NEW.learner_id,NEW.word_id,NEW.updated_at);
  DELETE FROM learner_word_preparation_reserve WHERE learner_id=NEW.learner_id AND word_id NOT IN (
    SELECT r.word_id FROM learner_word_preparation_reserve r
    LEFT JOIN learner_owned_user_word_priority p ON p.learner_id=r.learner_id AND p.word_id=r.word_id
    WHERE r.learner_id=NEW.learner_id
    ORDER BY CASE WHEN p.priority_tier=1 THEN 0 ELSE 1 END,
      CASE WHEN p.priority_tier=1 THEN p.updated_at END DESC,r.added_at,r.word_id LIMIT 40
  );
END;

-- Top is explicit admission, including when automatic daily intake is zero.
CREATE TRIGGER reserve_admit_top_update
AFTER UPDATE ON learner_owned_user_word_priority
WHEN NEW.priority_tier=1 AND EXISTS(SELECT 1 FROM learner_words w
  WHERE w.learner_id=NEW.learner_id AND w.word_id=NEW.word_id AND w.mode='unstudied' AND w.dismissed_at IS NULL)
  AND NOT EXISTS(SELECT 1 FROM vocabulary_word_catalogs c WHERE c.word_id=NEW.word_id AND c.senses_established_at IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM senses s WHERE s.word_id=c.word_id AND s.status='active'))
BEGIN
  INSERT OR IGNORE INTO learner_word_preparation_reserve(learner_id,word_id,added_at)
  VALUES(NEW.learner_id,NEW.word_id,NEW.updated_at);
  DELETE FROM learner_word_preparation_reserve WHERE learner_id=NEW.learner_id AND word_id NOT IN (
    SELECT r.word_id FROM learner_word_preparation_reserve r
    LEFT JOIN learner_owned_user_word_priority p ON p.learner_id=r.learner_id AND p.word_id=r.word_id
    WHERE r.learner_id=NEW.learner_id
    ORDER BY CASE WHEN p.priority_tier=1 THEN 0 ELSE 1 END,
      CASE WHEN p.priority_tier=1 THEN p.updated_at END DESC,r.added_at,r.word_id LIMIT 40
  );
END;
