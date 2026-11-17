import path from 'node:path';
import { readStrictArguments } from './lib/hosted-runtime.ts';
import { runReplicatedMigration } from './lib/hosted-migration.ts';
import { createMigrationCommandRunner } from './lib/migration-command-runner.ts';

const args = readStrictArguments(['confirm-app-stopped']);
const dataDir = process.env.APP_DATA_DIR ?? '/data';
if (!path.isAbsolute(dataDir)) throw new Error('APP_DATA_DIR must be absolute.');
// Litestream waits for this worker; the worker must also wait for its actual
// writer and must never launch the next command after shutdown was requested.
const runner = createMigrationCommandRunner();
const terminate = () => runner.interrupt('SIGTERM');
const interrupt = () => runner.interrupt('SIGINT');
process.on('SIGTERM', terminate);
process.on('SIGINT', interrupt);
try {
  const result = await runReplicatedMigration({
    databasePath: path.join(dataDir, 'app.db'), socketPath: path.join(dataDir, 'litestream.sock'),
    confirmAppStopped: args.get('confirm-app-stopped') === 'true',
  }, runner.run);
  console.log(JSON.stringify(result, null, 2));
} finally {
  process.removeListener('SIGTERM', terminate);
  process.removeListener('SIGINT', interrupt);
}
