import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { migrateDatabase, schemaMigrations } from '../server/db/migrations.ts';
import { createBaselineFixture } from './helpers/baseline-database.ts';

test('continuation migration preserves the previous schema rows and is repeatable', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reflection-continuation-migration-'));
  try {
    createBaselineFixture(root);
    const database = new DatabaseSync(path.join(root, 'app.db'));
    database.function('current_learner_id', () => 'learner-a');
    database.exec('PRAGMA foreign_keys = ON;');
    try {
      const previousMigrations = schemaMigrations.slice(0, -1);
      migrateDatabase(database, previousMigrations);
      database.prepare('INSERT INTO learners VALUES (?, ?, ?, NULL)').run(
        'learner-a',
        'Learner A',
        '2026-09-18T00:00:00.000Z',
      );
      database.prepare(`
        INSERT INTO learner_owned_reflection_generation_runs (
          learner_id, run_id, reflection_flow_version, started_at, completed_at,
          provider, model, provider_model, prompt_version, client_request_id,
          state, failure_code, eligible_item_count, included_item_count,
          evidence_bundle_json, source_proposal_ids_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'learner-a',
        'legacy-run',
        'initial_post_session_reflection.v2',
        '2026-09-18T00:00:00.000Z',
        '2026-09-18T00:00:01.000Z',
        'openai',
        'legacy-model',
        'legacy-model',
        'legacy-prompt',
        'legacy-request',
        'failed',
        'provider_error',
        1,
        1,
        '{"legacy":"run-evidence"}',
        null,
      );
      database.prepare(`
        INSERT INTO learner_owned_reflection_artifacts (
          learner_id, artifact_id, source_session_id, source_run_id,
          reflection_flow_version, generated_at, provider, model, prompt_version,
          bundle_schema_version, result_schema_version, evidence_bundle_json, result_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'learner-a',
        'legacy-artifact',
        null,
        'legacy-run',
        'initial_post_session_reflection.v2',
        '2026-09-18T00:00:01.000Z',
        'openai',
        'legacy-model',
        'legacy-prompt',
        'session_reflection_bundle.v4',
        'session_reflection_result.v7',
        '{"legacy":"artifact-evidence"}',
        '{"legacy":"artifact-result"}',
      );
      const generationRowsBefore = database.prepare(`
        SELECT * FROM learner_owned_reflection_generation_runs ORDER BY learner_id, run_id
      `).all();
      const artifactRowsBefore = database.prepare(`
        SELECT * FROM learner_owned_reflection_artifacts ORDER BY learner_id, artifact_id
      `).all();
      const oldTables = (database.prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'table'
          AND name NOT LIKE 'sqlite_%'
          AND name != 'schema_migrations'
        ORDER BY name
      `).all() as Array<{ name: string }>).map((row) => row.name);
      const countsBefore = Object.fromEntries(oldTables.map((table) => [
        table,
        (database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count,
      ]));

      assert.deepEqual(migrateDatabase(database), [
        'app_schema:0011_reflection_generation_continuations',
      ]);
      const countsAfter = Object.fromEntries(oldTables.map((table) => [
        table,
        (database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count,
      ]));
      assert.deepEqual(countsAfter, countsBefore);
      assert.deepEqual(database.prepare(`
        SELECT * FROM learner_owned_reflection_generation_runs ORDER BY learner_id, run_id
      `).all(), generationRowsBefore);
      assert.deepEqual(database.prepare(`
        SELECT * FROM learner_owned_reflection_artifacts ORDER BY learner_id, artifact_id
      `).all(), artifactRowsBefore);
      assert.deepEqual(migrateDatabase(database), []);
      assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
      assert.ok(database.prepare(`
        SELECT 1 FROM sqlite_master
        WHERE type = 'table' AND name = 'reflection_generation_continuations'
      `).get());
      assert.ok(database.prepare(`
        SELECT 1 FROM sqlite_master
        WHERE type = 'table' AND name = 'reflection_generation_continuation_runs'
      `).get());
    } finally {
      database.close();
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
