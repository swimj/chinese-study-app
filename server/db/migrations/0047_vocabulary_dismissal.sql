-- Explicit dismissal differs from an unfinished, non-stash diet enrollment.
-- Existing rows remain undismissed; no historical disposition is inferred.
ALTER TABLE learner_words ADD COLUMN dismissed_at TEXT;
CREATE INDEX idx_vocabulary_learner_dismissed ON learner_words(learner_id,dismissed_at,mode,in_stash);
