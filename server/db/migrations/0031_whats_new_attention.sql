-- Exposure clocks begin only after a visible navigation badge is acknowledged.
-- Legacy cursors remain available and are interpreted when reading attention.
CREATE TABLE learner_whats_new_attention (
  learner_id TEXT NOT NULL REFERENCES learners(learner_id) ON DELETE CASCADE,
  post_id TEXT NOT NULL REFERENCES whats_new_posts(post_id),
  first_badge_seen_at TEXT,
  read_at TEXT,
  PRIMARY KEY (learner_id, post_id),
  CHECK (first_badge_seen_at IS NOT NULL OR read_at IS NOT NULL)
);
