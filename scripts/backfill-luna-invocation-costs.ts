import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { backfillLunaInvocationCosts, previewLunaInvocationCostBackfill } from '../server/db/model-invocation-cost-backfill.ts';
import { readStrictArguments, requireArgument, readBooleanArgument } from './lib/hosted-runtime.ts';

const args = readStrictArguments(['data-dir', 'apply', 'actor-id', 'confirm-plan']);
const dataDir = requireArgument(args, 'data-dir');
if (!path.isAbsolute(dataDir)) throw new Error('--data-dir must be an absolute path.');
const apply = args.has('apply') ? readBooleanArgument(args, 'apply') : false;
const actorId = apply ? requireArgument(args, 'actor-id') : null;
const expectedPlanDigest = apply ? requireArgument(args, 'confirm-plan') : null;
const databasePath = path.join(dataDir, 'app.db');
if (!fs.existsSync(databasePath)) throw new Error('Backfill requires an existing database.');
// Avoid application startup: preview must neither bootstrap nor migrate a database.
const database = new DatabaseSync(databasePath, { readOnly: !apply });
try {
  database.exec('PRAGMA busy_timeout = 5000');
  const result = apply
    ? backfillLunaInvocationCosts(database, { actorId: actorId!, expectedPlanDigest: expectedPlanDigest! })
    : previewLunaInvocationCostBackfill(database);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  database.close();
}
