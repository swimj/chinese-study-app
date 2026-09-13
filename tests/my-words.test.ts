import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Server } from 'node:http';
import { after, before, beforeEach, describe, test } from 'node:test';
import { deckIdentityProbeSql, deckWordProbeSql, getResolvedDeckWordIds, invalidateDeckWordIds, queryManifestDeckWords, DECK_WORD_STUDY_DATES_SQL } from '../server/db/deck-words.ts';

import { getDb } from '../server/db/connection.ts';
import { loadDeckManifest } from '../server/decks/manifest.ts';

type DbModule = typeof import('../server/db.ts');
let db: DbModule;
let sqlite: DatabaseSync;
let directory: string;
let server: Server;
let origin: string;
let rawLearner = 'test-learner';
const previousManifestPath = process.env.APP_DECK_MANIFEST_PATH;

describe('My words collections', { concurrency: false }, () => {
  before(async () => {
    process.env.APP_DECK_MANIFEST_PATH = path.resolve('tests/fixtures/mandarin-decks-v1.fixture.json');
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
    sqlite.exec("DELETE FROM learner_settings WHERE setting_key = 'diet_profile'");
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    sqlite.close();
    const { closeDbConnection } = await import('../server/db/connection.ts');
    closeDbConnection();
    fs.rmSync(directory, { recursive: true, force: true });
    if (previousManifestPath === undefined) delete process.env.APP_DECK_MANIFEST_PATH;
    else process.env.APP_DECK_MANIFEST_PATH = previousManifestPath;
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
    sqlite.prepare('UPDATE words SET hanzi = ?, pinyin = ? WHERE id = ?').run('我', 'wǒ', 'review');
    place({ 'hsk2-l1': 1 });
    const deck = db.getMyWords({ view: 'deck' });
    assert.equal(deck.words.length, 1);
    assert.equal(deck.words[0].lastStudiedAt, '2026-09-12');
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

  test('current deck is unavailable until placement is stored; the fallback does not create placement', () => {
    assert.equal(db.getMyWords().currentDeck, null);
    assert.deepEqual(db.getMyWords({ view: 'deck' }), { words: [], hasMore: false, currentDeck: null });
    assert.equal(db.getStoredDietProfile(), null);
  });

  test('current deck includes unseen, personal and studied words with exact pronunciation matching', async () => {
    insertDeckWord('unseen', '我', 'wǒ');
    insertDeckWord('personal', '你', 'nǐ');
    insertDeckWord('studied', '他', 'tā', 'learning');
    insertDeckWord('other-deck', '猫', 'māo', 'review');
    insertDeckWord('other-reading', '我', 'wò');
    insertDeckWord('normalized', '她', '  TĀ  ');
    insertDeckWord('dismissed', '是', 'shì');
    db.updateWordUserPriority('personal', { bumpDelta: 1 });
    db.dismissWordFromStudy('dismissed');
    place({ 'hsk2-l1': 1 });
    const before = db.snapshotStoredDietProfile();
    const result = db.getMyWords({ view: 'deck' });
    assert.equal(result.currentDeck?.label, 'HSK 1');
    assert.deepEqual(new Set(result.words.map((entry) => entry.word.id)), new Set(['unseen', 'personal', 'studied', 'normalized']));
    assert.equal(result.words.find((entry) => entry.word.id === 'unseen')?.word.status, 'unstudied');
    assert.equal(db.snapshotStoredDietProfile(), before);
    assert.equal(db.getMyWords({ view: 'personal' }).words.length, 1);
    const response = await fetch(`${origin}/api/my-words?view=deck&q=我`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.words.length, 1);
    assert.equal(payload.words[0].word.id, 'unseen');
  });

  test('deck mix follows positive weights and nudges, not cumulative HSK levels or automatic spill', () => {
    insertDeckWord('l1', '我', 'wǒ'); insertDeckWord('l2', '猫', 'māo');
    insertDeckWord('l3', '抽象', 'chōu xiàng');
    place({ 'hsk2-l2': 1, 'hsk2-l1': 0 });
    assert.deepEqual(db.getMyWords({ view: 'deck' }).words.map((entry) => entry.word.id), ['l2']);
    db.nudgeDietProfile('harder');
    const mix = db.getMyWords({ view: 'deck' });
    assert.deepEqual(new Set(mix.words.map((entry) => entry.word.id)), new Set(['l2', 'l3']));
    assert.equal(mix.currentDeck?.label, 'HSK 2 + HSK 3 · part 1');
  });

  test('full deck loading has no 50-word cutoff and search stays inside explicit membership', () => {
    const previousPath = process.env.APP_DECK_MANIFEST_PATH;
    const fixture = JSON.parse(fs.readFileSync(previousPath!, 'utf8'));
    for (let index = 0; index < 455; index++) {
      const hanzi = `测试${index}`;
      fixture.assignments[`${hanzi}|cè shì`] = 'hsk2-l1';
      insertDeckWord(`deck-${index}`, hanzi, 'cè shì');
    }
    const manifestPath = path.join(directory, 'large-deck.json');
    fs.writeFileSync(manifestPath, JSON.stringify(fixture));
    process.env.APP_DECK_MANIFEST_PATH = manifestPath;
    place({ 'hsk2-l1': 1 });
    insert('unrelated');
    try {
      const all = db.getMyWords({ view: 'deck' });
      assert.equal(all.words.length, 455);
      assert.equal(new Set(all.words.map((entry) => entry.word.id)).size, 455);
      assert.equal(all.hasMore, false);
      assert.equal(db.getMyWords({ view: 'deck', query: '测试454' }).words[0].word.id, 'deck-454');
      assert.equal(db.getMyWords({ view: 'deck', query: 'unrelated' }).words.length, 0);
    } finally { process.env.APP_DECK_MANIFEST_PATH = previousPath; }
  });

  test('deck detail dates and notes remain learner-private with shared lexical probes', () => {
    insertDeckWord('shared', '我', 'wǒ', 'learning');
    db.updateWordPersonalNotes('shared', 'private note');
    sqlite.prepare('UPDATE words SET last_learning_covered_on = ? WHERE id = ?').run('2026-09-13', 'shared');
    place({ 'hsk2-l1': 1 });
    assert.equal(db.getMyWords({ view: 'deck' }).words[0].lastStudiedAt, '2026-09-13');
    assert.equal(db.runWithLearnerId('other-learner', () => db.getMyWords()).currentDeck, null);
    db.runWithLearnerId('other-learner', () => place({ 'hsk2-l1': 1 }));
    const other = db.runWithLearnerId('other-learner', () => db.getMyWords({ view: 'deck' }));
    assert.equal(other.words.length, 1);
    assert.equal(other.words[0].word.personalNotes, '');
    assert.equal(other.words[0].word.status, 'unstudied');
    assert.equal(other.words[0].lastStudiedAt, null);
  });

  test('Beyond HSK and mixes containing it are unavailable without scanning a remainder', () => {
    insert('unmapped'); insertDeckWord('explicit', '我', 'wǒ');
    for (const weights of [{ 'beyond-hsk': 1 }, { 'hsk2-l1': 0.9, 'beyond-hsk': 0.1 }]) {
      place(weights);
      assert.deepEqual(db.getMyWords({ view: 'deck' }), { words: [], hasMore: false, currentDeck: null });
      assert.equal(db.getMyWords().currentDeck, null);
    }
  });

  test('resolved identities are shared across decks while learner state stays fresh', () => {
    insertDeckWord('first', '我', 'wǒ');
    insertDeckWord('second', '猫', 'māo');
    const manifest = loadDeckManifest()!;
    const cached = getResolvedDeckWordIds(manifest);
    assert.deepEqual(cached.get('hsk2-l1'), ['first']);
    assert.deepEqual(cached.get('hsk2-l2'), ['second']);
    db.updateWordUserPriority('first', { bumpDelta: 1 });
    assert.strictEqual(getResolvedDeckWordIds(manifest), cached);
    assert.equal(queryManifestDeckWords(manifest, ['hsk2-l1'], 'diet').length, 0);
    assert.equal(queryManifestDeckWords(manifest, ['hsk2-l1'], 'browse').length, 1);
    db.runWithLearnerId('other-learner', () => {
      assert.strictEqual(getResolvedDeckWordIds(manifest), cached);
      assert.equal(queryManifestDeckWords(manifest, ['hsk2-l1'], 'diet').length, 1);
    });
  });

  test('identity cache observes external imports and explicit same-connection invalidation', () => {
    insertDeckWord('first', '我', 'wǒ');
    const manifest = loadDeckManifest()!;
    const cached = getResolvedDeckWordIds(manifest);
    insertDeckWord('second', '你', 'nǐ');
    assert.notStrictEqual(getResolvedDeckWordIds(manifest), cached);
    assert.deepEqual(new Set(getResolvedDeckWordIds(manifest).get('hsk2-l1')), new Set(['first', 'second']));
    invalidateDeckWordIds();
    getDb().prepare('UPDATE lexical_words SET pinyin = ? WHERE id = ?').run('wrong', 'first');
    assert.deepEqual(getResolvedDeckWordIds(manifest).get('hsk2-l1'), ['second']);
  });

  test('rolled-back lexical identities cannot enter the shared cache', () => {
    insertDeckWord('first', '我', 'wǒ');
    const manifest = loadDeckManifest()!;
    const cached = getResolvedDeckWordIds(manifest);
    getDb().exec('BEGIN');
    try {
      getDb().prepare('UPDATE lexical_words SET pinyin = ? WHERE id = ?').run('wrong', 'first');
      assert.equal(getResolvedDeckWordIds(manifest).get('hsk2-l1'), undefined);
    } finally { getDb().exec('ROLLBACK'); }
    assert.strictEqual(getResolvedDeckWordIds(manifest), cached);
    assert.deepEqual(cached.get('hsk2-l1'), ['first']);
  });

  test('production queries probe lexical identities and IDs; dates make one learner-scoped history pass', () => {
    const identityPlan = sqlite.prepare(`EXPLAIN QUERY PLAN ${deckIdentityProbeSql(2)}`).all('我', '猫') as Array<{ detail: string }>;
    assert.match(identityPlan.map((row) => row.detail).join('\n'), /SEARCH lexical_words USING INDEX idx_lexical_words_hanzi/);
    for (const purpose of ['browse', 'diet'] as const) {
      const plan = sqlite.prepare(`EXPLAIN QUERY PLAN ${deckWordProbeSql(2, purpose)}`).all('word-1', 'word-2') as Array<{ detail: string }>;
      const details = plan.map((row) => row.detail).join('\n');
      assert.match(details, /SEARCH lexical_words USING INDEX sqlite_autoindex_lexical_words_1/);
      assert.doesNotMatch(details, /SCAN (lexical_words|learner_word_state|learner_owned_user_word_priority)/);
    }
    const datePlan = sqlite.prepare(`EXPLAIN QUERY PLAN ${DECK_WORD_STUDY_DATES_SQL}`).all(JSON.stringify(['word'])) as Array<{ detail: string }>;
    const details = datePlan.map((row) => row.detail).join('\n');
    assert.match(details, /SEARCH learner_owned_study_attempt_events USING INDEX .*\(learner_id=\?\)/);
    assert.equal(datePlan.filter((row) => row.detail.includes('SEARCH learner_owned_study_attempt_events')).length, 1);
    assert.doesNotMatch(details, /idx_study_attempts_word_date/);
    assert.match(details, /SEARCH learner_owned_word_skill_state USING INDEX/);
    assert.doesNotMatch(details, /SCAN learner_owned_/);
  });

  test('missing manifest hides deck browsing even with stored placement', () => {
    place({ 'hsk2-l1': 1 });
    const manifestPath = process.env.APP_DECK_MANIFEST_PATH;
    process.env.APP_DECK_MANIFEST_PATH = path.join(directory, 'absent.json');
    try {
      assert.equal(db.getMyWords().currentDeck, null);
      assert.deepEqual(db.getMyWords({ view: 'deck' }), { words: [], hasMore: false, currentDeck: null });
    } finally { process.env.APP_DECK_MANIFEST_PATH = manifestPath; }
  });
});

function place(weights: Record<string, number>) {
  db.saveDietProfile({ version: 1, weights, provenance: [], updatedAt: '2026-09-13T00:00:00Z' });
}

function insertDeckWord(id: string, hanzi: string, pinyin: string, status: 'unstudied' | 'learning' | 'review' = 'unstudied') {
  insert(id, status);
  sqlite.prepare('UPDATE words SET hanzi = ?, pinyin = ? WHERE id = ?').run(hanzi, pinyin, id);
}

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
