import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';

describe('study scheduler shadow state', { concurrency: false }, () => {
  test('startup migration backfills admission and skill state from legacy review items', async () => {
    const legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-study-app-study-shadow-'));
    const legacyDbPath = path.join(legacyDir, 'app.db');

    const legacyDb = new DatabaseSync(legacyDbPath);
    legacyDb.exec(`
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

    legacyDb.prepare(`
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
      'legacy-review-word',
      '旧',
      null,
      'jiu',
      'old',
      JSON.stringify(['old']),
      '',
      JSON.stringify([]),
      'review',
      10,
      '2026-01-01T00:00:00.000Z',
      0,
      null,
      null,
    );

    legacyDb.prepare(`
      INSERT INTO review_items (
        id,
        word_id,
        direction,
        interval_hours,
        last_reviewed_at,
        next_due_at,
        ease_factor
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      'legacy-review-word-forward',
      'legacy-review-word',
      'forward',
      36,
      '2026-01-02T00:00:00.000Z',
      '2026-01-03T12:00:00.000Z',
      2.35,
    );

    legacyDb.prepare(`
      INSERT INTO review_items (
        id,
        word_id,
        direction,
        interval_hours,
        last_reviewed_at,
        next_due_at,
        ease_factor
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      'legacy-review-word-reverse',
      'legacy-review-word',
      'reverse',
      24,
      null,
      '2026-01-02T00:00:00.000Z',
      2.5,
    );

    legacyDb.prepare(`
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
      'legacy-unstudied-word',
      '新',
      null,
      'xin',
      'new',
      JSON.stringify(['new']),
      '',
      JSON.stringify([]),
      'unstudied',
      9,
      '2026-01-01T00:00:00.000Z',
      0,
      null,
      null,
    );

    legacyDb.prepare(`
      INSERT INTO review_items (
        id,
        word_id,
        direction,
        interval_hours,
        last_reviewed_at,
        next_due_at,
        ease_factor
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      'legacy-unstudied-word-forward',
      'legacy-unstudied-word',
      'forward',
      6,
      null,
      null,
      2.5,
    );

    legacyDb.close();

    const previousMode = process.env.APP_MODE;
    const previousDataDir = process.env.APP_DATA_DIR;

    process.env.APP_MODE = 'study';
    process.env.APP_DATA_DIR = legacyDir;

    try {
      const moduleUrl = `${pathToFileURL(path.resolve('server/db.ts')).href}?test=shadow-${Date.now()}`;
      const legacyModule = await import(moduleUrl);

      assert.deepEqual(legacyModule.getWordStudyAdmissionStates(), [
        {
          wordId: 'legacy-review-word',
          studyPhase: 'review',
          earliestNextStudyAt: null,
        },
      ]);
      assert.deepEqual(legacyModule.getWordSkillStates(), [
        {
          wordId: 'legacy-review-word',
          skillId: 'production',
          enabled: true,
          intervalHours: 24,
          lastStudiedAt: null,
          nextDueAt: '2026-01-02T00:00:00.000Z',
          easeFactor: 2.5,
        },
        {
          wordId: 'legacy-review-word',
          skillId: 'recognition',
          enabled: true,
          intervalHours: 36,
          lastStudiedAt: '2026-01-02T00:00:00.000Z',
          nextDueAt: '2026-01-03T12:00:00.000Z',
          easeFactor: 2.35,
        },
      ]);
      assert.deepEqual(legacyModule.validateReviewItemStudySchedulerShadow(), []);
      assert.equal(readBackfillMarker(legacyDbPath), 'completed');
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

      fs.rmSync(legacyDir, { recursive: true, force: true });
    }
  });

  test('startup leaves existing shadow rows alone so drift remains observable', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-study-app-study-shadow-existing-'));
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
      CREATE TABLE review_items (
        id TEXT PRIMARY KEY,
        word_id TEXT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
        direction TEXT NOT NULL,
        interval_hours INTEGER NOT NULL,
        last_reviewed_at TEXT,
        next_due_at TEXT,
        ease_factor REAL NOT NULL
      );
      CREATE TABLE word_meanings (
        id TEXT PRIMARY KEY,
        word_id TEXT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        text TEXT NOT NULL,
        show_on_production_prompt INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(word_id, position)
      );
      CREATE TABLE user_word_priority (
        word_id TEXT PRIMARY KEY REFERENCES words(id) ON DELETE CASCADE,
        bump_count INTEGER NOT NULL DEFAULT 0,
        force_top INTEGER NOT NULL DEFAULT 0,
        priority_tier INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE daily_new_word_intake (
        day_key TEXT PRIMARY KEY,
        new_study_count INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE app_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE word_study_admission_state (
        word_id TEXT PRIMARY KEY REFERENCES words(id) ON DELETE CASCADE,
        study_phase TEXT NOT NULL,
        earliest_next_study_at TEXT
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
      'existing-shadow-word',
      '影',
      null,
      'ying',
      'shadow',
      JSON.stringify(['shadow']),
      '',
      JSON.stringify([]),
      'review',
      10,
      '2026-01-01T00:00:00.000Z',
      0,
      null,
      null,
    );
    sqlite.prepare(`
      INSERT INTO review_items (
        id,
        word_id,
        direction,
        interval_hours,
        last_reviewed_at,
        next_due_at,
        ease_factor
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      'existing-shadow-word-forward',
      'existing-shadow-word',
      'forward',
      36,
      '2026-01-02T00:00:00.000Z',
      '2026-01-03T12:00:00.000Z',
      2.35,
    );
    sqlite.prepare(`
      INSERT INTO word_study_admission_state (
        word_id,
        study_phase,
        earliest_next_study_at
      ) VALUES (?, ?, ?)
    `).run('existing-shadow-word', 'review', null);
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
      'existing-shadow-word',
      'recognition',
      1,
      99,
      '2026-01-02T00:00:00.000Z',
      '2026-01-03T12:00:00.000Z',
      2.35,
    );
    sqlite.prepare(`
      INSERT INTO app_metadata (
        key,
        value,
        updated_at
      ) VALUES (?, ?, ?)
    `).run(
      'study_scheduler_shadow_backfill_v1',
      'completed',
      '2026-01-04T00:00:00.000Z',
    );
    sqlite.close();

    const previousMode = process.env.APP_MODE;
    const previousDataDir = process.env.APP_DATA_DIR;

    process.env.APP_MODE = 'study';
    process.env.APP_DATA_DIR = dataDir;

    try {
      const moduleUrl = `${pathToFileURL(path.resolve('server/db.ts')).href}?test=shadow-existing-${Date.now()}`;
      const dbModule = await import(moduleUrl);

      assert.equal(dbModule.getWordSkillStates()[0]?.intervalHours, 99);
      assert.deepEqual(dbModule.validateReviewItemStudySchedulerShadow(), [
        {
          reviewItemId: 'existing-shadow-word-forward',
          wordId: 'existing-shadow-word',
          direction: 'forward',
          skillId: 'recognition',
          problem: 'interval_hours mismatch',
        },
      ]);
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

function readBackfillMarker(dbPath: string) {
  const sqlite = new DatabaseSync(dbPath);
  try {
    const row = sqlite
      .prepare(`
        SELECT value
        FROM app_metadata
        WHERE key = ?
      `)
      .get('study_scheduler_shadow_backfill_v1') as { value: string } | undefined;

    return row?.value;
  } finally {
    sqlite.close();
  }
}
