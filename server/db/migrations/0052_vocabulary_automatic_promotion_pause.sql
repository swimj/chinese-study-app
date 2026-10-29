-- Preserve ordinary automatic graduation for existing learner words. An explicit
-- future Solidify choice records the durable preference to keep solidifying.
ALTER TABLE learner_words ADD COLUMN automatic_promotion_paused INTEGER NOT NULL DEFAULT 0
  CHECK (automatic_promotion_paused IN (0, 1));
