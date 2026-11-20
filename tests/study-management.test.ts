import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';

type DbModule = typeof import('../server/db.ts');

let dataDir = '';
let dbPath = '';
let sqlite: DatabaseSync;
let dbModule: DbModule;

describe('study management relevance events', { concurrency: false }, () => {
  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-study-app-study-management-'));
    dbPath = path.join(dataDir, 'app.db');

    const previousMode = process.env.APP_MODE;
    const previousDataDir = process.env.APP_DATA_DIR;

    process.env.APP_MODE = 'study';
    process.env.APP_DATA_DIR = dataDir;

    const moduleUrl = `${pathToFileURL(path.resolve('server/db.ts')).href}?test=study-management-${Date.now()}`;
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
    sqlite.function('current_learner_id', () => 'test-learner');
    sqlite.exec('PRAGMA foreign_keys = ON;');
  });

  after(() => {
    sqlite.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  test('creates current study-management tables without retired prompt exclusions', () => {
    assertTableHasColumns('study_events', [
      'id',
      'occurred_at',
      'session_id',
      'session_action_id',
      'session_event_sequence',
      'event_type',
      'target_word_id',
      'action_kind',
      'sampled_skill_ids_json',
      'content_ref_json',
      'payload_json',
      'projected_at',
    ]);

    assertTableHasColumns('word_skill_relevance', [
      'word_id',
      'skill_id',
      'relevance_state',
      'updated_at',
      'source_event_id',
    ]);
    for (const tableName of ['definition_fallback_exclusions', 'contrast_prompt_exclusions']) {
      assert.equal(sqlite.prepare(`
        SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?
      `).get(tableName), undefined);
    }
  });
});

function assertTableHasColumns(tableName: string, expectedColumns: string[]) {
  const rows = sqlite.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  const actualColumns = new Set(rows.map((row) => row.name));

  for (const column of expectedColumns) {
    assert.equal(actualColumns.has(column), true, `${tableName} is missing ${column}`);
  }
}
