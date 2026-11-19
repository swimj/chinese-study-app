import { readInvocationPromptEvidence } from '../server/db/invocation-prompt-archive.ts';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { after, before, test } from 'node:test';
import { assertSchemaCurrent, migrateDatabase, getSchemaMigrationStatus, schemaMigrationIds, schemaMigrations } from '../server/db/migrations.ts';

import { createBaselineFixture } from './helpers/baseline-database.ts';

let dir: string;
let baselineSource: string;
let source: string;
const migration = { id: 'app_schema:9000_optional_note', sql: 'ALTER TABLE learners ADD COLUMN migration_test_note TEXT;' };
const testMigrations = [...schemaMigrations, migration];
function startup(databaseDir: string) {
  return spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', 'await import("./server/db.ts")'], {
    encoding: 'utf8', env: { ...process.env, APP_MODE: 'study', APP_AUTH_MODE: 'clerk', APP_DATA_DIR: databaseDir },
  });
}
function copy(name: string, baselineOnly = false) {
  const targetDir = path.join(dir, name);
  fs.mkdirSync(targetDir);
  const file = path.join(targetDir, 'app.db');
  fs.copyFileSync(baselineOnly ? baselineSource : source, file);
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
  const baselineDir = path.join(dir, 'baseline');
  createBaselineFixture(baselineDir);
  baselineSource = path.join(baselineDir, 'app.db');
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
  const { db, file, targetDir } = copy('adopt', true);
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
    const latest = new DatabaseSync(source);
    try { assert.deepEqual(snapshot(db), snapshot(latest)); } finally { latest.close(); }
    assert.deepEqual(migrateDatabase(db), []);
  } finally { db.close(); }
});

test('rejects older baseline and missing guards without recording adoption', () => {
  const { db } = copy('old', true);
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
    assert.throws(() => assertSchemaCurrent(db, testMigrations), /migration required/);
    assert.deepEqual(migrateDatabase(db, testMigrations), [migration.id]);
    assert.deepEqual(migrateDatabase(db, testMigrations), []);
    assertSchemaCurrent(db, testMigrations);
    assert.throws(() => assertSchemaCurrent(db), /Unknown/);
    assert.throws(() => migrateDatabase(db, [...schemaMigrations, { ...migration, sql: `${migration.sql} -- edited` }]), /has changed/);
    db.exec('CREATE INDEX unexpected_index ON learners(display_name)');
    assert.throws(() => assertSchemaCurrent(db, testMigrations), /drifted/);
  } finally { db.close(); }
});

test('rolls the entire pending batch and data back on SQL failure', () => {
  const { db } = copy('failure');
  try {
    const schema = snapshot(db);
    const broken = { id: 'app_schema:9001_broken', sql: "INSERT INTO learners VALUES ('test', 'Temporary', '2026-09-07', NULL, NULL); SELECT * FROM missing_table;" };
    assert.throws(() => migrateDatabase(db, [...testMigrations, broken]), /missing_table/);
    assert.deepEqual(snapshot(db), schema);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM learners').get()?.count, 0);
    assertSchemaCurrent(db);
    assert.deepEqual(migrateDatabase(db, testMigrations), [migration.id]);
  } finally { db.close(); }
});

test('rejects foreign key violations and leaves the ledger unchanged', () => {
  const { db } = copy('foreign-key');
  try {
    const bad = { id: 'app_schema:9000_bad_reference', sql: "PRAGMA defer_foreign_keys=ON; INSERT INTO learner_auth_mappings VALUES ('test', 'subject', 'missing', '2026-09-07');" };
    assert.throws(() => migrateDatabase(db, [...schemaMigrations, bad]), /Foreign key check failed/);
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
    assert.throws(() => migrateDatabase(other, testMigrations), /locked/);
    db.exec('ROLLBACK');
    const next = { id: 'app_schema:9001_index', sql: 'CREATE INDEX idx_migration_test ON learners(migration_test_note);' };
    migrateDatabase(db, [...testMigrations, next]);
    db.prepare('DELETE FROM schema_migrations WHERE migration_id = ?').run(migration.id);
    assert.throws(() => assertSchemaCurrent(db, [...testMigrations, next]), /out-of-order/);
  } finally { other.close(); db.close(); }
});


test('ignores only known Litestream-managed tables during adoption and startup', () => {
  const { db } = copy('litestream', true);
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
  const sourceDb = new DatabaseSync(baselineSource);
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
    migrateDatabase(deployed, []);
    assertSchemaCurrent(deployed, []);
    assert.deepEqual(deployed.prepare('SELECT * FROM learner_owned_reflection_artifacts').all(), before);
    assert.equal(deployed.prepare("SELECT applied_at FROM schema_migrations WHERE migration_id='historical_marker'").get()?.applied_at, '2026-09-06');
    const row = deployed.prepare("SELECT details_json FROM schema_migrations WHERE migration_id='app_schema:0000_baseline'").get();
    assert.equal(JSON.parse(String(row?.details_json)).baselineVariant, 'fly_3ad618b');
    assert.deepEqual(snapshot(deployed), schemaBefore);
    assert.throws(() => deployed.exec("UPDATE reflection_artifacts SET generated_at='changed' WHERE artifact_id='artifact-a'"), /immutable/);
    assert.deepEqual(migrateDatabase(deployed, []), []);
  } finally { deployed.close(); sourceDb.close(); }
});

test('rejects an unexpected missing view guard', () => {
  const { db } = copy('unknown-variant', true);
  try {
    db.exec("DELETE FROM schema_migrations WHERE migration_id LIKE 'app_schema:%'; DROP TRIGGER reflection_artifacts_scoped_update");
    assert.throws(() => migrateDatabase(db), /supported current schema baseline/);
    assert.equal(db.prepare("SELECT 1 FROM sqlite_schema WHERE name='reflection_artifacts_scoped_update'").get(), undefined);
  } finally { db.close(); }
});


test('exercise compensation migration starts empty and preserves existing summary and restoration history', () => {
  const { db } = copy('exercise-compensation', true);
  try {
    const migrationIndex = schemaMigrations.findIndex(item => item.id === 'app_schema:0022_exercise_compensation_days');
    assert.ok(migrationIndex > 0);
    migrateDatabase(db, schemaMigrations.slice(0, migrationIndex));
    db.prepare(`INSERT INTO learners (learner_id, display_name, created_at) VALUES ('test', 'Test', '2026-09-18')`).run();
    db.prepare(`INSERT INTO lexical_words
      (id, hanzi, pinyin, meaning, meanings_json, examples_json, priority, created_at)
      VALUES ('word', '字', 'zi', 'character', '[]', '[]', 1, '2026-09-18')`).run();
    db.prepare(`INSERT INTO learner_owned_review_session_summaries
      (learner_id, session_id, completed_at, day_key, completed_count, failed_count, active_duration_ms)
      VALUES ('test', 'old-session', '2026-09-18T00:00:00.000Z', '2026-09-18', 10, 2, 1000)`).run();
    db.prepare(`INSERT INTO pure_cue_scheduler_compensation_snapshots
      (learner_id, session_id, session_action_id, target_word_id, captured_at,
       production_skill_state_json, admission_state_json, compensated_by_invocation_id, compensated_at)
      VALUES ('test', 'old-session', 'action', 'word', '2026-09-18T00:00:00.000Z',
        'null', 'null', 'old-invocation', '2026-09-19T00:00:00.000Z')`).run();
    const summary = db.prepare('SELECT * FROM learner_owned_review_session_summaries').all();
    const restorations = db.prepare('SELECT * FROM pure_cue_scheduler_compensation_snapshots').all();
    migrateDatabase(db);
    assertSchemaCurrent(db);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM learner_exercise_compensation_days').get()?.n, 0);
    assert.deepEqual(db.prepare('SELECT * FROM learner_owned_review_session_summaries').all().map(row => ({ ...row })), summary.map(row => ({ ...row, learning_completed_count: null, new_word_count: null })));
    assert.deepEqual(db.prepare('SELECT * FROM pure_cue_scheduler_compensation_snapshots').all(), restorations);
    assert.deepEqual(migrateDatabase(db), []);
  } finally { db.close(); }
});

test('session debrief migration preserves valued completion rows and starts with no historical jobs', () => {
  const { db } = copy('session-debrief-forward', true);
  try {
    const earlier = schemaMigrations.filter((migration) => migration.id < 'app_schema:0023_session_debrief');
    migrateDatabase(db, earlier);
    db.prepare(`INSERT INTO learners (learner_id, display_name, created_at) VALUES ('test','Preserve me','2026-10-06')`).run();
    db.prepare(`INSERT INTO learner_owned_review_session_summaries (learner_id,session_id,completed_at,day_key,completed_count,failed_count,active_duration_ms)
      VALUES ('test','historical','2026-10-05T00:00:00.000Z','2026-10-05',12,2,3456)`).run();
    const old = db.prepare('SELECT * FROM learner_owned_review_session_summaries').all();
    assert.deepEqual(migrateDatabase(db), schemaMigrations
      .filter((migration) => migration.id >= 'app_schema:0023_session_debrief')
      .map((migration) => migration.id));
    assert.deepEqual(db.prepare('SELECT * FROM learner_owned_review_session_summaries').all().map(row => ({ ...row })), old.map(row => ({ ...row, learning_completed_count: null, new_word_count: null })));
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM learner_session_debrief_jobs').get()?.count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM learner_session_debrief_attempts').get()?.count, 0);
    assert.deepEqual(migrateDatabase(db), []);
    assertSchemaCurrent(db);
  } finally { db.close(); }
});


test('model invocation outcome migration preserves old accounting without inventing latency', () => {
  const { db } = copy('model-invocation-outcomes', true);
  try {
    migrateDatabase(db, schemaMigrations.filter((migration) => migration.id < 'app_schema:0026_model_invocation_outcomes'));
    db.prepare(`INSERT INTO learners (learner_id, display_name, created_at) VALUES ('ledger-history','History','2026-10-06')`).run();
    db.prepare(`INSERT INTO model_invocations (id,timestamp,provider,model,invocation_type,learner_id,spend_usd,spend_source,status,pricing_json)
      VALUES ('old-call','2026-10-06T12:00:00.000Z','openrouter','old-model','reflection','ledger-history',0.25,'reported','completed','{"source":"provider"}')`).run();
    const old = db.prepare('SELECT * FROM model_invocations').get();
    migrateDatabase(db);
    const migrated = db.prepare('SELECT * FROM model_invocations').get()!;
    for (const [key, value] of Object.entries(old!)) assert.deepEqual(migrated[key], value);
    assert.equal(migrated.latency_ms, null);
    assert.equal(migrated.actor_kind, 'learner');
    assert.equal(migrated.actor_id, 'ledger-history');
    assert.equal(migrated.prompt_hash, null);
    assert.equal(migrated.request_snapshot_json, null);
    assert.deepEqual(migrateDatabase(db), []);
    assertSchemaCurrent(db);
  } finally { db.close(); }
});

test('definition fallback migration preserves snapshots, encounters, ratings and integrity guards', () => {
  const { db } = copy('definition-fallback-quality', true);
  try {
    const index = schemaMigrations.findIndex(item => item.id === 'app_schema:0035_definition_fallback_quality');
    assert.ok(index > 0);
    migrateDatabase(db, schemaMigrations.slice(0, index));
    db.exec(`INSERT INTO learners(learner_id,display_name,created_at) VALUES ('test','Test','2026-10-10');
      INSERT INTO content_quality_items VALUES ('existing','production_cue','cue','word','A greeting','{"cueText":"A greeting"}','{"source":"manual","model":null}','2026-10-10');
      INSERT INTO learner_content_quality_encounters VALUES ('test','encounter','existing','2026-10-10');
      INSERT INTO learner_content_quality_ratings VALUES ('test','existing','down','2026-10-10');`);
    const tables = ['content_quality_items', 'learner_content_quality_encounters', 'learner_content_quality_ratings'];
    const before = tables.map(table => db.prepare(`SELECT * FROM ${table}`).all());
    migrateDatabase(db);
    assertSchemaCurrent(db);
    assert.deepEqual(tables.map(table => db.prepare(`SELECT * FROM ${table}`).all()), before);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.throws(() => db.exec("UPDATE content_quality_items SET title='changed'"), /immutable/);
    assert.throws(() => db.exec("UPDATE learner_content_quality_encounters SET encounter_id='changed'"), /immutable/);
    assert.throws(() => db.exec("UPDATE learner_content_quality_ratings SET content_key='changed'"), /immutable/);
    db.exec(`INSERT INTO content_quality_items VALUES ('fallback','definition_fallback','word','word','hello','{"promptText":"hello","displayedMeanings":[]}','{"source":"definition fallback","model":null}','2026-10-10')`);
    assert.throws(() => db.exec("INSERT INTO learner_content_quality_ratings VALUES ('test','fallback','down','2026-10-10')"), /requires own encounter/);
    db.exec(`INSERT INTO learner_content_quality_encounters VALUES ('test','fallback-encounter','fallback','2026-10-10');
      INSERT INTO learner_content_quality_ratings VALUES ('test','fallback','down','2026-10-10');`);
    assert.deepEqual(migrateDatabase(db), []);
  } finally { db.close(); }
});

test('durable session completion migration preserves historical progress and fabricates no intents or reporting jobs', () => {
  const { db } = copy('session-completion-upgrade', true);
  try {
    const index = schemaMigrations.findIndex(item => item.id === 'app_schema:0036_session_completion');
    assert.ok(index > 0);
    migrateDatabase(db, schemaMigrations.slice(0, index));
    db.exec(`INSERT INTO learners(learner_id,display_name,created_at) VALUES ('test','Test','2026-10-12');
      INSERT INTO learner_owned_review_session_summaries
        (learner_id,session_id,completed_at,day_key,completed_count,failed_count,active_duration_ms,learning_completed_count)
        VALUES ('test','historical','2026-10-12T00:00:00.000Z','2026-10-12',4,1,120000,2);`);
    const summaries = db.prepare('SELECT * FROM learner_owned_review_session_summaries').all();
    const learners = db.prepare('SELECT * FROM learners').all();
    migrateDatabase(db);
    assertSchemaCurrent(db);
    assert.deepEqual(db.prepare('SELECT * FROM learner_owned_review_session_summaries').all().map(row => ({ ...row })), summaries.map(row => ({ ...row, new_word_count: null })));
    assert.deepEqual(db.prepare('SELECT * FROM learners').all(), learners);
    for (const table of ['learner_session_completions', 'learner_session_word_outcomes', 'learner_session_reflection_dispatches'])
      assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n, 0);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.deepEqual(migrateDatabase(db), []);
  } finally { db.close(); }
});


test('service kickoff migration preserves authored notices without inferring kickoff', () => {
  const { db } = copy('service-kickoff-upgrade', true);
  try {
    const index = schemaMigrations.findIndex(item => item.id === 'app_schema:0037_service_banner_kickoff');
    assert.ok(index > 0);
    migrateDatabase(db, schemaMigrations.slice(0, index));
    db.exec(`INSERT INTO service_banner VALUES (1, 'Update around 6 PM EDT', '2030-07-01T00:00:00.000Z', '2030-07-03T00:00:00.000Z', 'operator');`);
    const before = db.prepare('SELECT * FROM service_banner').get();
    migrateDatabase(db);
    assert.deepEqual({ ...db.prepare('SELECT * FROM service_banner').get() }, { ...before, kickoff_at: null });
    assertSchemaCurrent(db);
    assert.deepEqual(migrateDatabase(db), []);
    const { db: fresh } = copy('service-kickoff-fresh', true);
    try {
      migrateDatabase(fresh);
      assert.deepEqual(snapshot(db), snapshot(fresh));
    } finally { fresh.close(); }
  } finally { db.close(); }
});

test('automatic graduation pause migration preserves existing words and defaults to ordinary automatic progression',()=>{
  const {db}=copy('automatic-graduation-pause',true);
  try {
    const index=schemaMigrations.findIndex((migration)=>migration.id==='app_schema:0052_vocabulary_automatic_promotion_pause');
    assert.ok(index>0);
    migrateDatabase(db,schemaMigrations.slice(0,index));
    db.exec(`INSERT INTO learners(learner_id,display_name,created_at) VALUES ('pause-test','Pause test','2026-10-23');
      INSERT INTO lexical_words(id,hanzi,pinyin,meaning,meanings_json,examples_json,priority,created_at)
        VALUES ('pause-word','字','zi','character','[]','[]',1,'2026-10-23');
      INSERT INTO learner_words(learner_id,word_id,in_stash,added_at,mode,mode_changed_at)
        VALUES ('pause-test','pause-word',1,'2026-10-23','solidify','2026-10-23');`);
    const before=db.prepare("SELECT * FROM learner_words WHERE learner_id='pause-test'").get()!;
    assert.deepEqual(migrateDatabase(db),schemaMigrations.slice(index).map(migration=>migration.id));
    const after=db.prepare("SELECT * FROM learner_words WHERE learner_id='pause-test'").get()!;
    assert.deepEqual({...after},{...before,automatic_promotion_paused:0});
    assert.throws(()=>db.exec("UPDATE learner_words SET automatic_promotion_paused=2 WHERE learner_id='pause-test'"),/CHECK/);
    db.exec("UPDATE learner_words SET automatic_promotion_paused=1 WHERE learner_id='pause-test'");
    assert.deepEqual(migrateDatabase(db),[]);
    assert.equal(db.prepare("SELECT automatic_promotion_paused FROM learner_words WHERE learner_id='pause-test'").get()!.automatic_promotion_paused,1);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
    assertSchemaCurrent(db);
  } finally {db.close();}
});

test('operator-only migration preserves both existing controls and defaults access open', () => {
  const { db } = copy('operator-only-upgrade', true);
  try {
    const index = schemaMigrations.findIndex(entry => entry.id === 'app_schema:0056_operator_only_access');
    const prior = schemaMigrations.slice(0,index);
    migrateDatabase(db, prior);
    db.exec("UPDATE service_controls SET enabled = CASE control_key WHEN 'maintenance_mode' THEN 1 ELSE 0 END, updated_at = '2026-10-27T00:00:00.000Z', actor_id = 'incident-operator'");
    const before = db.prepare('SELECT * FROM service_controls ORDER BY control_key').all();
    assert.deepEqual(migrateDatabase(db), schemaMigrations.slice(index).map(entry=>entry.id));
    // Later control migrations add their own rows; the earlier controls stay exact.
    assert.deepEqual(db.prepare("SELECT * FROM service_controls WHERE control_key NOT IN ('operator_only','timed_sessions','proactive_repertoire') ORDER BY control_key").all(), before);
    assert.deepEqual({ ...db.prepare("SELECT * FROM service_controls WHERE control_key = 'operator_only'").get() }, {
      control_key: 'operator_only', enabled: 0, updated_at: '1970-01-01T00:00:00.000Z', actor_id: 'system_default',
    });
    assert.deepEqual(migrateDatabase(db), []);
    assert.throws(() => db.exec("INSERT INTO service_controls VALUES ('invalid', 1, 'now', 'operator')"), /CHECK constraint/);
    assertSchemaCurrent(db);
  } finally { db.close(); }
});


test('preparation compatibility migration retains old preparation and makes no eager queue demand', () => {
  const { db } = copy('preparation-compatibility-upgrade', true);
  try {
    const index = schemaMigrations.findIndex(entry => entry.id === 'app_schema:0057_preparation_compatibility');
    migrateDatabase(db,schemaMigrations.slice(0,index));
    db.exec("INSERT INTO lexical_words(id,hanzi,pinyin,meaning,meanings_json,examples_json,priority,created_at) VALUES('epoch-word','字','zi','word','[]','[]',0,'2026-01-01')");
    db.exec("INSERT INTO word_introduction_preparation(word_id,active_stage,lease_token,lease_expires_at) VALUES('epoch-word','bootstrap','old-token','2026-10-30T00:00:00.000Z')");
    const before=db.prepare('SELECT * FROM word_introduction_preparation').all();
    const queues=db.prepare('SELECT * FROM word_preparation_work').all();
    assert.deepEqual(migrateDatabase(db),schemaMigrations.slice(index).map(entry=>entry.id));
    assert.deepEqual(db.prepare('SELECT * FROM word_introduction_preparation').all().map(row=>({...row})),before.map(row=>({...row,preparation_epoch:0,teaching_set_key:'default'})));
    assert.deepEqual(db.prepare('SELECT * FROM word_preparation_work').all(),queues);
    assert.throws(()=>db.exec('UPDATE word_introduction_preparation SET preparation_epoch=-1'),/CHECK/);
    assertSchemaCurrent(db);
  } finally {db.close();}
});

test('sense coverage migration preserves existing authored data and starts inherited defaults',()=>{
  const {db}=copy('sense-coverage-upgrade',true);
  try {
    const prior=schemaMigrations.slice(0,schemaMigrations.findIndex(item=>item.id==='app_schema:0062_vocabulary_sense_coverage'));
    migrateDatabase(db,prior);
    const before=db.prepare('SELECT * FROM content_items ORDER BY content_id').all();
    const senses=db.prepare('SELECT * FROM senses ORDER BY sense_id').all();
    migrateDatabase(db);
    assert.deepEqual(db.prepare('SELECT * FROM content_items ORDER BY content_id').all(),before);
    assert.deepEqual(db.prepare('SELECT * FROM senses ORDER BY sense_id').all(),senses);
    for(const table of ['vocabulary_word_sense_coverage','vocabulary_case_sense_coverage','vocabulary_sense_coverage_history'])
      assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get()!.n,0);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
    assertSchemaCurrent(db);
  }finally{db.close();}
});

test('retirement receipt upgrade runs the real migration chain and preserves existing application history',()=>{
  const {db}=copy('retirement-receipt-upgrade',true);
  try {
    const index=schemaMigrations.findIndex(item=>item.id==='app_schema:0063_vocabulary_proposal_drop_actions');
    migrateDatabase(db,schemaMigrations.slice(0,index));
    const at='2026-10-29T12:00:00.000Z';
    db.exec('BEGIN IMMEDIATE');
    db.prepare(`INSERT INTO content_items VALUES ('exercise','exercise',1,'{}','definition','production','general','{}','shared',NULL,'active','human',NULL,NULL,2,?,?)`).run(at,at);
    for(const version of [1,2])db.prepare(`INSERT INTO content_revision_history VALUES (?,?,?,?,?,'updated','update_existing','operator','editor',NULL,?)`).run(version===1?'before':'after','exercise',version,version===1?null:1,'{}',at);
    db.prepare(`INSERT INTO content_proposals VALUES ('proposal',NULL,1,'applied','[]','Retained history','operator','editor',NULL,?,?)`).run(at,at);
    db.prepare(`INSERT INTO proposal_revision_history VALUES ('proposal',1,'{}','operator','editor',?)`).run(at);
    db.prepare(`INSERT INTO proposal_reviews VALUES ('review','proposal',1,'editor','approved','{}',?)`).run(at);
    db.prepare(`INSERT INTO proposal_applications VALUES ('application','proposal',1,'review','key','{}',?)`).run(at);
    db.exec("INSERT INTO application_content_changes VALUES ('application','old','update_existing','exercise',1,'exercise',2,'after')");
    db.exec('COMMIT');
    const tables=['content_items','content_revision_history','proposal_revision_history','proposal_reviews','proposal_applications','application_content_changes'];
    const before=tables.map(table=>db.prepare(`SELECT * FROM ${table}`).all());
    migrateDatabase(db);
    tables.forEach((table,i)=>assert.deepEqual(db.prepare(`SELECT * FROM ${table}`).all(),before[i]));
    db.exec("INSERT INTO application_content_changes VALUES ('application','retire','retire','exercise',1,'exercise',2,'after')");
    assert.throws(()=>db.exec("UPDATE application_content_changes SET write_strategy='create'"),/immutable/);
    assert.throws(()=>db.exec('DELETE FROM application_content_changes'),/retained/);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);assertSchemaCurrent(db);
  }finally{db.close();}
});

test('default useful selection upgrade preserves prior coverage without interpreting unknown as all or none',()=>{
  const {db}=copy('default-useful-upgrade',true);
  try{
    const prior=schemaMigrations.slice(0,schemaMigrations.findIndex(item=>item.id==='app_schema:0064_vocabulary_default_useful_senses'));
    migrateDatabase(db,prior);
    db.exec(`INSERT INTO lexical_words(id,hanzi,traditional,pinyin,meaning,meanings_json,examples_json,priority,created_at) VALUES ('selection','函',NULL,'hán','letter; box','["letter","box"]','[]',1,'2026-10-29');
      INSERT INTO vocabulary_word_sense_coverage(word_id,version,excluded_sense_ids_json,updated_at) VALUES ('selection',4,'["old-exclusion"]','2026-10-29');`);
    const before=db.prepare('SELECT * FROM vocabulary_sense_coverage_history').all();
    migrateDatabase(db);migrateDatabase(db);
    const row=db.prepare('SELECT * FROM vocabulary_word_sense_coverage WHERE word_id=?').get('selection')!;
    assert.equal(row.version,4);assert.equal(row.excluded_sense_ids_json,'["old-exclusion"]');assert.equal(row.default_useful_sense_ids_json,null);
    assert.deepEqual(db.prepare('SELECT * FROM vocabulary_sense_coverage_history').all(),before);assertSchemaCurrent(db);
  }finally{db.close();}
});

test('dispatch polling indexes preserve populated evidence and lifecycle fields across upgrade',()=>{
  const {db}=copy('dispatch-polling-upgrade',true);
  try {
    const index=schemaMigrations.findIndex(item=>item.id==='app_schema:0065_vocabulary_dispatch_polling_indexes');
    assert.ok(index>0);
    migrateDatabase(db,schemaMigrations.slice(0,index));
    const at='2026-11-04T04:05:23.470Z';
    db.prepare('INSERT INTO learners VALUES(?,?,?,NULL)').run('dispatch-learner','Retained learner',at);
    const evidence=JSON.stringify({context:{retained:'x'.repeat(512*1024)},actions:[],projection:{fixture:true}});
    for(const status of ['queued','running','succeeded','failed']) {
      db.prepare(`INSERT INTO vocabulary_sessions VALUES(?,'dispatch-learner',1,'{}',?,?,'closed')`).run(status,at,at);
      db.prepare(`INSERT INTO vocabulary_session_completions VALUES(?,'dispatch-learner',?,1,0,?,?,'closed','{}','{}','fixture',?,NULL)`).run(status,status,at,at,at);
      db.prepare(`INSERT INTO vocabulary_post_session_dispatches VALUES(?,'dispatch-learner',?,?,?,?,?,?,?,?,?)`)
        .run(status,status,status,evidence,status,at,status==='running'?'retained-token':null,
          status==='running'?'2026-11-04T04:06:23.470Z':null,status==='failed'?'retained-error':null,
          status==='succeeded'?' {"caseIds": ["retained-case"]} ':null);
    }
    const tables=['learners','vocabulary_sessions','vocabulary_session_completions','vocabulary_post_session_dispatches'];
    const before=tables.map(table=>db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
    const throughPolling = schemaMigrations.slice(0,index+1);
    assert.deepEqual(migrateDatabase(db,throughPolling),[schemaMigrations[index]!.id]);
    assert.deepEqual(migrateDatabase(db,throughPolling),[]);
    tables.forEach((table,i)=>assert.deepEqual(db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),before[i]));
    assert.throws(()=>db.exec("UPDATE vocabulary_post_session_dispatches SET evidence_json='{}' WHERE dispatch_id='succeeded'"),/immutable/);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  } finally {db.close();}
});

function seedCaseReviewLineage(db:DatabaseSync,active=false){
  const at='2026-11-04T00:00:00.000Z';
  db.exec('BEGIN');
  db.prepare("INSERT INTO learners VALUES ('case-learner','Fixture',?,NULL)").run(at);
  db.prepare("INSERT INTO vocabulary_sessions VALUES ('case-session','case-learner',1,'{}',?,?,'closed')").run(at,at);
  db.prepare("INSERT INTO vocabulary_session_completions VALUES ('case-completion','case-learner','case-session',1,0,?,?,'closed','{\"actions\":[]}','{}','fixture',?,NULL)").run(at,at,at);
  db.prepare("INSERT INTO vocabulary_reflection_session_evidence VALUES ('case-completion','case-learner','case-session','{}',?)").run(at);
  for(const [id,status] of [['root','closed'],['successor','completed'],['opinion','completed']])db.prepare("INSERT INTO reflection_cases(case_id,completion_id,learner_id,kind,subject_key,status,evidence_snapshot_json,created_at) VALUES (?,'case-completion','case-learner','exercise_improvement',?,?,'[]',?)").run(id,id,status,at);
  db.prepare("INSERT INTO content_proposals VALUES ('old-proposal','root',1,'closed','[]','Retained','service','fixture',NULL,?,?)").run(at,at);
  db.prepare("INSERT INTO proposal_revision_history VALUES ('old-proposal',1,'{}','service','fixture',?)").run(at);
  const insert=db.prepare("INSERT INTO vocabulary_reflection_jobs(job_id,case_id,kind,dedupe_key,status,next_attempt_at,created_at,result_json,reassessment_source_job_id,second_opinion_json) VALUES (?,?,'exercise_improvement',?,?,?,?,?,?,?)");
  insert.run('z-initial','root','root',active?'queued':'succeeded',at,at,JSON.stringify({input:{proposal:{}},output:{proposalId:'old-proposal'}}),null,null);
  insert.run('a-successor','successor','successor',active?'queued':'succeeded',at,at,JSON.stringify({input:{proposal:null},output:{proposalId:null}}),'z-initial',null);
  insert.run('0-opinion','opinion','opinion','succeeded',at,at,JSON.stringify({input:{proposal:null,secondOpinion:{verdict:'support',rationale:'Advisory'}}}),null,JSON.stringify({proposal:{caseId:'root'}}));
  db.exec('COMMIT');
}

test('case review migration preserves a tied historical chain and keeps its latest no-change assessment open',()=>{
  const {db}=copy('case-review-chain',true);
  try{
    const index=schemaMigrations.findIndex(item=>item.id==='app_schema:0066_vocabulary_case_reviews');migrateDatabase(db,schemaMigrations.slice(0,index));seedCaseReviewLineage(db);
    const cases=db.prepare('SELECT * FROM reflection_cases ORDER BY case_id').all(),history=db.prepare('SELECT * FROM proposal_revision_history').all();
    const originalJobs=db.prepare('SELECT job_id,case_id,result_json,second_opinion_json,reassessment_source_job_id FROM vocabulary_reflection_jobs ORDER BY job_id').all();
    migrateDatabase(db);migrateDatabase(db);
    assert.deepEqual(db.prepare('SELECT * FROM reflection_cases ORDER BY case_id').all(),cases);assert.deepEqual(db.prepare('SELECT * FROM proposal_revision_history').all(),history);
    assert.deepEqual(db.prepare('SELECT job_id,case_id,result_json,second_opinion_json,reassessment_source_job_id FROM vocabulary_reflection_jobs ORDER BY job_id').all(),originalJobs);
    const review=db.prepare('SELECT * FROM vocabulary_case_reviews').get()!;
    assert.equal(review.case_id,'root');assert.equal(review.state,'open');assert.equal(review.current_job_id,'a-successor');assert.equal(review.current_proposal_id,null);assert.equal(review.resolved_at,null);
    const jobs=db.prepare('SELECT job_id,review_case_id,case_sequence FROM vocabulary_reflection_jobs ORDER BY case_sequence').all();
    assert.deepEqual(jobs.map(j=>j.job_id),['z-initial','0-opinion','a-successor']);assert.ok(jobs.every(j=>j.review_case_id==='root'));
    assert.equal(db.prepare("SELECT assessment_job_id FROM content_proposals WHERE proposal_id='old-proposal'").get()!.assessment_job_id,'z-initial');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);assertSchemaCurrent(db);
  }finally{db.close();}
});

test('case review migration refuses multiple in-flight ancestors atomically instead of losing provider work',()=>{
  const {db}=copy('case-review-active-chain',true);
  try{
    const index=schemaMigrations.findIndex(item=>item.id==='app_schema:0066_vocabulary_case_reviews');migrateDatabase(db,schemaMigrations.slice(0,index));seedCaseReviewLineage(db,true);
    const before=db.prepare('SELECT * FROM vocabulary_reflection_jobs ORDER BY job_id').all();
    assert.throws(()=>migrateDatabase(db),/2 active jobs/);
    assert.deepEqual(db.prepare('SELECT * FROM vocabulary_reflection_jobs ORDER BY job_id').all(),before);
    assert.equal(db.prepare("SELECT 1 FROM sqlite_schema WHERE name='vocabulary_case_reviews'").get(),undefined);
  }finally{db.close();}
});

test('repair target migration preserves legacy scopes and assessments without inventing operator intent',()=>{
  const {db}=copy('repair-target-upgrade',true);
  try {
    const reviewIndex=schemaMigrations.findIndex(item=>item.id==='app_schema:0066_vocabulary_case_reviews');
    const targetIndex=schemaMigrations.findIndex(item=>item.id==='app_schema:0067_vocabulary_repair_targets');
    assert.ok(targetIndex>reviewIndex);
    migrateDatabase(db,schemaMigrations.slice(0,reviewIndex));seedCaseReviewLineage(db);
    migrateDatabase(db,schemaMigrations.slice(0,targetIndex));
    db.exec(`INSERT INTO vocabulary_case_sense_coverage VALUES ('root',2,'["historical-sense"]','2026-11-04T00:00:00.000Z');
      INSERT INTO vocabulary_sense_coverage_history VALUES ('legacy-scope','case','root',2,'{"includedSenseIds":["historical-sense"]}','operator','2026-11-04T00:00:00.000Z');`);
    const preserved=['vocabulary_case_sense_coverage','vocabulary_sense_coverage_history','vocabulary_case_reviews','content_proposals','proposal_revision_history','reflection_cases'];
    const before=preserved.map(table=>db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
    const jobs=db.prepare('SELECT job_id,result_json,status FROM vocabulary_reflection_jobs ORDER BY job_id').all();
    migrateDatabase(db);
    preserved.forEach((table,i)=>{
      // Later additive migrations may add fields; retain every pre-existing column.
      const columns=Object.keys(before[i][0]??{}).join(',')||'*';
      assert.deepEqual(db.prepare(`SELECT ${columns} FROM ${table} ORDER BY rowid`).all(),before[i]);
    });
    assert.deepEqual(db.prepare('SELECT job_id,result_json,status FROM vocabulary_reflection_jobs ORDER BY job_id').all(),jobs);
    assert.deepEqual(db.prepare('SELECT * FROM vocabulary_case_repair_targets').all(),[]);
    assert.deepEqual(db.prepare('SELECT * FROM vocabulary_repertoire_revisions').all(),[]);
    assert.equal(db.prepare('SELECT count(*) AS n FROM vocabulary_reflection_jobs WHERE repair_target_json IS NOT NULL').get()!.n,0);
    assert.deepEqual(migrateDatabase(db),[]);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
    assertSchemaCurrent(db);
  } finally {db.close();}
});

test('background reserve migration retains membership and work while conservatively scheduling existing owners',()=>{
  const {db,file}=copy('background-reserve-upgrade',true);
  try {
    const before=schemaMigrations.slice(0,schemaMigrations.findIndex(m=>m.id==='app_schema:0070_background_teaching_reserve'));
    migrateDatabase(db,before);
    db.exec(`INSERT INTO learners(learner_id,display_name,created_at) VALUES('reserve-owner','Owner','2026-11-01'),('reserve-dormant','Dormant','2026-11-01');
      INSERT INTO lexical_words(id,hanzi,pinyin,meaning,examples_json,priority,created_at) VALUES('reserve-word','词','ci','word','[]',1,'2026-11-01');
      INSERT INTO learner_word_preparation_reserve VALUES('reserve-owner','reserve-word','2026-11-01');
      INSERT INTO word_preparation_work(work_id,word_id,stage,status,requested_by_learner_id,created_at,updated_at,next_attempt_at)
        VALUES('reserve-failure','reserve-word','bootstrap','paused','reserve-owner','2026-11-01','2026-11-01','2026-11-01');`);
    const work=db.prepare('SELECT * FROM word_preparation_work').all();
    migrateDatabase(db);
    assert.deepEqual({...db.prepare("SELECT * FROM learner_word_preparation_reserve WHERE learner_id='reserve-owner'").get()},
      {learner_id:'reserve-owner',word_id:'reserve-word',added_at:'2026-11-01',ready_at:null,checked_at:null});
    assert.deepEqual(db.prepare('SELECT * FROM word_preparation_work').all().map(row=>({...row})),work.map(row=>({...row,teaching_set_key:'default'})));
    assert.deepEqual(db.prepare('SELECT learner_id FROM learner_word_reserve_requests').all().map(row=>row.learner_id),['reserve-owner']);
    assert.deepEqual(migrateDatabase(db),[]);
    assertSchemaCurrent(db);
    const version=db.prepare('PRAGMA data_version').get();
    const inspection=spawnSync(process.execPath,['--import','tsx','scripts/inspect-reserve-diagnostics.ts',`--database=${file}`],{encoding:'utf8'});
    assert.equal(inspection.status,0,inspection.stderr);assert.deepEqual(JSON.parse(inspection.stdout),{findings:[]});
    assert.deepEqual(db.prepare('PRAGMA data_version').get(),version,'operator inspection does not write');
  }finally{db.close();}
});

test('content reaction migration creates empty learner reaction tables with subject and append-only guards', () => {
  const { db } = copy('content-reactions-upgrade', true);
  try {
    const index = schemaMigrations.findIndex(entry => entry.id === 'app_schema:0072_learner_content_reactions');
    migrateDatabase(db, schemaMigrations.slice(0, index));
    assert.deepEqual(migrateDatabase(db), schemaMigrations.slice(index).map(entry => entry.id));
    assert.deepEqual(db.prepare('SELECT * FROM learner_content_reactions').all(), []);
    assert.deepEqual(db.prepare('SELECT * FROM learner_content_reaction_events').all(), []);
    db.exec("INSERT INTO learners(learner_id,display_name,created_at) VALUES('reaction-owner','Owner','2026-11-12')");
    assert.throws(() => db.exec("INSERT INTO learner_content_reactions(learner_id,subject_kind,session_id,note_index,message_id,reaction,surface,created_at,updated_at) VALUES ('reaction-owner','connection',NULL,0,NULL,'saved','home','now','now')"), /CHECK constraint/);
    assert.throws(() => db.exec("INSERT INTO learner_content_reactions(learner_id,subject_kind,session_id,note_index,message_id,reaction,reasons_json,surface,created_at,updated_at) VALUES ('reaction-owner','lesson',NULL,NULL,'m','saved','[\"wrong\"]','home','now','now')"), /CHECK constraint/);
    assert.throws(() => db.exec("INSERT INTO learner_content_reaction_events(learner_id,subject_kind,session_id,note_index,message_id,reaction,surface,occurred_at) VALUES ('reaction-owner','lesson',NULL,NULL,'missing',NULL,'home','now')"), /FOREIGN KEY/);
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='learner_content_reaction_events_append_only'").get());
    assert.deepEqual(migrateDatabase(db), []);
    assertSchemaCurrent(db);
  } finally { db.close(); }
});

test('timed session migration keeps existing controls, enables timed sessions, and starts empty learner state', () => {
  const { db } = copy('timed-session-upgrade', true);
  try {
    const index = schemaMigrations.findIndex(entry => entry.id === 'app_schema:0071_timed_daily_sessions');
    migrateDatabase(db, schemaMigrations.slice(0, index));
    db.exec("UPDATE service_controls SET enabled = 1, updated_at = '2026-11-10T00:00:00.000Z', actor_id = 'incident-operator' WHERE control_key = 'operator_only'");
    const before = db.prepare('SELECT * FROM service_controls ORDER BY control_key').all();
    const through = schemaMigrations.findIndex(entry => entry.id === 'app_schema:0071_timed_daily_sessions') + 1;
    migrateDatabase(db, schemaMigrations.slice(0, through));
    assert.deepEqual(db.prepare("SELECT * FROM service_controls WHERE control_key NOT IN ('timed_sessions','proactive_repertoire') ORDER BY control_key").all(), before);
    assert.deepEqual({ ...db.prepare("SELECT * FROM service_controls WHERE control_key = 'timed_sessions'").get() }, {
      control_key: 'timed_sessions', enabled: 1, updated_at: '1970-01-01T00:00:00.000Z', actor_id: 'system_default',
    });
    assert.deepEqual(db.prepare('SELECT * FROM learner_timed_skip_counts').all(), []);
    assert.deepEqual(db.prepare('SELECT * FROM vocabulary_timed_session_records').all(), []);
    db.exec("INSERT INTO learners(learner_id,display_name,created_at) VALUES('timed-owner','Owner','2026-11-12')");
    assert.throws(() => db.exec("INSERT INTO learner_timed_skip_counts VALUES ('timed-owner','word','w',0,'2026-11-12','now')"), /CHECK constraint/);
    assert.throws(() => db.exec("INSERT INTO learner_timed_skip_counts VALUES ('timed-owner','word','w',1,'12 Nov','now')"), /CHECK constraint/);
    assert.throws(() => db.exec("INSERT INTO service_controls VALUES ('invalid', 1, 'now', 'operator')"), /CHECK constraint/);
    // 0078 later retires the skip counts in favour of due-time urgency.
    assert.deepEqual(migrateDatabase(db), schemaMigrations.slice(through).map(entry => entry.id));
    assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name = 'learner_timed_skip_counts'").get()!.n, 0);
    assert.deepEqual(migrateDatabase(db), []);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    assertSchemaCurrent(db);
  } finally { db.close(); }
});

test('teaching set migration preserves default artifacts, leases, attempts and learner history without inferring scope',()=>{
  const {db}=copy('teaching-set-upgrade',true);
  try{
    const index=schemaMigrations.findIndex(m=>m.id==='app_schema:0074_teaching_sense_sets');
    migrateDatabase(db,schemaMigrations.slice(0,index));
    db.exec(`INSERT INTO learners(learner_id,display_name,created_at) VALUES('test','Learner','2026-11-15');
      INSERT INTO lexical_words(id,hanzi,pinyin,meaning,examples_json,priority,created_at) VALUES('set-word','词','cí','word','[]',1,'2026-11-15');
      INSERT INTO shared_content_publications(publication_id,content_kind,content_id,learning_purpose_key,publication_status,published_at,status_updated_at)
        VALUES('source-publication','word_content','set-source','set-word','available','2026-11-15','2026-11-15'),
        ('package-publication','teaching_package','set-package','set-word','shared_trial','2026-11-15','2026-11-15');
      INSERT INTO word_content_documents(content_id,word_id,content_json,model,created_at,publication_id)
        VALUES('set-source','set-word','{"uses":[{"id":"historical-use"}]}','fixture','2026-11-15','source-publication');
      INSERT INTO word_teaching_packages(package_id,word_id,content_id,package_json,model,created_at,publication_id)
        VALUES('set-package','set-word','set-source','{}','fixture','2026-11-15','package-publication');
      INSERT INTO learner_word_introduction_events(event_id,learner_id,word_id,package_id,event_kind,occurred_at)
        VALUES('set-open','test','set-word','set-package','opened','2026-11-15');
      INSERT INTO word_introduction_preparation(word_id,content_id,package_id,preparation_epoch,active_stage,lease_token,lease_expires_at)
        VALUES('set-word','set-source','set-package',1,'teaching','held','2026-11-16T00:00:00.000Z');
      INSERT INTO word_preparation_work(work_id,word_id,stage,source_content_id,status,attempt_count,next_attempt_at,active_token,expires_at,last_error,created_at,updated_at,requested_by_learner_id)
        VALUES('set-work','set-word','teaching','set-source','running',2,'2026-11-15','held','2026-11-16T00:00:00.000Z','preserve','2026-11-15','2026-11-15','test');
      INSERT INTO word_preparation_attempts(attempt_id,work_id,started_at) VALUES('held','set-work','2026-11-15');
      INSERT INTO word_preparation_retry_events(event_id,work_id,actor_id,occurred_at) VALUES('retry','set-work','test','2026-11-15');
      INSERT INTO vocabulary_word_sense_coverage(word_id,version,excluded_sense_ids_json,default_useful_sense_ids_json,updated_at) VALUES('set-word',1,'[]','[]','2026-11-15');`);
    const tables=['word_introduction_preparation','word_preparation_work','word_content_documents','word_teaching_packages','shared_content_publications','learner_word_introduction_events','word_preparation_attempts','word_preparation_retry_events','vocabulary_word_sense_coverage'];
    const before=new Map(tables.map(table=>[table,db.prepare(`SELECT * FROM ${table}`).all().map(row=>({...row}))]));
    assert.deepEqual(migrateDatabase(db),schemaMigrations.slice(index).map(m=>m.id));
    for(const table of tables){
      const addsKey=['word_introduction_preparation','word_preparation_work','word_content_documents'].includes(table);
      assert.deepEqual(db.prepare(`SELECT * FROM ${table}`).all().map(row=>({...row})),before.get(table)!.map(row=>addsKey?{...row,teaching_set_key:'default'}:row),table);
    }
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
    assert.deepEqual(migrateDatabase(db),[]);
    assertSchemaCurrent(db);
    const latest=new DatabaseSync(source);
    try{assert.deepEqual(snapshot(db),snapshot(latest));}finally{latest.close();}
  }finally{db.close();}
});

const promptMigrationId = 'app_schema:0080_retain_invocation_prompts';
function prepareOldLedger(db: DatabaseSync) {
  migrateDatabase(db, schemaMigrations.filter(m => m.id < promptMigrationId));
  return db.prepare(`INSERT INTO model_invocations
    (id,timestamp,provider,model,invocation_type,spend_source,status,actor_kind,actor_id,
     prompt_hash,prompt_template,request_snapshot_json,response_snapshot_json)
    VALUES (?,'2026-11-18','provider','model','call','unknown','completed','service','worker',?,?,?,'{"receipt":true}')`);
}

test('0080 preserves exact historical prompt bytes, including standalone, empty, unknown and hash-only prompts', () => {
  const { db } = copy('prompt-retention', true);
  try {
    const insert = prepareOldLedger(db);
    const text = '词 🀄\n\t\0end';
    const hash = createHash('sha256').update(text).digest('hex');
    const request = (role: string, content: string) => JSON.stringify({ messages: [{ role, content }] });
    const emptyHash = createHash('sha256').update('').digest('hex');
    insert.run('exact', hash, text, request('system', text));
    insert.run('suffixed', hash, text, request('system', text + '\nresponse format follows'));
    insert.run('wrong-role', hash, text, request('user', text));
    insert.run('different', hash, text, request('system', 'another prompt'));
    insert.run('custom', hash, text, null);
    insert.run('without-hash', null, text, request('system', text));
    insert.run('hash-only', hash, null, request('system', text));
    insert.run('empty', emptyHash, '', request('system', ''));
    insert.run('unknown', null, null, null);
    const before = db.prepare('SELECT * FROM model_invocations ORDER BY id').all();
    const prompts = db.prepare('SELECT id,prompt_hash,CAST(prompt_template AS BLOB) AS bytes FROM model_invocations ORDER BY id').all();
    const through = schemaMigrations.filter(m => m.id <= promptMigrationId);
    assert.deepEqual(migrateDatabase(db, through), [promptMigrationId]);
    assert.deepEqual(migrateDatabase(db, through), []);
    const after = db.prepare('SELECT * FROM model_invocations ORDER BY id').all();
    assert.equal(after.length, before.length);
    for (const [index, original] of before.entries()) {
      const { prompt_template: _template, request_snapshot_json: request, ...oldFields } = original;
      const { prompt_blob_hash: blobHash, request_prompt_refs_json: refs, request_snapshot_json: storedRequest, ...newFields } = after[index]!;
      assert.deepEqual(newFields, oldFields);
      const oldBytes = prompts[index]!.bytes;
      const expected = oldBytes === null ? null : Buffer.from(oldBytes as Uint8Array).toString('utf8');
      assert.deepEqual(readInvocationPromptEvidence(db, String(original.id)), { promptTemplate: expected, requestJson: request });
      assert.equal(blobHash, expected === null ? null : createHash('sha256').update(expected).digest('hex'));
      if (request !== null && JSON.parse(String(request)).messages[0].role === 'system') {
        assert.ok(refs);
        assert.equal(JSON.parse(String(storedRequest)).messages[0].content, '');
      } else {
        assert.equal(refs, null);
        assert.equal(storedRequest, request);
      }
    }
    for (const [column, value] of [
      ['prompt_hash', "'changed'"], ['request_prompt_refs_json', 'NULL'],
      ['request_snapshot_json', "'{}'"], ['prompt_blob_hash', 'NULL'],
    ]) {
      assert.throws(() => db.exec(`UPDATE model_invocations SET ${column}=${value} WHERE id='exact'`));
    }
  } finally { db.close(); }
});

test('0080 rolls back without discarding prompt evidence when a captured template has the wrong hash', () => {
  const { db } = copy('prompt-hash-mismatch', true);
  try {
    const insert = prepareOldLedger(db);
    insert.run('bad', 'incorrect', 'original', '{"messages":[{"role":"system","content":"original"}]}');
    const schema = snapshot(db);
    const original = db.prepare('SELECT * FROM model_invocations').all();
    assert.throws(() => migrateDatabase(db, schemaMigrations.filter(m => m.id <= promptMigrationId)), /hash/i);
    assert.deepEqual(snapshot(db), schema);
    assert.deepEqual(db.prepare('SELECT * FROM model_invocations').all(), original);
    assert.equal(db.prepare('SELECT 1 FROM schema_migrations WHERE migration_id=?').get(promptMigrationId), undefined);
  } finally { db.close(); }
});

test('0081 verifies each dispatch against its closed revision before removing the envelope', () => {
  const { db } = copy('dispatch-reference', true);
  const id = 'app_schema:0081_reference_dispatch_completion';
  const through = schemaMigrations.filter(m => m.id <= id);
  const at = '2026-11-18T03:00:00.000Z';
  const actions = [{ payload: { text: '字', punctuation: '"\n' } }];
  const projection = { throughSequence: 1, preserved: '回' };
  const evidence = JSON.stringify({ actions, projection });
  try {
    migrateDatabase(db, through.filter(m => m.id !== id));
    db.prepare("INSERT INTO learners VALUES ('dispatch-learner','Learner',?,NULL)").run(at);
    const session = db.prepare("INSERT INTO vocabulary_sessions VALUES (?,'dispatch-learner',1,'{}',?,?,'closed')");
    const completion = db.prepare(`INSERT INTO vocabulary_session_completions VALUES
      (?,'dispatch-learner',?,1,1,?,?,?, ?,?,'fixture',?,NULL)`);
    const dispatch = db.prepare(`INSERT INTO vocabulary_post_session_dispatches
      (dispatch_id,learner_id,session_id,completion_id,evidence_json,status,created_at,active_token,expires_at,last_error,result_json)
      VALUES (?,'dispatch-learner',?,?,?,?,?,?,?,?,?)`);
    const fields = 'dispatch_id,learner_id,session_id,completion_id,status,created_at,active_token,expires_at,last_error,result_json';
    for (const status of ['queued','running','succeeded','failed','pending','unused']) {
      session.run(status,at,at);
      completion.run(status,status,at,at,status === 'pending' ? 'pending' : 'closed',JSON.stringify({ actions }),JSON.stringify(projection),at);
      if (status === 'pending' || status === 'unused') continue;
      dispatch.run(status,status,status,evidence,status,at,status === 'running' ? 'token' : null,
        status === 'running' ? at : null,status === 'failed' ? 'error' : null,status === 'succeeded' ? '{"caseIds":[]}' : null);
    }
    const before = db.prepare('SELECT ' + fields + ' FROM vocabulary_post_session_dispatches ORDER BY dispatch_id').all();
    const originalCompletions = db.prepare('SELECT * FROM vocabulary_session_completions ORDER BY completion_id').all();
    for (const [sessionId, completionId, body] of [
      ['unused','unused',JSON.stringify({ actions: [], projection })],
      ['unused','unused',JSON.stringify({ actions, projection: {} })],
      ['unused','unused',JSON.stringify({ actions, projection, extra: true })],
      ['unused','pending',evidence], ['pending','pending',evidence],
    ] as const) {
      dispatch.run('invalid',sessionId,completionId,body,'queued',at,null,null,null,null);
      assert.throws(() => migrateDatabase(db, through), /dispatch_must_match_closed_completion/);
      assert.equal(db.prepare("SELECT evidence_json FROM vocabulary_post_session_dispatches WHERE dispatch_id='invalid'").get()?.evidence_json,body);
      assert.equal(db.prepare('SELECT 1 FROM schema_migrations WHERE migration_id=?').get(id),undefined);
      db.exec("DELETE FROM vocabulary_post_session_dispatches WHERE dispatch_id='invalid'");
    }

    assert.deepEqual(migrateDatabase(db, through), [id]);
    assert.deepEqual(migrateDatabase(db, through), []);
    assert.deepEqual(db.prepare('SELECT * FROM vocabulary_post_session_dispatches ORDER BY dispatch_id').all(), before);
    assert.deepEqual(db.prepare('SELECT * FROM vocabulary_session_completions ORDER BY completion_id').all(), originalCompletions);
    assert.throws(() => db.exec("UPDATE vocabulary_post_session_dispatches SET completion_id='unused' WHERE status='queued'"),/immutable/);
    const insert = db.prepare(`INSERT INTO vocabulary_post_session_dispatches
      (dispatch_id,learner_id,session_id,completion_id,status,created_at) VALUES ('test','dispatch-learner',?,?,'queued',?)`);
    assert.throws(() => insert.run('pending','pending',at),/closed completion/);
    assert.throws(() => insert.run('pending','unused',at),/closed completion/);
    insert.run('unused','unused',at);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { db.close(); }
});

test('0082 drops only the explicitly abandoned session, compacts closed history and protects future closure', () => {
  const { db } = copy('compact-closed-history', true);
  const id = 'app_schema:0082_compact_closed_session_history';
  const through = schemaMigrations.filter(m => m.id <= id);
  const wedged = 'b9aa613b-7c80-47be-91f6-45d0af5b45d5';
  const start = '2026-11-01T00:58:05.231Z';
  const end = '2026-11-07T15:43:39.300Z';
  const initial = { words: [{ wordId: 'w' }], wordStateVersions: { w: 1 } };
  const lexical = { wordId: 'w', hanzi: '冬' };
  const context = JSON.stringify({ ...initial, payload: { version: 1,
    words: { w: { lexical, general: ['unserved-exercise'] } }, snapshots: { unserved: { text: '左' } } } });
  const compact = { ...initial, closedHistory: { version: 1, lexicalWords: { w: lexical } } };
  try {
    migrateDatabase(db, through.filter(m => m.id < id));
    db.prepare("INSERT INTO learners VALUES ('history-learner','Learner',?,NULL)").run(start);
    const session = db.prepare("INSERT INTO vocabulary_sessions VALUES (?,'history-learner',1,?,?,?,?)");
    function report(sessionId: string) {
      db.prepare(`INSERT INTO vocabulary_session_completions VALUES
        (?,'history-learner',?,1,0,?,?,'closed','{"actions":[],"activeDurationMs":91}',
         '{"phase":"completed","encounters":[]}','fixture',?,NULL)`).run(sessionId, sessionId, end, end, end);
    }
    session.run('closed', context, start, end, 'closed');
    report('closed');
    session.run('legacy', JSON.stringify(initial), start, end, 'closed');
    report('legacy');
    session.run('active', context, start, null, 'active');
    session.run('retrying', context, start, null, 'finalizing');
    session.run(wedged, context, start, end, 'closed');
    const action = db.prepare(`INSERT INTO session_actions(action_id,learner_id,session_id,sequence_number,client_action_id,
      kind,action_json,occurred_at,recorded_at) VALUES (?,'history-learner',?,1,'client','presentation','{"saved":"冬"}',?,?)`);
    action.run('wedged-action', wedged, start, start);
    const retained = db.prepare('SELECT context_json FROM vocabulary_sessions WHERE session_id=?');
    const reports = db.prepare('SELECT * FROM vocabulary_session_completions ORDER BY completion_id').all();
    const assertRollback = () => {
      assert.throws(() => migrateDatabase(db, through), /closed_session_requires_one_closed_completion/);
      assert.equal(retained.get('closed')!.context_json, context);
      assert.equal(retained.get(wedged)!.context_json, context);
      assert.equal(db.prepare("SELECT COUNT(*) n FROM session_actions WHERE action_id='wedged-action'").get()!.n, 1);
      assert.equal(db.prepare('SELECT 1 FROM schema_migrations WHERE migration_id=?').get(id), undefined);
    };
    assertRollback(); // The pinned ID alone cannot authorize the deletion.
    db.prepare(`INSERT INTO backend_events(event_id,occurred_at,recorded_at,name,payload_version,data_json,actor_kind,session_id)
      VALUES ('abandon',?,?,'vocabulary.session.abandoned',1,'{}','operator',?)`).run(end, end, wedged);
    session.run('unrecognized', context, start, end, 'closed');
    assertRollback(); // A different reportless closed session still halts the migration.
    db.exec("DELETE FROM vocabulary_sessions WHERE session_id='unrecognized'");
    // The historical reader uses the highest revision, so one older closed
    // report is insufficient when a later revision contradicts the session.
    db.prepare(`INSERT INTO vocabulary_session_completions VALUES
      ('later-cancelled','history-learner','closed',2,0,?,?,'cancelled','{}','{}','fixture',NULL,NULL)`).run(end, end);
    assertRollback();
    db.exec("DELETE FROM vocabulary_session_completions WHERE completion_id='later-cancelled'");
    assert.deepEqual(migrateDatabase(db, through), [id]);
    assert.deepEqual(migrateDatabase(db, through), []);
    assert.equal(retained.get(wedged), undefined);
    assert.equal(db.prepare("SELECT 1 FROM session_actions WHERE action_id='wedged-action'").get(), undefined);
    assert.equal(db.prepare("SELECT session_id FROM backend_events WHERE event_id='abandon'").get()!.session_id, wedged);
    assert.deepEqual(JSON.parse(String(retained.get('closed')!.context_json)), compact);
    assert.deepEqual(JSON.parse(String(retained.get('legacy')!.context_json)), { ...initial, closedHistory: { version: 1 } });
    assert.equal(retained.get('active')!.context_json, context);
    assert.equal(retained.get('retrying')!.context_json, context);
    assert.deepEqual(db.prepare('SELECT * FROM vocabulary_session_completions ORDER BY completion_id').all(), reports);
    const finish = db.prepare("UPDATE vocabulary_sessions SET status='closed',closed_at=?,context_json=? WHERE session_id=?");
    assert.throws(() => finish.run(end, JSON.stringify(compact), 'retrying'), /closed completion/);
    report('retrying');
    db.exec('SAVEPOINT later_revision');
    db.prepare(`INSERT INTO vocabulary_session_completions VALUES
      ('retrying-cancelled','history-learner','retrying',2,0,?,?,'cancelled','{}','{}','fixture',NULL,NULL)`).run(end, end);
    assert.throws(() => finish.run(end, JSON.stringify(compact), 'retrying'), /closed completion/);
    db.exec('ROLLBACK TO later_revision; RELEASE later_revision');
    assert.throws(() => finish.run(end, context, 'retrying'), /compact history/);
    finish.run(end, JSON.stringify(compact), 'retrying');
    assert.throws(() => db.exec("UPDATE vocabulary_sessions SET status='active' WHERE session_id='retrying'"), /closing session/);
    assert.throws(() => db.exec("UPDATE vocabulary_sessions SET context_json='{}' WHERE session_id='active'"), /immutable/);
    assert.throws(() => db.exec("UPDATE vocabulary_sessions SET context_json='{}' WHERE session_id='closed'"), /immutable/);
    assert.throws(() => db.exec("UPDATE vocabulary_sessions SET learner_id=learner_id WHERE session_id='closed'"), /immutable/);
    assert.throws(() => session.run('fresh', JSON.stringify(compact), start, null, 'active'), /status/);
    assert.throws(() => session.run('fresh', context, start, end, 'closed'), /status/);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { db.close(); }
});

test('0083 verifies each completion against its own journal prefix before trimming its input', () => {
  const { db } = copy('completion-action-boundaries', true);
  const id = 'app_schema:0083_reference_completion_actions';
  const through = schemaMigrations.filter(m => m.id <= id);
  const at = '2026-11-18T00:00:00.000Z';
  const first = { sequence: 1, payload: { text: '保留', actions: ['nested'] } };
  const second = { sequence: 2, payload: { undoesActionId: 'first' } };
  try {
    migrateDatabase(db, through.filter(m => m.id !== id));
    db.prepare("INSERT INTO learners VALUES ('journal-learner','Learner',?,NULL)").run(at);
    db.prepare("INSERT INTO vocabulary_sessions VALUES ('s','journal-learner',1,'{}',?,NULL,'active')").run(at);
    const action = db.prepare(`INSERT INTO session_actions(action_id,learner_id,session_id,sequence_number,client_action_id,kind,action_json,occurred_at,recorded_at)
      VALUES (?,'journal-learner','s',?,?,'fixture',?,?,?)`);
    // Insert out of order so the check relies on acknowledged sequence.
    action.run('second',2,'second',JSON.stringify(second),at,at);
    action.run('first',1,'first',JSON.stringify(first),at,at);
    const completion = db.prepare(`INSERT INTO vocabulary_session_completions VALUES
      (?,'journal-learner','s',?,?,?,?,?,?,'{"saved":true}','fixture',NULL,NULL)`);
    const cancelled = { actions: [first], activeDurationMs: null };
    completion.run('cancelled',1,1,at,at,'cancelled',JSON.stringify(cancelled));
    for (const [boundary,input] of [
      [0,{}], [1,{actions:[]}], [1,{actions:[second]}], [2,{actions:[second,first]}], [3,{actions:[first,second]}],
    ] as const) {
      completion.run('invalid',2,boundary,at,at,'failed',JSON.stringify(input));
      assert.throws(() => migrateDatabase(db,through), /completion_actions_must_match_journal/);
      assert.equal(db.prepare("SELECT input_json FROM vocabulary_session_completions WHERE completion_id='cancelled'").get()?.input_json,JSON.stringify(cancelled));
      assert.equal(db.prepare('SELECT 1 FROM schema_migrations WHERE migration_id=?').get(id),undefined);
      db.exec("DELETE FROM vocabulary_session_completions WHERE completion_id='invalid'");
    }
    completion.run('closed',2,2,at,at,'closed',JSON.stringify({actions:[first,second],activeDurationMs:800}));
    assert.deepEqual(migrateDatabase(db,through),[id]);
    assert.deepEqual(migrateDatabase(db,through),[]);
    const rows = db.prepare(`SELECT c.input_json,j.actions_json,c.report_json FROM vocabulary_session_completions c
      JOIN vocabulary_completion_action_lists j USING (learner_id,session_id,completion_id) ORDER BY c.revision_number`).all();
    assert.deepEqual(rows.map(r => [r.input_json,r.actions_json,r.report_json]),[
      ['{"activeDurationMs":null}',JSON.stringify([first]),'{"saved":true}'],
      ['{"activeDurationMs":800}',JSON.stringify([first,second]),'{"saved":true}'],
    ]);
    assert.throws(() => completion.run('bad',3,2,at,at,'pending','{"actions":null}'), /action boundary/);
    assert.throws(() => completion.run('bad',3,3,at,at,'pending','{}'), /action boundary/);
    completion.run('empty',3,0,at,at,'pending','{}');
    assert.equal(db.prepare("SELECT actions_json FROM vocabulary_completion_action_lists WHERE completion_id='empty'").get()?.actions_json,'[]');
    assert.throws(() => db.exec("UPDATE vocabulary_session_completions SET through_sequence=1 WHERE completion_id='empty'"), /immutable/);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  } finally { db.close(); }
});

test('0084 retains receipt identity and case links and enforces the closed report reference', () => {
  const id = 'app_schema:0084_reference_reflection_report';
  const { db } = copy('reflection-receipt', true);
  const at = '2026-11-18T20:00:00.000Z';
  const report = '{"encounters":[],"detail":"保留"}';
  try {
    migrateDatabase(db, schemaMigrations.filter(m => m.id < id));
    db.prepare("INSERT INTO learners VALUES ('a','Learner',?,NULL)").run(at);
    db.prepare("INSERT INTO vocabulary_sessions VALUES ('s','a',1,'{}',?,NULL,'finalizing')").run(at);
    const completion = db.prepare(`INSERT INTO vocabulary_session_completions VALUES
      (?,'a','s',?,0,?,?,?,'{}',?,'fixture',?,NULL)`);
    completion.run('closed',1,at,at,'closed',report,at);
    completion.run('pending',2,at,at,'pending',report,null);
    db.prepare("INSERT INTO vocabulary_reflection_session_evidence VALUES ('closed','a','s',?,?)").run(report,at);
    db.prepare(`INSERT INTO reflection_cases(case_id,completion_id,learner_id,kind,subject_key,status,evidence_snapshot_json,created_at)
      VALUES ('case','closed','a','teaching_review','example','open','[]',?)`).run(at);
    const cases = db.prepare('SELECT * FROM reflection_cases').all();
    const through = schemaMigrations.filter(m => m.id <= id);
    assert.deepEqual(migrateDatabase(db,through),[id]);
    assert.deepEqual(migrateDatabase(db,through),[]);
    const receipt = db.prepare('SELECT * FROM vocabulary_reflection_session_evidence').get();
    assert.deepEqual({...receipt},{completion_id:'closed',learner_id:'a',session_id:'s',created_at:at});
    assert.equal(db.prepare(`SELECT c.report_json FROM vocabulary_reflection_session_evidence e
      JOIN vocabulary_session_completions c USING (learner_id,session_id,completion_id)`).get()?.report_json,report);
    assert.deepEqual(db.prepare('SELECT * FROM reflection_cases').all(),cases);
    const insert = db.prepare('INSERT INTO vocabulary_reflection_session_evidence VALUES (?,?,?,?)');
    assert.throws(() => insert.run('pending','a','s',at), /requires its closed completion/);
    assert.throws(() => insert.run('closed','a','other',at), /requires its closed completion/);
    assert.throws(() => insert.run('closed','other','s',at), /requires its closed completion/);
    assert.throws(() => db.exec('UPDATE vocabulary_reflection_session_evidence SET created_at=created_at'), /immutable/);
    assert.throws(() => db.exec('DELETE FROM vocabulary_reflection_session_evidence'), /retained/);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  } finally { db.close(); }
});

for (const [issue,session,status,report] of [
  ['session','other','closed','{}'], ['status','s','failed','{}'], ['bytes','s','closed','{ }'],
] as const) {
  test(`0084 rolls back when a retained receipt differs in ${issue}`, () => {
    const id = 'app_schema:0084_reference_reflection_report';
    const { db } = copy('reflection-receipt-' + issue, true);
    const at = '2026-11-18T20:00:00.000Z';
    try {
      migrateDatabase(db,schemaMigrations.filter(m => m.id < id));
      db.prepare("INSERT INTO learners VALUES ('a','Learner',?,NULL)").run(at);
      db.prepare("INSERT INTO vocabulary_sessions VALUES ('s','a',1,'{}',?,NULL,'finalizing')").run(at);
      db.prepare(`INSERT INTO vocabulary_session_completions VALUES
        ('c','a','s',1,0,?,?,?,'{}','{}','fixture',?,NULL)`).run(at,at,status,status==='closed'?at:null);
      db.prepare("INSERT INTO vocabulary_reflection_session_evidence VALUES ('c','a',?,?,?)").run(session,report,at);
      assert.throws(() => migrateDatabase(db,schemaMigrations.filter(m => m.id <= id)), /reflection_report_must_match_closed_completion/);
      assert.equal(db.prepare('SELECT projection_json FROM vocabulary_reflection_session_evidence').get()?.projection_json,report);
      assert.equal(db.prepare('SELECT 1 FROM schema_migrations WHERE migration_id=?').get(id),undefined);
    } finally { db.close(); }
  });
}

test('a current database reports exactly the checkout migration ids the code-only upgrade compares', () => {
  const { db } = copy('current-ledger-ids');
  try {
    assert.deepEqual(getSchemaMigrationStatus(db), { applied: schemaMigrationIds(), pending: [] });
    assert.equal(schemaMigrationIds()[0], 'app_schema:0000_baseline');
  } finally {
    db.close();
  }
});
