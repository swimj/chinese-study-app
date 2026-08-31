import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type HostedBackupStatus = {
  lastSyncAt: string;
  ageSeconds: number;
};

export async function readHostedBackupStatus(
  options: {
    socketPath?: string;
    databasePath?: string;
    now?: Date;
  } = {},
): Promise<HostedBackupStatus | null> {
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
