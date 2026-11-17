import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { readStrictArguments, requireArgument } from './lib/hosted-runtime.ts';
import { downloadHostedBackup, readBackupReceiverStatus, requestHostedBackup } from '../server/backups/client.ts';

const args = readStrictArguments(['action', 'id', 'kind', 'release-id', 'source-revision', 'source-app', 'output', 'at']);
const action = requireArgument(args, 'action');
if (action === 'create') {
  const kind = requireArgument(args, 'kind');
  if (kind !== 'hourly' && kind !== 'release') throw new Error('kind must be hourly or release');
  console.log(JSON.stringify(await requestHostedBackup({ id: requireArgument(args, 'id'), kind,
    releaseId: args.get('release-id'), expectedSourceRevision: requireArgument(args, 'source-revision'),
    expectedSourceApp: requireArgument(args, 'source-app') })));
} else if (action === 'status') {
  console.log(JSON.stringify(await readBackupReceiverStatus()));
} else if (action === 'restore') {
  const status = await readBackupReceiverStatus();
  const at = args.has('at') ? Date.parse(args.get('at')!) : Infinity;
  if (Number.isNaN(at)) throw new Error('Invalid restore timestamp');
  const receipt = status.backups.filter(r => args.has('id') ? r.id === args.get('id') : Date.parse(r.completedAt) <= at)
    .sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt))[0];
  if (!receipt) throw new Error('No retained backup satisfies restore selection');
  const output = requireArgument(args, 'output');
  if (!path.isAbsolute(output)) throw new Error('Restore output must be absolute');
  await downloadHostedBackup(receipt, output);
  const database = new DatabaseSync(output, { readOnly: true });
  try {
    const rows = database.prepare('PRAGMA integrity_check').all();
    if (rows.length !== 1 || rows[0]?.integrity_check !== 'ok' || database.prepare('PRAGMA foreign_key_check').get()) throw new Error('Restored backup failed SQLite validation');
  } finally { database.close(); }
  console.log(JSON.stringify({ ...receipt, integrity_check: 'full', restoredAt: new Date().toISOString() }));
} else throw new Error('action must be create, status, or restore');
