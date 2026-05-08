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
      '2026-01-01T00:00:00.000Z',
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
          lastStudiedAt: '2026-01-01T00:00:00.000Z',
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
      assert.equal(readColumnNotNullFlag(legacyDbPath, 'word_skill_state', 'last_studied_at'), 1);
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

  test('startup migrates existing word skill state to require last studied timestamps', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-study-app-study-shadow-not-null-'));
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
    insertShadowValidationWord(sqlite, 'not-null-shadow-word');
    insertShadowValidationReviewItem(sqlite, {
      id: 'not-null-shadow-word-forward',
      wordId: 'not-null-shadow-word',
      direction: 'forward',
    });
    sqlite.prepare(`
      INSERT INTO word_study_admission_state (
        word_id,
        study_phase,
        earliest_next_study_at
      ) VALUES (?, ?, ?)
    `).run('not-null-shadow-word', 'review', null);
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
      'not-null-shadow-word',
      'recognition',
      1,
      24,
      '2026-01-02T00:00:00.000Z',
      '2026-01-03T00:00:00.000Z',
      2.5,
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
      const moduleUrl = `${pathToFileURL(path.resolve('server/db.ts')).href}?test=shadow-not-null-${Date.now()}`;
      await import(moduleUrl);

      assert.equal(readColumnNotNullFlag(dbPath, 'word_skill_state', 'last_studied_at'), 1);
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

  test('startup rejects existing word skill state with null last studied timestamps', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-study-app-study-shadow-null-last-'));
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
    insertShadowValidationWord(sqlite, 'null-last-shadow-word');
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
      'null-last-shadow-word',
      'recognition',
      1,
      24,
      null,
      '2026-01-03T00:00:00.000Z',
      2.5,
    );
    sqlite.close();

    const previousMode = process.env.APP_MODE;
    const previousDataDir = process.env.APP_DATA_DIR;

    process.env.APP_MODE = 'study';
    process.env.APP_DATA_DIR = dataDir;

    try {
      const moduleUrl = `${pathToFileURL(path.resolve('server/db.ts')).href}?test=shadow-null-last-${Date.now()}`;
      await assert.rejects(
        import(moduleUrl),
        /cannot migrate word_skill_state\.last_studied_at to NOT NULL because 1 row\(s\) contain NULL/,
      );
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

  test('shadow validation reports each mismatch category', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-study-app-study-shadow-mismatches-'));
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

    insertShadowValidationWord(sqlite, 'missing-shadow-word');
    insertShadowValidationReviewItem(sqlite, {
      id: 'missing-shadow-word-forward',
      wordId: 'missing-shadow-word',
      direction: 'forward',
    });
    insertShadowValidationWord(sqlite, 'drift-shadow-word');
    insertShadowValidationReviewItem(sqlite, {
      id: 'drift-shadow-word-forward',
      wordId: 'drift-shadow-word',
      direction: 'forward',
    });
    // The legacy review item above has interval=24, lastReviewedAt=2026-01-02,
    // nextDueAt=2026-01-03, and easeFactor=2.5. Every comparable shadow field
    // below is intentionally different, and enabled=0 adds the disabled case.
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
      'drift-shadow-word',
      'recognition',
      0,
      99,
      '2026-01-05T00:00:00.000Z',
      '2026-01-06T00:00:00.000Z',
      1.9,
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
      const moduleUrl = `${pathToFileURL(path.resolve('server/db.ts')).href}?test=shadow-mismatches-${Date.now()}`;
      const dbModule = await import(moduleUrl);

      assert.deepEqual(dbModule.validateReviewItemStudySchedulerShadow(), [
        {
          reviewItemId: 'drift-shadow-word-forward',
          wordId: 'drift-shadow-word',
          direction: 'forward',
          skillId: 'recognition',
          problem: 'disabled shadow skill',
        },
        {
          reviewItemId: 'drift-shadow-word-forward',
          wordId: 'drift-shadow-word',
          direction: 'forward',
          skillId: 'recognition',
          problem: 'interval_hours mismatch',
        },
        {
          reviewItemId: 'drift-shadow-word-forward',
          wordId: 'drift-shadow-word',
          direction: 'forward',
          skillId: 'recognition',
          problem: 'last_studied_at mismatch',
        },
        {
          reviewItemId: 'drift-shadow-word-forward',
          wordId: 'drift-shadow-word',
          direction: 'forward',
          skillId: 'recognition',
          problem: 'next_due_at mismatch',
        },
        {
          reviewItemId: 'drift-shadow-word-forward',
          wordId: 'drift-shadow-word',
          direction: 'forward',
          skillId: 'recognition',
          problem: 'ease_factor mismatch',
        },
        {
          reviewItemId: 'missing-shadow-word-forward',
          wordId: 'missing-shadow-word',
          direction: 'forward',
          skillId: 'recognition',
          problem: 'missing word_skill_state row',
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

function readColumnNotNullFlag(dbPath: string, tableName: string, columnName: string) {
  const sqlite = new DatabaseSync(dbPath);
  try {
    const rows = sqlite.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string; notnull: number }>;
    return rows.find((row) => row.name === columnName)?.notnull;
  } finally {
    sqlite.close();
  }
}

function insertShadowValidationWord(sqlite: DatabaseSync, wordId: string) {
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

function insertShadowValidationReviewItem(
  sqlite: DatabaseSync,
  {
    id,
    wordId,
    direction,
  }: {
    id: string;
    wordId: string;
    direction: 'forward' | 'reverse';
  },
) {
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
    id,
    wordId,
    direction,
    24,
    '2026-01-02T00:00:00.000Z',
    '2026-01-03T00:00:00.000Z',
    2.5,
  );
}
