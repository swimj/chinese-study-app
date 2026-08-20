import { getDefaultSpikeDbPath, openSpikeDatabase } from '../src/database.ts';
import { applyHarmlessMigration, HARMLESS_MIGRATION_VERSION, validateHarmlessMigration } from '../src/migrations.ts';
import { requireArgument } from './cli.ts';

const requestedVersion = Number(requireArgument('to'));
if (requestedVersion !== HARMLESS_MIGRATION_VERSION) {
  throw new Error(`Only the harmless schema version ${HARMLESS_MIGRATION_VERSION} migration is supported.`);
}

const database = openSpikeDatabase(getDefaultSpikeDbPath());
try {
  applyHarmlessMigration(database);
  validateHarmlessMigration(database);
  console.log(JSON.stringify({ status: 'migrated', schemaVersion: database.getSchemaVersion() }));
} finally {
  database.close();
}
