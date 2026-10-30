-- The mapping budget is independent of job claims and sense preparation attempts.
ALTER TABLE vocabulary_reflection_jobs ADD COLUMN sense_mapping_availability_failures INTEGER NOT NULL DEFAULT 0
  CHECK(sense_mapping_availability_failures BETWEEN 0 AND 6);
