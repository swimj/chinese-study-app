import path from 'node:path';
import { once } from 'node:events';
import { readStrictArguments, requireArgument } from './lib/hosted-runtime.ts';
import { runBackedUpMigration } from './lib/hosted-migration.ts';
import { createMigrationCommandRunner } from './lib/migration-command-runner.ts';
import { startConfiguredBackupSource } from '../server/backups/source.ts';

const args = readStrictArguments(['confirm-app-stopped', 'pre-release-backup-id', 'release-id', 'previous-revision']);
const dataDir = process.env.APP_DATA_DIR ?? '/data';
if (!path.isAbsolute(dataDir)) throw new Error('APP_DATA_DIR must be absolute.');
const runner = createMigrationCommandRunner();
const terminate = () => runner.interrupt('SIGTERM');
const interrupt = () => runner.interrupt('SIGINT');
process.on('SIGTERM', terminate);
process.on('SIGINT', interrupt);
try {
  const result = await runBackedUpMigration({
    databasePath: path.join(dataDir, 'app.db'),
    confirmAppStopped: args.get('confirm-app-stopped') === 'true',
    preReleaseBackupId: requireArgument(args, 'pre-release-backup-id'),
    releaseId: requireArgument(args, 'release-id'),
    previousRevision: requireArgument(args, 'previous-revision'),
    sourceRevision: process.env.APP_REVISION ?? '', sourceApp: process.env.FLY_APP_NAME ?? '',
  }, runner.run, { async start() {
    const server = startConfiguredBackupSource();
    if (!server) throw new Error('APP_BACKUP_SOURCE_TOKEN is required');
    await once(server, 'listening');
    return () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  } });
  console.log(JSON.stringify(result, null, 2));
} finally {
  process.removeListener('SIGTERM', terminate);
  process.removeListener('SIGINT', interrupt);
}
