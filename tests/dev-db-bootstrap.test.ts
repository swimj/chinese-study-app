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
const mandarinDevContextualSelectionCount = 11;
const mandarinDevBinaryContrastChoiceSetCount = 2;

function registerPersistedLearnerContext(sqlite: DatabaseSync): void {
  const learner = sqlite.prepare(`
    SELECT learner_id
    FROM learners
    ORDER BY learner_id ASC
    LIMIT 1
  `).get() as { learner_id: string } | undefined;
  assert.ok(learner, 'expected the bootstrapped database to contain a learner');
  sqlite.function('current_learner_id', () => learner.learner_id);
}

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
      registerPersistedLearnerContext(sqlite);

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

  test('repairs contextual eligibility for persisted cluster members without resetting scheduler history', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-study-app-cluster-backfill-'));
    const dbPath = path.join(dataDir, 'app.db');
    const previousMode = process.env.APP_MODE;
    const previousDataDir = process.env.APP_DATA_DIR;

    try {
      process.env.APP_MODE = 'study';
      process.env.APP_DATA_DIR = dataDir;
      await import(`${pathToFileURL(path.resolve('server/db.ts')).href}?test=cluster-backfill-prime-${Date.now()}`);

      const sqlite = new DatabaseSync(dbPath);
      registerPersistedLearnerContext(sqlite);
      sqlite.exec('PRAGMA foreign_keys = ON;');
      sqlite.exec(`
        INSERT INTO words (
          id, hanzi, pinyin, meaning, examples_json, status, priority, created_at
        ) VALUES
          ('missing-eligibility', '考察', 'kao3 cha2', 'inspect', '[]', 'review', 1, '2026-04-01T00:00:00.000Z'),
          ('disabled-eligibility', '考查', 'kao3 cha2', 'test', '[]', 'review', 1, '2026-04-01T00:00:00.000Z');
        INSERT INTO contrast_clusters (id, title, note)
        VALUES ('persisted-cluster', '考察 / 考查', '');
        INSERT INTO contrast_cluster_members (cluster_id, word_id, nuance_note, display_order)
        VALUES
          ('persisted-cluster', 'missing-eligibility', '', 1),
          ('persisted-cluster', 'disabled-eligibility', '', 2);
        INSERT INTO word_skill_relevance (
          word_id, skill_id, relevance_state, updated_at, source_event_id
        ) VALUES (
          'disabled-eligibility', 'contextual_selection', 'suppressed',
          '2026-04-02T00:00:00.000Z', NULL
        );
        INSERT INTO word_skill_state (
          word_id, skill_id, enabled, interval_hours, last_studied_at, next_due_at, ease_factor
        ) VALUES (
          'disabled-eligibility', 'contextual_selection', 0, 72,
          '2026-04-03T00:00:00.000Z', '2026-04-06T00:00:00.000Z', 2.1
        );
      `);
      sqlite.close();

      await import(`${pathToFileURL(path.resolve('server/db.ts')).href}?test=cluster-backfill-apply-${Date.now()}`);

      const repaired = new DatabaseSync(dbPath);
      registerPersistedLearnerContext(repaired);
      try {
        const rows = repaired.prepare(`
          SELECT
            word_skill_relevance.word_id,
            word_skill_relevance.relevance_state,
            word_skill_state.enabled,
            word_skill_state.interval_hours,
            word_skill_state.last_studied_at,
            word_skill_state.next_due_at,
            word_skill_state.ease_factor
          FROM word_skill_relevance
          INNER JOIN word_skill_state
            ON word_skill_state.word_id = word_skill_relevance.word_id
           AND word_skill_state.skill_id = word_skill_relevance.skill_id
          WHERE word_skill_relevance.skill_id = 'contextual_selection'
          ORDER BY word_skill_relevance.word_id ASC
        `).all() as Array<{
          word_id: string;
          relevance_state: string;
          enabled: number;
          interval_hours: number;
          last_studied_at: string;
          next_due_at: string | null;
          ease_factor: number;
        }>;

        assert.equal(rows.length, 2);
        assert.deepEqual({ ...rows[0] }, {
          word_id: 'disabled-eligibility',
          relevance_state: 'normal',
          enabled: 1,
          interval_hours: 72,
          last_studied_at: '2026-04-03T00:00:00.000Z',
          next_due_at: '2026-04-06T00:00:00.000Z',
          ease_factor: 2.1,
        });
        assert.equal(rows[1]?.word_id, 'missing-eligibility');
        assert.equal(rows[1]?.relevance_state, 'normal');
        assert.equal(rows[1]?.enabled, 1);
        assert.equal(rows[1]?.interval_hours, 6);
        assert.equal(rows[1]?.ease_factor, 2.5);
      } finally {
        repaired.close();
      }
    } finally {
      if (previousMode === undefined) delete process.env.APP_MODE;
      else process.env.APP_MODE = previousMode;
      if (previousDataDir === undefined) delete process.env.APP_DATA_DIR;
      else process.env.APP_DATA_DIR = previousDataDir;
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
