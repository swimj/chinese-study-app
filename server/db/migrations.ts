import { createHash } from 'node:crypto';
import fs from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';

const PREFIX = 'app_schema:';
const BASELINE_ID = `${PREFIX}0000_baseline`;
const baseline = JSON.parse(fs.readFileSync(new URL('./migrations/baseline-schema.json', import.meta.url), 'utf8')) as Record<string, string>;
const deployedOverrides = JSON.parse(fs.readFileSync(new URL('./migrations/baseline-deployed-variant.json', import.meta.url), 'utf8')) as Record<string, string>;
const deployedBaseline = { ...baseline, ...deployedOverrides };

export type SchemaMigration = { id: string; sql: string };
// Append migrations here in order. Never edit an applied migration or the baseline.
export const schemaMigrations: readonly SchemaMigration[] = [];

function checksum(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

// Litestream owns these two tables; their lifecycle is independent of app releases.
function schemaObjects(db: DatabaseSync): Record<string, string> {
  const rows = db.prepare(`SELECT type, name, sql FROM sqlite_schema
    WHERE name NOT LIKE 'sqlite_%'
      AND name NOT IN ('_litestream_lock', '_litestream_seq')
    ORDER BY type, name`).all() as Array<{ type: string; name: string; sql: string }>;
  return Object.fromEntries(rows.map((row) => [`${row.type}:${row.name}`, checksum(row.sql)]));
}

function schemaChecksum(db: DatabaseSync): string {
  return checksum(JSON.stringify(schemaObjects(db)));
}

function schemaDifferences(expected: Record<string, string>, actual: Record<string, string>): string[] {
  return [...new Set([...Object.keys(expected), ...Object.keys(actual)])]
    .filter((key) => expected[key] !== actual[key]);
}

function adoptBaseline(db: DatabaseSync): 'fresh' | 'fly_3ad618b' {
  const actual = schemaObjects(db);
  if (schemaDifferences(baseline, actual).length === 0) return 'fresh';
  if (schemaDifferences(deployedBaseline, actual).length === 0) return 'fly_3ad618b';
  throw new Error(`Database does not match the supported current schema baseline: ${schemaDifferences(baseline, actual).join(', ')}. Older schemas are unsupported; do not stamp this database manually.`);
}

function definitions(migrations: readonly SchemaMigration[]) {
  const all = [{ id: BASELINE_ID, sql: JSON.stringify({ baseline, deployedOverrides }) }, ...migrations];
  let previous = BASELINE_ID;
  for (const migration of migrations) {
    if (!/^app_schema:\d{4}_[a-z0-9_]+$/.test(migration.id) || migration.id <= previous || !migration.sql.trim()) {
      throw new Error(`Invalid or unordered schema migration: ${migration.id}`);
    }
    previous = migration.id;
  }
  return all;
}

type Applied = { migration_id: string; details_json: string };
type Details = { checksum: string; schemaChecksum: string };

function readState(db: DatabaseSync, migrations: readonly SchemaMigration[]) {
  const all = definitions(migrations);
  const hasLedger = db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'schema_migrations'").get();
  const rows = hasLedger ? db.prepare(`SELECT migration_id, details_json FROM schema_migrations
    WHERE substr(migration_id, 1, ?) = ? ORDER BY migration_id`).all(PREFIX.length, PREFIX) as Applied[] : [];
  let last: Details | undefined;
  for (const [index, row] of rows.entries()) {
    const expected = all[index];
    if (!expected || row.migration_id !== expected.id) throw new Error(`Unknown or out-of-order schema migration: ${row.migration_id}`);
    const details = JSON.parse(row.details_json) as Details;
    if (details.checksum !== checksum(expected.sql)) throw new Error(`Applied migration has changed: ${row.migration_id}`);
    last = details;
  }
  if (last && last.schemaChecksum !== schemaChecksum(db)) throw new Error('Database schema has drifted since its last recorded migration.');
  return { all, applied: rows.length };
}

export function assertSchemaCurrent(db: DatabaseSync, migrations = schemaMigrations): void {
  const state = readState(db, migrations);
  if (state.applied !== state.all.length) {
    throw new Error('Database schema migration required. Stop the app, take a backup, and run npm run db:migrate -- --database=/absolute/path/app.db --confirm-app-stopped=true.');
  }
}

export function getSchemaMigrationStatus(db: DatabaseSync, migrations = schemaMigrations) {
  const state = readState(db, migrations);
  return { applied: state.all.slice(0, state.applied).map((item) => item.id), pending: state.all.slice(state.applied).map((item) => item.id) };
}

/** Caller owns the maintenance window. The transaction serializes migration runners. */
export function migrateDatabase(db: DatabaseSync, migrations = schemaMigrations): string[] {
  if ((db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys !== 1) {
    throw new Error('Schema migrations require foreign_keys=ON.');
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    const state = readState(db, migrations);
    const applied: string[] = [];
    for (const migration of state.all.slice(state.applied)) {
      let baselineVariant: 'fresh' | 'fly_3ad618b' | undefined;
      if (migration.id === BASELINE_ID) baselineVariant = adoptBaseline(db);
      else db.exec(migration.sql);
      if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error(`Foreign key check failed after ${migration.id}`);
      const integrity = db.prepare('PRAGMA quick_check').all() as Array<{ quick_check: string }>;
      if (integrity.length !== 1 || integrity[0].quick_check !== 'ok') throw new Error(`Integrity check failed after ${migration.id}`);
      db.prepare('INSERT INTO schema_migrations (migration_id, applied_at, details_json) VALUES (?, ?, ?)')
        .run(migration.id, new Date().toISOString(), JSON.stringify({ checksum: checksum(migration.sql), schemaChecksum: schemaChecksum(db), ...(baselineVariant ? { baselineVariant } : {}) }));
      applied.push(migration.id);
    }
    db.exec('COMMIT');
    return applied;
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}
