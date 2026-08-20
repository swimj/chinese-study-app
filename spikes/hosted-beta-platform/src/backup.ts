import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type LitestreamBackupStatus = {
  lastSyncAt: string;
};

export async function readLitestreamBackupStatus(
  socketPath = process.env.LITESTREAM_SOCKET_PATH ?? '/data/litestream.sock',
  databasePath = process.env.APP_DATA_DIR ? `${process.env.APP_DATA_DIR}/app.db` : '/data/app.db',
): Promise<LitestreamBackupStatus | null> {
  try {
    const { stdout } = await execFileAsync('litestream', ['list', '-socket', socketPath, '-json'], {
      encoding: 'utf8',
      timeout: 2_000,
      maxBuffer: 64 * 1024,
    });
    return parseLitestreamList(stdout, databasePath);
  } catch {
    return null;
  }
}

export function parseLitestreamList(rawJson: string, databasePath: string): LitestreamBackupStatus | null {
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
  if (!isRecord(row) || typeof row.last_sync_at !== 'string' || Number.isNaN(Date.parse(row.last_sync_at))) {
    return null;
  }
  return { lastSyncAt: row.last_sync_at };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
