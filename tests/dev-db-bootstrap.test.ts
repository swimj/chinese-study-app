import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';

const mandarinDevContrastWordCount = 11;
const mandarinDevContrastClusterCount = 4;
const mandarinDevContrastPromptCount = 11;
const mandarinDevContextualSelectionCount = 4;
const mandarinDevBinaryContrastChoiceSetCount = 2;

describe('dev database bootstrap', { concurrency: false }, () => {
  test('rebuilds an invalid dev database from the checked-in mandarin dev seed fixture', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-study-app-dev-bootstrap-'));
    const dbPath = path.join(dataDir, 'app.db');
    const sourceSeedPath = path.resolve('server/seeds/mandarin-dev.json');
    const seedData = JSON.parse(fs.readFileSync(sourceSeedPath, 'utf8')) as {
      words: Array<{ id: string }>;
    };
    const reviewWordCount = seedData.words.length;

    fs.writeFileSync(dbPath, '');

    const previousMode = process.env.APP_MODE;
    const previousDataDir = process.env.APP_DATA_DIR;
    const previousSeedDataPath = process.env.APP_SEED_DATA_PATH;

    try {
      process.env.APP_MODE = 'dev';
      process.env.APP_DATA_DIR = dataDir;
      process.env.APP_SEED_DATA_PATH = sourceSeedPath;

      const moduleUrl = `${pathToFileURL(path.resolve('server/db.ts')).href}?test=${Date.now()}`;
      const dbModule = await import(moduleUrl);

      assert.equal(seedData.words.length, 10);
      assert.equal(dbModule.getWords().length, seedData.words.length + mandarinDevContrastWordCount);
      assert.equal(dbModule.getWordStudyAdmissionStates().length, reviewWordCount + mandarinDevContrastWordCount);
      assert.equal(
        dbModule.getWordSkillStates().length,
        (reviewWordCount + mandarinDevContrastWordCount) * 2 + mandarinDevContextualSelectionCount,
      );
      assert.equal(dbModule.getContrastClusters().length, mandarinDevContrastClusterCount);

      const studyDayKey = new Date().toISOString().slice(0, 10);
      const contrastSelectionItems = dbModule
        .getSessionPayload(studyDayKey)
        .buckets.review.filter((item) => item.actionKind === 'contrast_selection');
      assert.equal(contrastSelectionItems.length, mandarinDevBinaryContrastChoiceSetCount);
      assert.deepEqual(
        contrastSelectionItems.map((item) => item.targetWordId).sort(),
        [
          'dev-contrast-kaojin',
          'dev-contrast-qiadang',
        ],
      );

      const sqlite = new DatabaseSync(dbPath);

      try {
        const wordCount = sqlite.prepare('SELECT COUNT(*) AS count FROM words').get() as { count: number };
        const wordSkillStateCount = sqlite.prepare('SELECT COUNT(*) AS count FROM word_skill_state').get() as {
          count: number;
        };
        const contrastPromptCount = sqlite.prepare('SELECT COUNT(*) AS count FROM contrast_prompts').get() as {
          count: number;
        };
        const contextualSelectionRelevanceCount = sqlite.prepare(`
          SELECT COUNT(*) AS count
          FROM word_skill_relevance
          WHERE skill_id = 'contextual_selection'
            AND relevance_state = 'normal'
        `).get() as { count: number };

        assert.equal(wordCount.count, seedData.words.length + mandarinDevContrastWordCount);
        assert.equal(
          wordSkillStateCount.count,
          (reviewWordCount + mandarinDevContrastWordCount) * 2 + mandarinDevContextualSelectionCount,
        );
        assert.equal(contextualSelectionRelevanceCount.count, mandarinDevContextualSelectionCount);
        assert.equal(contrastPromptCount.count, mandarinDevContrastPromptCount);
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

      if (previousSeedDataPath === undefined) {
        delete process.env.APP_SEED_DATA_PATH;
      } else {
        process.env.APP_SEED_DATA_PATH = previousSeedDataPath;
      }

      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test('reseeds an empty dev database that already has the current schema', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-study-app-dev-empty-'));
    const dbPath = path.join(dataDir, 'app.db');
    const sourceSeedPath = path.resolve('server/seeds/mandarin-dev.json');
    const seedData = JSON.parse(fs.readFileSync(sourceSeedPath, 'utf8')) as {
      words: Array<{ id: string }>;
    };
    const reviewWordCount = seedData.words.length;

    const sqlite = new DatabaseSync(dbPath);
    sqlite.exec(`
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
    `);
    sqlite.close();

    const previousMode = process.env.APP_MODE;
    const previousDataDir = process.env.APP_DATA_DIR;
    const previousSeedDataPath = process.env.APP_SEED_DATA_PATH;

    try {
      process.env.APP_MODE = 'dev';
      process.env.APP_DATA_DIR = dataDir;
      process.env.APP_SEED_DATA_PATH = sourceSeedPath;

      const moduleUrl = `${pathToFileURL(path.resolve('server/db.ts')).href}?test=${Date.now()}`;
      const dbModule = await import(moduleUrl);

      assert.equal(dbModule.getWords().length, seedData.words.length + mandarinDevContrastWordCount);
      assert.equal(dbModule.getWordStudyAdmissionStates().length, reviewWordCount + mandarinDevContrastWordCount);
      assert.equal(
        dbModule.getWordSkillStates().length,
        (reviewWordCount + mandarinDevContrastWordCount) * 2 + mandarinDevContextualSelectionCount,
      );
      assert.equal(dbModule.getContrastClusters().length, mandarinDevContrastClusterCount);
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

      if (previousSeedDataPath === undefined) {
        delete process.env.APP_SEED_DATA_PATH;
      } else {
        process.env.APP_SEED_DATA_PATH = previousSeedDataPath;
      }

      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
