import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { BackupReceiver } from '../server/backups/receiver.ts';

const revision = 'a'.repeat(40);
async function fixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'backup-receiver-'));
  const file = path.join(dir, 'fixture.db');
  const db = new DatabaseSync(file);
  db.exec("CREATE TABLE important(id INTEGER PRIMARY KEY, value TEXT); INSERT INTO important VALUES(1,'preserved')");
  db.close();
  const payload = await fs.readFile(file);
  const state = { now: new Date('2026-11-17T00:00:00Z'), mode: 'ok', requests: 0, release: () => {} };
  const server = http.createServer(async (req, res) => {
    state.requests++;
    let raw = ''; for await (const chunk of req) raw += chunk;
    if (req.url !== '/backup' || req.method !== 'POST' || req.headers.authorization !== 'Bearer test-secret') {
      res.writeHead(401);res.end('secret-content-must-not-leak');return;
    }
    const { id } = JSON.parse(raw) as { id: string };
    if (state.mode === 'unauthorized') { res.writeHead(403);res.end('secret-content');return; }
    const body = state.mode === 'not-sqlite' ? Buffer.alloc(payload.length, 42) : payload;
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': body.length,
      'x-backup-id': id, 'x-backup-source-app': 'production-app', 'x-backup-source-revision': revision,
      'x-backup-started-at': state.now.toISOString(), 'x-backup-completed-at': state.now.toISOString(),
      'x-backup-sha256': state.mode === 'bad-hash' ? '0'.repeat(64) : createHash('sha256').update(body).digest('hex') });
    if (state.mode === 'wait') { await new Promise<void>(resolve => { state.release = resolve; }); }
    if (state.mode === 'truncated') { res.write(body.subarray(0, 100)); res.destroy();return; }
    res.end(body);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();assert.ok(address && typeof address !== 'string');
  const dataDir = path.join(dir, 'backups');
  const options = { dataDir, sourceUrl: `http://127.0.0.1:${address.port}`, sourceToken: 'test-secret', now: () => state.now };
  const receiver = new BackupReceiver(options);await receiver.initialize();
  return { dir, dataDir, state, receiver, options, payload,
    async close() { state.release();await receiver.close();server.closeAllConnections();await new Promise<void>(resolve => server.close(() => resolve()));await fs.rm(dir, { recursive: true, force: true }); } };
}

test('receives a verified durable standalone SQLite file, checks source identity, and retries idempotently', async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.receiver.create({ id: 'wrong-app', kind: 'hourly', expectedSourceApp: 'other-app' }), /invalid_source_metadata/);
    const request = { id: 'hour-1', kind: 'hourly' as const, expectedSourceRevision: revision, expectedSourceApp: 'production-app' };
    const receipt = await f.receiver.create(request);
    assert.equal(receipt.bytes, f.payload.length);
    assert.equal(receipt.sourceApp, 'production-app');
    const restored = new DatabaseSync(path.join(f.dataDir, receipt.fileName), { readOnly: true });
    assert.equal(restored.prepare('SELECT value FROM important').get()?.value, 'preserved');restored.close();
    const requests = f.state.requests;
    assert.deepEqual(await f.receiver.create(request), receipt);assert.equal(f.state.requests, requests);
    await assert.rejects(f.receiver.create({ ...request, expectedSourceRevision: 'b'.repeat(40) }), /backup_id_conflict/);
    await f.receiver.close();
    const restarted = new BackupReceiver(f.options);await restarted.initialize();
    assert.deepEqual(restarted.status().lastSuccessfulBackup, receipt);await restarted.close();
  } finally { await f.close(); }
});

test('six-hour timer and five scheduled recovery points survive manual captures, releases and failed transfers', async () => {
  const f = await fixture();
  try {
    const scheduled: string[] = [];
    for (let n = 0; n < 6; n++) {
      f.state.now = new Date(Date.UTC(2026, 10, 17, 6 * n));
      assert.equal(f.receiver.scheduledBackupDue(), true);
      const receipt = await f.receiver.createScheduled('production-app');
      scheduled.push(receipt.id);
      assert.equal(f.receiver.scheduledBackupDue(), false);
      for (let m = 0; m < 2; m++) {
        f.state.now = new Date(Date.UTC(2026, 10, 17, 6 * n + 5, 58 + m));
        await f.receiver.create({ id: `post-deploy-${n}-${m}`, kind: 'hourly' });
      }
      await f.receiver.create({ id: `pre-release-${n}`, kind: 'release', releaseId: `release-${n}` });
      assert.equal(f.receiver.scheduledBackupDue(), false);
    }

    const ids = f.receiver.status().backups.map(r => r.id);
    assert.deepEqual(ids.sort(), [...scheduled.slice(1), 'post-deploy-5-1', 'pre-release-5', 'pre-release-4', 'pre-release-3'].sort());
    assert.equal((await fs.readdir(f.dataDir)).includes(`${scheduled[0]}.sqlite`), false);
    f.state.now = new Date(Date.UTC(2026, 10, 17, 36));
    for (const mode of ['bad-hash', 'truncated', 'unauthorized', 'not-sqlite']) {
      f.state.mode = mode;
      await assert.rejects(f.receiver.createScheduled('production-app'));
      assert.equal(f.receiver.scheduledBackupDue(), true);
      assert.deepEqual(f.receiver.status().backups.map(r => r.id).sort(), ids);
      assert.equal(JSON.stringify(f.receiver.status()).includes('secret-content'), false);
      assert.equal((await fs.readdir(f.dataDir)).some(n => n.endsWith('.part')), false);
    }

    await f.receiver.close();
    const restarted = new BackupReceiver(f.options);
    await restarted.initialize();
    try {
      assert.equal(restarted.status().lastScheduledBackup?.id, scheduled.at(-1));
      assert.equal(restarted.scheduledBackupDue(), true);
    } finally { await restarted.close(); }
  } finally { await f.close(); }
});

test('reads legacy timer receipts and keeps new operator-chosen ids in the manual retention slot', async () => {
  const f = await fixture();
  try {
    const legacy = await f.receiver.create({ id: `hourly-${randomUUID()}`, kind: 'hourly' });
    delete legacy.captureOrigin;
    await f.receiver.close();
    await fs.writeFile(path.join(f.dataDir, `${legacy.id}.json`), JSON.stringify(legacy));
    const restarted = new BackupReceiver(f.options);
    await restarted.initialize();
    try {
      assert.equal(restarted.status().lastScheduledBackup?.id, legacy.id);
      f.state.now = new Date(Date.UTC(2026, 10, 17, 6));
      await restarted.create({ id: `hourly-${randomUUID()}`, kind: 'hourly' });
      assert.equal(restarted.scheduledBackupDue(), true);
      assert.equal(restarted.status().lastScheduledBackup?.id, legacy.id);
      assert.equal(restarted.status().backups.length, 2);
    } finally { await restarted.close(); }
  } finally { await f.close(); }
});

test('retains at most three distinct pre-release backups younger than seven days', async () => {
  const f = await fixture();
  try {
    for (let n = 0; n < 4; n++) {
      f.state.now = new Date(Date.UTC(2026, 10, 17, n));
      await f.receiver.create({ id: `release-${n}`, kind: 'release', releaseId: `revision-${n}` });
    }
    assert.deepEqual(f.receiver.status().backups.map(r => r.id), ['release-3', 'release-2', 'release-1']);
    await assert.rejects(f.receiver.create({ id: 'replacement', kind: 'release', releaseId: 'revision-3' }), /release_already_backed_up/);
    f.state.now = new Date('2026-11-24T02:00:00Z');
    await f.receiver.create({ id: 'hour-new', kind: 'hourly' });
    assert.deepEqual(f.receiver.status().backups.map(r => r.id), ['hour-new', 'release-3']);
  } finally { await f.close(); }
});

test('rejects overlap, invalid identifiers, and oversized backups without publication', async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.receiver.create({ id: '../escape', kind: 'hourly' }), /invalid_request/);
    f.state.mode = 'wait';
    const pending = f.receiver.create({ id: 'slow', kind: 'hourly' });
    while (f.state.requests === 0) await new Promise(resolve => setTimeout(resolve, 5));
    await assert.rejects(f.receiver.create({ id: 'overlap', kind: 'hourly' }), /backup_busy/);
    assert.equal(f.receiver.status().busy, true);
    f.state.release();await pending;
    await f.receiver.close();
    const small = new BackupReceiver({ ...f.options, maxBytes: 1 });await small.initialize();
    f.state.mode = 'ok';
    await assert.rejects(small.create({ id: 'too-large', kind: 'hourly' }), /invalid_source_metadata/);
    assert.equal(small.status().backups.length, 1);await small.close();
  } finally { await f.close(); }
});

test('startup rejects a second owner, removes incomplete files and preserves orphan complete files', async () => {
  const f = await fixture();
  try {
    const duplicate = new BackupReceiver(f.options);await assert.rejects(duplicate.initialize(), /receiver_already_running/);
    await f.receiver.close();
    await fs.writeFile(path.join(f.dataDir, 'unfinished.sqlite.part'), 'partial');
    await fs.writeFile(path.join(f.dataDir, 'orphan.sqlite'), f.payload);
    const restarted = new BackupReceiver(f.options);await restarted.initialize();
    const names = await fs.readdir(f.dataDir);
    assert.ok(!names.includes('unfinished.sqlite.part'));assert.ok(names.includes('orphan.sqlite'));
    await assert.rejects(restarted.create({ id: 'orphan', kind: 'hourly' }), /orphan_backup_requires_inspection/);
    await restarted.close();
  } finally { await f.close(); }
});

test('reclaims a confirmed exited owner after a crash without losing committed receipts', async () => {
  const f = await fixture();
  try {
    const receipt = await f.receiver.create({ id: 'before-crash', kind: 'hourly' });
    const oldOwner = JSON.parse(await fs.readFile(path.join(f.dataDir, '.receiver-lock', 'owner.json'), 'utf8')) as Record<string, unknown>;
    await f.receiver.close();
    await fs.mkdir(path.join(f.dataDir, '.receiver-lock'));
    await fs.writeFile(path.join(f.dataDir, '.receiver-lock', 'owner.json'), JSON.stringify({ ...oldOwner, pid: 2147483647 }));
    const restarted = new BackupReceiver(f.options);await restarted.initialize();
    assert.deepEqual(restarted.status().lastSuccessfulBackup, receipt);
    assert.ok((await fs.readdir(f.dataDir)).some(n => n.startsWith('.receiver-stale-')));
    await restarted.close();
  } finally { await f.close(); }
});
