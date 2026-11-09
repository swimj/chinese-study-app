import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { closeDbConnection, setDb } from '../server/db/connection.ts';
import { assertSchemaCurrent } from '../server/db/migrations.ts';
import { maintainPureCues } from '../server/db/pure-cue-maintenance.ts';
import { configureHostedDatabase, readStrictArguments, requireArgument } from './lib/hosted-runtime.ts';

const args = readStrictArguments(['data-dir', 'manifest', 'actor-id', 'confirm-plan']);
const dataDir = configureHostedDatabase(args);
const databasePath = path.join(dataDir, 'app.db');
if (!statSync(databasePath).isFile()) throw new Error('Maintenance requires an existing app.db file');
const actorId = requireArgument(args, 'actor-id');
const confirmPlan = args.has('confirm-plan') ? requireArgument(args, 'confirm-plan') : undefined;
if (confirmPlan !== undefined && !/^[0-9a-f]{64}$/.test(confirmPlan)) throw new Error('Expected a preview digest');
const manifest: unknown = JSON.parse(readFileSync(requireArgument(args, 'manifest'), 'utf8'));
const db = new DatabaseSync(databasePath, { readOnly: confirmPlan === undefined });
setDb(db);
try {
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');
  assertSchemaCurrent(db);
  process.stdout.write(`${JSON.stringify(maintainPureCues(manifest, actorId, confirmPlan), null, 2)}\n`);
} finally {
  closeDbConnection();
}
