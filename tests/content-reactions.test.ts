import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type http from 'node:http';
import { before, after, test } from 'node:test';
import { getDb } from '../server/db/connection.ts';
import { bootstrapLearner } from '../server/db/identity.ts';
import { runWithLearnerId } from '../server/db/learner-context.ts';
import { recordReviewSessionSummary } from '../server/db/persistence.ts';
import { claimSessionDebrief, finishSessionDebrief } from '../server/db/session-debrief.ts';
import { ContentReactionNotFoundError, getContentReactionSummary, getSavedCollection, listContentReactions,
  setContentReaction } from '../server/db/content-reactions.ts';
import { ContentReactionInputError, parseContentReactionInput, type ContentReactionInput } from '../src/domain/content-reactions.ts';

let dir: string; let server: http.Server; let base: string;
const asA = <T>(work: () => T) => runWithLearnerId('http-learner', work);
const asB = <T>(work: () => T) => runWithLearnerId('other', work);
const inventory = Array.from({ length: 15 }, (_, index) => ({ word: `词${index + 1}`, pinyin: `cí ${index + 1}` }));

function readyConnections(learner: <T>(work: () => T) => T, sessionId: string, completedAt: string, notes: string[]) {
  learner(() => recordReviewSessionSummary({ sessionId, completedAt, completedReviewActionCount: 0, failedReviewActionCount: 0,
    activeDurationMs: 1000, debriefInventory: inventory }));
  learner(() => {
    assert(claimSessionDebrief(sessionId, `token-${sessionId}`, completedAt, '2099-01-01T00:00:00.000Z'));
    assert(finishSessionDebrief({ sessionId, token: `token-${sessionId}`, completedAt, durationMs: 10, error: null, errorCode: null,
      metadata: null, result: { notes: notes.map((text, index) => ({ text, refs: index === 0 ? ['w1', 'w3'] : ['w2'], followUp: null })) } }));
  });
}
function lesson(learnerId: string, messageId: string) {
  const db = getDb();
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.prepare(`INSERT INTO reflection_cases(case_id,completion_id,learner_id,kind,subject_key,word_id,content_id,status,evidence_snapshot_json,created_at)
      VALUES (?,?,?,'learner_feedback',?,NULL,'fixture-content','completed','[]','2026-10-07T00:00:00.000Z')`)
      .run(`case-${messageId}`, `completion-${messageId}`, learnerId, messageId);
    db.prepare(`INSERT INTO learner_messages(message_id,learner_id,case_id,judgment_id,source_key,body_json,created_at)
      VALUES (?,?,?,?,?,?,'2026-10-07T00:00:00.000Z')`)
      .run(messageId, learnerId, `case-${messageId}`, `judgment-${messageId}`, `source-${messageId}`, JSON.stringify({ title: 'Lesson', text: `About ${messageId}` }));
  } finally { db.exec('PRAGMA foreign_keys = ON'); }
}
const connection = (sessionId: string, noteIndex: number) => ({ kind: 'connection' as const, sessionId, noteIndex });
const input = (patch: Partial<ContentReactionInput> & Pick<ContentReactionInput, 'subject'>): ContentReactionInput =>
  ({ reaction: 'saved', reasons: [], note: null, surface: 'home', ...patch });
const events = () => getDb().prepare('SELECT learner_id, subject_kind, session_id, note_index, message_id, reaction, reasons_json, surface FROM learner_content_reaction_events ORDER BY event_id')
  .all().map((row) => ({ ...row }));

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'content-reactions-'));
  Object.assign(process.env, { APP_MODE: 'study', APP_AUTH_MODE: 'trusted_local', APP_LEARNER_ID: 'http-learner', APP_DATA_DIR: dir });
  const { createApp } = await import('../server/index.ts');
  bootstrapLearner({ learnerId: 'other' });
  server = createApp({ frontendDistPath: null, wakeSessionDebriefs: () => undefined, wakeVocabulary: () => undefined }).listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const address = server.address(); assert(address && typeof address !== 'string'); base = `http://127.0.0.1:${address.port}`;
  // The first request bootstraps the trusted-local learner before fixtures reference it.
  assert.equal((await fetch(`${base}/api/content-reactions`)).status, 200);
  readyConnections(asA, 'older', '2026-10-05T01:00:00.000Z', ['Older note']);
  readyConnections(asA, 'newer', '2026-10-06T01:00:00.000Z', ['First newer note', 'Second newer note']);
  readyConnections(asB, 'other-session', '2026-10-06T01:00:00.000Z', ['Other learner note']);
  lesson('http-learner', 'lesson-a');
  lesson('other', 'lesson-b');
});
after(async () => {
  if (server?.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
  getDb().close(); fs.rmSync(dir, { recursive: true, force: true });
});

test('input parsing keeps reasons to not_for_me and notes to saved items', () => {
  const subject = connection('newer', 0);
  assert.deepEqual(parseContentReactionInput({ subject, reaction: 'not_for_me', reasons: ['too_long', 'wrong'], surface: 'home' }),
    { subject, reaction: 'not_for_me', reasons: ['wrong', 'too_long'], note: null, surface: 'home' });
  assert.equal(parseContentReactionInput({ subject, reaction: 'saved', note: '   ', surface: 'saved' }).note, null);
  for (const body of [
    { subject, reaction: 'saved', reasons: ['wrong'], surface: 'home' },
    { subject, reaction: 'not_for_me', note: 'hm', surface: 'home' },
    { subject, reaction: 'liked', surface: 'home' },
    { subject, reaction: 'saved', surface: 'elsewhere' },
    { subject, reaction: 'not_for_me', reasons: ['wrong', 'wrong'], surface: 'home' },
    { subject: { ...subject, noteIndex: -1 }, reaction: 'saved', surface: 'home' },
    { subject: { kind: 'lesson', messageId: 'x', sessionId: 'y' }, reaction: 'saved', surface: 'home' },
    { subject, reaction: 'saved', surface: 'home', learnerId: 'forged' },
  ]) assert.throws(() => parseContentReactionInput(body), ContentReactionInputError, JSON.stringify(body));
});

test('one current reaction per subject; reaction changes and clears are appended, note edits are not', () => {
  const subject = connection('newer', 1);
  const saved = asA(() => setContentReaction(input({ subject }), '2026-10-06T02:00:00.000Z'));
  assert.deepEqual(saved, { subject, reaction: 'saved', reasons: [], note: null, updatedAt: '2026-10-06T02:00:00.000Z' });
  asA(() => setContentReaction(input({ subject, note: 'Remember this', surface: 'saved' }), '2026-10-06T02:01:00.000Z'));
  const changed = asA(() => setContentReaction(input({ subject, reaction: 'not_for_me', reasons: ['confusing'] }), '2026-10-06T02:02:00.000Z'));
  assert.equal(changed?.reaction, 'not_for_me'); assert.equal(changed?.note, null);
  assert.equal(asA(() => setContentReaction(input({ subject, reaction: null }), '2026-10-06T02:03:00.000Z')), null);
  assert.equal(asA(() => setContentReaction(input({ subject, reaction: null }), '2026-10-06T02:04:00.000Z')), null);
  assert.deepEqual(asA(listContentReactions), []);
  assert.deepEqual(events().map((row) => [row.reaction, row.reasons_json, row.surface]),
    [['saved', '[]', 'home'], ['not_for_me', '["confusing"]', 'home'], [null, '[]', 'home']]);
  assert.throws(() => getDb().exec('UPDATE learner_content_reaction_events SET surface = \'saved\''), /append-only/);
});

test('learners can react only to their own ready notes and lessons', () => {
  for (const subject of [connection('other-session', 0), connection('newer', 2), connection('missing', 0), { kind: 'lesson' as const, messageId: 'lesson-b' }]) {
    assert.throws(() => asA(() => setContentReaction(input({ subject }))), ContentReactionNotFoundError, JSON.stringify(subject));
  }
  assert.equal(asB(() => setContentReaction(input({ subject: connection('other-session', 0) })))?.reaction, 'saved');
  assert.deepEqual(asA(listContentReactions), []);
});

test('saved collection lists recent connections with words, saved older notes, and saved lessons', () => {
  asA(() => setContentReaction(input({ subject: connection('older', 0), surface: 'saved' }), '2026-10-07T00:00:00.000Z'));
  asA(() => setContentReaction(input({ subject: { kind: 'lesson', messageId: 'lesson-a' }, surface: 'feedback' }), '2026-10-07T00:01:00.000Z'));
  const all = asA(() => getSavedCollection());
  assert.deepEqual(all.connections.map((note) => [note.sessionId, note.noteIndex, note.reaction?.reaction ?? null]),
    [['newer', 0, null], ['newer', 1, null], ['older', 0, 'saved']]);
  assert.deepEqual(all.connections[0].words, [{ word: '词1', pinyin: 'cí 1' }, { word: '词3', pinyin: 'cí 3' }]);
  assert.deepEqual(all.lessons.map((item) => [item.messageId, item.subjectLabel, item.reaction.reaction]), [['lesson-a', 'Shared expression', 'saved']]);
  // An older saved note stays reachable after it falls outside the recent window.
  assert.deepEqual(asA(() => getSavedCollection(1)).connections.map((note) => note.sessionId), ['newer', 'newer', 'older']);
});

test('operator summary counts reactions by prompt and returns only Wrong-flagged text', () => {
  asA(() => setContentReaction(input({ subject: connection('newer', 0), reaction: 'not_for_me', reasons: ['wrong', 'too_long'] }), '2026-10-08T00:00:00.000Z'));
  const summary = getContentReactionSummary();
  assert.deepEqual(summary.totals, [
    { kind: 'connection', reaction: 'not_for_me', count: 1 }, { kind: 'connection', reaction: 'saved', count: 2 },
    { kind: 'lesson', reaction: 'saved', count: 1 }]);
  assert.deepEqual(summary.reasons, [{ kind: 'connection', reason: 'wrong', count: 1 }, { kind: 'connection', reason: 'too_long', count: 1 }]);
  assert.deepEqual(summary.connectionsByPrompt,
    [{ promptVersion: 'session-debrief-v7', model: 'gpt-6.1-sol', notes: 4, saved: 2, notForMe: 1 }]);
  assert.deepEqual(summary.flaggedWrong.map((row) => [row.kind, row.learnerId, row.text]), [['connection', 'http-learner', 'First newer note']]);
});

test('HTTP routes validate, scope to the current learner, and return the collection', async () => {
  const put = (body: unknown) => fetch(`${base}/api/content-reactions`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let response = await put({ subject: connection('newer', 1), reaction: 'saved', reasons: [], note: 'Nice', surface: 'home' });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).reaction.note, 'Nice');
  assert.equal((await put({ subject: connection('other-session', 0), reaction: 'saved', surface: 'home' })).status, 404);
  assert.equal((await put({ subject: connection('newer', 1), reaction: 'saved', surface: 'nowhere' })).status, 400);
  response = await fetch(`${base}/api/content-reactions`);
  assert.equal((await response.json()).reactions.length, 4);
  const collection = await fetch(`${base}/api/saved-collection`).then((res) => res.json());
  assert.deepEqual(collection.connections.map((note: { text: string }) => note.text), ['First newer note', 'Second newer note', 'Older note']);
});
