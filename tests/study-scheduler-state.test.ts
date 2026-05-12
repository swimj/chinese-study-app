import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';

describe('study scheduler state', { concurrency: false }, () => {
  test('startup migrates existing word skill state to require last studied timestamps', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-study-app-study-state-not-null-'));
    const dbPath = path.join(dataDir, 'app.db');

    const sqlite = new DatabaseSync(dbPath);
    sqlite.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE words (
        id TEXT PRIMARY KEY,
        hanzi TEXT NOT NULL,
        traditional TEXT,
        pinyin TEXT NOT NULL,
        meaning TEXT NOT NULL,
        meanings_json TEXT NOT NULL DEFAULT '[]',
        personal_notes TEXT NOT NULL DEFAULT '',
        examples_json TEXT NOT NULL,
        status TEXT NOT NULL,
        priority INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        learning_streak INTEGER NOT NULL DEFAULT 0,
        last_learning_success_on TEXT,
        last_learning_covered_on TEXT
      );
      CREATE TABLE word_skill_state (
        word_id TEXT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
        skill_id TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        interval_hours INTEGER NOT NULL,
        last_studied_at TEXT,
        next_due_at TEXT,
        ease_factor REAL NOT NULL,
        PRIMARY KEY (word_id, skill_id)
      );
    `);
    insertWord(sqlite, 'not-null-state-word');
    sqlite.prepare(`
      INSERT INTO word_skill_state (
        word_id,
        skill_id,
        enabled,
        interval_hours,
        last_studied_at,
        next_due_at,
        ease_factor
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      'not-null-state-word',
      'recognition',
      1,
      24,
      '2026-01-02T00:00:00.000Z',
      '2026-01-03T00:00:00.000Z',
      2.5,
    );
    sqlite.close();

    await withStudyDatabase(dataDir, async () => {
      const moduleUrl = `${pathToFileURL(path.resolve('server/db.ts')).href}?test=state-not-null-${Date.now()}`;
      await import(moduleUrl);

      assert.equal(readColumnNotNullFlag(dbPath, 'word_skill_state', 'last_studied_at'), 1);
    });

    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('startup rejects existing word skill state with null last studied timestamps', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-study-app-study-state-null-last-'));
    const dbPath = path.join(dataDir, 'app.db');

    const sqlite = new DatabaseSync(dbPath);
    sqlite.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE words (
        id TEXT PRIMARY KEY,
        hanzi TEXT NOT NULL,
        traditional TEXT,
        pinyin TEXT NOT NULL,
        meaning TEXT NOT NULL,
        meanings_json TEXT NOT NULL DEFAULT '[]',
        personal_notes TEXT NOT NULL DEFAULT '',
        examples_json TEXT NOT NULL,
        status TEXT NOT NULL,
        priority INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        learning_streak INTEGER NOT NULL DEFAULT 0,
        last_learning_success_on TEXT,
        last_learning_covered_on TEXT
      );
      CREATE TABLE word_skill_state (
        word_id TEXT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
        skill_id TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        interval_hours INTEGER NOT NULL,
        last_studied_at TEXT,
        next_due_at TEXT,
        ease_factor REAL NOT NULL,
        PRIMARY KEY (word_id, skill_id)
      );
    `);
    insertWord(sqlite, 'null-last-state-word');
    sqlite.prepare(`
      INSERT INTO word_skill_state (
        word_id,
        skill_id,
        enabled,
        interval_hours,
        last_studied_at,
        next_due_at,
        ease_factor
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      'null-last-state-word',
      'recognition',
      1,
      24,
      null,
      '2026-01-03T00:00:00.000Z',
      2.5,
    );
    sqlite.close();

    await withStudyDatabase(dataDir, async () => {
      const moduleUrl = `${pathToFileURL(path.resolve('server/db.ts')).href}?test=state-null-last-${Date.now()}`;
      await assert.rejects(
        import(moduleUrl),
        /cannot migrate word_skill_state\.last_studied_at to NOT NULL because 1 row\(s\) contain NULL/,
      );
    });

    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('scheduler invariant validation reports missing review scheduler state', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-study-app-study-state-invariants-'));

    await withStudyDatabase(dataDir, async () => {
      const moduleUrl = `${pathToFileURL(path.resolve('server/db.ts')).href}?test=state-invariants-${Date.now()}`;
      const dbModule = await import(moduleUrl);

      const sqlite = new DatabaseSync(path.join(dataDir, 'app.db'));
      try {
        insertWord(sqlite, 'missing-state-word');
      } finally {
        sqlite.close();
      }

      assert.deepEqual(dbModule.validateStudySchedulerStateInvariants(), [
        {
          wordId: 'missing-state-word',
          skillId: null,
          problem: 'review word missing admission state',
        },
        {
          wordId: 'missing-state-word',
          skillId: 'production',
          problem: 'review word missing skill state',
        },
        {
          wordId: 'missing-state-word',
          skillId: 'recognition',
          problem: 'review word missing skill state',
        },
      ]);
    });

    fs.rmSync(dataDir, { recursive: true, force: true });
  });
});

async function withStudyDatabase(dataDir: string, run: () => Promise<void>) {
  const previousMode = process.env.APP_MODE;
  const previousDataDir = process.env.APP_DATA_DIR;

  process.env.APP_MODE = 'study';
  process.env.APP_DATA_DIR = dataDir;

  try {
    await run();
  } finally {
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
  }
}

function readColumnNotNullFlag(dbPath: string, tableName: string, columnName: string) {
  const sqlite = new DatabaseSync(dbPath);
  try {
    const rows = sqlite.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string; notnull: number }>;
    return rows.find((row) => row.name === columnName)?.notnull;
  } finally {
    sqlite.close();
  }
}

function insertWord(sqlite: DatabaseSync, wordId: string) {
  sqlite.prepare(`
    INSERT INTO words (
      id,
      hanzi,
      traditional,
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
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    wordId,
    '验',
    null,
    'yan',
    'test',
    JSON.stringify(['test']),
    '',
    JSON.stringify([]),
    'review',
    10,
    '2026-01-01T00:00:00.000Z',
    0,
    null,
    null,
  );
}
