import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, beforeEach, describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';

type DbModule = typeof import('../server/db.ts');

let dataDir = '';
let dbPath = '';
let sqlite: DatabaseSync;
let dbModule: DbModule;

describe('word meanings', { concurrency: false }, () => {
  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-study-app-word-meanings-tests-'));
    dbPath = path.join(dataDir, 'app.db');

    const previousMode = process.env.APP_MODE;
    const previousDataDir = process.env.APP_DATA_DIR;

    process.env.APP_MODE = 'study';
    process.env.APP_DATA_DIR = dataDir;

    const moduleUrl = `${pathToFileURL(path.resolve('server/db.ts')).href}?test=${Date.now()}`;
    dbModule = await import(moduleUrl);

    if (previousMode === undefined) {
      delete process.env.APP_MODE;
    } else {
      process.env.APP_MODE = previousMode;
    }

    if (previousDataDir === undefined) {
      delete process.env.APP_DATA_DIR;
    } else {
      process.env.APP_DATA_DIR = previousDataDir;
    }

    sqlite = new DatabaseSync(dbPath);
    sqlite.exec('PRAGMA foreign_keys = ON;');
  });

  beforeEach(() => {
    sqlite.exec(`
      DELETE FROM daily_new_word_intake;
      DELETE FROM user_word_priority;
      DELETE FROM words;
    `);
  });

  after(() => {
    sqlite.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('returns word meanings ordered by position and persists visibility toggles', () => {
    const wordId = 'meaning-word';
    insertWord(wordId, '词', 'ci2', ['word', 'term']);
    insertWordMeaning({
      id: `${wordId}-meaning-2`,
      wordId,
      position: 1,
      text: 'term',
      showOnProductionPrompt: true,
    });
    insertWordMeaning({
      id: `${wordId}-meaning-1`,
      wordId,
      position: 0,
      text: 'word',
      showOnProductionPrompt: true,
    });

    const ordered = dbModule.getWordMeanings(wordId);
    assert.deepEqual(ordered.map((meaning) => meaning.text), ['word', 'term']);
    assert.deepEqual(ordered.map((meaning) => meaning.position), [0, 1]);
    assert(ordered.every((meaning) => meaning.showOnProductionPrompt));

    const updated = dbModule.updateWordMeaningVisibility(wordId, `${wordId}-meaning-1`, false);
    assert.equal(updated[0].showOnProductionPrompt, false);
    assert.equal(updated[1].showOnProductionPrompt, true);
  });

  test('throws clear errors for missing word and missing meaning rows', () => {
    assert.throws(() => dbModule.getWordMeanings('missing-word'), /Word not found/);

    const wordId = 'existing-word';
    insertWord(wordId, '学', 'xue2', ['learn']);

    assert.throws(
      () => dbModule.updateWordMeaningVisibility(wordId, 'missing-meaning', false),
      /Word meaning not found/,
    );
  });

});

function insertWord(wordId: string, hanzi: string, pinyin: string, meanings: string[]) {
  sqlite.prepare(`
    INSERT INTO words (
      id,
      hanzi,
      pinyin,
      meaning,
      meanings_json,
      personal_notes,
      examples_json,
      status,
      priority,
      created_at,
      learning_streak,
      last_learning_success_on,
      last_learning_covered_on
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    wordId,
    hanzi,
    pinyin,
    meanings[0] ?? '',
    JSON.stringify(meanings),
    '',
    JSON.stringify(['example']),
    'review',
    10,
    '2026-01-01T00:00:00.000Z',
    0,
    null,
    null,
  );
}

function insertWordMeaning(record: {
  id: string;
  wordId: string;
  position: number;
  text: string;
  showOnProductionPrompt: boolean;
}) {
  sqlite.prepare(`
    INSERT INTO word_meanings (
      id,
      word_id,
      position,
      text,
      show_on_production_prompt,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.id,
    record.wordId,
    record.position,
    record.text,
    record.showOnProductionPrompt ? 1 : 0,
    '2026-01-01T00:00:00.000Z',
    '2026-01-01T00:00:00.000Z',
  );
}
