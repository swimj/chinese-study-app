-- Stored Mandarin lookup key for punctuation-insensitive stash add.
-- Display hanzi stays unchanged. Row backfill uses the migration `after`
-- hook so Unicode stripping can match production normalization.
ALTER TABLE lexical_words ADD COLUMN normalized_hanzi TEXT NOT NULL DEFAULT '';

CREATE INDEX idx_lexical_words_normalized_hanzi
  ON lexical_words(normalized_hanzi)
  WHERE normalized_hanzi <> '';
