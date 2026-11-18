import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseBackupReceipt, readBackupReceiverStatus } from './backups/client.ts';
import type { BackupStatus } from './backups/types.ts';
import { OFFSITE_MAX_AGE_SECONDS, SCHEDULE_MAX_AGE_SECONDS } from './backups/schedule.ts';

const execFileAsync = promisify(execFile);

export type HostedBackupStatus = {
  lastSyncAt: string;
  ageSeconds: number;
};

type ReceiverFreshness = {
  local: HostedBackupStatus | null;
  localMaxAgeSeconds: number;
  offsiteAgeSeconds?: number | null;
};

function receiverFreshness(status: BackupStatus, sourceApp: string | undefined, now: Date): ReceiverFreshness {
  const legacy = status.lastScheduledBackup === undefined;
  const latest = legacy ? status.lastSuccessfulBackup : status.lastScheduledBackup;
  const receipt = latest ? parseBackupReceipt(latest) : null;
  const local = receipt && (!sourceApp || receipt.sourceApp === sourceApp)
    ? { lastSyncAt: receipt.startedAt, ageSeconds: Math.max(0, Math.floor((now.getTime() - Date.parse(receipt.startedAt)) / 1000)) }
    : null;
  const result: ReceiverFreshness = { local, localMaxAgeSeconds: legacy ? 75 * 60 : SCHEDULE_MAX_AGE_SECONDS };
  if (status.offsite !== undefined) {
    const startedAt = status.offsite?.lastConfirmed?.startedAt;
    const age = startedAt ? Math.floor((now.getTime() - Date.parse(startedAt)) / 1000) : NaN;
    result.offsiteAgeSeconds = Number.isFinite(age) && age >= 0 ? age : null;
  }
  return result;
}

async function readReceiverFreshness(now: Date): Promise<ReceiverFreshness | null> {
  try {
    return receiverFreshness(await readBackupReceiverStatus(), process.env.FLY_APP_NAME, now);
  } catch { return null; }
}

export async function readPublicBackupHealth(now = new Date()) {
  const freshness = process.env.APP_BACKUP_RECEIVER_URL ? await readReceiverFreshness(now) : null;
  const ageSeconds = freshness?.local?.ageSeconds ?? null;
  const localHealthy = freshness !== null && ageSeconds !== null && ageSeconds <= freshness.localMaxAgeSeconds;
  const offsiteRequired = process.env.APP_BACKUP_S3_REQUIRED === 'true' || freshness?.offsiteAgeSeconds !== undefined;
  const offsiteAgeSeconds = freshness?.offsiteAgeSeconds ?? null;
  const healthy = localHealthy && (!offsiteRequired || (offsiteAgeSeconds !== null && offsiteAgeSeconds <= OFFSITE_MAX_AGE_SECONDS));
  return { status: healthy ? 'ok' : 'unhealthy', ageSeconds, ...(offsiteRequired ? { offsiteAgeSeconds } : {}) };
}

export async function readHostedBackupStatus(
  options: {
    socketPath?: string;
    databasePath?: string;
    now?: Date;
  } = {},
): Promise<HostedBackupStatus | null> {
  if (process.env.APP_BACKUP_RECEIVER_URL) {
    return (await readReceiverFreshness(options.now ?? new Date()))?.local ?? null;
  }
  const socketPath = options.socketPath ?? process.env.LITESTREAM_SOCKET_PATH ?? '/data/litestream.sock';
  const databasePath = options.databasePath
    ?? (process.env.APP_DATA_DIR ? `${process.env.APP_DATA_DIR}/app.db` : '/data/app.db');
  try {
    const { stdout } = await execFileAsync('litestream', ['list', '-socket', socketPath, '-json'], {
      encoding: 'utf8',
      timeout: 2_000,
      maxBuffer: 64 * 1024,
    });
    return parseHostedBackupStatus(stdout, databasePath, options.now);
  } catch {
    return null;
  }
}

export function parseHostedBackupStatus(
  rawJson: string,
  databasePath: string,
  now = new Date(),
): HostedBackupStatus | null {
  let value: unknown;
  try {
    value = JSON.parse(rawJson);
  } catch {
    return null;
  }
  const rows = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.databases) ? value.databases : [];
  const row = rows.find((candidate) => isRecord(candidate) && candidate.path === databasePath);
  if (!isRecord(row) || typeof row.last_sync_at !== 'string') return null;
  const syncedAt = Date.parse(row.last_sync_at);
  if (Number.isNaN(syncedAt)) return null;
  return {
    lastSyncAt: row.last_sync_at,
    ageSeconds: Math.max(0, Math.floor((now.getTime() - syncedAt) / 1_000)),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
