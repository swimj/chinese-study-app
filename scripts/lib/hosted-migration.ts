import { randomUUID } from 'node:crypto';
import type { BackupReceipt } from '../../server/backups/types.ts';
import { parseHostedCommandJson, type CommandRunner } from './hosted-upgrade.ts';

const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/;
const SHA = /^[a-f0-9]{40}$/;
/** Controls must already be closed when the operator captures this recovery point. */
export const MIGRATION_BACKUP_MAX_AGE_MS = 60 * 60_000;
export async function runBackedUpMigration(input: {
  databasePath: string;
  confirmAppStopped: boolean;
  preReleaseBackupId: string;
  releaseId: string;
  previousRevision: string;
  sourceRevision: string;
  sourceApp: string;
}, run: CommandRunner, source: { start(): Promise<() => Promise<void>> }, now = () => Date.now()) {
  if (!input.confirmAppStopped) throw new Error('Stop the app and workers before running the backed-up migration.');
  if (!ID.test(input.preReleaseBackupId) || !ID.test(input.releaseId)
    || !SHA.test(input.previousRevision) || !SHA.test(input.sourceRevision)
    || !/^[a-z0-9][a-z0-9-]*$/.test(input.sourceApp)) throw new Error('Invalid migration backup identity.');
  const command = ['--import', 'tsx', 'scripts/manage-hosted-backup.ts'];
  const status = parseHostedCommandJson((await run(process.execPath, [...command, '--action=status'])).stdout);
  const backups = status && typeof status === 'object' && 'backups' in status ? status.backups : undefined;
  const before = Array.isArray(backups) ? backups.find((r: BackupReceipt) => r.id === input.preReleaseBackupId) as BackupReceipt | undefined : undefined;
  if (!before || before.version !== 1 || before.kind !== 'release' || before.releaseId !== input.releaseId
    || before.sourceRevision !== input.previousRevision || before.sourceApp !== input.sourceApp
    || !Number.isFinite(Date.parse(before.startedAt)) || !Number.isFinite(Date.parse(before.receivedAt))
    || Date.parse(before.startedAt) < now() - MIGRATION_BACKUP_MAX_AGE_MS
    || Date.parse(before.startedAt) > now() || Date.parse(before.receivedAt) > now()) {
    throw new Error('A retained verified pre-release backup for this release, app and previous revision, captured within one hour, is required. Keep the app stopped.');
  }
  const migration = parseHostedCommandJson((await run(process.execPath, ['--import', 'tsx', 'scripts/migrate-database.ts',
    `--database=${input.databasePath}`, '--confirm-app-stopped=true'])).stdout);
  // No source listener exists during schema mutation. A fresh UUID prevents an
  // earlier successful capture from satisfying this post-migration gate.
  const id = randomUUID();
  const afterStarted = now();
  let stop: (() => Promise<void>) | undefined;
  try {
    stop = await source.start();
    const after = parseHostedCommandJson((await run(process.execPath, [...command,
      '--action=create', '--kind=hourly', `--id=${id}`, `--source-revision=${input.sourceRevision}`,
      `--source-app=${input.sourceApp}`], { timeoutMs: 16 * 60_000 })).stdout) as BackupReceipt;
    if (after.id !== id || after.kind !== 'hourly' || after.sourceRevision !== input.sourceRevision
      || after.sourceApp !== input.sourceApp || !Number.isFinite(Date.parse(after.startedAt))
      || Date.parse(after.startedAt) < afterStarted - 5000) throw new Error('Post-migration receipt does not match the fresh backup request.');
    return { migration, backup: { before, after } };
  } catch (error) {
    throw new Error('Migration may have committed, but its verified backup failed. Keep the app stopped; inspect migration status and repair backup access before reopening.', { cause: error });
  } finally {
    await stop?.();
  }
}
