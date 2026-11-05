-- Case sense coverage is retained as historical evidence only. New operator intent
-- selects one repair target without changing the source exercise.
CREATE TABLE vocabulary_case_repair_targets (
  case_id TEXT PRIMARY KEY REFERENCES vocabulary_case_reviews(case_id),
  version INTEGER NOT NULL CHECK(version > 0),
  pending_sense_id TEXT REFERENCES senses(sense_id),
  accepted_sense_id TEXT REFERENCES senses(sense_id),
  accepted_version INTEGER,
  updated_at TEXT NOT NULL,
  CHECK ((accepted_sense_id IS NULL AND accepted_version IS NULL) OR
    (accepted_sense_id IS NOT NULL AND accepted_version > 0 AND accepted_version <= version))
);
ALTER TABLE vocabulary_reflection_jobs ADD COLUMN repair_target_json TEXT
  CHECK(repair_target_json IS NULL OR json_valid(repair_target_json));

-- An editorial narrowing records its own targets without rewriting model evidence.
CREATE TABLE vocabulary_repertoire_revisions (
  proposal_id TEXT NOT NULL REFERENCES content_proposals(proposal_id),
  proposal_version INTEGER NOT NULL CHECK(proposal_version > 0),
  sense_ids_json TEXT NOT NULL CHECK(json_valid(sense_ids_json)),
  PRIMARY KEY (proposal_id, proposal_version)
);
CREATE TRIGGER vocabulary_repertoire_revisions_immutable_update BEFORE UPDATE ON vocabulary_repertoire_revisions
BEGIN SELECT RAISE(ABORT,'Repertoire revision evidence is immutable'); END;
CREATE TRIGGER vocabulary_repertoire_revisions_immutable_delete BEFORE DELETE ON vocabulary_repertoire_revisions
BEGIN SELECT RAISE(ABORT,'Repertoire revision evidence is immutable'); END;
