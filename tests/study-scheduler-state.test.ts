import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';

describe('study scheduler state', { concurrency: false }, () => {
  test('scheduler invariant validation reports missing review scheduler state', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-study-app-study-state-invariants-'));

    await withStudyDatabase(dataDir, async () => {
      const moduleUrl = `${pathToFileURL(path.resolve('server/db.ts')).href}?test=state-invariants-${Date.now()}`;
      const dbModule = await import(moduleUrl);

      const sqlite = new DatabaseSync(path.join(dataDir, 'app.db'));
      sqlite.function('current_learner_id', () => 'test-learner');
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
