import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  createSpikeMetrics,
  observeDatabaseError,
  observeTransaction,
  type SpikeMetrics,
} from './metrics.ts';

export const ACCOUNT_DISABLED_CODE = 'ACCOUNT_DISABLED';
export const MAINTENANCE_MODE_CODE = 'MAINTENANCE_MODE';
export const CURRENT_SPIKE_SCHEMA_VERSION = 1;
export const SPIKE_BUSY_TIMEOUT_MS = 5_000;

export type SpikeAccount = {
  localAccountId: string;
  providerSubject: string;
  enabled: boolean;
};

export type SpikeSentinel = {
  sentinelId: string;
  createdAt: string;
};

export type SpikeDatabase = {
  db: DatabaseSync;
  dbPath: string;
  metrics: SpikeMetrics;
  close(): void;
  getSchemaVersion(): number;
  isMaintenanceMode(): boolean;
  setMaintenanceMode(enabled: boolean): void;
  getAccount(providerSubject: string): SpikeAccount | null;
  ensureAccount(providerSubject: string): SpikeAccount;
  setAccountEnabled(providerSubject: string, enabled: boolean): SpikeAccount;
  createSentinel(sentinelId?: string): SpikeSentinel;
  getSentinel(sentinelId: string): SpikeSentinel | null;
};

export function openSpikeDatabase(
  dbPath: string,
  options: { metrics?: SpikeMetrics } = {},
): SpikeDatabase {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  const metrics = options.metrics ?? createSpikeMetrics();

  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = ${SPIKE_BUSY_TIMEOUT_MS};

    CREATE TABLE IF NOT EXISTS spike_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS spike_accounts (
      local_account_id TEXT PRIMARY KEY,
      provider_subject TEXT NOT NULL UNIQUE,
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS spike_sentinels (
      sentinel_id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL
    );
  `);

  db.prepare(`
    INSERT INTO spike_metadata (key, value)
    VALUES ('schema_version', ?)
    ON CONFLICT(key) DO NOTHING
  `).run(String(CURRENT_SPIKE_SCHEMA_VERSION));
  db.prepare(`
    INSERT INTO spike_metadata (key, value)
    VALUES ('maintenance_mode', 'false')
    ON CONFLICT(key) DO NOTHING
  `).run();

  function measuredTransaction<T>(work: () => T): T {
    const startedAt = performance.now();
    let began = false;
    try {
      db.exec('BEGIN IMMEDIATE');
      began = true;
      const result = work();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        if (began) db.exec('ROLLBACK');
      } finally {
        observeDatabaseError(metrics, error);
      }
      throw error;
    } finally {
      observeTransaction(metrics, performance.now() - startedAt);
    }
  }

  function getSchemaVersion(): number {
    const row = db.prepare("SELECT value FROM spike_metadata WHERE key = 'schema_version'").get() as
      | { value: string }
      | undefined;
    const version = Number(row?.value);
    if (!Number.isInteger(version) || version < 1) {
      throw new Error('Synthetic spike database has an invalid schema version.');
    }
    return version;
  }

  function readAccount(providerSubject: string): SpikeAccount | null {
    const row = db.prepare(`
      SELECT local_account_id, provider_subject, enabled
      FROM spike_accounts
      WHERE provider_subject = ?
    `).get(providerSubject) as { local_account_id: string; provider_subject: string; enabled: number } | undefined;
    return row ? toAccount(row) : null;
  }

  function readMaintenanceMode(): boolean {
    const row = db.prepare("SELECT value FROM spike_metadata WHERE key = 'maintenance_mode'").get() as
      | { value: string }
      | undefined;
    if (row?.value === 'true') return true;
    if (row?.value === 'false') return false;
    throw new Error('Synthetic spike database has an invalid maintenance mode.');
  }

  return {
    db,
    dbPath,
    metrics,
    close: () => db.close(),
    getSchemaVersion,
    isMaintenanceMode: readMaintenanceMode,
    setMaintenanceMode(enabled) {
      if (typeof enabled !== 'boolean') throw new Error('Expected boolean maintenance mode.');
      measuredTransaction(() => {
        db.prepare("UPDATE spike_metadata SET value = ? WHERE key = 'maintenance_mode'")
          .run(enabled ? 'true' : 'false');
      });
    },
    getAccount(providerSubject) {
      assertProviderSubject(providerSubject);
      return readAccount(providerSubject);
    },
    ensureAccount(providerSubject) {
      assertProviderSubject(providerSubject);
      const existing = readAccount(providerSubject);
      if (existing) return existing;

      return measuredTransaction(() => {
        const raced = readAccount(providerSubject);
        if (raced) return raced;
        if (readMaintenanceMode()) throw new MaintenanceModeError();
        const account: SpikeAccount = {
          localAccountId: randomUUID(),
          providerSubject,
          enabled: true,
        };
        db.prepare(`
          INSERT INTO spike_accounts (local_account_id, provider_subject, enabled, created_at)
          VALUES (?, ?, 1, ?)
        `).run(account.localAccountId, account.providerSubject, new Date().toISOString());
        return account;
      });
    },
    setAccountEnabled(providerSubject, enabled) {
      assertProviderSubject(providerSubject);
      if (typeof enabled !== 'boolean') throw new Error('Expected boolean enabled value.');
      const account = this.ensureAccount(providerSubject);
      measuredTransaction(() => {
        db.prepare('UPDATE spike_accounts SET enabled = ? WHERE provider_subject = ?')
          .run(enabled ? 1 : 0, providerSubject);
      });
      return { ...account, enabled };
    },
    createSentinel(sentinelId = randomUUID()) {
      assertSentinelId(sentinelId);
      const sentinel: SpikeSentinel = { sentinelId, createdAt: new Date().toISOString() };
      measuredTransaction(() => {
        if (readMaintenanceMode()) throw new MaintenanceModeError();
        db.prepare('INSERT INTO spike_sentinels (sentinel_id, created_at) VALUES (?, ?)')
          .run(sentinel.sentinelId, sentinel.createdAt);
      });
      return sentinel;
    },
    getSentinel(sentinelId) {
      assertSentinelId(sentinelId);
      const row = db.prepare(`
        SELECT sentinel_id, created_at FROM spike_sentinels WHERE sentinel_id = ?
      `).get(sentinelId) as { sentinel_id: string; created_at: string } | undefined;
      return row ? { sentinelId: row.sentinel_id, createdAt: row.created_at } : null;
    },
  };
}

export class MaintenanceModeError extends Error {
  readonly code = MAINTENANCE_MODE_CODE;

  constructor() {
    super('Writes are temporarily paused.');
    this.name = 'MaintenanceModeError';
  }
}

export function getDefaultSpikeDbPath(): string {
  return path.join(path.resolve(process.env.APP_DATA_DIR ?? '/data'), 'app.db');
}

function toAccount(row: { local_account_id: string; provider_subject: string; enabled: number }): SpikeAccount {
  return {
    localAccountId: row.local_account_id,
    providerSubject: row.provider_subject,
    enabled: row.enabled === 1,
  };
}

function assertProviderSubject(value: string): void {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 255) {
    throw new Error('Expected a non-empty provider subject of at most 255 characters.');
  }
}

function assertSentinelId(value: string): void {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    throw new Error('Expected a safe sentinel id of at most 128 characters.');
  }
}
