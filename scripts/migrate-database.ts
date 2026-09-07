import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getSchemaMigrationStatus, migrateDatabase } from '../server/db/migrations.ts';
import { readStrictArguments, requireArgument } from './lib/hosted-runtime.ts';

const args = readStrictArguments(['database', 'confirm-app-stopped', 'status']);
const databasePath = requireArgument(args, 'database');
if (!path.isAbsolute(databasePath)) throw new Error('--database must be an absolute path.');
if (!fs.statSync(databasePath).isFile()) throw new Error('--database must name an existing database file.');
const statusOnly = args.get('status') === 'true';
if (args.has('status') && !statusOnly) throw new Error('--status must be true when supplied.');
if (!statusOnly && args.get('confirm-app-stopped') !== 'true') {
  throw new Error('Stop the app and provider workers, take a backup, then pass --confirm-app-stopped=true.');
}
const db = new DatabaseSync(databasePath, { readOnly: statusOnly });
try {
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  // Schema changes must never silently attribute data writes to a learner.
  db.function('current_learner_id', () => { throw new Error('Migration must supply explicit learner ownership.'); });
  const applied = statusOnly ? [] : migrateDatabase(db);
  console.log(JSON.stringify({ database: databasePath, appliedThisRun: applied, ...getSchemaMigrationStatus(db) }, null, 2));
} finally {
  db.close();
}
