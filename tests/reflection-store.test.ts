import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';

type DbModule = typeof import('../server/db.ts');

let dataDir = '';
let sqlite: DatabaseSync;
let dbModule: DbModule;

describe('reflection durable store', { concurrency: false }, () => {
  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-study-app-reflection-store-'));
    const previousMode = process.env.APP_MODE;
    const previousDataDir = process.env.APP_DATA_DIR;
    try {
      process.env.APP_MODE = 'study';
      process.env.APP_DATA_DIR = dataDir;
      const moduleUrl = `${pathToFileURL(path.resolve('server/db.ts')).href}?test=${Date.now()}`;
      dbModule = await import(moduleUrl);
    } finally {
      if (previousMode === undefined) delete process.env.APP_MODE;
      else process.env.APP_MODE = previousMode;
      if (previousDataDir === undefined) delete process.env.APP_DATA_DIR;
      else process.env.APP_DATA_DIR = previousDataDir;
    }

    sqlite = new DatabaseSync(path.join(dataDir, 'app.db'));
    sqlite.function('current_learner_id', () => 'test-learner');
    sqlite.exec('PRAGMA foreign_keys = ON;');
  });

  after(() => {
    sqlite.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('initializes and validates the eight-table reflection schema', () => {
    assert.doesNotThrow(() => dbModule.validateReflectionSchema());
    const tables = sqlite.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name LIKE 'learner_owned_reflection_%'
      ORDER BY name
    `).all() as Array<{ name: string }>;
    assert.deepEqual(tables.map((row) => row.name), [
      'learner_owned_reflection_artifacts',
      'learner_owned_reflection_generation_run_starts',
      'learner_owned_reflection_generation_runs',
      'learner_owned_reflection_help_inbox',
      'learner_owned_reflection_operation_invocations',
      'learner_owned_reflection_proposal_reviews',
      'learner_owned_reflection_quality_annotations',
    ]);
    const ownershipTrigger = sqlite.prepare(`
      SELECT 1 FROM sqlite_master
      WHERE type = 'trigger'
        AND name = 'learner_owned_reflection_artifacts_source_session_id_same_owner_insert'
    `).get();
    assert(ownershipTrigger);
  });
});
