import fs from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import type { VocabularyPureCueSchedulerState } from '../../server/db/vocabulary-learners.ts';
import { splitPureCueSchedulerState } from '../../server/db/vocabulary-schedule-columns.ts';

/**
 * Hand-built vocabulary fixtures apply individual migration files; schedule reads
 * and writes need 0077's columns. A fixture without skill states gets an empty
 * table of the shape 0077 extends.
 */
export function applyVocabularyDueColumns(db: DatabaseSync): void {
  if (!db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='learner_owned_word_skill_state'").get())
    db.exec(`CREATE TABLE learner_owned_word_skill_state(learner_id TEXT,word_id TEXT,skill_id TEXT,interval_hours REAL,ease_factor REAL,enabled INTEGER,
      next_due_at TEXT,last_studied_at TEXT,PRIMARY KEY(learner_id,word_id,skill_id))`);
  db.exec(fs.readFileSync(new URL('../../server/db/migrations/0077_vocabulary_due_columns.sql', import.meta.url), 'utf8'));
}

/** Insert a pure-cue schedule from one merged state object, as the application stores it. */
export function insertPureCueSchedule(db: DatabaseSync, row: { learnerId: string; contentId: string; nextEligibleAt: string | null;
  lastPractisedAt: string | null; policyVersion: string; state: Partial<VocabularyPureCueSchedulerState> & Record<string, unknown> }): void {
  const { columns, json } = splitPureCueSchedulerState(row.state);
  db.prepare(`INSERT INTO learner_pure_cue_schedules(learner_id,content_id,next_eligible_at,last_practised_at,policy_version,scheduler_state_json,
    interval_hours,enabled,reset_until,strong_since,strong_successes,maintenance_identity,recheck_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(row.learnerId, row.contentId, row.nextEligibleAt, row.lastPractisedAt, row.policyVersion, json, columns.interval_hours, columns.enabled,
      columns.reset_until, columns.strong_since, columns.strong_successes, columns.maintenance_identity, columns.recheck_at);
}
