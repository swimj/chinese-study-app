ALTER TABLE vocabulary_reflection_jobs ADD COLUMN reassessment_source_json TEXT CHECK (reassessment_source_json IS NULL OR json_valid(reassessment_source_json));
