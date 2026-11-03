import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setDb, closeDbConnection } from '../server/db/connection.ts';
import { runWithLearnerId } from '../server/db/learner-context.ts';
import { readStrictArguments, requireArgument } from './lib/hosted-runtime.ts';
import { previewEnoughRecovery, applyEnoughRecovery } from './lib/recover-enough-session.ts';

const args = readStrictArguments(['database', 'learner-id', 'session-id', 'apply', 'confirm-plan']);
const file = requireArgument(args, 'database');
if (!path.isAbsolute(file) || !fs.statSync(file).isFile()) throw new Error('--database must identify an existing absolute database file.');
if (args.has('apply') && args.get('apply') !== 'true') throw new Error('Omit --apply for preview, or use --apply=true.');
const apply = args.get('apply') === 'true';
if (!apply && args.has('confirm-plan')) throw new Error('--confirm-plan requires --apply=true.');
const digest = apply ? requireArgument(args, 'confirm-plan') : null;
const learnerId = requireArgument(args, 'learner-id'), sessionId = requireArgument(args, 'session-id');
// No application bootstrap, migrations, worker startup, or automatic database creation.
const db = new DatabaseSync(file, {readOnly: !apply});
setDb(db);
try {
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  if (!apply) db.exec('BEGIN');
  const result = runWithLearnerId(learnerId, () => digest === null
    ? previewEnoughRecovery(sessionId) : applyEnoughRecovery(sessionId, digest));
  if (!apply) db.exec('ROLLBACK');
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally { closeDbConnection(); }
