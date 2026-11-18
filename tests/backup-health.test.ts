import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readHostedBackupStatus, readPublicBackupHealth } from '../server/hosted-backup-status.ts';
import type { BackupReceipt, BackupStatus } from '../server/backups/types.ts';

test('public health checks scheduled local and enabled offsite capture ages independently', async (t) => {
  const now = new Date('2026-11-18T12:00:00Z');
  const before = (seconds: number) => new Date(now.getTime() - seconds * 1000).toISOString();
  const receipt: BackupReceipt = {
    version: 1, id: 'fresh-manual', kind: 'hourly', sourceApp: 'prod', sourceRevision: 'a'.repeat(40),
    startedAt: before(0), completedAt: before(0), receivedAt: before(0), bytes: 4096,
    sha256: 'b'.repeat(64), fileName: 'fresh-manual.sqlite',
  };
  const receiver: BackupStatus = { busy: false, lastSuccessfulBackup: receipt, backups: [receipt], lastError: null };
  t.mock.method(globalThis, 'fetch', async () => Response.json(receiver));
  const env = { ...process.env };
  process.env.APP_BACKUP_RECEIVER_URL = 'http://backup.internal';
  process.env.APP_BACKUP_RECEIVER_TOKEN = 'test'.repeat(8);
  process.env.FLY_APP_NAME = 'prod';
  delete process.env.APP_BACKUP_S3_REQUIRED;
  try {
    // Until the receiver is upgraded, retain the original 75-minute threshold.
    assert.deepEqual(await readPublicBackupHealth(now), { status: 'ok', ageSeconds: 0 });
    receipt.startedAt = before(4501);
    assert.equal((await readPublicBackupHealth(now)).status, 'unhealthy');
    receipt.startedAt = before(0);

    receiver.lastScheduledBackup = null;
    assert.deepEqual(await readPublicBackupHealth(now), { status: 'unhealthy', ageSeconds: null });
    receiver.lastScheduledBackup = { ...receipt, startedAt: before(22501) };
    assert.equal((await readPublicBackupHealth(now)).status, 'unhealthy');
    receiver.lastScheduledBackup.startedAt = before(22500);
    assert.deepEqual(await readPublicBackupHealth(now), { status: 'ok', ageSeconds: 22500 });

    process.env.APP_BACKUP_S3_REQUIRED = 'true';
    assert.deepEqual(await readPublicBackupHealth(now), { status: 'unhealthy', ageSeconds: 22500, offsiteAgeSeconds: null });
    delete process.env.APP_BACKUP_S3_REQUIRED;
    receiver.offsite = { lastConfirmed: null };
    assert.equal((await readPublicBackupHealth(now)).status, 'unhealthy');
    receiver.offsite.lastConfirmed = { id: 'backup', key: 'prefix/backup', startedAt: before(48601), confirmedAt: before(0) };
    assert.deepEqual(await readPublicBackupHealth(now), { status: 'unhealthy', ageSeconds: 22500, offsiteAgeSeconds: 48601 });
    assert.equal((await readHostedBackupStatus({ now }))?.ageSeconds, 22500);
    receiver.offsite.lastConfirmed.startedAt = before(48600);
    assert.deepEqual(await readPublicBackupHealth(now), { status: 'ok', ageSeconds: 22500, offsiteAgeSeconds: 48600 });
    receiver.lastScheduledBackup.sourceApp = 'wrong-app';
    assert.equal((await readPublicBackupHealth(now)).status, 'unhealthy');
    t.mock.method(globalThis, 'fetch', async () => { throw new Error('receiver unavailable'); });
    assert.deepEqual(await readPublicBackupHealth(now), { status: 'unhealthy', ageSeconds: null });
  } finally {
    for (const key of ['APP_BACKUP_RECEIVER_URL', 'APP_BACKUP_RECEIVER_TOKEN', 'FLY_APP_NAME', 'APP_BACKUP_S3_REQUIRED']) {
      if (env[key] === undefined) delete process.env[key];
      else process.env[key] = env[key];
    }
  }
});
