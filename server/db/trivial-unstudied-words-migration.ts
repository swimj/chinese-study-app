import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export const TRIVIAL_UNSTUDIED_WORDS_MIGRATION = 'app_schema:0076_prune_trivial_unstudied_words';
export const TRIVIAL_UNSTUDIED_WORDS_EVENT = 'vocabulary.learner_words.trivial_unstudied_pruned';

/**
 * Learner-scoped tables whose rows mark a (learner, word) pair as in use. Each has a column naming the word;
 * the migration SQL selects from every one of them, and a test requires every learner/word table in the
 * schema to appear here or in the owned set below, so a new table forces a decision.
 */
export const TRIVIAL_UNSTUDIED_ATTACHMENTS = {
  encounter_words: 'word_id', learner_feedback: 'word_id', learner_owned_intake_triage_assessments: 'word_id',
  learner_owned_user_word_priority: 'word_id', learner_owned_word_skill_relevance: 'word_id',
  learner_owned_word_skill_state: 'word_id', learner_owned_word_study_admission_state: 'word_id', learner_senses: 'word_id',
  learner_session_word_outcomes: 'word_id', learner_state_effects: 'word_id', learner_word_introduction_events: 'word_id',
  learner_word_preparation_reserve: 'word_id', reflection_cases: 'word_id', session_actions: 'word_id',
  teaching_completions: 'word_id', learner_owned_study_events: 'target_word_id',
  learner_owned_study_attempt_events: 'target_word_id', learner_owned_production_cue_evidence_records: 'submitted_word_id',
  pure_cue_scheduler_compensation_snapshots: 'target_word_id', exercise_encounters: 'selected_through_word_id',
} as const;
/** Tables the migration deletes from, besides learner_words itself. */
export const TRIVIAL_UNSTUDIED_OWNED_TABLES = ['learner_word_schedules', 'learner_word_state'] as const;

const SHARED_DICTIONARY_TABLES = ['lexical_words', 'lexical_word_meanings'] as const;
const PRECONDITIONS = 'trivial_unstudied_preconditions';
const PROTECTED = `SELECT COUNT(*) AS n FROM learner_words WHERE mode != 'unstudied' OR in_stash = 1 OR dismissed_at IS NOT NULL`;

function count(db: DatabaseSync, sql: string): number {
  return (db.prepare(sql).get() as { n: number }).n;
}
function requireTransaction(db: DatabaseSync): void {
  if (!db.isTransaction) throw new Error('Trivial unstudied word pruning requires the offline migration transaction');
}

/** Records shared-dictionary and protected-word sizes so the after hook can prove they were not touched. */
export function recordTrivialUnstudiedPreconditions(db: DatabaseSync): void {
  requireTransaction(db);
  db.exec(`CREATE TEMP TABLE ${PRECONDITIONS} (name TEXT PRIMARY KEY, n INTEGER NOT NULL)`);
  const insert = db.prepare(`INSERT INTO ${PRECONDITIONS}(name, n) VALUES (?, ?)`);
  for (const table of SHARED_DICTIONARY_TABLES) insert.run(table, count(db, `SELECT COUNT(*) AS n FROM ${table}`));
  insert.run('learner_words', count(db, 'SELECT COUNT(*) AS n FROM learner_words'));
  insert.run('protected', count(db, PROTECTED));
}

/** Verifies the deletion and records per-learner counts. Any violation throws and rolls back the whole batch. */
export function verifyAndRecordTrivialUnstudiedPrune(db: DatabaseSync): void {
  requireTransaction(db);
  const recorded = new Map((db.prepare(`SELECT name, n FROM ${PRECONDITIONS}`).all() as { name: string; n: number }[]).map(row => [row.name, row.n]));
  const total = count(db, 'SELECT COUNT(*) AS n FROM trivial_unstudied_candidates');
  const fail = (message: string): never => { throw new Error(`${TRIVIAL_UNSTUDIED_WORDS_MIGRATION}: ${message}`); };
  for (const table of SHARED_DICTIONARY_TABLES) {
    if (count(db, `SELECT COUNT(*) AS n FROM ${table}`) !== recorded.get(table)) fail(`${table} changed`);
  }
  if (count(db, 'SELECT COUNT(*) AS n FROM learner_words') !== recorded.get('learner_words')! - total) fail('learner_words count does not match the deleted candidates');
  if (count(db, PROTECTED) !== recorded.get('protected')) fail('a studied, stash or dismissed word was deleted');
  for (const table of ['learner_words', 'learner_word_schedules', 'learner_word_state']) {
    const left = count(db, `SELECT COUNT(*) AS n FROM ${table} t JOIN trivial_unstudied_candidates c ON c.learner_id = t.learner_id AND c.word_id = t.word_id`);
    if (left) fail(`${left} ${table} rows survived`);
  }
  for (const [table, column] of Object.entries(TRIVIAL_UNSTUDIED_ATTACHMENTS)) {
    const attached = count(db, `SELECT COUNT(*) AS n FROM ${table} t JOIN trivial_unstudied_candidates c ON c.learner_id = t.learner_id AND c.word_id = t.${column}`);
    if (attached) fail(`${attached} ${table} rows reference a deleted word association`);
  }
  const perLearner = db.prepare(`SELECT learner_id, COUNT(*) AS words, SUM(had_legacy_state) AS legacy FROM trivial_unstudied_candidates
    GROUP BY learner_id ORDER BY learner_id`).all() as { learner_id: string; words: number; legacy: number }[];
  const at = new Date().toISOString();
  const insert = db.prepare(`INSERT INTO backend_events(event_id,occurred_at,recorded_at,name,payload_version,data_json,actor_kind,actor_id,learner_id,entity_kind,entity_id)
    VALUES(?,?,?,?,1,?,'service',?,?,'learner',?)`);
  for (const row of perLearner) {
    insert.run(randomUUID(), at, at, TRIVIAL_UNSTUDIED_WORDS_EVENT, JSON.stringify({
      migration: TRIVIAL_UNSTUDIED_WORDS_MIGRATION, learnerWords: row.words, learnerWordSchedules: row.words, learnerWordState: row.legacy,
      remainingLearnerWords: count(db, `SELECT COUNT(*) AS n FROM learner_words WHERE learner_id='${row.learner_id.replaceAll("'", "''")}'`),
    }), TRIVIAL_UNSTUDIED_WORDS_MIGRATION, row.learner_id, row.learner_id);
  }
  db.exec(`DROP TABLE trivial_unstudied_candidates; DROP TABLE trivial_unstudied_attached; DROP TABLE ${PRECONDITIONS}`);
}
