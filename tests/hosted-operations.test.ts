import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { parseHostedBackupStatus } from '../server/hosted-backup-status.ts';

type DbModule = typeof import('../server/db.ts');

let dataDir = '';
let dbModule: DbModule;

describe('hosted operational controls', { concurrency: false }, () => {
  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-study-app-hosted-operations-'));
    const previousMode = process.env.APP_MODE;
    const previousAuthMode = process.env.APP_AUTH_MODE;
    const previousDataDir = process.env.APP_DATA_DIR;
    try {
      process.env.APP_MODE = 'study';
      process.env.APP_AUTH_MODE = 'clerk';
      process.env.APP_DATA_DIR = dataDir;
      dbModule = await import(`${pathToFileURL(path.resolve('server/db.ts')).href}?hosted-ops=${Date.now()}`);
    } finally {
      restoreEnv('APP_MODE', previousMode);
      restoreEnv('APP_AUTH_MODE', previousAuthMode);
      restoreEnv('APP_DATA_DIR', previousDataDir);
    }
  });

  after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

  test('starts with safe hosted service-control defaults', () => {
    assert.deepEqual(dbModule.getHostedServiceControls(), {
      maintenanceMode: false,
      providerWorkEnabled: true,
    });
  });

  test('records attributable service-control changes', () => {
    assert.deepEqual(dbModule.setHostedServiceControl({
      key: 'maintenance_mode',
      enabled: true,
      actorId: 'operator-test',
      updatedAt: '2026-08-31T08:00:00.000Z',
    }), {
      key: 'maintenance_mode',
      enabled: true,
      updatedAt: '2026-08-31T08:00:00.000Z',
      actorId: 'operator-test',
    });
    assert.equal(dbModule.getHostedServiceControls().maintenanceMode, true);
  });

  test('creates immutable unique persistence sentinels', () => {
    assert.deepEqual(dbModule.createDeploymentSentinel({
      sentinelId: 'swi-56-test-sentinel',
      actorId: 'operator-test',
      createdAt: '2026-08-31T08:01:00.000Z',
    }), {
      sentinelId: 'swi-56-test-sentinel',
      actorId: 'operator-test',
      createdAt: '2026-08-31T08:01:00.000Z',
    });
    assert.equal(dbModule.hasDeploymentSentinel('swi-56-test-sentinel'), true);
    assert.throws(() => dbModule.createDeploymentSentinel({
      sentinelId: 'swi-56-test-sentinel',
      actorId: 'operator-test',
    }), /UNIQUE constraint failed/);
  });

  test('disables a learner through an attributable operator action', () => {
    dbModule.bootstrapLearner({ learnerId: 'learner-to-disable' });
    const action = dbModule.setHostedLearnerDisabled({
      learnerId: 'learner-to-disable',
      disabled: true,
      actorId: 'operator-test',
      createdAt: '2026-08-31T08:02:00.000Z',
    });
    assert.equal(action.learnerId, 'learner-to-disable');
    assert.equal(action.disabled, true);
    assert.equal(action.actorId, 'operator-test');
    assert.throws(() => dbModule.assertLearnerExists('learner-to-disable'), /disabled/i);
    assert.equal(dbModule.getHostedOperationalDiagnostics().operatorActionCount, 1);
  });
});

test('reports Litestream backup freshness without exposing replica coordinates', () => {
  assert.deepEqual(parseHostedBackupStatus(JSON.stringify({ databases: [{
    path: '/data/app.db',
    last_sync_at: '2026-08-31T08:00:00Z',
    replica: 's3://secret-bucket/secret-prefix',
  }] }), '/data/app.db', new Date('2026-08-31T08:00:05Z')), {
    lastSyncAt: '2026-08-31T08:00:00Z',
    ageSeconds: 5,
  });
  assert.equal(parseHostedBackupStatus('{invalid', '/data/app.db'), null);
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
