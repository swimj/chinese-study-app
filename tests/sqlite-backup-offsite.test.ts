import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import http, { type IncomingHttpHeaders } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test, type TestContext } from 'node:test';
import { gunzipSync } from 'node:zlib';
import { S3Client } from '@aws-sdk/client-s3';
import { OffsiteBackup } from '../server/backups/offsite.ts';
import { offsiteKey } from '../server/backups/offsite-object.ts';
import type { BackupReceipt } from '../server/backups/types.ts';

const HOUR = 3_600_000;

async function fixture(t: TestContext) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'offsite-test-'));
  const db = new DatabaseSync(path.join(dir, 'fixture.sqlite'));
  db.exec("CREATE TABLE items(value); INSERT INTO items VALUES ('restore me')");
  db.close();
  const payload = await fs.readFile(path.join(dir, 'fixture.sqlite'));
  const captures = new Map<string, { headers: IncomingHttpHeaders; body: Buffer }>();
  const state = { now: Date.parse('2026-11-17T00:00:00Z'), puts: 0, heads: 0, mode: 'ok' };
  const server = http.createServer(async (req, res) => {
    const key = decodeURIComponent(new URL(req.url!, 'http://localhost').pathname).slice(1);
    if (req.method === 'HEAD') {
      state.heads++;
      const object = captures.get(key);
      if (!object) { res.writeHead(403); res.end(); return; }
      const headers = Object.fromEntries(Object.entries(object.headers).filter(([k]) => k.startsWith('x-amz-meta-')));
      res.writeHead(200, { ...headers, 'content-length': object.body.length,
        'x-amz-checksum-sha256': object.headers['x-amz-checksum-sha256'] as string });
      res.end();
      return;
    }
    assert.equal(req.method, 'PUT');
    assert.equal(req.headers['if-none-match'], '*');
    assert.equal(req.headers['x-amz-server-side-encryption'], 'AES256');
    assert.equal(req.headers['content-type'], 'application/gzip');
    state.puts++;
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks);
    assert.equal(body.length, Number(req.headers['content-length']));
    const checksum = createHash('sha256').update(body).digest('base64');
    assert.equal(req.headers['x-amz-checksum-sha256'], checksum);
    if (state.mode === 'denied') { res.writeHead(403); res.end('<Error><Code>AccessDenied</Code></Error>'); return; }
    if (captures.has(key)) { res.writeHead(412); res.end('<Error><Code>PreconditionFailed</Code></Error>'); return; }
    captures.set(key, { headers: req.headers, body });
    if (state.mode === 'lost-response') { req.socket.destroy(); return; }
    res.writeHead(200, { 'x-amz-checksum-sha256': checksum, 'x-amz-request-id': 'mock-request' }); res.end();
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const endpoint = `http://127.0.0.1:${address.port}`;
  const logs: Record<string, unknown>[] = [];
  const services: OffsiteBackup[] = [];
  function service(bucket = 'test-backups') {
    const client = new S3Client({ region: 'us-east-1', forcePathStyle: true,
      endpoint, maxAttempts: 1,
      credentials: { accessKeyId: 'test-only-id', secretAccessKey: 'test-only-secret' } });
    const result = new OffsiteBackup({ client, bucket, region: 'us-east-1', dataDir: dir, sourceApp: 'production',
      scratchDir: dir, now: () => state.now, log: event => logs.push(event) });
    services.push(result);
    return result;
  }
  async function capture(id: string): Promise<BackupReceipt> {
    const timestamp = new Date(state.now).toISOString();
    const result: BackupReceipt = { id, version: 1, kind: 'hourly', captureOrigin: 'scheduled', sourceApp: 'production',
      sourceRevision: 'a'.repeat(40), startedAt: timestamp, completedAt: timestamp, receivedAt: timestamp,
      bytes: payload.length, sha256: createHash('sha256').update(payload).digest('hex'), fileName: id + '.sqlite' };
    await fs.writeFile(path.join(dir, result.fileName), payload);
    return result;
  }
  t.after(async () => {
    for (const backup of services) await backup.close();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await fs.rm(dir, { recursive: true, force: true });
  });
  return { service, capture, captures, state, dir, payload, logs };
}

test('conditionally uploads restorable gzip with original metadata, gates future uploads by capture time across restart', async t => {
  const f = await fixture(t);
  const first = await f.capture('capture-a');
  const service = f.service();
  await Promise.all([service.poll(first, first), service.poll(first, first)]);
  const key = offsiteKey(first);
  assert.equal(key, 'sqlite-backups/production/2026-11-17/2026-11-17T00:00:00.000Z-capture-a.sqlite.gz');
  assert.deepEqual(service.status().lastConfirmed, { id: first.id, key, startedAt: first.startedAt, confirmedAt: first.startedAt });
  const stored = f.captures.get('test-backups/' + key)!;
  assert.deepEqual(gunzipSync(stored.body), f.payload);
  assert.equal(stored.headers['x-amz-meta-sqlite-sha256'], first.sha256);
  assert.equal(stored.headers['x-amz-meta-source-revision'], first.sourceRevision);
  assert.equal(stored.headers['x-amz-meta-sqlite-bytes'], String(f.payload.length));
  assert.equal(f.state.puts, 1);
  assert.equal(f.state.heads, 0);
  assert.equal(f.logs.at(-1)?.bodyBytesRead, stored.body.length);
  await service.close();
  const restarted = f.service();
  f.state.now += 6 * HOUR;
  const notDue = await f.capture('not-due');
  await restarted.poll(notDue, notDue);
  assert.equal(restarted.status().lastConfirmed?.id, first.id);
  assert.equal(f.state.puts, 1);
  f.state.now += 6 * HOUR;
  await restarted.poll(first, first);
  assert.equal(f.state.puts, 1);
  const next = await f.capture('next-due');
  await restarted.poll(next, next);
  assert.equal(f.state.puts, 2);
  assert.equal(restarted.status().lastConfirmed?.id, next.id);
  assert.ok(!JSON.stringify(f.logs).includes('test-only-secret'));
});

test('recovers lost S3 acknowledgement after receiver restart and local source pruning without PUT or download', async t => {
  const f = await fixture(t);
  const source = await f.capture('response-lost');
  const service = f.service();
  f.state.mode = 'lost-response';
  await service.poll(source, source);
  assert.equal(f.captures.size, 1);
  assert.equal(service.status().lastConfirmed, null);
  await service.close();
  await fs.unlink(path.join(f.dir, source.fileName));
  f.state.now += 2 * HOUR;
  const restarted = f.service();
  await restarted.poll(null, null);
  assert.equal(restarted.status().lastConfirmed?.startedAt, source.startedAt);
  assert.equal(f.state.heads, 1);
  assert.equal(f.state.puts, 1);
});

test('fails closed for corrupt same-length local backup and keeps previous confirmation after an AWS refusal', async t => {
  const f = await fixture(t);
  const service = f.service();
  const first = await f.capture('confirmed');
  await service.poll(first, first);
  f.state.now += 12 * HOUR;
  const next = await f.capture('local-corrupt');
  await fs.writeFile(path.join(f.dir, next.fileName), Buffer.alloc(next.bytes));
  await service.poll(next, next);
  assert.equal(f.logs.at(-1)?.code, 'sqlite_checksum_mismatch');
  assert.equal(f.state.puts, 1);
  assert.equal(service.status().lastConfirmed?.id, first.id);
  f.state.now += 60_000;
  const valid = await f.capture('still-local');
  f.state.mode = 'denied';
  await service.poll(valid, valid);
  assert.equal(service.status().lastConfirmed?.id, first.id);
  assert.equal(f.captures.size, 1);
  f.state.now += 2 * 60_000;
  f.state.mode = 'ok';
  await service.poll(valid, valid);
  assert.equal(service.status().lastConfirmed?.id, valid.id);
  assert.equal(f.state.heads, 1);
  assert.equal(f.captures.size, 2);
});

test('reconciles condition conflicts only with a matching checksum and metadata, scopes success to destination', async t => {
  const f = await fixture(t);
  const source = await f.capture('unique-key');
  const service = f.service();
  await service.poll(source, source);
  await service.close();
  await fs.unlink(path.join(f.dir, '.offsite-receipt.json'));
  const same = f.service();
  await same.poll(source, source);
  assert.equal(same.status().lastConfirmed?.id, source.id);
  assert.equal(f.logs.at(-1)?.outcome, 'already_exists');
  await same.close();
  await fs.unlink(path.join(f.dir, '.offsite-receipt.json'));
  const object = f.captures.get('test-backups/' + offsiteKey(source))!;
  object.headers['x-amz-meta-sqlite-sha256'] = '0'.repeat(64);
  const mismatch = f.service();
  await mismatch.poll(source, source);
  assert.equal(mismatch.status().lastConfirmed, null);
  assert.equal(f.logs.at(-1)?.code, 'existing_object_mismatch');
  f.state.now += 6 * HOUR;
  const later = await f.capture('fresh-after-conflict');
  await mismatch.poll(later, later);
  assert.equal(mismatch.status().lastConfirmed?.id, later.id);
  assert.equal(f.captures.size, 2);
  await mismatch.close();
  const other = f.service('different-destination');
  await other.poll(null, null);
  assert.equal(other.status().lastConfirmed, null);
  assert.equal(f.captures.size, 2);
});

test('uses fresh scheduled captures as twelve-hour anchors and uploads the newest verified file', async t => {
  const f = await fixture(t);
  const service = f.service();
  const oldAnchor = await f.capture('midnight');
  f.state.now += 3 * HOUR;
  const offGrid = await f.capture('manual-between-schedules');
  await service.poll(oldAnchor, offGrid);
  assert.equal(f.state.puts, 0);
  f.state.now += 3 * HOUR;
  const six = await f.capture('six-am');
  f.state.now += 30 * 60_000;
  const recent = { ...await f.capture('release-after-six'), kind: 'release' as const, captureOrigin: 'manual' as const, releaseId: 'release-123' };
  await service.poll(six, recent);
  assert.equal(service.status().lastConfirmed?.startedAt, recent.startedAt);
  assert.equal(f.captures.get('test-backups/' + offsiteKey(recent))?.headers['x-amz-meta-release-id'], 'release-123');
  await service.close();
  const restart = f.service();
  f.state.now += 11.5 * HOUR;
  const eighteen = await f.capture('six-pm');
  await restart.poll(eighteen, eighteen);
  assert.equal(f.state.puts, 2);
  assert.equal(restart.status().lastConfirmed?.id, eighteen.id);
});
