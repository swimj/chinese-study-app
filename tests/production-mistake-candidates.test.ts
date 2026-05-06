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

describe('production mistake candidates', { concurrency: false }, () => {
  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-study-app-production-mistakes-'));
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
      DELETE FROM review_items;
      DELETE FROM words;
    `);
    fs.rmSync(path.join(dataDir, 'production-mistake-candidates.jsonl'), { force: true });
  });

  after(() => {
    sqlite.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('appends wrong production input to a JSONL candidate file', () => {
    insertWord('target-word', '考察');
    insertWord('matched-word', '考查');

    const candidate = dbModule.captureProductionMistakeCandidate({
      targetWordId: 'target-word',
      attemptedHanzi: ' 考 查 ',
    });

    assert.equal(candidate.targetWordId, 'target-word');
    assert.equal(candidate.targetHanzi, '考察');
    assert.equal(candidate.attemptedHanzi, '考查');
    assert.equal(candidate.matchedWordId, 'matched-word');
    assert.equal(candidate.note, '');
    assert.match(candidate.createdAt, /^\d{4}-\d{2}-\d{2}T/);

    assert.deepEqual(dbModule.getProductionMistakeCandidates(), [candidate]);

    const lines = fs
      .readFileSync(path.join(dataDir, 'production-mistake-candidates.jsonl'), 'utf8')
      .trim()
      .split('\n');
    assert.equal(lines.length, 1);
    assert.deepEqual(JSON.parse(lines[0]), candidate);
  });

  test('records unmatched attempted Hanzi without forcing a corpus match', () => {
    insertWord('target-word', '考察');

    const candidate = dbModule.captureProductionMistakeCandidate({
      targetWordId: 'target-word',
      attemptedHanzi: '不存在',
      note: 'typed during review',
    });

    assert.equal(candidate.matchedWordId, null);
    assert.equal(candidate.note, 'typed during review');
  });

  test('rejects same-Hanzi candidates', () => {
    insertWord('target-word', '考察');

    assert.throws(
      () =>
        dbModule.captureProductionMistakeCandidate({
          targetWordId: 'target-word',
          attemptedHanzi: '考察',
        }),
      /Expected attempted Hanzi to differ from target Hanzi/,
    );
  });
});

function insertWord(id: string, hanzi: string) {
  sqlite.prepare(`
    INSERT INTO words (
      id,
      hanzi,
      pinyin,
      meaning,
      examples_json,
      status,
      priority,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    hanzi,
    `${hanzi} pinyin`,
    `${hanzi} meaning`,
    JSON.stringify([]),
    'review',
    100,
    '2026-01-01T00:00:00.000Z',
  );
}
