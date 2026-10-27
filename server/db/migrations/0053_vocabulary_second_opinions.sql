-- Each opinion owns a normal leased reflection job and an immutable proposal snapshot.
ALTER TABLE vocabulary_reflection_jobs ADD COLUMN second_opinion_json TEXT
  CHECK (second_opinion_json IS NULL OR json_valid(second_opinion_json));
CREATE TABLE vocabulary_second_opinions (
  request_id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL REFERENCES content_proposals(proposal_id),
  proposal_version INTEGER NOT NULL CHECK (proposal_version > 0),
  job_id TEXT NOT NULL UNIQUE REFERENCES vocabulary_reflection_jobs(job_id),
  requested_by TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  UNIQUE(proposal_id, proposal_version)
);
