import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Server } from 'node:http';
import { after, before, beforeEach, describe, test } from 'node:test';

type DbModule = typeof import('../server/db.ts');
let db: DbModule;
let sqlite: DatabaseSync;
let directory: string;
let server: Server;
let origin: string;
let rawLearner = 'test-learner';

describe('My words collections', { concurrency: false }, () => {
  before(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'my-words-'));
    const previousEnvironment = {
      APP_MODE: process.env.APP_MODE,
      APP_DATA_DIR: process.env.APP_DATA_DIR,
      APP_LEARNER_ID: process.env.APP_LEARNER_ID,
    };
    process.env.APP_MODE = 'study';
    process.env.APP_DATA_DIR = directory;
    process.env.APP_LEARNER_ID = 'test-learner';
    try {
      db = await import('../server/db.ts');
    } finally {
      for (const [key, value] of Object.entries(previousEnvironment)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
    db.bootstrapLearner({ learnerId: 'other-learner' });
    sqlite = new DatabaseSync(path.join(directory, 'app.db'));
    sqlite.function('current_learner_id', () => rawLearner);
    sqlite.exec('PRAGMA foreign_keys = ON');
    const { createApp } = await import('../server/index.ts');
    server = createApp({ frontendDistPath: null }).listen(0, '127.0.0.1');
    await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    const address = server.address();
    assert(address && typeof address !== 'string');
    origin = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(() => {
    rawLearner = 'test-learner';
    sqlite.exec('DELETE FROM study_attempt_events; DELETE FROM study_sessions; DELETE FROM word_skill_state; DELETE FROM user_word_priority; DELETE FROM words;');
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    sqlite.close();
    const { closeDbConnection } = await import('../server/db/connection.ts');
    closeDbConnection();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  test('personal membership includes waiting and studied words; removal and dismissal exclude words', () => {
    insert('waiting'); insert('required'); insert('removed'); insert('dismissed'); insert('ordinary', 'learning');
    for (const id of ['waiting', 'removed', 'dismissed']) db.updateWordUserPriority(id, { bumpDelta: 1 });
    db.updateWordUserPriority('required', { requiredForNextSession: true });
    db.completeUnstudiedWordSession('required', '2026-09-13');
    db.updateWordUserPriority('removed', { reset: true });
    db.dismissWordFromStudy('dismissed');
    assert.deepEqual(new Set(db.getMyWords({ view: 'personal' }).words.map((entry) => entry.word.id)), new Set(['waiting', 'required']));
    assert.deepEqual(new Set(db.getMyWords().words.map((entry) => entry.word.id)), new Set(['required', 'ordinary']));
  });

  test('recency includes failed accepted reviews, combines sources, and sorts missing dates last', () => {
    insert('missing', 'learning'); insert('learning', 'learning', '2026-09-10');
    insert('review', 'review', '2026-09-01');
    sqlite.prepare(`INSERT INTO study_sessions (id, started_at, processing_state) VALUES ('session', '2026-09-01T00:00:00Z', 'processed')`).run();
    insertAttempt('accepted', '2026-09-12T20:00:00.000Z', '2026-09-12T20:00:01.000Z');
    insertAttempt('unprojected', '2026-09-14T20:00:00.000Z', null);
    sqlite.prepare(`INSERT INTO word_skill_state (word_id, skill_id, enabled, interval_hours, last_studied_at, next_due_at, ease_factor) VALUES ('review', 'recognition', 1, 24, '2026-09-11T00:00:00.000Z', NULL, 2.5)`).run();
    const entries = db.getMyWords().words;
    assert.deepEqual(entries.map((entry) => entry.word.id), ['review', 'learning', 'missing']);
    assert.deepEqual(entries.map((entry) => entry.lastStudiedAt), ['2026-09-12', '2026-09-10', null]);
  });

  test('search spans the collection before pagination and treats wildcard characters literally', () => {
    for (let index = 0; index < 55; index++) insert(`word-${String(index).padStart(2, '0')}`, 'learning');
    sqlite.prepare('UPDATE words SET meaning = ? WHERE id = ?').run('100% under_score \\ unique', 'word-54');
    sqlite.prepare('UPDATE words SET meanings_json = ? WHERE id = ?').run('["first gloss", "secondary gloss"]', 'word-53');
    const first = db.getMyWords();
    assert.equal(first.words.length, 50); assert.equal(first.hasMore, true);
    assert.equal(db.getMyWords({ offset: 50 }).words.length, 5);
    for (const query of ['unique', '%', '_', '\\']) {
      assert.deepEqual(db.getMyWords({ query }).words.map((entry) => entry.word.id), ['word-54']);
    }
    assert.equal(db.getMyWords({ query: 'unique', view: 'personal' }).words.length, 0);
    assert.deepEqual(db.getMyWords({ query: 'secondary gloss' }).words.map((entry) => entry.word.id), ['word-53']);
    assert.equal(db.getMyWords({ offset: 55 }).hasMore, false);
  });

  test('personal order reflects overlay updates with stable id ties', () => {
    for (const id of ['b', 'a', 'c']) {
      insert(id); db.updateWordUserPriority(id, { bumpDelta: 1 });
      sqlite.prepare('UPDATE user_word_priority SET updated_at = ? WHERE word_id = ?').run(id === 'c' ? '2026-09-12T00:00:00Z' : '2026-09-10T00:00:00Z', id);
    }
    assert.deepEqual(db.getMyWords({ view: 'personal' }).words.map((entry) => entry.word.id), ['c', 'a', 'b']);
  });

  test('learner context isolates membership, notes and study dates', () => {
    insert('shared', 'learning', '2026-09-12');
    db.updateWordPersonalNotes('shared', 'private note');
    assert.equal(db.runWithLearnerId('other-learner', () => db.getMyWords()).words.length, 0);
    db.runWithLearnerId('other-learner', () => db.updateWordUserPriority('shared', { bumpDelta: 1 }));
    const other = db.runWithLearnerId('other-learner', () => db.getMyWords({ view: 'personal' })).words[0];
    assert.equal(other.word.status, 'unstudied');
    assert.equal(other.word.personalNotes, '');
    assert.equal(other.lastStudiedAt, null);
    assert.equal(db.getMyWords({ view: 'personal' }).words.length, 0);
  });

  test('HTTP validates pagination and filters, and returns the bounded payload', async () => {
    insert('http', 'learning');
    for (const query of ['view=unknown', 'limit=0', 'limit=101', 'limit=1.5', 'offset=-1', 'offset=9007199254740992', 'q[x]=a', 'view=recent&view=personal']) {
      assert.equal((await fetch(`${origin}/api/my-words?${query}`)).status, 400, query);
    }
    const response = await fetch(`${origin}/api/my-words?view=recent&limit=1&offset=0&q=http`);
    assert.equal(response.status, 200);
    const payload = await response.json() as { words: Array<{ word: { id: string } }>; hasMore: boolean };
    assert.equal(payload.words[0]?.word.id, 'http'); assert.equal(payload.hasMore, false);
  });
});

function insert(id: string, status: 'unstudied' | 'learning' | 'review' = 'unstudied', covered: string | null = null) {
  sqlite.prepare(`INSERT INTO words (id, hanzi, traditional, pinyin, meaning, meanings_json, examples_json, personal_notes, status, priority, created_at, learning_streak, last_learning_success_on, last_learning_covered_on)
    VALUES (?, ?, NULL, ?, ?, '[]', '[]', '', ?, 1, '2026-01-01T00:00:00.000Z', 0, NULL, ?)`)
    .run(id, id, id, id, status, covered);
}

function insertAttempt(id: string, occurred: string, projected: string | null) {
  sqlite.prepare(`INSERT INTO study_attempt_events (id, occurred_at, session_id, session_action_id, session_event_sequence, action_attempt_sequence, action_kind, target_word_id, sampled_skill_ids_json, response, outcome, rating, content_ref_json, metadata_json, projected_at)
    VALUES (?, ?, 'session', ?, ?, 1, 'recognition', 'review', '["recognition"]', NULL, 'incorrect', NULL, NULL, '{}', ?)`)
    .run(id, occurred, id, projected ? 1 : 2, projected);
}
