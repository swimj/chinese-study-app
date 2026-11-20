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

describe('study attempt event storage', { concurrency: false }, () => {
  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-study-app-attempt-events-'));
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
    sqlite.function('current_learner_id', () => 'test-learner');
    sqlite.exec('PRAGMA foreign_keys = ON;');
  });

  after(() => {
    sqlite.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  test('creates durable study session and attempt event tables', () => {
    assertTableHasColumns('study_sessions', [
      'id',
      'started_at',
      'ended_at',
      'processing_state',
      'processed_at',
    ]);

    assertTableHasColumns('study_attempt_events', [
      'id',
      'occurred_at',
      'session_id',
      'session_action_id',
      'session_event_sequence',
      'action_attempt_sequence',
      'action_kind',
      'target_word_id',
      'sampled_skill_ids_json',
      'response',
      'outcome',
      'rating',
      'content_ref_json',
      'metadata_json',
      'projected_at',
    ]);
  });
});

function assertTableHasColumns(tableName: string, expectedColumns: string[]) {
  const rows = sqlite.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  const actualColumns = new Set(rows.map((row) => row.name));

  for (const column of expectedColumns) {
    assert.equal(actualColumns.has(column), true, `Expected ${tableName}.${column}`);
  }
}
