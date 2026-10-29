-- Existing artifacts are retained. Reserve admission refreshes old preparation lazily.
ALTER TABLE word_introduction_preparation ADD COLUMN preparation_epoch INTEGER NOT NULL DEFAULT 0
  CHECK (preparation_epoch >= 0);
