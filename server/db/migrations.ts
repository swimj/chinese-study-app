import { assertVocabularyCutoverReady } from './vocabulary-cutover.ts';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { importLegacyVocabulary } from './vocabulary-import.ts';
import { migrateSharedDictionaryBaselines } from './dictionary-baseline-sharing.ts';
import { fillMissingNormalizedHanzi } from './hanzi-lookup.ts';

const PREFIX = 'app_schema:';
const BASELINE_ID = `${PREFIX}0000_baseline`;
const baseline = JSON.parse(fs.readFileSync(new URL('./migrations/baseline-schema.json', import.meta.url), 'utf8')) as Record<string, string>;
const deployedOverrides = JSON.parse(fs.readFileSync(new URL('./migrations/baseline-deployed-variant.json', import.meta.url), 'utf8')) as Record<string, string>;
const deployedBaseline = { ...baseline, ...deployedOverrides };

export type SchemaMigration = {
  id: string;
  sql: string;
  before?: (db: DatabaseSync) => void;
  after?: (db: DatabaseSync) => void;
};
// Append migrations here in order. Never edit an applied migration or the baseline.
export const schemaMigrations: readonly SchemaMigration[] = [{
  id: 'app_schema:0001_deferred_second_opinion',
  sql: fs.readFileSync(new URL('./migrations/0001_deferred_second_opinion.sql', import.meta.url), 'utf8'),
}, {
  id: 'app_schema:0002_requested_second_opinion_disposition',
  sql: fs.readFileSync(
    new URL('./migrations/0002_requested_second_opinion_disposition.sql', import.meta.url),
    'utf8',
  ),
}, {
  id: 'app_schema:0003_deck_word_probes',
  sql: fs.readFileSync(new URL('./migrations/0003_deck_word_probes.sql', import.meta.url), 'utf8'),
}, {
  id: 'app_schema:0004_usage_daily_snapshots',
  sql: fs.readFileSync(new URL('./migrations/0004_usage_daily_snapshots.sql', import.meta.url), 'utf8'),
}, {
  id: 'app_schema:0005_service_banner',
  sql: fs.readFileSync(new URL('./migrations/0005_service_banner.sql', import.meta.url), 'utf8'),
}, {
  id: 'app_schema:0006_inbox_seen_at',
  sql: fs.readFileSync(new URL('./migrations/0006_inbox_seen_at.sql', import.meta.url), 'utf8'),
}, {
  id: 'app_schema:0007_learner_params',
  sql: fs.readFileSync(new URL('./migrations/0007_learner_params.sql', import.meta.url), 'utf8'),
}, {
  id: 'app_schema:0008_normalized_hanzi',
  sql: fs.readFileSync(new URL('./migrations/0008_normalized_hanzi.sql', import.meta.url), 'utf8'),
  after: fillMissingNormalizedHanzi,
}, {
  id: 'app_schema:0009_pure_cues',
  sql: fs.readFileSync(new URL('./migrations/0009_pure_cues.sql', import.meta.url), 'utf8'),
}, {
  id: 'app_schema:0010_strict_word_cues',
  sql: fs.readFileSync(new URL('./migrations/0010_strict_word_cues.sql', import.meta.url), 'utf8'),
}, {
  id: 'app_schema:0011_reflection_generation_continuations',
  sql: fs.readFileSync(
    new URL('./migrations/0011_reflection_generation_continuations.sql', import.meta.url),
    'utf8',
  ),
}, {
  id: 'app_schema:0012_pure_cue_teaching_notes',
  sql: fs.readFileSync(new URL('./migrations/0012_pure_cue_teaching_notes.sql', import.meta.url), 'utf8'),
}, {
  id: 'app_schema:0013_deferred_explanation_items',
  sql: fs.readFileSync(new URL('./migrations/0013_deferred_explanation_items.sql', import.meta.url), 'utf8'),
}, {
  id: 'app_schema:0014_pure_cue_reflection',
  sql: fs.readFileSync(new URL('./migrations/0014_pure_cue_reflection.sql', import.meta.url), 'utf8'),
}, {
  id: 'app_schema:0015_pure_cue_stimulus_repair',
  sql: fs.readFileSync(new URL('./migrations/0015_pure_cue_stimulus_repair.sql', import.meta.url), 'utf8'),
}, {
  id: 'app_schema:0016_word_introduction_content',
  sql: fs.readFileSync(new URL('./migrations/0016_word_introduction_content.sql', import.meta.url), 'utf8'),
}, {
  id: 'app_schema:0017_review_content_records',
  sql: fs.readFileSync(new URL('./migrations/0017_review_content_records.sql', import.meta.url), 'utf8'),
}, {
  id: 'app_schema:0018_word_preparation_work',
  sql: fs.readFileSync(new URL('./migrations/0018_word_preparation_work.sql', import.meta.url), 'utf8'),
}, {
  id: 'app_schema:0019_word_preparation_reserve',
  sql: fs.readFileSync(new URL('./migrations/0019_word_preparation_reserve.sql', import.meta.url), 'utf8'),
}, {
  id: 'app_schema:0020_rehearsal_presentation',
  sql: fs.readFileSync(new URL('./migrations/0020_rehearsal_presentation.sql', import.meta.url), 'utf8'),
}, {
  id: 'app_schema:0021_content_quality',
  sql: fs.readFileSync(new URL('./migrations/0021_content_quality.sql', import.meta.url), 'utf8'),
}, {
  id: 'app_schema:0022_exercise_compensation_days',
  sql: fs.readFileSync(new URL('./migrations/0022_exercise_compensation_days.sql', import.meta.url), 'utf8'),
}, {
  id: 'app_schema:0023_session_debrief',
  sql: fs.readFileSync(new URL('./migrations/0023_session_debrief.sql', import.meta.url), 'utf8'),
}, {
  id: 'app_schema:0024_recovery_attempt_window',
  sql: fs.readFileSync(new URL('./migrations/0024_recovery_attempt_window.sql', import.meta.url), 'utf8'),
}, {
  id: 'app_schema:0025_model_invocations',
  sql: fs.readFileSync(new URL('./migrations/0025_model_invocations.sql', import.meta.url), 'utf8'),
}, {
  id: 'app_schema:0026_model_invocation_outcomes',
  sql: fs.readFileSync(new URL('./migrations/0026_model_invocation_outcomes.sql', import.meta.url), 'utf8'),
}, {
  id: 'app_schema:0027_correct_cue_repair_recovery',
  sql: fs.readFileSync(new URL('./migrations/0027_correct_cue_repair_recovery.sql', import.meta.url), 'utf8'),
}, {
  id: 'app_schema:0028_whats_new_blog',
  sql: fs.readFileSync(new URL('./migrations/0028_whats_new_blog.sql', import.meta.url), 'utf8'),
}, {
  id: 'app_schema:0029_introduction_components',
  sql: fs.readFileSync(new URL('./migrations/0029_introduction_components.sql', import.meta.url), 'utf8'),
}, {
  id: 'app_schema:0030_whats_new_previews',
  sql: fs.readFileSync(new URL('./migrations/0030_whats_new_previews.sql', import.meta.url), 'utf8'),
}, {
  id: 'app_schema:0031_whats_new_attention',
  sql: fs.readFileSync(new URL('./migrations/0031_whats_new_attention.sql', import.meta.url), 'utf8'),
}, {
  id: 'app_schema:0032_content_improvement_workspace',
  sql: fs.readFileSync(new URL('./migrations/0032_content_improvement_workspace.sql', import.meta.url), 'utf8'),
}, {
  id: 'app_schema:0033_content_improvement_repairs',
  sql: fs.readFileSync(new URL('./migrations/0033_content_improvement_repairs.sql', import.meta.url), 'utf8'),
}, {
  id: 'app_schema:0034_usage_exercise_totals',
  sql: fs.readFileSync(new URL('./migrations/0034_usage_exercise_totals.sql', import.meta.url), 'utf8'),
}, {
  id: 'app_schema:0035_definition_fallback_quality',
  sql: fs.readFileSync(new URL('./migrations/0035_definition_fallback_quality.sql', import.meta.url), 'utf8'),
}, {
  id: 'app_schema:0036_session_completion',
  sql: fs.readFileSync(new URL('./migrations/0036_session_completion.sql', import.meta.url), 'utf8'),
}, {
  id: 'app_schema:0037_service_banner_kickoff',
  sql: fs.readFileSync(new URL('./migrations/0037_service_banner_kickoff.sql', import.meta.url), 'utf8'),
}, {
  id: 'app_schema:0038_usage_new_word_totals',
  sql: fs.readFileSync(new URL('./migrations/0038_usage_new_word_totals.sql', import.meta.url), 'utf8'),
}, {
  id: 'app_schema:0039_vocabulary_content',
  sql: fs.readFileSync(new URL('./migrations/0039_vocabulary_content.sql', import.meta.url), 'utf8'),
}, {
  id: 'app_schema:0040_model_provenance',
  sql: fs.readFileSync(new URL('./migrations/0040_model_provenance.sql', import.meta.url), 'utf8'),
}, {
  id: 'app_schema:0041_vocabulary_learner_state',
  before: assertVocabularyCutoverReady,
  sql: fs.readFileSync(new URL('./migrations/0041_vocabulary_learner_state.sql', import.meta.url), 'utf8'),
}, {
  id: 'app_schema:0042_vocabulary_sessions',
  sql: fs.readFileSync(new URL('./migrations/0042_vocabulary_sessions.sql', import.meta.url), 'utf8'),
}, {
  id: 'app_schema:0043_vocabulary_import',
  sql: fs.readFileSync(new URL('./migrations/0043_vocabulary_import.sql', import.meta.url), 'utf8'),
  after: (db) => { importLegacyVocabulary(db); },
}, {
  id: 'app_schema:0044_vocabulary_reflection',
  sql: fs.readFileSync(new URL('./migrations/0044_vocabulary_reflection.sql', import.meta.url), 'utf8'),
}, {
  id: 'app_schema:0045_vocabulary_provenance_links',
  sql: fs.readFileSync(new URL('./migrations/0045_vocabulary_provenance_links.sql', import.meta.url), 'utf8'),
}, {
  id: 'app_schema:0046_vocabulary_pure_cue_guards',
  sql: fs.readFileSync(new URL('./migrations/0046_vocabulary_pure_cue_guards.sql', import.meta.url), 'utf8'),
}, {
  id: 'app_schema:0047_vocabulary_dismissal',
  sql: fs.readFileSync(new URL('./migrations/0047_vocabulary_dismissal.sql', import.meta.url), 'utf8'),
}, {
  id: 'app_schema:0048_vocabulary_connections',
  sql: fs.readFileSync(new URL('./migrations/0048_vocabulary_connections.sql', import.meta.url), 'utf8'),
}, {
  id: 'app_schema:0049_vocabulary_sense_readiness',
  sql: fs.readFileSync(new URL('./migrations/0049_vocabulary_sense_readiness.sql', import.meta.url), 'utf8'),
}, {
  id: 'app_schema:0050_vocabulary_improvement_admission',
  sql: fs.readFileSync(new URL('./migrations/0050_vocabulary_improvement_admission.sql', import.meta.url), 'utf8'),
}, {
  id: 'app_schema:0051_vocabulary_pure_cue_promotion',
  sql: fs.readFileSync(new URL('./migrations/0051_vocabulary_pure_cue_promotion.sql', import.meta.url), 'utf8'),
}, {
  id: 'app_schema:0052_vocabulary_automatic_promotion_pause',
  sql: fs.readFileSync(new URL('./migrations/0052_vocabulary_automatic_promotion_pause.sql', import.meta.url), 'utf8'),
}, {
  id: 'app_schema:0053_vocabulary_second_opinions',
  sql: fs.readFileSync(new URL('./migrations/0053_vocabulary_second_opinions.sql', import.meta.url), 'utf8'),
}, {
  id: 'app_schema:0054_vocabulary_provider_retry_routing',
  sql: fs.readFileSync(new URL('./migrations/0054_vocabulary_provider_retry_routing.sql', import.meta.url), 'utf8'),
}, {
  id: 'app_schema:0055_vocabulary_feedback_dismissal',
  sql: fs.readFileSync(new URL('./migrations/0055_vocabulary_feedback_dismissal.sql', import.meta.url), 'utf8'),
}, {
  id: 'app_schema:0056_operator_only_access',
  sql: fs.readFileSync(new URL('./migrations/0056_operator_only_access.sql', import.meta.url), 'utf8'),
}, {
  id: 'app_schema:0057_preparation_compatibility',
  sql: fs.readFileSync(new URL('./migrations/0057_preparation_compatibility.sql', import.meta.url), 'utf8'),
}, {
  id: 'app_schema:0058_shared_dictionary_baselines',
  sql: fs.readFileSync(new URL('./migrations/0058_shared_dictionary_baselines.sql', import.meta.url), 'utf8'),
  after: migrateSharedDictionaryBaselines,
}, {
  id: 'app_schema:0059_vocabulary_reassessment',
  sql: fs.readFileSync(new URL('./migrations/0059_vocabulary_reassessment.sql', import.meta.url), 'utf8'),
}, {
  id: 'app_schema:0060_vocabulary_reassessment_source',
  sql: fs.readFileSync(new URL('./migrations/0060_vocabulary_reassessment_source.sql', import.meta.url), 'utf8'),
}];

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

function definitions(migrations: readonly SchemaMigration[]): SchemaMigration[] {
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
  if (db.isTransaction) {
    throw new Error('Schema migrations cannot start inside an open transaction.');
  }
  if ((db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys !== 1) {
    throw new Error('Schema migrations require foreign_keys=ON.');
  }
  // SQLite cannot change CHECK constraints or drop a table with incoming FKs
  // while foreign keys are enabled, and this pragma is a no-op inside a
  // transaction. Disable them for the documented schema-change procedure;
  // foreign_key_check after each migration remains the integrity gate.
  db.exec('PRAGMA foreign_keys=OFF');
  try {
    db.exec('BEGIN IMMEDIATE');
    try {
      const state = readState(db, migrations);
      const applied: string[] = [];
      for (const migration of state.all.slice(state.applied)) {
        let baselineVariant: 'fresh' | 'fly_3ad618b' | undefined;
        if (migration.id === BASELINE_ID) baselineVariant = adoptBaseline(db);
        else {
          migration.before?.(db);
          db.exec(migration.sql);
          migration.after?.(db);
        }
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
      try {
        db.exec('ROLLBACK');
      } catch {
        // Transaction may already be inactive after the failed statement.
      }
      throw error;
    }
  } finally {
    db.exec('PRAGMA foreign_keys=ON');
  }
}
