import type { SpikeDatabase } from './database.ts';

export const HARMLESS_MIGRATION_VERSION = 2;

export function applyHarmlessMigration(database: SpikeDatabase): void {
  database.db.exec('BEGIN EXCLUSIVE');
  try {
    if (!database.isMaintenanceMode()) {
      throw new Error('Harmless migration requires maintenance mode before writes are quiesced.');
    }
    const currentVersion = database.getSchemaVersion();
    if (currentVersion === HARMLESS_MIGRATION_VERSION) {
      database.db.exec('COMMIT');
      return;
    }
    if (currentVersion !== 1) {
      throw new Error(`Cannot apply harmless migration from schema version ${currentVersion}.`);
    }
    database.db.exec(`
      CREATE TABLE spike_release_probe (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        migrated_at TEXT NOT NULL
      );
    `);
    database.db.prepare('INSERT INTO spike_release_probe (singleton, migrated_at) VALUES (1, ?)')
      .run(new Date().toISOString());
    database.db.prepare("UPDATE spike_metadata SET value = ? WHERE key = 'schema_version'")
      .run(String(HARMLESS_MIGRATION_VERSION));
    database.db.exec('COMMIT');
  } catch (error) {
    database.db.exec('ROLLBACK');
    throw error;
  }
}

export function validateHarmlessMigration(database: SpikeDatabase): void {
  if (database.getSchemaVersion() !== HARMLESS_MIGRATION_VERSION) {
    throw new Error(`Expected schema version ${HARMLESS_MIGRATION_VERSION}.`);
  }
  const row = database.db.prepare('SELECT migrated_at FROM spike_release_probe WHERE singleton = 1').get() as
    | { migrated_at: string }
    | undefined;
  if (!row || Number.isNaN(Date.parse(row.migrated_at))) {
    throw new Error('Harmless migration probe is missing or invalid.');
  }
}
