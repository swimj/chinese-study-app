import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { assertSchemaCurrent, migrateDatabase, schemaMigrations } from '../server/db/migrations.ts';
import { createDeployedSchemaFixture } from './helpers/deployed-schema.ts';
import { createBaselineFixture } from './helpers/baseline-database.ts';

const tables = ['reflection_generation_runs', 'reflection_generation_run_starts'] as const;
const time = '2026-09-07T00:00:00.000Z';
function insertRun(db: DatabaseSync, table: typeof tables[number], runId: string, provenance?: string) {
  const columns = ['run_id', 'reflection_flow_version', 'started_at', 'provider', 'model', 'provider_model', 'prompt_version', 'client_request_id', 'eligible_item_count', 'included_item_count', 'evidence_bundle_json'];
  const values: Array<string | number> = [runId, 'initial_post_session_reflection.v2', time, 'test-provider', 'test-model', 'test-model', 'test-prompt', `request-${runId}`, 1, 1, '{"retained":"history"}'];
  if (table === 'reflection_generation_runs') {
    columns.push('completed_at', 'state', 'failure_code');
    values.push(time, 'failed', 'provider_error');
  }
  if (provenance !== undefined) { columns.push('source_proposal_ids_json'); values.push(provenance); }
  db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${values.map(() => '?').join(', ')})`).run(...values);
}
function schema(db: DatabaseSync) {
  const objects = db.prepare('SELECT type, name, sql FROM sqlite_schema ORDER BY type, name').all() as Array<{ type: string; name: string; sql: string | null }>;
  const names = new Set(objects.map((object) => object.name));
  // The verified deployed variant differs in table-identifier quoting. Compare
  // final definitions ignoring only quotes around known schema object names.
  return objects.map((object) => ({ ...object,
    sql: object.sql?.replace(/"([A-Za-z_][A-Za-z_0-9]*)"/g, (quoted, name: string) => names.has(name) ? name : quoted) ?? null,
  }));
}

for (const variant of ['fresh', 'fly'] as const) {
  test(`second-opinion migration preserves history, provenance and ownership from ${variant} baseline`, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'second-opinion-migration-'));
    const baselineDir = path.join(root, 'baseline');
    createBaselineFixture(baselineDir);
    const db = new DatabaseSync(path.join(variant === 'fresh' ? baselineDir : root, 'app.db'));
    let learner = 'learner-a';
    db.function('current_learner_id', () => learner);
    db.exec('PRAGMA foreign_keys=ON');
    try {
      if (variant === 'fly') {
        const source = new DatabaseSync(path.join(baselineDir, 'app.db'));
        try { createDeployedSchemaFixture(source, db); } finally { source.close(); }
      }
      db.prepare('INSERT INTO learners VALUES (?, ?, ?, NULL)').run('learner-a', 'A', time);
      db.prepare('INSERT INTO learners VALUES (?, ?, ?, NULL)').run('learner-b', 'B', time);
      for (learner of ['learner-a', 'learner-b']) {
        for (const table of tables) insertRun(db, table, `${learner}-historical`);
      }
      const before = tables.map((table) => db.prepare(`SELECT * FROM learner_owned_${table} ORDER BY learner_id, run_id`).all());
      assert.throws(() => assertSchemaCurrent(db), /migration required/);
      assert.deepEqual(migrateDatabase(db), [...(variant === 'fly' ? ['app_schema:0000_baseline'] : []), ...schemaMigrations.map((migration) => migration.id)]);
      assertSchemaCurrent(db);
      for (const [index, table] of tables.entries()) {
        const rows = db.prepare(`SELECT * FROM learner_owned_${table} ORDER BY learner_id, run_id`).all();
        assert.deepEqual(rows.map(({ source_proposal_ids_json, ...row }) => {
          assert.equal(source_proposal_ids_json, null);
          return row;
        }), before[index].map((row) => ({ ...row })));
        learner = 'learner-a';
        const provenance = '["proposal-a"]';
        insertRun(db, table, 'new-a', provenance);
        assert.deepEqual({ ...db.prepare(`SELECT learner_id, source_proposal_ids_json FROM learner_owned_${table} WHERE run_id='new-a'`).get() }, {
          learner_id: 'learner-a', source_proposal_ids_json: provenance,
        });
        assert.throws(() => db.exec(`UPDATE ${table} SET source_proposal_ids_json='[]' WHERE run_id='new-a'`), /immutable/);
        learner = 'learner-b';
        assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE run_id='new-a'`).get()?.count, 0);
        db.exec(`DELETE FROM ${table} WHERE run_id='new-a'`);
        assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM learner_owned_${table} WHERE run_id='new-a'`).get()?.count, 1);
        insertRun(db, table, 'new-b', '["proposal-b"]');
        assert.equal(db.prepare(`SELECT learner_id FROM learner_owned_${table} WHERE run_id='new-b'`).get()?.learner_id, 'learner-b');
      }
      const after = schema(db);
      assert.deepEqual(migrateDatabase(db), []);
      assert.deepEqual(schema(db), after);
      assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
      assert.equal(db.prepare('PRAGMA quick_check').get()?.quick_check, 'ok');

      const freshDir = path.join(root, 'fresh');
      const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', 'await import("./server/db.ts")'], {
        encoding: 'utf8', env: { ...process.env, APP_MODE: 'study', APP_AUTH_MODE: 'clerk', APP_DATA_DIR: freshDir },
      });
      assert.equal(result.status, 0, result.stderr);
      const fresh = new DatabaseSync(path.join(freshDir, 'app.db'));
      try { assert.deepEqual(schema(fresh), after); } finally { fresh.close(); }
    } finally { db.close(); fs.rmSync(root, { recursive: true, force: true }); }
  });

}
