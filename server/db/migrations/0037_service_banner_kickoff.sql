-- Existing authored messages retain their text; their kickoff cannot be inferred.
ALTER TABLE service_banner ADD COLUMN kickoff_at TEXT;
