CREATE TABLE vocabulary_word_sense_coverage (
  word_id TEXT PRIMARY KEY REFERENCES lexical_words(id),
  version INTEGER NOT NULL CHECK(version >= 1),
  excluded_sense_ids_json TEXT NOT NULL CHECK(json_valid(excluded_sense_ids_json)),
  default_useful_sense_ids_json TEXT CHECK(default_useful_sense_ids_json IS NULL OR json_valid(default_useful_sense_ids_json)),
  updated_at TEXT NOT NULL
);
CREATE TABLE vocabulary_case_sense_coverage (
  case_id TEXT PRIMARY KEY REFERENCES reflection_cases(case_id),
  version INTEGER NOT NULL CHECK(version >= 1),
  included_sense_ids_json TEXT CHECK(included_sense_ids_json IS NULL OR json_valid(included_sense_ids_json)),
  updated_at TEXT NOT NULL
);
CREATE TABLE vocabulary_sense_coverage_history (
  change_id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK(scope IN ('word','case')),
  subject_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
  actor_id TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  UNIQUE(scope,subject_id,version)
);
CREATE TRIGGER vocabulary_sense_coverage_history_immutable_update BEFORE UPDATE ON vocabulary_sense_coverage_history BEGIN SELECT RAISE(ABORT,'Coverage history is immutable'); END;
CREATE TRIGGER vocabulary_sense_coverage_history_immutable_delete BEFORE DELETE ON vocabulary_sense_coverage_history BEGIN SELECT RAISE(ABORT,'Coverage history is immutable'); END;
