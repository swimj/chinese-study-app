import { DatabaseSync } from 'node:sqlite';
import { getDefaultSpikeDbPath } from '../src/database.ts';
import { readArgument, requireArgument } from './cli.ts';

const sentinelId = requireArgument('sentinel-id');
const expectedSchemaVersion = Number(readArgument('schema-version') ?? '1');
if (!Number.isInteger(expectedSchemaVersion) || expectedSchemaVersion < 1) {
  throw new Error('Expected --schema-version to be a positive integer.');
}

const database = new DatabaseSync(getDefaultSpikeDbPath(), { readOnly: true });
try {
  const versionRow = database.prepare("SELECT value FROM spike_metadata WHERE key = 'schema_version'").get() as
    | { value: string }
    | undefined;
  const sentinelRow = database.prepare('SELECT sentinel_id FROM spike_sentinels WHERE sentinel_id = ?').get(sentinelId) as
    | { sentinel_id: string }
    | undefined;

  if (Number(versionRow?.value) !== expectedSchemaVersion) {
    throw new Error(`Restored database schema version did not equal ${expectedSchemaVersion}.`);
  }
  if (sentinelRow?.sentinel_id !== sentinelId) {
    throw new Error('Restored database did not contain the expected sentinel.');
  }
  const integrity = database.prepare('PRAGMA integrity_check').get() as { integrity_check: string } | undefined;
  if (integrity?.integrity_check !== 'ok') throw new Error('Restored database failed PRAGMA integrity_check.');

  console.log(JSON.stringify({
    status: 'verified',
    schemaVersion: expectedSchemaVersion,
    sentinelId,
    integrity: 'ok',
  }));
} finally {
  database.close();
}
