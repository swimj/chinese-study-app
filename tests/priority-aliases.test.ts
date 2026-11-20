import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, beforeEach, describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';

type WordStatus = 'unstudied' | 'learning' | 'review';
type DbModule = typeof import('../server/db.ts');
type StudyProfile = 'mandarin';

type Harness = {
  dataDir: string;
  sqlite: DatabaseSync;
  dbModule: DbModule;
};

describe('priority alias lookup', { concurrency: false }, () => {
  describe('default backend profile', { concurrency: false }, () => {
    let harness: Harness;

    before(async () => {
      harness = await createHarness('mandarin');
    });

    beforeEach(() => {
      clearHarnessData(harness);
    });

    after(() => {
      destroyHarness(harness);
    });

    test('lookup alias schema uses one row per alias, canonical word, and source', () => {
      assert.deepEqual(getWordLookupAliasPrimaryKeyColumns(harness.sqlite), ['normalized_alias', 'word_id', 'source']);
    });

    test('does not consult aliases even if alias rows exist', () => {
      insertWord(harness.sqlite, 'parler-verb', 90, 'unstudied', '2026-01-01T00:00:00.000Z', 'parler');
      insertAlias(harness.sqlite, 'parlait', 'parlait', 'parler-verb');

      assert.throws(() => {
        harness.dbModule.addUnstudiedUserPriorityByHanzi('parlait');
      }, /No matching unstudied words found/);
    });
  });
});

async function createHarness(studyProfile: StudyProfile): Promise<Harness> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `chinese-study-app-priority-alias-${studyProfile}-`));
  const previousMode = process.env.APP_MODE;
  const previousDataDir = process.env.APP_DATA_DIR;
  const previousStudyProfile = process.env.APP_STUDY_PROFILE;

  process.env.APP_MODE = 'study';
  process.env.APP_DATA_DIR = dataDir;
  process.env.APP_STUDY_PROFILE = studyProfile;

  try {
    const moduleUrl = `${pathToFileURL(path.resolve('server/db.ts')).href}?priorityAlias=${studyProfile}-${Date.now()}-${Math.random()}`;
    const dbModule = await import(moduleUrl);
    const sqlite = new DatabaseSync(path.join(dataDir, 'app.db'));
    sqlite.function('current_learner_id', () => 'test-learner');
    sqlite.exec('PRAGMA foreign_keys = ON;');
    return { dataDir, sqlite, dbModule };
  } finally {
    restoreEnv('APP_MODE', previousMode);
    restoreEnv('APP_DATA_DIR', previousDataDir);
    restoreEnv('APP_STUDY_PROFILE', previousStudyProfile);
  }
}

function clearHarnessData({ sqlite }: Harness) {
  sqlite.exec(`
    DELETE FROM daily_new_word_intake;
    DELETE FROM word_lookup_aliases;
    DELETE FROM user_word_priority;
    DELETE FROM words;
  `);
}

function destroyHarness({ dataDir, sqlite }: Harness) {
  sqlite.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}

function insertWord(
  sqlite: DatabaseSync,
  id: string,
  priority: number,
  status: WordStatus,
  createdAt: string,
  hanzi = `${id}-hanzi`,
) {
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
    id,
    hanzi,
    `${id}-note`,
    `${id}-meaning`,
    JSON.stringify([`${id}-meaning`]),
    '',
    JSON.stringify([]),
    status,
    priority,
    createdAt,
    0,
    null,
    null,
  );
}

function insertAlias(sqlite: DatabaseSync, aliasText: string, normalizedAlias: string, wordId: string) {
  sqlite.prepare(`
    INSERT INTO word_lookup_aliases (
      alias_text,
      normalized_alias,
      word_id,
      relation,
      source,
      tags_json,
      confidence,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    aliasText,
    normalizedAlias,
    wordId,
    'inflected_form',
    'test',
    JSON.stringify([]),
    null,
    '2026-01-01T00:00:00.000Z',
  );
}

function getWordLookupAliasPrimaryKeyColumns(sqlite: DatabaseSync): string[] {
  const columns = sqlite.prepare('PRAGMA table_info(word_lookup_aliases)').all() as Array<{ name: string; pk: number }>;
  return columns
    .filter((column) => column.pk > 0)
    .sort((left, right) => left.pk - right.pk)
    .map((column) => column.name);
}
