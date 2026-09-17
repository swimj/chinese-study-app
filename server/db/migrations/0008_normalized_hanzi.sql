-- Stored Mandarin lookup key for punctuation-insensitive stash add.
-- Display hanzi stays unchanged; matching identity uses the same strip as
-- production answers (whitespace, commas, and other punctuation/symbols).
ALTER TABLE lexical_words ADD COLUMN normalized_hanzi TEXT NOT NULL DEFAULT '';

UPDATE lexical_words
SET normalized_hanzi = normalize_mandarin_hanzi_lookup(hanzi);

CREATE INDEX idx_lexical_words_normalized_hanzi
  ON lexical_words(normalized_hanzi)
  WHERE normalized_hanzi <> '';
