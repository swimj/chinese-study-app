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

  test('historical help inbox membership is immutable and its seen timestamp can be recorded', () => {
    sqlite.exec(`
      INSERT INTO reflection_artifacts (
        artifact_id, reflection_flow_version, generated_at, provider, model, prompt_version,
        bundle_schema_version, result_schema_version, evidence_bundle_json, result_json
      ) VALUES ('artifact', 'initial_post_session_reflection.v6', '2026-08-18T08:00:00.000Z',
        'openai', 'test', 'reflection-staged-v4', 'session_reflection_bundle.v6',
        'session_reflection_result.v10', '{}', '{}');
      INSERT INTO reflection_help_inbox (inbox_id, artifact_id, item_id, opened_at)
      VALUES ('inbox', 'artifact', 'item', '2026-08-18T08:00:00.000Z');
    `);
    assert.throws(() => sqlite.exec(`
      UPDATE reflection_help_inbox SET opened_at = '2026-08-18T09:00:00.000Z' WHERE inbox_id = 'inbox'
    `), /reflection help inbox entries are immutable/);
    const seenAt = '2026-08-18T10:00:00.000Z';
    sqlite.prepare('UPDATE reflection_help_inbox SET inbox_seen_at = ? WHERE inbox_id = ?').run(seenAt, 'inbox');
    assert.equal(sqlite.prepare('SELECT inbox_seen_at FROM reflection_help_inbox WHERE inbox_id = ?').get('inbox')?.inbox_seen_at, seenAt);
  });
});
