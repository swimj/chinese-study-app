import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createBaselineFixture } from './helpers/baseline-database.ts';
import { assertSchemaCurrent, migrateDatabase, schemaMigrations } from '../server/db/migrations.ts';
import { TRIVIAL_UNSTUDIED_ATTACHMENTS, TRIVIAL_UNSTUDIED_OWNED_TABLES, TRIVIAL_UNSTUDIED_WORDS_EVENT } from '../server/db/trivial-unstudied-words-migration.ts';

const MIGRATION = 'app_schema:0076_prune_trivial_unstudied_words';
const DEFAULT_STATE = JSON.stringify({ intervalHours: 24, easeFactor: 2.5, enabled: 1, cleanCoveredSessions: 0 });
const IMPORT_STATE = JSON.stringify({ intervalHours: 24, easeFactor: 2.5, enabled: 1, cleanCoveredSessions: 0, legacyAdmissionAt: null });
const AT = '2026-04-11T00:00:00.000Z';

function open(directory: string, name: string): DatabaseSync {
  createBaselineFixture(path.join(directory, name));
  const db = new DatabaseSync(path.join(directory, name, 'app.db'));
  db.function('current_learner_id', () => 'a');
  migrateDatabase(db, schemaMigrations.filter(migration => migration.id !== MIGRATION));
  return db;
}
type Options = { learner?: string; stash?: number; mode?: string; dismissed?: string | null; use?: string | null; version?: number;
  scope?: string | null; paused?: number; schedule?: 'default' | 'import' | 'practised' | 'due' | 'refresh' | 'disabled' | 'extra' | 'none';
  legacy?: 'default' | 'notes' | 'learning' | 'none' };
function seed(db: DatabaseSync, word: string, options: Options = {}): string {
  const learner = options.learner ?? 'a';
  db.prepare('INSERT OR IGNORE INTO lexical_words(id,hanzi,pinyin,meaning,examples_json,priority,created_at) VALUES (?,?,?,?,?,?,?)').run(word, word, 'p', 'm', '[]', 1, AT);
  db.prepare(`INSERT INTO learner_words(learner_id,word_id,in_stash,added_at,intended_use_text,mode,mode_changed_at,state_version,scope_established_at,dismissed_at,automatic_promotion_paused)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(learner, word, options.stash ?? 0, AT, options.use ?? null, options.mode ?? 'unstudied', AT, options.version ?? 1,
    options.scope ?? null, options.dismissed ?? null, options.paused ?? 0);
  const kind = options.schedule ?? 'default';
  if (kind !== 'none') {
    const state = kind === 'import' ? IMPORT_STATE : kind === 'disabled' ? JSON.stringify({ ...JSON.parse(DEFAULT_STATE), enabled: 0 })
      : kind === 'extra' ? JSON.stringify({ ...JSON.parse(DEFAULT_STATE), note: 1 }) : DEFAULT_STATE;
    db.prepare(`INSERT INTO learner_word_schedules(learner_id,word_id,next_eligible_at,last_practised_at,policy_version,scheduler_state_json,refresh_requested_at,refresh_until)
      VALUES (?,?,?,?,?,?,?,?)`).run(learner, word, kind === 'due' ? '2026-05-01T00:00:00.000Z' : null, kind === 'practised' ? AT : null,
      kind === 'import' ? 'legacy-import-v1' : 'vocabulary-v1', state, kind === 'refresh' ? AT : null, kind === 'refresh' ? '2026-05-01T00:00:00.000Z' : null);
  }
  const legacy = options.legacy ?? 'default';
  if (legacy !== 'none') {
    db.prepare('INSERT INTO learner_word_state(learner_id,word_id,personal_notes,status,learning_streak) VALUES (?,?,?,?,0)')
      .run(learner, word, legacy === 'notes' ? 'my note' : '', legacy === 'learning' ? 'learning' : 'unstudied');
  }
  return word;
}
const has = (db: DatabaseSync, table: string, word: string, learner = 'a') =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE learner_id=? AND word_id=?`).get(learner, word)!.n as number) > 0;
const snapshot = (db: DatabaseSync, table: string) => db.prepare(`SELECT * FROM ${table} ORDER BY 1,2`).all();

test('prunes only trivial unstudied associations, keeps everything else, and records what it did', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trivial-unstudied-'));
  let db: DatabaseSync | undefined;
  try {
    db = open(directory, 'db');
    const conn = db;
    for (const learner of ['a', 'b']) conn.prepare('INSERT INTO learners(learner_id,display_name,created_at) VALUES (?,?,?)').run(learner, learner, AT);
    const gone = [seed(conn, 'gone-default'), seed(conn, 'gone-import', { schedule: 'import' }), seed(conn, 'gone-nolegacy', { legacy: 'none' })];
    seed(conn, 'gone-b', { learner: 'b' });
    const attach = (word: string, sql: string, ...params: unknown[]) => { seed(conn, word); conn.prepare(sql).run(...params as never[]); return word; };
    const kept = [
      attach('k-priority', 'INSERT INTO learner_owned_user_word_priority(learner_id,word_id,bump_count,force_top,priority_tier,required_for_next_session,updated_at) VALUES (?,?,0,0,0,0,?)', 'a', 'k-priority', AT),
      attach('k-reserve', 'INSERT INTO learner_word_preparation_reserve(learner_id,word_id,added_at) VALUES (?,?,?)', 'a', 'k-reserve', AT),
      attach('k-skill', 'INSERT INTO learner_owned_word_skill_state(learner_id,word_id,skill_id,enabled,interval_hours,last_studied_at,next_due_at,ease_factor) VALUES (?,?,?,1,24,?,?,2.5)', 'a', 'k-skill', 'recognition', AT, AT),
      attach('k-admission', 'INSERT INTO learner_owned_word_study_admission_state(learner_id,word_id,study_phase,earliest_next_study_at) VALUES (?,?,?,?)', 'a', 'k-admission', 'review', AT),
      attach('k-session', "INSERT INTO vocabulary_sessions(session_id,learner_id,protocol_version,context_json,started_at,status) VALUES ('s1','a',1,?,?,'active')",
        JSON.stringify({ sessionId: 's1', words: [{ wordId: 'k-session' }], reviewOrder: [{ kind: 'word', id: 'k-session' }] }), AT),
      seed(conn, 'k-stash', { stash: 1 }), seed(conn, 'k-dismissed', { dismissed: AT }), seed(conn, 'k-use', { use: 'travel' }),
      seed(conn, 'k-practice', { mode: 'practice' }), seed(conn, 'k-solidify', { mode: 'solidify' }), seed(conn, 'k-version', { version: 2 }), seed(conn, 'k-scope', { scope: AT }),
      seed(conn, 'k-paused', { paused: 1 }), seed(conn, 'k-practised', { schedule: 'practised' }), seed(conn, 'k-due', { schedule: 'due' }),
      seed(conn, 'k-refresh', { schedule: 'refresh' }), seed(conn, 'k-disabled', { schedule: 'disabled' }), seed(conn, 'k-extra', { schedule: 'extra' }),
      seed(conn, 'k-noschedule', { schedule: 'none' }), seed(conn, 'k-notes', { legacy: 'notes' }), seed(conn, 'k-learning', { legacy: 'learning' }),
    ];
    seed(conn, 'shared-word', { learner: 'a' }); seed(conn, 'shared-word', { learner: 'b', stash: 1 });
    const dictionary = [snapshot(conn, 'lexical_words'), snapshot(conn, 'lexical_word_meanings')];
    const eventsBefore = conn.prepare('SELECT COUNT(*) AS n FROM backend_events').get()!.n as number;

    assert.deepEqual(migrateDatabase(conn), [MIGRATION]);
    for (const word of gone) for (const table of ['learner_words', 'learner_word_schedules', 'learner_word_state']) assert.equal(has(conn, table, word), false, `${table} ${word}`);
    for (const table of ['learner_words', 'learner_word_schedules', 'learner_word_state']) assert.equal(has(conn, table, 'gone-b', 'b'), false);
    assert.equal(has(conn, 'learner_words', 'shared-word', 'a'), false);
    assert.equal(has(conn, 'learner_words', 'shared-word', 'b'), true, 'another learner keeps their stash row');
    for (const word of kept) assert.equal(has(conn, 'learner_words', word), true, `kept ${word}`);
    for (const word of ['k-notes', 'k-priority', 'k-stash']) {
      assert.equal(has(conn, 'learner_word_schedules', word), true, word); assert.equal(has(conn, 'learner_word_state', word), true, word);
    }
    assert.equal(has(conn, 'learner_word_schedules', 'k-noschedule'), false);
    assert.equal(has(conn, 'learner_word_state', 'k-noschedule'), true);
    assert.deepEqual([snapshot(conn, 'lexical_words'), snapshot(conn, 'lexical_word_meanings')], dictionary);
    assert.equal(conn.prepare("SELECT COUNT(*) AS n FROM sqlite_temp_schema WHERE name LIKE 'trivial_unstudied%'").get()!.n, 0);

    const events = conn.prepare('SELECT learner_id,data_json FROM backend_events WHERE name=? ORDER BY learner_id').all(TRIVIAL_UNSTUDIED_WORDS_EVENT) as { learner_id: string; data_json: string }[];
    assert.equal(conn.prepare('SELECT COUNT(*) AS n FROM backend_events').get()!.n, eventsBefore + 2);
    assert.deepEqual(events.map(e => [e.learner_id, JSON.parse(e.data_json).learnerWords, JSON.parse(e.data_json).learnerWordState]), [['a', 4, 3], ['b', 1, 1]]);

    assert.deepEqual(migrateDatabase(conn), []); assertSchemaCurrent(conn);
    assert.deepEqual(conn.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { db?.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('every learner/word table is either an attachment that keeps the word or deleted by the migration', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trivial-unstudied-schema-'));
  let db: DatabaseSync | undefined;
  try {
    db = open(directory, 'db');
    const sql = fs.readFileSync(new URL('../server/db/migrations/0076_prune_trivial_unstudied_words.sql', import.meta.url), 'utf8');
    const known = new Set<string>([...Object.keys(TRIVIAL_UNSTUDIED_ATTACHMENTS), ...TRIVIAL_UNSTUDIED_OWNED_TABLES, 'learner_words']);
    for (const { name } of db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all() as { name: string }[]) {
      const columns = (db.prepare(`PRAGMA table_info(${name})`).all() as { name: string }[]).map(column => column.name);
      if (columns.includes('learner_id') && columns.includes('word_id')) assert.ok(known.has(name), `${name} references learner words; decide whether it keeps the word`);
    }
    for (const [table, column] of Object.entries(TRIVIAL_UNSTUDIED_ATTACHMENTS)) {
      assert.ok(sql.includes(`FROM ${table}`), `${table} missing from migration SQL`);
      assert.ok((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some(c => c.name === column), `${table}.${column}`);
    }
  } finally { db?.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('a violated postcondition fails the whole batch instead of partially applying', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trivial-unstudied-fail-'));
  let db: DatabaseSync | undefined;
  try {
    db = open(directory, 'db');
    db.prepare('INSERT INTO learners(learner_id,display_name,created_at) VALUES (?,?,?)').run('a', 'a', AT);
    seed(db, 'gone');
    const tampered = schemaMigrations.map(migration => migration.id === MIGRATION
      ? { ...migration, sql: `${migration.sql}\nINSERT INTO lexical_words(id,hanzi,pinyin,meaning,examples_json,priority,created_at) VALUES ('extra','x','p','m','[]',1,'${AT}');` } : migration);
    assert.throws(() => migrateDatabase(db!, tampered), /lexical_words changed/);
    assert.equal(has(db, 'learner_words', 'gone'), true);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM lexical_words').get()!.n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations WHERE migration_id=?').get(MIGRATION)!.n, 0);
    assert.deepEqual(migrateDatabase(db), [MIGRATION]);
    assert.equal(has(db, 'learner_words', 'gone'), false);
  } finally { db?.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});
