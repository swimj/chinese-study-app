import { readLitestreamSyncReceipt } from './litestream-sync.ts';
import { parseHostedCommandJson, type CommandRunner } from './hosted-upgrade.ts';

/** Run only as the child of the dedicated migration Litestream process. */
export async function runReplicatedMigration(input: {
  databasePath: string;
  socketPath: string;
  confirmAppStopped: boolean;
}, run: CommandRunner) {
  if (!input.confirmAppStopped) throw new Error('Stop the app and workers before running the replicated migration.');
  const sync = async () => {
    const result = await run('litestream', ['sync', '-wait', '-timeout', '60', '-socket', input.socketPath,
      '-json', input.databasePath], { timeoutMs: 90_000 });
    return readLitestreamSyncReceipt(parseHostedCommandJson(result.stdout), input.databasePath);
  };
  // No migration connection opens until the supervisor has attached to the WAL
  // and completed its initial verification.
  const before = await sync();
  const migration = await run(process.execPath, ['--import', 'tsx', 'scripts/migrate-database.ts',
    `--database=${input.databasePath}`, '--confirm-app-stopped=true']);
  const applied = parseHostedCommandJson(migration.stdout);
  try {
    const after = await sync();
    return { migration: applied, replication: { before, after } };
  } catch (error) {
    throw new Error('Migration may have committed, but its backup sync failed. Keep the app stopped; inspect migration status and repair replication before reopening.', { cause: error });
  }
}
