-- Timed sessions now treat a held item as pressing when it is overdue by a full
-- interval, read from its due time at Start. Per-day passed-over counts are no
-- longer read or written; they were derived selection state with no other use.
DROP TABLE learner_timed_skip_counts;
