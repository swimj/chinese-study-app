-- Dismissal is an inbox preference, independent of whether a lesson was read.
ALTER TABLE learner_messages ADD COLUMN dismissed_at TEXT;
