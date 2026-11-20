import { clearWordPreparationFixtures } from './helpers/prepared-word-fixtures.ts';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Server } from 'node:http';
import { after, before, beforeEach, describe, test } from 'node:test';
import { deckIdentityProbeSql, getResolvedDeckWordIds, invalidateDeckWordIds, DECK_WORD_STUDY_DATES_SQL } from '../server/db/deck-words.ts';

import { getDb } from '../server/db/connection.ts';
import { getVocabularyWordsCollection } from '../server/db/vocabulary-words.ts';
import { loadDeckManifest } from '../server/decks/manifest.ts';

type DbModule = typeof import('../server/db.ts');
let db: DbModule;
let sqlite: DatabaseSync;
let directory: string;
let server: Server;
let origin: string;
const rawLearner = 'test-learner';
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
    clearWordPreparationFixtures(sqlite);
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

  test('HTTP validates pagination and filters, and returns the bounded payload', async () => {
    assert.equal((await fetch(`${origin}/api/my-words`)).status, 404);
    insertDeckWord('http', '我', 'wǒ');
    place({ 'hsk2-l1': 1 });
    for (const query of ['view=unknown', 'limit=0', 'limit=101', 'limit=1.5', 'offset=-1', 'offset=9007199254740992', 'q[x]=a', 'view=recent&view=personal', 'mode=nope', 'lapses=maybe']) {
      assert.equal((await fetch(`${origin}/api/vocabulary/word-collection?${query}`)).status, 400, query);
    }
    const response = await fetch(`${origin}/api/vocabulary/word-collection?view=deck&limit=1&offset=0&q=http&mode=unstudied&lapses=0`);
    assert.equal(response.status, 200);
    const payload = await response.json() as { words: Array<{ word: { id: string } }>; hasMore: boolean; total: number };
    assert.equal(payload.words[0]?.word.id, 'http'); assert.equal(payload.hasMore, false);
    assert.equal(payload.total, 1);
  });

  test('current deck is unavailable until placement is stored; the fallback does not create placement', () => {
    assert.equal(getVocabularyWordsCollection().currentDeck, null);
    assert.deepEqual(getVocabularyWordsCollection({ view: 'deck' }), { words: [], hasMore: false, total: 0, currentDeck: null });
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
    sink('dismissed');
    place({ 'hsk2-l1': 1 });
    const before = db.getStoredDietProfile();
    const result = getVocabularyWordsCollection({ view: 'deck' });
    assert.equal(result.currentDeck?.label, 'HSK 1');
    assert.deepEqual(new Set(result.words.map((entry) => entry.word.id)), new Set(['unseen', 'personal', 'studied', 'normalized']));
    assert.equal(result.words.find((entry) => entry.word.id === 'unseen')?.word.status, 'unstudied');
    assert.equal(result.total, 4);
    assert.deepEqual(db.getStoredDietProfile(), before);
    const response = await fetch(`${origin}/api/vocabulary/word-collection?view=deck&q=我`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.words.length, 1);
    assert.equal(payload.words[0].word.id, 'unseen');
    assert.equal(payload.total, 1);
  });

  test('deck mix follows positive weights and excludes unrelated levels', () => {
    insertDeckWord('l1', '我', 'wǒ'); insertDeckWord('l2', '猫', 'māo');
    insertDeckWord('l3', '抽象', 'chōu xiàng');
    place({ 'hsk2-l2': 1, 'hsk2-l1': 0 });
    assert.deepEqual(getVocabularyWordsCollection({ view: 'deck' }).words.map((entry) => entry.word.id), ['l2']);
    place({ 'hsk2-l2': 0.9, 'hsk2-l3-s1': 0.1 });
    const mix = getVocabularyWordsCollection({ view: 'deck' });
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
      const all = getVocabularyWordsCollection({ view: 'deck' });
      assert.equal(all.words.length, 50);
      assert.equal(all.total, 455);
      assert.equal(all.hasMore, true);
      const ids = new Set(all.words.map(entry => entry.word.id));
      for (let offset = 50; offset < all.total; offset += 100) {
        const page = getVocabularyWordsCollection({ view: 'deck', offset, limit: 100 });
        for (const entry of page.words) ids.add(entry.word.id);
      }
      assert.equal(ids.size, 455);
      assert.equal(getVocabularyWordsCollection({ view: 'deck', query: '测试454' }).total, 1);
      assert.equal(getVocabularyWordsCollection({ view: 'deck', query: 'unrelated' }).total, 0);
    } finally { process.env.APP_DECK_MANIFEST_PATH = previousPath; }
  });

  test('deck detail dates and notes remain learner-private with shared lexical probes', () => {
    insertDeckWord('shared', '我', 'wǒ', 'learning');
    db.updateWordPersonalNotes('shared', 'private note');
    sqlite.prepare('UPDATE words SET last_learning_covered_on = ? WHERE id = ?').run('2026-09-13', 'shared');
    place({ 'hsk2-l1': 1 });
    assert.equal(getVocabularyWordsCollection({ view: 'deck' }).words[0].lastStudiedAt, '2026-09-13');
    assert.equal(db.runWithLearnerId('other-learner', () => getVocabularyWordsCollection()).currentDeck, null);
    db.runWithLearnerId('other-learner', () => place({ 'hsk2-l1': 1 }));
    const other = db.runWithLearnerId('other-learner', () => getVocabularyWordsCollection({ view: 'deck' }));
    assert.equal(other.words.length, 1);
    assert.equal(other.words[0].word.personalNotes, '');
    assert.equal(other.words[0].word.status, 'unstudied');
    assert.equal(other.words[0].lastStudiedAt, null);
  });

  test('Beyond HSK and mixes containing it are unavailable without scanning a remainder', () => {
    insert('unmapped'); insertDeckWord('explicit', '我', 'wǒ');
    const mixes: Record<string, number>[] = [{ 'beyond-hsk': 1 }, { 'hsk2-l1': 0.9, 'beyond-hsk': 0.1 }];
    for (const weights of mixes) {
      place(weights);
      assert.deepEqual(getVocabularyWordsCollection({ view: 'deck' }), { words: [], hasMore: false, total: 0, currentDeck: null });
      assert.equal(getVocabularyWordsCollection().currentDeck, null);
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
    place({ 'hsk2-l1': 1 });
    assert.equal(getVocabularyWordsCollection({ view: 'deck' }).words[0]?.word.id, 'first');
    assert.ok(getVocabularyWordsCollection({ view: 'deck' }).words[0]?.personalUpdatedAt);
    db.runWithLearnerId('other-learner', () => {
      assert.strictEqual(getResolvedDeckWordIds(manifest), cached);
      place({ 'hsk2-l1': 1 });
      const other = getVocabularyWordsCollection({ view: 'deck' }).words[0];
      assert.equal(other?.word.id, 'first');
      assert.equal(other?.personalUpdatedAt, null);
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

  test('production queries probe lexical identities; dates make one learner-scoped history pass', () => {
    const identityPlan = sqlite.prepare(`EXPLAIN QUERY PLAN ${deckIdentityProbeSql(2)}`).all('我', '猫') as Array<{ detail: string }>;
    assert.match(identityPlan.map((row) => row.detail).join('\n'), /SEARCH lexical_words USING INDEX idx_lexical_words_hanzi/);
    const datePlan = sqlite.prepare(`EXPLAIN QUERY PLAN ${DECK_WORD_STUDY_DATES_SQL}`).all(JSON.stringify(['word'])) as Array<{ detail: string }>;
    const details = datePlan.map((row) => row.detail).join('\n');
    assert.match(details, /SEARCH learner_owned_study_attempt_events USING INDEX .*\(learner_id=\?\)/);
    assert.equal(datePlan.filter((row) => row.detail.includes('SEARCH learner_owned_study_attempt_events')).length, 1);
    assert.doesNotMatch(details, /idx_study_attempts_word_date/);
    assert.match(details, /SEARCH learner_owned_word_skill_state USING (COVERING )?INDEX/);
    assert.doesNotMatch(details, /SCAN learner_owned_/);
  });

  test('missing manifest hides deck browsing even with stored placement', () => {
    place({ 'hsk2-l1': 1 });
    const manifestPath = process.env.APP_DECK_MANIFEST_PATH;
    process.env.APP_DECK_MANIFEST_PATH = path.join(directory, 'absent.json');
    try {
      assert.equal(getVocabularyWordsCollection().currentDeck, null);
      assert.deepEqual(getVocabularyWordsCollection({ view: 'deck' }), { words: [], hasMore: false, total: 0, currentDeck: null });
    } finally { process.env.APP_DECK_MANIFEST_PATH = manifestPath; }
  });
});

function place(weights: Record<string, number>) {
  db.saveDietProfile({ version: 1, weights, provenance: [], updatedAt: '2026-09-13T00:00:00Z' });
}

/** Dismissing an unstudied word sinks its priority overlay (sunk tier is -1). */
function sink(id: string) {
  sqlite.prepare(`INSERT INTO learner_owned_user_word_priority
      (learner_id, word_id, bump_count, force_top, priority_tier, required_for_next_session, updated_at)
    VALUES (?, ?, 0, 0, -1, 0, ?)
    ON CONFLICT(learner_id, word_id) DO UPDATE SET bump_count = 0, force_top = 0, priority_tier = -1,
      required_for_next_session = 0, updated_at = excluded.updated_at`)
    .run(rawLearner, id, new Date().toISOString());
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
