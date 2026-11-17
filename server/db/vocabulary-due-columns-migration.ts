import type { DatabaseSync } from 'node:sqlite';

/** Canonical `toISOString()` form; due times compare as strings with it. */
export const CANONICAL_TIMESTAMP_GLOB = '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z';

/**
 * 0077 postcondition. Review selection trusts the due columns and later writes
 * require a positive interval, so the batch fails if any schedule lacks one, if a
 * study timestamp is not canonical, or if a due time could not be computed.
 */
export function assertVocabularyDueColumns(db: DatabaseSync): void {
  const failures: string[] = [];
  const count = (label: string, sql: string) => {
    const row = db.prepare(sql).get() as { n: number };
    if (Number(row.n) > 0) failures.push(`${label}: ${row.n}`);
  };
  for (const table of ['learner_word_schedules', 'learner_pure_cue_schedules']) {
    count(`${table} without a positive interval`, `SELECT count(*) AS n FROM ${table}
      WHERE typeof(interval_hours) NOT IN ('integer', 'real') OR interval_hours <= 0`);
    count(`${table} with an invalid study timestamp`, `SELECT count(*) AS n FROM ${table}
      WHERE last_practised_at IS NOT NULL AND last_practised_at NOT GLOB '${CANONICAL_TIMESTAMP_GLOB}'`);
  }
  count('production schedules without a due time', 'SELECT count(*) AS n FROM learner_word_schedules WHERE review_due_at IS NULL');
  count('skill states with an invalid study timestamp', `SELECT count(*) AS n FROM learner_owned_word_skill_state
    WHERE last_studied_at IS NOT NULL AND last_studied_at NOT GLOB '${CANONICAL_TIMESTAMP_GLOB}'`);
  count('skill states with an invalid interval', `SELECT count(*) AS n FROM learner_owned_word_skill_state
    WHERE last_studied_at IS NOT NULL AND (typeof(interval_hours) NOT IN ('integer', 'real') OR interval_hours <= 0)`);
  count('skill states without a due time', 'SELECT count(*) AS n FROM learner_owned_word_skill_state WHERE review_due_at IS NULL');
  if (failures.length) throw new Error(`Review due times cannot be computed (${failures.join('; ')})`);
}
