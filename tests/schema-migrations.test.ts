import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { after, before, test } from 'node:test';
import { assertSchemaCurrent, migrateDatabase, getSchemaMigrationStatus } from '../server/db/migrations.ts';

let dir: string;
let source: string;
const migration = { id: 'app_schema:0001_optional_note', sql: 'ALTER TABLE learners ADD COLUMN migration_test_note TEXT;' };
function startup(databaseDir: string) {
  return spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', 'await import("./server/db.ts")'], {
    encoding: 'utf8', env: { ...process.env, APP_MODE: 'study', APP_AUTH_MODE: 'clerk', APP_DATA_DIR: databaseDir },
  });
}
function copy(name: string) {
  const targetDir = path.join(dir, name);
  fs.mkdirSync(targetDir);
  const file = path.join(targetDir, 'app.db');
  fs.copyFileSync(source, file);
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys=ON');
  db.function('current_learner_id', () => 'test');
  return { db, file, targetDir };
}
function snapshot(db: DatabaseSync) {
  return db.prepare('SELECT type, name, sql FROM sqlite_schema ORDER BY type, name').all();
}
before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'schema-migrations-'));
  const sourceDir = path.join(dir, 'source');
  const result = startup(sourceDir);
  assert.equal(result.status, 0, result.stderr);
  source = path.join(sourceDir, 'app.db');
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('fresh database is current and repeated startup does not modify schema or data', () => {
  const { db, targetDir } = copy('startup');
  try {
    assertSchemaCurrent(db);
    const schema = snapshot(db);
    const version = db.prepare('PRAGMA schema_version').get();
    const ledger = db.prepare('SELECT * FROM schema_migrations').all();
    const result = startup(targetDir);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(snapshot(db), schema);
    assert.deepEqual(db.prepare('PRAGMA schema_version').get(), version);
    assert.deepEqual(db.prepare('SELECT * FROM schema_migrations').all(), ledger);
  } finally { db.close(); }
});

test('offline CLI adopts current baseline without changing application data; startup refuses before adoption', () => {
  const { db, file, targetDir } = copy('adopt');
  try {
    db.exec("DELETE FROM schema_migrations WHERE migration_id LIKE 'app_schema:%'; INSERT INTO learners VALUES ('test', 'Keep me', '2026-09-07', NULL)");
    const schema = snapshot(db);
    const result = startup(targetDir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /migration required/);
    assert.deepEqual(snapshot(db), schema);
    const cli = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/migrate-database.ts', `--database=${file}`, '--confirm-app-stopped=true'], { encoding: 'utf8' });
    assert.equal(cli.status, 0, cli.stderr);
    assertSchemaCurrent(db);
    assert.equal(db.prepare('SELECT display_name FROM learners').get()?.display_name, 'Keep me');
    assert.deepEqual(snapshot(db), schema);
    assert.deepEqual(migrateDatabase(db), []);
  } finally { db.close(); }
});

test('rejects older baseline and missing guards without recording adoption', () => {
  const { db } = copy('old');
  try {
    db.exec("DELETE FROM schema_migrations WHERE migration_id LIKE 'app_schema:%'; DROP INDEX idx_words_priority");
    const schema = snapshot(db);
    assert.throws(() => migrateDatabase(db), /supported current schema baseline.*idx_words_priority/);
    assert.deepEqual(snapshot(db), schema);
    assert.deepEqual(getSchemaMigrationStatus(db).applied, []);
  } finally { db.close(); }
});

test('applies optional column once and rejects edited, pending, future and drifted schemas', () => {
  const { db } = copy('upgrade');
  try {
    assert.throws(() => assertSchemaCurrent(db, [migration]), /migration required/);
    assert.deepEqual(migrateDatabase(db, [migration]), [migration.id]);
    assert.deepEqual(migrateDatabase(db, [migration]), []);
    assertSchemaCurrent(db, [migration]);
    assert.throws(() => assertSchemaCurrent(db), /Unknown/);
    assert.throws(() => migrateDatabase(db, [{ ...migration, sql: `${migration.sql} -- edited` }]), /has changed/);
    db.exec('CREATE INDEX unexpected_index ON learners(display_name)');
    assert.throws(() => assertSchemaCurrent(db, [migration]), /drifted/);
  } finally { db.close(); }
});

test('rolls the entire pending batch and data back on SQL failure', () => {
  const { db } = copy('failure');
  try {
    const schema = snapshot(db);
    const broken = { id: 'app_schema:0002_broken', sql: "INSERT INTO learners VALUES ('test', 'Temporary', '2026-09-07', NULL, NULL); SELECT * FROM missing_table;" };
    assert.throws(() => migrateDatabase(db, [migration, broken]), /missing_table/);
    assert.deepEqual(snapshot(db), schema);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM learners').get()?.count, 0);
    assertSchemaCurrent(db);
    assert.deepEqual(migrateDatabase(db, [migration]), [migration.id]);
  } finally { db.close(); }
});

test('rejects foreign key violations and leaves the ledger unchanged', () => {
  const { db } = copy('foreign-key');
  try {
    const bad = { id: 'app_schema:0001_bad_reference', sql: "PRAGMA defer_foreign_keys=ON; INSERT INTO learner_auth_mappings VALUES ('test', 'subject', 'missing', '2026-09-07');" };
    assert.throws(() => migrateDatabase(db, [bad]), /Foreign key check failed/);
    assertSchemaCurrent(db);
  } finally { db.close(); }
});

test('CLI refuses missing paths and missing maintenance confirmation', () => {
  for (const args of [[`--database=${path.join(dir, 'missing.db')}`, '--confirm-app-stopped=true'], [`--database=${source}`]]) {
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/migrate-database.ts', ...args], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
  }
  assert.equal(fs.existsSync(path.join(dir, 'missing.db')), false);
});

test('serializes against an existing writer and rejects gaps in migration history', () => {
  const { db, file } = copy('locking');
  const other = new DatabaseSync(file);
  try {
    other.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1');
    db.exec('BEGIN IMMEDIATE');
    assert.throws(() => migrateDatabase(other, [migration]), /locked/);
    db.exec('ROLLBACK');
    const next = { id: 'app_schema:0002_index', sql: 'CREATE INDEX idx_migration_test ON learners(migration_test_note);' };
    migrateDatabase(db, [migration, next]);
    db.prepare('DELETE FROM schema_migrations WHERE migration_id = ?').run(migration.id);
    assert.throws(() => assertSchemaCurrent(db, [migration, next]), /out-of-order/);
  } finally { other.close(); db.close(); }
});


test('ignores only known Litestream-managed tables during adoption and startup', () => {
  const { db } = copy('litestream');
  try {
    db.exec("DELETE FROM schema_migrations WHERE migration_id LIKE 'app_schema:%'");
    db.exec('CREATE TABLE _litestream_lock (id INTEGER); CREATE TABLE _litestream_seq (id INTEGER PRIMARY KEY, seq INTEGER); INSERT INTO _litestream_seq VALUES (1, 7)');
    migrateDatabase(db);
    assertSchemaCurrent(db);
    assert.equal(db.prepare('SELECT seq FROM _litestream_seq').get()?.seq, 7);
    db.exec('DROP TABLE _litestream_lock');
    assertSchemaCurrent(db);
    db.exec('CREATE TABLE _litestream_unexpected (id INTEGER)');
    assert.throws(() => assertSchemaCurrent(db), /drifted/);
  } finally { db.close(); }
});

test('adopts the verified Fly variant without altering schema or artifact data', async () => {
  const { createDeployedSchemaFixture } = await import('./helpers/deployed-schema.ts');
  const sourceDb = new DatabaseSync(source);
  const deployed = new DatabaseSync(':memory:');
  deployed.function('current_learner_id', () => 'learner-a');
  deployed.exec('PRAGMA foreign_keys=ON');
  try {
    createDeployedSchemaFixture(sourceDb, deployed);
    deployed.exec(`
      INSERT INTO learners VALUES ('learner-a', 'Retain me', '2026-09-07', NULL);
      INSERT INTO schema_migrations VALUES ('historical_marker', '2026-09-06', '{}');
      INSERT INTO learner_owned_reflection_artifacts (
        learner_id, artifact_id, reflection_flow_version, generated_at, provider, model,
        prompt_version, bundle_schema_version, result_schema_version, evidence_bundle_json, result_json
      ) VALUES ('learner-a', 'artifact-a', 'historical', '2026-09-07', 'provider', 'model',
        'prompt', 'bundle', 'result', '{"keep":"evidence"}', '{"keep":"result"}');
    `);
    const before = deployed.prepare('SELECT * FROM learner_owned_reflection_artifacts').all();
    const schemaBefore = snapshot(deployed);
    const broken = { id: 'app_schema:0001_broken', sql: 'SELECT * FROM nonexistent;' };
    assert.throws(() => migrateDatabase(deployed, [broken]), /nonexistent/);
    assert.equal(deployed.prepare("SELECT 1 FROM sqlite_schema WHERE name='reflection_artifacts_immutable'").get(), undefined);
    assert.equal(getSchemaMigrationStatus(deployed).applied.length, 0);
    migrateDatabase(deployed);
    assertSchemaCurrent(deployed);
    assert.deepEqual(deployed.prepare('SELECT * FROM learner_owned_reflection_artifacts').all(), before);
    assert.equal(deployed.prepare("SELECT applied_at FROM schema_migrations WHERE migration_id='historical_marker'").get()?.applied_at, '2026-09-06');
    const row = deployed.prepare("SELECT details_json FROM schema_migrations WHERE migration_id='app_schema:0000_baseline'").get();
    assert.equal(JSON.parse(String(row?.details_json)).baselineVariant, 'fly_3ad618b');
    assert.deepEqual(snapshot(deployed), schemaBefore);
    assert.throws(() => deployed.exec("UPDATE reflection_artifacts SET generated_at='changed' WHERE artifact_id='artifact-a'"), /immutable/);
    assert.deepEqual(migrateDatabase(deployed), []);
  } finally { deployed.close(); sourceDb.close(); }
});

test('rejects an unexpected missing view guard', () => {
  const { db } = copy('unknown-variant');
  try {
    db.exec("DELETE FROM schema_migrations WHERE migration_id LIKE 'app_schema:%'; DROP TRIGGER reflection_artifacts_scoped_update");
    assert.throws(() => migrateDatabase(db), /supported current schema baseline/);
    assert.equal(db.prepare("SELECT 1 FROM sqlite_schema WHERE name='reflection_artifacts_scoped_update'").get(), undefined);
  } finally { db.close(); }
});
