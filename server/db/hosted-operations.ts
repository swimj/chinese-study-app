import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { getDb } from './connection.ts';

export const HOSTED_SERVICE_CONTROL_KEYS = ['maintenance_mode', 'provider_work_enabled'] as const;
export type HostedServiceControlKey = (typeof HOSTED_SERVICE_CONTROL_KEYS)[number];

export type HostedServiceControl = {
  key: HostedServiceControlKey;
  enabled: boolean;
  updatedAt: string;
  actorId: string;
};

export type HostedServiceControlState = {
  maintenanceMode: boolean;
  providerWorkEnabled: boolean;
};

export type HostedRestoreValidation = {
  integrityCheck: 'ok';
  journalMode: string;
  foreignKeysEnabled: boolean;
  learnerCount: number;
  sharedWordCount: number;
  contentImportCount: number;
  schemaMigrationCount: number;
  sentinelPresent: boolean;
};

export function ensureHostedOperationsSchema(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS service_controls (
      control_key TEXT PRIMARY KEY CHECK (
        control_key IN ('maintenance_mode', 'provider_work_enabled')
      ),
      enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
      updated_at TEXT NOT NULL,
      actor_id TEXT NOT NULL CHECK (length(trim(actor_id)) > 0)
    );

    CREATE TABLE IF NOT EXISTS deployment_sentinels (
      sentinel_id TEXT PRIMARY KEY CHECK (length(trim(sentinel_id)) > 0),
      created_at TEXT NOT NULL,
      actor_id TEXT NOT NULL CHECK (length(trim(actor_id)) > 0)
    );

    CREATE TABLE IF NOT EXISTS operator_actions (
      action_id TEXT PRIMARY KEY CHECK (length(trim(action_id)) > 0),
      action_kind TEXT NOT NULL CHECK (action_kind IN ('set_learner_disabled')),
      actor_id TEXT NOT NULL CHECK (length(trim(actor_id)) > 0),
      target_learner_id TEXT NOT NULL REFERENCES learners(learner_id),
      details_json TEXT NOT NULL CHECK (json_valid(details_json)),
      created_at TEXT NOT NULL
    );

    INSERT OR IGNORE INTO service_controls (control_key, enabled, updated_at, actor_id)
    VALUES ('maintenance_mode', 0, '1970-01-01T00:00:00.000Z', 'system_default');

    INSERT OR IGNORE INTO service_controls (control_key, enabled, updated_at, actor_id)
    VALUES ('provider_work_enabled', 1, '1970-01-01T00:00:00.000Z', 'system_default');
  `);
}

export function getHostedServiceControls(): HostedServiceControlState {
  return {
    maintenanceMode: readHostedServiceControl('maintenance_mode').enabled,
    providerWorkEnabled: readHostedServiceControl('provider_work_enabled').enabled,
  };
}

export function readHostedServiceControl(key: HostedServiceControlKey): HostedServiceControl {
  const row = getDb().prepare(`
    SELECT control_key, enabled, updated_at, actor_id
    FROM service_controls
    WHERE control_key = ?
  `).get(key) as {
    control_key: HostedServiceControlKey;
    enabled: number;
    updated_at: string;
    actor_id: string;
  } | undefined;
  if (!row) throw new Error(`Hosted service control "${key}" is missing.`);
  return {
    key: row.control_key,
    enabled: row.enabled === 1,
    updatedAt: row.updated_at,
    actorId: row.actor_id,
  };
}

export function setHostedServiceControl(input: {
  key: HostedServiceControlKey;
  enabled: boolean;
  actorId: string;
  updatedAt?: string;
}): HostedServiceControl {
  const actorId = requireNonEmpty(input.actorId, 'actor id');
  const updatedAt = requireIsoTimestamp(input.updatedAt ?? new Date().toISOString(), 'updated at');
  getDb().exec('BEGIN IMMEDIATE');
  try {
    const result = getDb().prepare(`
      UPDATE service_controls
      SET enabled = ?, updated_at = ?, actor_id = ?
      WHERE control_key = ?
    `).run(input.enabled ? 1 : 0, updatedAt, actorId, input.key);
    if (result.changes !== 1) throw new Error(`Hosted service control "${input.key}" is missing.`);
    getDb().exec('COMMIT');
  } catch (error) {
    getDb().exec('ROLLBACK');
    throw error;
  }
  return readHostedServiceControl(input.key);
}

export function createDeploymentSentinel(input: {
  sentinelId: string;
  actorId: string;
  createdAt?: string;
}): { sentinelId: string; createdAt: string; actorId: string } {
  const sentinelId = requireNonEmpty(input.sentinelId, 'sentinel id');
  const actorId = requireNonEmpty(input.actorId, 'actor id');
  const createdAt = requireIsoTimestamp(input.createdAt ?? new Date().toISOString(), 'created at');
  getDb().prepare(`
    INSERT INTO deployment_sentinels (sentinel_id, created_at, actor_id)
    VALUES (?, ?, ?)
  `).run(sentinelId, createdAt, actorId);
  return { sentinelId, createdAt, actorId };
}

export function hasDeploymentSentinel(sentinelId: string): boolean {
  return Boolean(getDb().prepare(`
    SELECT 1 FROM deployment_sentinels WHERE sentinel_id = ?
  `).get(requireNonEmpty(sentinelId, 'sentinel id')));
}

export function setHostedLearnerDisabled(input: {
  learnerId: string;
  disabled: boolean;
  actorId: string;
  createdAt?: string;
}): { actionId: string; learnerId: string; disabled: boolean; actorId: string; createdAt: string } {
  const learnerId = requireNonEmpty(input.learnerId, 'learner id');
  const actorId = requireNonEmpty(input.actorId, 'actor id');
  const createdAt = requireIsoTimestamp(input.createdAt ?? new Date().toISOString(), 'created at');
  const actionId = randomUUID();
  getDb().exec('BEGIN IMMEDIATE');
  try {
    const result = getDb().prepare(`
      UPDATE learners SET disabled_at = ? WHERE learner_id = ?
    `).run(input.disabled ? createdAt : null, learnerId);
    if (result.changes !== 1) throw new Error(`Learner "${learnerId}" does not exist.`);
    getDb().prepare(`
      INSERT INTO operator_actions (
        action_id, action_kind, actor_id, target_learner_id, details_json, created_at
      ) VALUES (?, 'set_learner_disabled', ?, ?, ?, ?)
    `).run(actionId, actorId, learnerId, JSON.stringify({ disabled: input.disabled }), createdAt);
    getDb().exec('COMMIT');
  } catch (error) {
    getDb().exec('ROLLBACK');
    throw error;
  }
  return { actionId, learnerId, disabled: input.disabled, actorId, createdAt };
}

export function getHostedOperationalDiagnostics(): {
  controls: HostedServiceControlState;
  journalMode: string;
  foreignKeysEnabled: boolean;
  databaseBytes: number;
  walBytes: number;
  learnerCount: number;
  sharedWordCount: number;
  contentImportCount: number;
  schemaMigrationCount: number;
  sentinelCount: number;
  operatorActionCount: number;
} {
  const counts = readOperationalCounts();
  const dbPath = getDatabasePath();
  return {
    controls: getHostedServiceControls(),
    journalMode: readJournalMode(),
    foreignKeysEnabled: readForeignKeysEnabled(),
    databaseBytes: fileSize(dbPath),
    walBytes: fileSize(`${dbPath}-wal`),
    ...counts,
  };
}

export function validateHostedRestore(expectedSentinelId: string): HostedRestoreValidation {
  const integrityRows = getDb().prepare('PRAGMA integrity_check').all() as Array<{ integrity_check: string }>;
  if (integrityRows.length !== 1 || integrityRows[0]?.integrity_check !== 'ok') {
    throw new Error('Restored database failed SQLite integrity_check.');
  }
  const counts = readOperationalCounts();
  if (counts.sharedWordCount === 0) {
    throw new Error('Restored database has no shared Mandarin content.');
  }
  const sentinelPresent = hasDeploymentSentinel(expectedSentinelId);
  if (!sentinelPresent) throw new Error(`Restored database is missing sentinel "${expectedSentinelId}".`);
  return {
    integrityCheck: 'ok',
    journalMode: readJournalMode(),
    foreignKeysEnabled: readForeignKeysEnabled(),
    learnerCount: counts.learnerCount,
    sharedWordCount: counts.sharedWordCount,
    contentImportCount: counts.contentImportCount,
    schemaMigrationCount: counts.schemaMigrationCount,
    sentinelPresent,
  };
}

function readOperationalCounts() {
  return getDb().prepare(`
    SELECT
      (SELECT COUNT(*) FROM learners) AS learnerCount,
      (SELECT COUNT(*) FROM lexical_words) AS sharedWordCount,
      (SELECT COUNT(*) FROM content_imports) AS contentImportCount,
      (SELECT COUNT(*) FROM schema_migrations) AS schemaMigrationCount,
      (SELECT COUNT(*) FROM deployment_sentinels) AS sentinelCount,
      (SELECT COUNT(*) FROM operator_actions) AS operatorActionCount
  `).get() as {
    learnerCount: number;
    sharedWordCount: number;
    contentImportCount: number;
    schemaMigrationCount: number;
    sentinelCount: number;
    operatorActionCount: number;
  };
}

function readJournalMode(): string {
  const row = getDb().prepare('PRAGMA journal_mode').get() as { journal_mode: string };
  return row.journal_mode;
}

function readForeignKeysEnabled(): boolean {
  const row = getDb().prepare('PRAGMA foreign_keys').get() as { foreign_keys: number };
  return row.foreign_keys === 1;
}

function getDatabasePath(): string {
  const rows = getDb().prepare('PRAGMA database_list').all() as Array<{ name: string; file: string }>;
  const main = rows.find((row) => row.name === 'main');
  if (!main?.file) throw new Error('SQLite main database path is unavailable.');
  return main.file;
}

function fileSize(path: string): number {
  try {
    return fs.statSync(path).size;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return 0;
    throw error;
  }
}

function requireNonEmpty(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`Expected non-empty ${label}.`);
  return normalized;
}

function requireIsoTimestamp(value: string, label: string): string {
  const normalized = requireNonEmpty(value, label);
  if (Number.isNaN(new Date(normalized).getTime())) throw new Error(`Expected ISO ${label} timestamp.`);
  return normalized;
}
