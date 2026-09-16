-- Singleton current operator-posted service banner (planned downtime, etc.).
CREATE TABLE service_banner (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  message TEXT NOT NULL CHECK (length(trim(message)) > 0 AND length(message) <= 280),
  posted_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  actor_id TEXT NOT NULL CHECK (length(trim(actor_id)) > 0),
  CHECK (expires_at > posted_at)
);
