import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';

describe('dev database bootstrap', { concurrency: false }, () => {
  test('rebuilds an invalid dev database from the checked-in app.json fixture', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-study-app-dev-bootstrap-'));
    const dbPath = path.join(dataDir, 'app.db');
    const appJsonPath = path.join(dataDir, 'app.json');
    const sourceSeedPath = path.resolve('data/app.json');
    const seedData = JSON.parse(fs.readFileSync(sourceSeedPath, 'utf8')) as {
      words: Array<{ id: string }>;
      reviewItems: Array<{ id: string }>;
    };

    fs.writeFileSync(dbPath, '');
    fs.copyFileSync(sourceSeedPath, appJsonPath);

    const previousMode = process.env.APP_MODE;
    const previousDataDir = process.env.APP_DATA_DIR;

    try {
      process.env.APP_MODE = 'dev';
      process.env.APP_DATA_DIR = dataDir;

      const moduleUrl = `${pathToFileURL(path.resolve('server/db.ts')).href}?test=${Date.now()}`;
      const dbModule = await import(moduleUrl);

      assert.equal(seedData.words.length, 10);
      assert.equal(dbModule.getWords().length, seedData.words.length);
      assert.equal(dbModule.getReviewItems().length, seedData.reviewItems.length);

      const sqlite = new DatabaseSync(dbPath);

      try {
        const wordCount = sqlite.prepare('SELECT COUNT(*) AS count FROM words').get() as { count: number };
        const reviewItemCount = sqlite.prepare('SELECT COUNT(*) AS count FROM review_items').get() as {
          count: number;
        };

        assert.equal(wordCount.count, seedData.words.length);
        assert.equal(reviewItemCount.count, seedData.reviewItems.length);
      } finally {
        sqlite.close();
      }

      const backupFiles = fs
        .readdirSync(dataDir)
        .filter((entry) => entry.startsWith('app.db.invalid-backup-'));
      assert.equal(backupFiles.length, 1);
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

      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test('reseeds an empty dev database that already has the current schema', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-study-app-dev-empty-'));
    const dbPath = path.join(dataDir, 'app.db');
    const appJsonPath = path.join(dataDir, 'app.json');
    const sourceSeedPath = path.resolve('data/app.json');
    const seedData = JSON.parse(fs.readFileSync(sourceSeedPath, 'utf8')) as {
      words: Array<{ id: string }>;
      reviewItems: Array<{ id: string }>;
    };

    fs.copyFileSync(sourceSeedPath, appJsonPath);

    const sqlite = new DatabaseSync(dbPath);
    sqlite.exec(`
      CREATE TABLE words (
        id TEXT PRIMARY KEY,
        hanzi TEXT NOT NULL,
        traditional TEXT,
        pinyin TEXT NOT NULL,
        meaning TEXT NOT NULL,
        examples_json TEXT NOT NULL,
        status TEXT NOT NULL,
        priority INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        learning_streak INTEGER NOT NULL DEFAULT 0,
        last_learning_success_on TEXT,
        last_learning_covered_on TEXT
      );

      CREATE TABLE review_items (
        id TEXT PRIMARY KEY,
        word_id TEXT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
        direction TEXT NOT NULL,
        interval_hours INTEGER NOT NULL,
        last_reviewed_at TEXT,
        next_due_at TEXT,
        ease_factor REAL NOT NULL
      );
    `);
    sqlite.close();

    const previousMode = process.env.APP_MODE;
    const previousDataDir = process.env.APP_DATA_DIR;

    try {
      process.env.APP_MODE = 'dev';
      process.env.APP_DATA_DIR = dataDir;

      const moduleUrl = `${pathToFileURL(path.resolve('server/db.ts')).href}?test=${Date.now()}`;
      const dbModule = await import(moduleUrl);

      assert.equal(dbModule.getWords().length, seedData.words.length);
      assert.equal(dbModule.getReviewItems().length, seedData.reviewItems.length);
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

      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
