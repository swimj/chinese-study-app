import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import { createBaselineFixture } from './helpers/baseline-database.ts';
import { migrateDatabase, schemaMigrations } from '../server/db/migrations.ts';

const migrationId = 'app_schema:0079_share_session_context';
const prior = schemaMigrations.filter(migration => migration.id < migrationId);
const throughMigration = schemaMigrations.filter(migration => migration.id <= migrationId);
const at = '2026-11-17T08:00:00.000Z';
const root = mkdtempSync(join(tmpdir(), 'session-context-migration-'));
const baseline = join(root, 'before', 'app.db');
const location = join(root, 'test.db');
let db: DatabaseSync;

before(() => {
  createBaselineFixture(join(root, 'before'));
  const original = new DatabaseSync(baseline);
  try {
    original.function('current_learner_id', () => 'a');
    migrateDatabase(original, prior);
    original.prepare('INSERT INTO learners(learner_id,display_name,created_at) VALUES (?,?,?)').run('a', 'A', at);
  } finally {
    original.close();
  }
});
beforeEach(() => {
  copyFileSync(baseline, location);
  db = new DatabaseSync(location);
  db.exec('PRAGMA foreign_keys=ON');
  db.function('current_learner_id', () => 'a');
});
afterEach(() => db.close());
after(() => rmSync(root, { recursive: true, force: true }));

const context = { sessionId: 's', words: [], wordStateVersions: {} };
const actions = [{ sequence: 1, payload: { context: '保留' } }];
const report = { phase: 'completed', words: {}, encounters: [], nested: { context: '保留' } };
const input = { actions, activeDurationMs: 907 };
const evidence = { actions, projection: report };

function session(id = 's') {
  db.prepare(`INSERT INTO vocabulary_sessions(session_id,learner_id,protocol_version,context_json,started_at,status)
    VALUES (?,'a',1,?,?,'closed')`).run(id, JSON.stringify({ ...context, sessionId: id }), at);
}
function completion(id: string, sessionId: string, body: object, revision = 1, status = 'closed') {
  db.prepare(`INSERT INTO vocabulary_session_completions(completion_id,learner_id,session_id,revision_number,
    through_sequence,staged_at,close_at,status,input_json,report_json,policy_version)
    VALUES (?,'a',?,?,1,?,?,?,?,?,'v1')`)
    .run(id, sessionId, revision, at, at, status, JSON.stringify(body), JSON.stringify(report));
}
function dispatch(id: string, sessionId: string, completionId: string, body: object) {
  db.prepare(`INSERT INTO vocabulary_post_session_dispatches(dispatch_id,learner_id,session_id,completion_id,evidence_json,status,created_at)
    VALUES (?,'a',?,?,?,'failed',?)`).run(id, sessionId, completionId, JSON.stringify(body), at);
}

test('migration removes only the top-level context from historical records and keeps the immutable session as authority', () => {
  session();
  completion('cancelled', 's', { context, ...input }, 1, 'cancelled');
  completion('closed', 's', { context, ...input }, 2);
  dispatch('d', 's', 'closed', { context, ...evidence });
  assert.deepEqual(migrateDatabase(db, throughMigration), [migrationId]);

  assert.deepEqual(JSON.parse(String(db.prepare('SELECT context_json FROM vocabulary_sessions').get()!.context_json)), context);
  const rows = db.prepare('SELECT status,input_json,report_json FROM vocabulary_session_completions ORDER BY revision_number').all();
  assert.deepEqual(rows.map(r => [r.status, JSON.parse(String(r.input_json)), JSON.parse(String(r.report_json))]),
    [['cancelled', input, report], ['closed', input, report]]);
  assert.deepEqual(JSON.parse(String(db.prepare('SELECT evidence_json FROM vocabulary_post_session_dispatches').get()!.evidence_json)), evidence);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);

  session('new');
  assert.throws(() => completion('new-c', 'new', { context, ...input }));
  completion('new-c', 'new', input, 1, 'pending');
  assert.throws(() => dispatch('new-d', 'new', 'new-c', { context, ...evidence }));
  dispatch('new-d', 'new', 'new-c', evidence);
  assert.throws(() => db.exec("UPDATE vocabulary_session_completions SET input_json='{}' WHERE completion_id='new-c'"));
  assert.throws(() => db.exec("UPDATE vocabulary_session_completions SET status='pending' WHERE completion_id='closed'"));
  assert.throws(() => db.exec("UPDATE vocabulary_post_session_dispatches SET evidence_json='{}' WHERE dispatch_id='new-d'"));
});

for (const differing of ['completion', 'dispatch'] as const) {
  test(`an unequal ${differing} context rolls back conversion without discarding its frozen evidence`, () => {
    session();
    const divergent = { ...context, words: [{ wordId: 'another' }] };
    const oldInput = { context: differing === 'completion' ? divergent : context, ...input };
    const oldEvidence = { context: differing === 'dispatch' ? divergent : context, ...evidence };
    completion('c', 's', oldInput);
    dispatch('d', 's', 'c', oldEvidence);
    assert.throws(() => migrateDatabase(db, throughMigration));
    assert.equal(db.prepare('SELECT 1 FROM schema_migrations WHERE migration_id=?').get(migrationId), undefined);
    assert.equal(db.prepare('SELECT input_json FROM vocabulary_session_completions').get()!.input_json, JSON.stringify(oldInput));
    assert.equal(db.prepare('SELECT evidence_json FROM vocabulary_post_session_dispatches').get()!.evidence_json, JSON.stringify(oldEvidence));
  });
}
