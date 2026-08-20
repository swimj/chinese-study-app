import fs from 'node:fs';

export type SpikeMetrics = {
  transactionCount: number;
  transactionDurationMsTotal: number;
  transactionDurationMsMax: number;
  sqliteBusyTotal: number;
  applicationErrorsTotal: number;
  authFailuresTotal: number;
};

export function createSpikeMetrics(): SpikeMetrics {
  return {
    transactionCount: 0,
    transactionDurationMsTotal: 0,
    transactionDurationMsMax: 0,
    sqliteBusyTotal: 0,
    applicationErrorsTotal: 0,
    authFailuresTotal: 0,
  };
}

export function observeTransaction(metrics: SpikeMetrics, durationMs: number): void {
  metrics.transactionCount += 1;
  metrics.transactionDurationMsTotal += durationMs;
  metrics.transactionDurationMsMax = Math.max(metrics.transactionDurationMsMax, durationMs);
}

export function observeDatabaseError(metrics: SpikeMetrics, error: unknown): void {
  if (isSqliteBusyError(error)) metrics.sqliteBusyTotal += 1;
}

export function observeApplicationError(metrics: SpikeMetrics): void {
  metrics.applicationErrorsTotal += 1;
}

export function observeAuthFailure(metrics: SpikeMetrics): void {
  metrics.authFailuresTotal += 1;
}

export function renderPrometheusMetrics(
  metrics: SpikeMetrics,
  options: {
    dbPath: string;
    schemaVersion: number;
    maintenanceMode: boolean;
    backupLastSyncAt?: string | null;
    nowMs?: number;
  },
): string {
  const backupAgeSeconds = deriveBackupAgeSeconds(options.backupLastSyncAt ?? null, options.nowMs ?? Date.now());
  const values: Array<[name: string, help: string, value: number]> = [
    ['swi46_database_bytes', 'Size of the synthetic SQLite database file.', fileSize(options.dbPath)],
    ['swi46_wal_bytes', 'Size of the synthetic SQLite WAL file.', fileSize(`${options.dbPath}-wal`)],
    ['swi46_schema_version', 'Current synthetic spike schema version.', options.schemaVersion],
    ['swi46_maintenance_mode', 'Whether synthetic spike writes are quiesced.', options.maintenanceMode ? 1 : 0],
    ['swi46_sqlite_busy_total', 'SQLite busy or locked errors observed by the spike process.', metrics.sqliteBusyTotal],
    ['swi46_transaction_count', 'Observed synthetic spike transactions.', metrics.transactionCount],
    ['swi46_transaction_duration_ms_total', 'Total latency of observed synthetic spike transactions.', metrics.transactionDurationMsTotal],
    ['swi46_transaction_duration_ms_max', 'Maximum latency of an observed synthetic spike transaction.', metrics.transactionDurationMsMax],
    ['swi46_application_errors_total', 'Unexpected application errors observed by the spike process.', metrics.applicationErrorsTotal],
    ['swi46_auth_failures_total', 'Unauthenticated private requests without identity or token details.', metrics.authFailuresTotal],
    ['swi46_backup_replication_available', 'Whether Litestream reported a successful replication timestamp.', backupAgeSeconds === null ? 0 : 1],
    ['swi46_backup_replication_age_seconds', 'Age of the latest successful Litestream replication, or -1 when unavailable.', backupAgeSeconds ?? -1],
  ];

  return `${values.map(([name, help, value]) => [
    `# HELP ${name} ${help}`,
    `# TYPE ${name} ${name.endsWith('_total') ? 'counter' : 'gauge'}`,
    `${name} ${finiteMetric(value)}`,
  ].join('\n')).join('\n')}\n`;
}

function deriveBackupAgeSeconds(lastSyncAt: string | null, nowMs: number): number | null {
  if (!lastSyncAt) return null;
  const lastSyncMs = Date.parse(lastSyncAt);
  if (!Number.isFinite(lastSyncMs) || !Number.isFinite(nowMs)) return null;
  return Math.max(0, (nowMs - lastSyncMs) / 1_000);
}

function fileSize(filePath: string): number {
  try {
    return fs.statSync(filePath).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw error;
  }
}

function isSqliteBusyError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const sqliteError = error as Error & { code?: string; errcode?: number };
  return sqliteError.code === 'SQLITE_BUSY'
    || sqliteError.code === 'SQLITE_LOCKED'
    || sqliteError.errcode === 5
    || sqliteError.errcode === 6;
}

function finiteMetric(value: number): string {
  return Number.isFinite(value) ? String(value) : '0';
}
