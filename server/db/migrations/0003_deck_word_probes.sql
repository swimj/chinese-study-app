CREATE INDEX idx_lexical_words_hanzi ON lexical_words(hanzi);
CREATE INDEX idx_study_attempts_word_date
  ON learner_owned_study_attempt_events(learner_id, target_word_id, occurred_at DESC)
  WHERE projected_at IS NOT NULL;
