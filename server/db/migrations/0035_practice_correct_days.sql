CREATE TABLE learner_practice_correct_days (
  learner_id TEXT NOT NULL REFERENCES learners(learner_id) ON DELETE CASCADE,
  word_id TEXT NOT NULL REFERENCES lexical_words(id),
  day_key TEXT NOT NULL,
  PRIMARY KEY (learner_id, word_id, day_key)
);
CREATE INDEX idx_practice_correct_days_day ON learner_practice_correct_days(day_key);

-- Latest successes recover the rollout day's gains. Earlier dates are partial:
-- overwritten or reset word state cannot reconstruct a complete history.
INSERT INTO learner_practice_correct_days (learner_id, word_id, day_key)
SELECT learner_id, word_id, last_learning_success_on FROM learner_word_state
WHERE last_learning_success_on IS NOT NULL;

-- Encounter totals from 0034 do not measure correct-day gains.
UPDATE usage_daily_snapshots SET practice_completed = NULL;
