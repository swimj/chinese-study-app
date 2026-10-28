import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, test } from 'node:test';
import { setDb } from '../server/db/connection.ts';
import { runWithLearnerId } from '../server/db/learner-context.ts';
import { appendVocabularySessionActions, getVocabularySession, stageVocabularySessionCompletion, cancelVocabularySessionCompletion } from '../server/db/vocabulary-sessions.ts';
import { projectVocabularySession, type VocabularySessionAction, type VocabularySessionInitialContext } from '../src/domain/vocabulary-session.ts';

const now = '2026-10-28T00:00:00.000Z';
const databases: DatabaseSync[] = [];
const alice = <T>(work: () => T) => runWithLearnerId('alice', work);
function fixture() {
  const db = new DatabaseSync(':memory:'); databases.push(db);
  db.exec("CREATE TABLE learners(learner_id TEXT PRIMARY KEY); CREATE TABLE lexical_words(id TEXT PRIMARY KEY); INSERT INTO learners VALUES ('alice'),('bob');");
  db.exec(fs.readFileSync(new URL('../server/db/migrations/0042_vocabulary_sessions.sql', import.meta.url), 'utf8'));
  const statements: string[] = [];
  const prepare = db.prepare.bind(db);
  db.prepare = (sql: string) => { statements.push(sql); return prepare(sql); };
  setDb(db);
  return { db, statements };
}
function seed(db: DatabaseSync, sessionId = 'session', words: VocabularySessionInitialContext['words'] = []) {
  const context = { sessionId, words, wordStateVersions: {} };
  db.prepare("INSERT INTO vocabulary_sessions VALUES (?, 'alice', 1, ?, ?, NULL, 'active')")
    .run(sessionId, JSON.stringify(context), now);
  return context;
}
function finish(id = 'finish', sequence = 1): VocabularySessionAction {
  return { actionId: id, clientActionId: id, sequence, protocolVersion: 1, occurredAt: now, kind: 'finish_for_now', payload: {} };
}
function insertExternalAction(db: DatabaseSync, action: VocabularySessionAction) {
  db.prepare(`INSERT INTO session_actions(action_id,learner_id,session_id,sequence_number,client_action_id,kind,action_json,occurred_at,recorded_at)
    VALUES (?,'alice','session',?,?,?,?,?,?)`).run(action.actionId, action.sequence, action.clientActionId, action.kind, JSON.stringify(action), now, now);
}
const hasHistoryRead = (sql: string) => /SELECT action_json FROM session_actions/i.test(sql);
const hasContextRead = (sql: string) => /SELECT \* FROM vocabulary_sessions/i.test(sql);
afterEach(() => { setDb(null); for (const db of databases.splice(0)) db.close(); });

test('warm reads and append reuse retained context and history and preserve the prior projection', () => alice(() => {
  const { db, statements } = fixture(); const context = seed(db);
  const before = getVocabularySession('session', now); const initial = structuredClone(before.projection);
  statements.length = 0;
  const action = finish(); const after = appendVocabularySessionActions('session', [action], now);
  const reread = getVocabularySession('session', now);
  assert.deepEqual(before.projection, initial);
  assert.deepEqual(after.projection, projectVocabularySession(context, [action]));
  assert.equal(reread.context, before.context);
  assert.equal(reread.projection, after.projection);
  assert.equal(statements.some(hasHistoryRead), false);
  assert.equal(statements.some(hasContextRead), false);
  assert.ok(statements.some(sql => sql.includes('ORDER BY sequence_number DESC LIMIT 1')));
  assert.equal(appendVocabularySessionActions('session', [action], now).actions.length, 1);
}));

test('outer rollback invalidates a cached successful nested append', () => alice(() => {
  const { db } = fixture(); seed(db); getVocabularySession('session', now);
  db.exec('BEGIN'); appendVocabularySessionActions('session', [finish()], now); db.exec('ROLLBACK');
  const recovered = getVocabularySession('session', now);
  assert.equal(recovered.actions.length, 0);
  assert.equal(recovered.projection.throughSequence, 0);
  assert.equal(recovered.projection.phase, 'active');
}));

test('same-sequence replacement after outer rollback is detected by action identity', () => alice(() => {
  const { db, statements } = fixture(); const context = seed(db);
  db.exec('BEGIN'); appendVocabularySessionActions('session', [finish('rolled-back')], now); db.exec('ROLLBACK');
  const replacement = finish('replacement'); insertExternalAction(db, replacement); statements.length = 0;
  const recovered = getVocabularySession('session', now);
  assert.deepEqual(recovered.actions, [replacement]);
  assert.deepEqual(recovered.projection, projectVocabularySession(context, [replacement]));
  assert.ok(statements.some(hasHistoryRead));
}));

test('cache remains scoped to connection and learner, and observes persisted status', () => {
  const first = fixture(); const firstContext = seed(first.db); alice(() => getVocabularySession('session', now));
  runWithLearnerId('bob', () => assert.throws(() => getVocabularySession('session', now), /not found/));
  const second = fixture(); const secondContext = seed(second.db, 'session', [{ wordId: 'a', mode: 'practice' }]);
  assert.deepEqual(alice(() => getVocabularySession('session', now).context), secondContext);
  setDb(first.db);
  assert.deepEqual(alice(() => getVocabularySession('session', now).context), firstContext);
  first.db.exec("UPDATE vocabulary_sessions SET status='finalizing'");
  assert.equal(alice(() => getVocabularySession('session', now).status), 'finalizing');
  alice(() => assert.throws(() => appendVocabularySessionActions('session', [finish()], now), /finalizing/));
});

test('bounded LRU evicts older sessions and cold hydration preserves their result', () => alice(() => {
  const { db, statements } = fixture(); seed(db); const original = getVocabularySession('session', now);
  for (let i = 0; i < 64; i++) { const id = `other-${i}`; seed(db, id); getVocabularySession(id, now); }
  statements.length = 0;
  assert.deepEqual(getVocabularySession('session', now), original);
  assert.ok(statements.some(hasContextRead));
  assert.ok(statements.some(hasHistoryRead));
}));

const hasCompletionPayloadRead = (sql: string) => /SELECT \* FROM vocabulary_session_completions/i.test(sql);
test('cancelled completion is decoded once and warm resume/append reads only completion metadata', () => alice(() => {
  const { db, statements } = fixture(); seed(db);
  appendVocabularySessionActions('session', [finish()], now);
  const staged = stageVocabularySessionCompletion('session', 1, now);
  cancelVocabularySessionCompletion('session', staged.completionId, now);
  const first = getVocabularySession('session', now);
  assert.equal(first.completion?.status, 'cancelled');
  statements.length = 0;
  const resume: VocabularySessionAction = { ...finish('resume', 2), kind: 'resume', payload: {} };
  const resumed = appendVocabularySessionActions('session', [resume], now);
  const later = '2026-10-28T00:00:08.000Z';
  const reread = getVocabularySession('session', later);
  assert.equal(resumed.projection.phase, 'active');
  assert.equal(reread.completion?.report, first.completion?.report);
  assert.equal(reread.completion?.serverNow, later);
  assert.equal(reread.completion?.canUndo, false);
  assert.equal(statements.some(hasCompletionPayloadRead), false);
  assert.equal(statements.some(hasHistoryRead), false);
  assert.equal(statements.some(hasContextRead), false);
}));

test('cached completion refreshes status/error/deadline and closure report, including rollback and new revision', () => alice(() => {
  const { db, statements } = fixture(); seed(db);
  appendVocabularySessionActions('session', [finish()], now);
  const staged = stageVocabularySessionCompletion('session', 1, now);
  const original = getVocabularySession('session', now).completion!;
  assert.equal(original.canUndo, true);
  statements.length = 0;
  db.prepare("UPDATE vocabulary_session_completions SET status='failed',last_error='first failure'").run();
  const failed = getVocabularySession('session', '2026-10-28T00:00:16.000Z').completion!;
  assert.equal(failed.status, 'failed'); assert.equal(failed.error, 'first failure'); assert.equal(failed.canUndo, false);
  db.prepare("UPDATE vocabulary_session_completions SET last_error='second failure'").run();
  assert.equal(getVocabularySession('session', now).completion?.error, 'second failure');
  assert.equal(statements.some(hasCompletionPayloadRead), false);
  db.exec('BEGIN');
  const replacement = { ...original.report, policyVersion: 'closure report' };
  db.prepare("UPDATE vocabulary_session_completions SET status='closed',closed_at=?,last_error=NULL,report_json=?").run(now, JSON.stringify(replacement));
  const closed = getVocabularySession('session', now).completion!;
  assert.equal(closed.status, 'closed'); assert.equal(closed.closedAt, now); assert.equal(closed.error, null);
  assert.deepEqual(closed.report, replacement);
  db.exec('ROLLBACK');
  const recovered = getVocabularySession('session', now).completion!;
  assert.equal(recovered.status, 'failed'); assert.equal(recovered.closedAt, null); assert.equal(recovered.error, 'second failure');
  assert.deepEqual(recovered.report, original.report);
  cancelVocabularySessionCompletion('session', staged.completionId, now);
  getVocabularySession('session', now);
  const revised = stageVocabularySessionCompletion('session', 1, now, { activeDurationMs: 1 });
  const current = getVocabularySession('session', now).completion!;
  assert.equal(current.completionId, revised.completionId); assert.equal(current.revisionNumber, 2);
  assert.equal(current.metadata.activeDurationMs, 1); assert.equal(current.error, null);
}));
