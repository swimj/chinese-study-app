import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, test } from 'node:test';
import type { NextFunction, Request, Response } from 'express';
import { createSpikeAccountMiddleware } from '../spikes/hosted-beta-platform/src/auth.js';
import {
  ClerkAdminInputError,
  executeClerkAdminAction,
  readSoleProviderSubject,
  type ClerkAdminClient,
} from '../spikes/hosted-beta-platform/scripts/clerk-admin.js';
import {
  ACCOUNT_DISABLED_CODE,
  MAINTENANCE_MODE_CODE,
  MaintenanceModeError,
  openSpikeDatabase,
  SPIKE_BUSY_TIMEOUT_MS,
  type SpikeDatabase,
} from '../spikes/hosted-beta-platform/src/database.js';
import {
  applyHarmlessMigration,
  HARMLESS_MIGRATION_VERSION,
  validateHarmlessMigration,
} from '../spikes/hosted-beta-platform/src/migrations.js';
import { deriveClerkDomain, renderSpikeClient } from '../spikes/hosted-beta-platform/src/client.js';
import { parseLitestreamList } from '../spikes/hosted-beta-platform/src/backup.js';
import {
  renderPrometheusMetrics,
} from '../spikes/hosted-beta-platform/src/metrics.js';
import { parseAuthorizedParty, requireClerkPublishableKey } from '../spikes/hosted-beta-platform/src/server.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('hosted beta platform spike', { concurrency: false }, () => {
  test('uses WAL, foreign keys, and a bounded busy timeout for synthetic data', () => {
    const database = createDatabase();
    try {
      const journalMode = database.db.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
      const foreignKeys = database.db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number };
      const busyTimeout = database.db.prepare('PRAGMA busy_timeout').get() as { timeout: number };

      assert.equal(journalMode.journal_mode, 'wal');
      assert.equal(foreignKeys.foreign_keys, 1);
      assert.equal(busyTimeout.timeout, SPIKE_BUSY_TIMEOUT_MS);
    } finally {
      database.close();
    }
  });

  test('persists a server-generated sentinel across a fresh connection', () => {
    const directory = createTemporaryDirectory();
    const dbPath = path.join(directory, 'spike.db');
    const first = openSpikeDatabase(dbPath);
    const sentinel = first.createSentinel('deploy-restart-proof');
    first.close();

    const second = openSpikeDatabase(dbPath);
    try {
      assert.deepEqual(second.getSentinel(sentinel.sentinelId), sentinel);
    } finally {
      second.close();
    }
  });

  test('sentinel CLI honors the documented sentinel-id flag', () => {
    const directory = createTemporaryDirectory();
    const result = spawnSync(process.execPath, [
      '--import',
      'tsx',
      'spikes/hosted-beta-platform/scripts/seed-sentinel.ts',
      '--sentinel-id=documented-proof-id',
    ], {
      cwd: process.cwd(),
      env: { ...process.env, APP_DATA_DIR: directory },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout) as { sentinelId: string };
    assert.equal(output.sentinelId, 'documented-proof-id');
    const database = openSpikeDatabase(path.join(directory, 'app.db'));
    try {
      assert.equal(database.getSentinel('documented-proof-id')?.sentinelId, 'documented-proof-id');
    } finally {
      database.close();
    }
  });

  test('maps authenticated subjects to stable local accounts and blocks disabled accounts', () => {
    const database = createDatabase();
    try {
      let providerSubject: string | null = 'user_test_alpha';
      const middleware = createSpikeAccountMiddleware(database, () => providerSubject);
      const first = invokeAccountMiddleware(middleware);
      assert.equal(first.statusCode, 200);
      assert.equal(first.nextCalled, true);
      const firstAccount = database.ensureAccount('user_test_alpha');
      assert.equal(firstAccount.enabled, true);

      const second = invokeAccountMiddleware(middleware);
      assert.equal(second.nextCalled, true);
      assert.equal(database.ensureAccount('user_test_alpha').localAccountId, firstAccount.localAccountId);

      database.setAccountEnabled('user_test_alpha', false);
      const disabled = invokeAccountMiddleware(middleware);
      assert.equal(disabled.statusCode, 403);
      assert.equal(disabled.nextCalled, false);
      assert.deepEqual(disabled.body, {
        error: 'Account disabled.',
        code: ACCOUNT_DISABLED_CODE,
      });

      providerSubject = null;
      const anonymous = invokeAccountMiddleware(middleware);
      assert.equal(anonymous.statusCode, 401);
      assert.equal(database.metrics.authFailuresTotal, 1);
      assert.deepEqual(anonymous.body, {
        error: 'Authentication required.',
        code: 'AUTH_REQUIRED',
      });
    } finally {
      database.close();
    }
  });

  test('records content-free persistence and error metrics', () => {
    const database = createDatabase();
    try {
      database.ensureAccount('provider-secret-shaped-subject');
      database.createSentinel('sensitive-sentinel-marker');
      const rendered = renderPrometheusMetrics(database.metrics, {
        dbPath: database.dbPath,
        schemaVersion: database.getSchemaVersion(),
        maintenanceMode: database.isMaintenanceMode(),
        backupLastSyncAt: '2026-08-20T00:00:00.000Z',
        nowMs: Date.parse('2026-08-20T00:00:05.000Z'),
      });

      assert.match(rendered, /swi46_database_bytes [1-9][0-9]*/);
      assert.match(rendered, /swi46_transaction_count 2/);
      assert.match(rendered, /swi46_backup_replication_available 1/);
      assert.match(rendered, /swi46_backup_replication_age_seconds 5/);
      assert.doesNotMatch(rendered, /provider-secret-shaped-subject/);
      assert.doesNotMatch(rendered, /sensitive-sentinel-marker/);
    } finally {
      database.close();
    }
  });

  test('parses Litestream backup freshness without exposing replica details', () => {
    assert.deepEqual(
      parseLitestreamList(JSON.stringify({ databases: [{
        path: '/data/app.db',
        status: 'replicating',
        last_sync_at: '2026-08-20T00:00:05Z',
        replica: 's3://private-bucket/private-prefix',
      }] }), '/data/app.db'),
      { lastSyncAt: '2026-08-20T00:00:05Z' },
    );
    assert.equal(parseLitestreamList('{invalid', '/data/app.db'), null);
  });

  test('persists maintenance mode and exposes it as a content-free metric', () => {
    const directory = createTemporaryDirectory();
    const dbPath = path.join(directory, 'spike.db');
    const first = openSpikeDatabase(dbPath);
    assert.equal(first.isMaintenanceMode(), false);
    first.setMaintenanceMode(true);
    first.isMaintenanceMode = () => false;
    assert.throws(
      () => first.createSentinel('must-not-write'),
      (error: unknown) => error instanceof MaintenanceModeError
        && error.code === MAINTENANCE_MODE_CODE,
    );
    const newAccountDuringMaintenance = invokeAccountMiddleware(
      createSpikeAccountMiddleware(first, () => 'user_created_too_late'),
    );
    assert.equal(newAccountDuringMaintenance.statusCode, 503);
    assert.deepEqual(newAccountDuringMaintenance.body, {
      error: 'Writes are temporarily paused.',
      code: MAINTENANCE_MODE_CODE,
    });
    assert.equal(first.getAccount('user_created_too_late'), null);
    first.isMaintenanceMode = () => true;
    first.close();

    const second = openSpikeDatabase(dbPath);
    try {
      assert.equal(second.isMaintenanceMode(), true);
      const rendered = renderPrometheusMetrics(second.metrics, {
        dbPath,
        schemaVersion: second.getSchemaVersion(),
        maintenanceMode: second.isMaintenanceMode(),
      });
      assert.match(rendered, /swi46_maintenance_mode 1/);
    } finally {
      second.close();
    }
  });

  test('requires one exact HTTP(S) origin for Clerk authorized parties', () => {
    assert.equal(
      parseAuthorizedParty('https://swi-46-example.fly.dev'),
      'https://swi-46-example.fly.dev',
    );
    assert.equal(parseAuthorizedParty('http://127.0.0.1:5174'), 'http://127.0.0.1:5174');
    assert.throws(() => parseAuthorizedParty('https://example.com/path'), /without credentials, path, query, or fragment/);
    assert.throws(() => parseAuthorizedParty('example.com'), /absolute HTTP\(S\) origin/);
  });

  test('accepts the copied Vite Clerk publishable-key environment variable as fallback', () => {
    assert.equal(
      requireClerkPublishableKey({ VITE_CLERK_PUBLISHABLE_KEY: 'pk_test_from_vite' }),
      'pk_test_from_vite',
    );
    assert.equal(
      requireClerkPublishableKey({
        CLERK_PUBLISHABLE_KEY: 'pk_test_server',
        VITE_CLERK_PUBLISHABLE_KEY: 'pk_test_vite',
      }),
      'pk_test_server',
    );
    assert.throws(() => requireClerkPublishableKey({}), /CLERK_PUBLISHABLE_KEY or VITE_CLERK_PUBLISHABLE_KEY/);
  });

  test('loads the current Clerk UI bundle before mounting the sign-in component', () => {
    const rendered = renderSpikeClient('pk_test_ZXhhbXBsZS5jb20k');
    assert.match(rendered, /data-clerk-publishable-key="pk_test_ZXhhbXBsZS5jb20k"/);
    assert.match(rendered, /https:\/\/example\.com\/npm\/@clerk\/clerk-js@6\.29\.2\/dist\/clerk\.browser\.js/);
    assert.match(rendered, /\/npm\/@clerk\/ui@1\.30\.5\/dist\/ui\.browser\.js/);
    assert.match(rendered, /signInForceRedirectUrl: appOrigin/);
    assert.match(rendered, /signUpForceRedirectUrl: appOrigin/);
    assert.match(rendered, /signInFallbackRedirectUrl: appOrigin/);
    assert.match(rendered, /signUpFallbackRedirectUrl: appOrigin/);
    assert.doesNotMatch(rendered, /new window\.Clerk/);
    assert.match(rendered, /authStage \+ ': ' \+ errorName \+ ': ' \+ errorMessage/);
    assert.equal(deriveClerkDomain('pk_test_ZXhhbXBsZS5jb20k'), 'example.com');
    assert.throws(() => deriveClerkDomain('pk_test_invalid'), /domain marker was invalid/);
  });

  test('Clerk invite-and-revoke output never contains email or invitation identifiers', async () => {
    const calls: string[] = [];
    const client = createFakeClerkClient({ calls });
    const result = await executeClerkAdminAction({
      action: 'invite-and-revoke',
      client,
      emailEnvName: 'SWI46_INVITE_EMAIL',
      environment: {
        SWI46_INVITE_EMAIL: 'private-alias@example.test',
        CLERK_AUTHORIZED_PARTY: 'https://swi-46-example.fly.dev',
      },
    });

    assert.deepEqual(result, {
      action: 'invite-and-revoke',
      status: 'ok',
      createdCount: 1,
      revokedCount: 1,
    });
    assert.deepEqual(calls, ['invite', 'revoke-invitation']);
    const serialized = JSON.stringify(result);
    assert.doesNotMatch(serialized, /private-alias/);
    assert.doesNotMatch(serialized, /inv_secret/);
  });

  test('Clerk user actions require exactly one local synthetic account', async () => {
    const database = createDatabase();
    const client = createFakeClerkClient();
    try {
      assert.throws(
        () => readSoleProviderSubject(database),
        (error: unknown) => error instanceof ClerkAdminInputError
          && error.safeCode === 'EXPECTED_EXACTLY_ONE_LOCAL_ACCOUNT',
      );
      database.ensureAccount('user_secret_one');
      assert.equal(readSoleProviderSubject(database), 'user_secret_one');
      database.ensureAccount('user_secret_two');
      await assert.rejects(
        () => executeClerkAdminAction({ action: 'ban-user', client, database }),
        (error: unknown) => error instanceof ClerkAdminInputError
          && error.safeCode === 'EXPECTED_EXACTLY_ONE_LOCAL_ACCOUNT',
      );
    } finally {
      database.close();
    }
  });

  test('Clerk session revocation paginates and returns counts without session or subject identifiers', async () => {
    const database = createDatabase();
    database.ensureAccount('user_private_subject');
    const calls: string[] = [];
    const activeSessionIds = Array.from({ length: 101 }, (_, index) => `sess_secret_${index}`);
    const client = createFakeClerkClient({ calls, activeSessionIds });
    try {
      const result = await executeClerkAdminAction({ action: 'revoke-sessions', client, database });
      assert.deepEqual(result, { action: 'revoke-sessions', status: 'ok', affectedCount: 101 });
      assert.deepEqual(calls.filter((call) => call.startsWith('list-sessions:')), [
        'list-sessions:0',
        'list-sessions:100',
      ]);
      assert.equal(calls.filter((call) => call === 'revoke-session').length, 101);
      const serialized = JSON.stringify(result);
      assert.doesNotMatch(serialized, /sess_secret|user_private/);
    } finally {
      database.close();
    }
  });

  test('applies the harmless migration while an isolated pre-migration copy remains restorable', () => {
    const sourceDirectory = createTemporaryDirectory();
    const sourcePath = path.join(sourceDirectory, 'spike.db');
    const source = openSpikeDatabase(sourcePath);
    source.createSentinel('pre-release-sentinel');
    assert.throws(
      () => applyHarmlessMigration(source),
      /requires maintenance mode/,
    );
    source.setMaintenanceMode(true);
    source.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    source.close();

    const restoreDirectory = createTemporaryDirectory();
    const restorePath = path.join(restoreDirectory, 'spike.db');
    fs.copyFileSync(sourcePath, restorePath);

    const migrated = openSpikeDatabase(sourcePath);
    try {
      applyHarmlessMigration(migrated);
      validateHarmlessMigration(migrated);
      assert.equal(migrated.getSchemaVersion(), HARMLESS_MIGRATION_VERSION);
    } finally {
      migrated.close();
    }

    const restored = openSpikeDatabase(restorePath);
    try {
      assert.equal(restored.getSchemaVersion(), 1);
      assert.equal(restored.getSentinel('pre-release-sentinel')?.sentinelId, 'pre-release-sentinel');
      const integrity = restored.db.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
      assert.equal(integrity.integrity_check, 'ok');
    } finally {
      restored.close();
    }

    // Before writes reopen, rollback replaces the closed migrated file with
    // the identified v1 recovery point and starts the matching v1 app.
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${sourcePath}${suffix}`, { force: true });
    fs.copyFileSync(restorePath, sourcePath);
    const rolledBack = openSpikeDatabase(sourcePath);
    try {
      assert.equal(rolledBack.getSchemaVersion(), 1);
      assert.equal(rolledBack.isMaintenanceMode(), true);
      rolledBack.setMaintenanceMode(false);
      assert.equal(rolledBack.createSentinel('post-rollback-smoke').sentinelId, 'post-rollback-smoke');
    } finally {
      rolledBack.close();
    }
  });

  test('a second writer is rejected and the measured path records SQLite busy', () => {
    const database = createDatabase();
    const second = new DatabaseSync(database.dbPath);
    database.db.exec('PRAGMA busy_timeout = 0');
    second.exec('BEGIN IMMEDIATE');
    try {
      assert.throws(
        () => database.createSentinel('blocked-second-writer'),
        (error: unknown) => (error as { code?: string }).code === 'ERR_SQLITE_ERROR'
          || (error as { code?: string }).code === 'SQLITE_BUSY',
      );
      assert.equal(database.metrics.sqliteBusyTotal, 1);
    } finally {
      second.exec('ROLLBACK');
      second.close();
      database.close();
    }
  });
});

function createDatabase(): SpikeDatabase {
  return openSpikeDatabase(path.join(createTemporaryDirectory(), 'spike.db'));
}

function createTemporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'swi46-platform-spike-'));
  temporaryDirectories.push(directory);
  return directory;
}

function invokeAccountMiddleware(middleware: ReturnType<typeof createSpikeAccountMiddleware>): {
  statusCode: number;
  body: unknown;
  nextCalled: boolean;
} {
  const result = { statusCode: 200, body: undefined as unknown, nextCalled: false };
  const response = {
    status(code: number) {
      result.statusCode = code;
      return response;
    },
    json(body: unknown) {
      result.body = body;
      return response;
    },
  } as unknown as Response;
  const next: NextFunction = (error?: unknown) => {
    if (error) throw error;
    result.nextCalled = true;
  };
  middleware({} as Request, response, next);
  return result;
}

function createFakeClerkClient(options: {
  calls?: string[];
  activeSessionIds?: string[];
} = {}): ClerkAdminClient {
  const calls = options.calls ?? [];
  const activeSessionIds = options.activeSessionIds ?? [];
  return {
    invitations: {
      async createInvitation() {
        calls.push('invite');
        return { id: 'inv_secret' };
      },
      async revokeInvitation() {
        calls.push('revoke-invitation');
      },
    },
    sessions: {
      async getSessionList({ offset }) {
        calls.push(`list-sessions:${offset}`);
        return {
          data: activeSessionIds.slice(offset, offset + 100).map((id) => ({ id })),
          totalCount: activeSessionIds.length,
        };
      },
      async revokeSession() {
        calls.push('revoke-session');
      },
    },
    users: {
      async banUser() {
        calls.push('ban-user');
      },
      async unbanUser() {
        calls.push('unban-user');
      },
    },
  };
}
