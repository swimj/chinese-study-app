-- Forward-only rough analytics: existing restorations are deliberately not backfilled.
CREATE TABLE learner_exercise_compensation_days (
  learner_id TEXT NOT NULL REFERENCES learners(learner_id) ON DELETE CASCADE,
  day_key TEXT NOT NULL,
  compensated_count INTEGER NOT NULL CHECK (compensated_count >= 0),
  PRIMARY KEY (learner_id, day_key)
);
