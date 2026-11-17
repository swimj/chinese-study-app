import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { downloadHostedBackup, parseBackupReceipt } from '../server/backups/client.ts';

test('restore verifies bytes and never overwrites a database or an existing partial file', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'backup-client-'));
  const file = path.join(dir, 'fixture.db');
  const db = new DatabaseSync(file); db.exec('CREATE TABLE test (id INTEGER PRIMARY KEY); INSERT INTO test VALUES(7)'); db.close();
  const contents = await readFile(file);
  const receipt = parseBackupReceipt({ version:1, id:'test', kind:'hourly', sourceApp:'test', sourceRevision:'a'.repeat(40),
    startedAt:new Date().toISOString(), completedAt:new Date().toISOString(), receivedAt:new Date().toISOString(),
    bytes:contents.length, sha256:createHash('sha256').update(contents).digest('hex'), fileName:'test.sqlite' });
  const server = createServer((_req, res) => { void pipeline(createReadStream(file), res).catch(() => {}); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const previousUrl = process.env.APP_BACKUP_RECEIVER_URL; const previousToken = process.env.APP_BACKUP_RECEIVER_TOKEN;
  process.env.APP_BACKUP_RECEIVER_URL = `http://127.0.0.1:${address.port}`;
  process.env.APP_BACKUP_RECEIVER_TOKEN = 'synthetic'.repeat(8);
  try {
    const target = path.join(dir, 'restore.db');
    await downloadHostedBackup(receipt, target);
    assert.deepEqual(await readFile(target), contents);
    await assert.rejects(downloadHostedBackup(receipt, target), {code:'EEXIST'});
    assert.deepEqual(await readFile(target), contents);
    const sidecarTarget = path.join(dir, 'sidecar.db');
    await writeFile(`${sidecarTarget}-wal`, 'valued WAL');
    await assert.rejects(downloadHostedBackup(receipt, sidecarTarget), {code:'EEXIST'});
    assert.equal(await readFile(`${sidecarTarget}-wal`, 'utf8'), 'valued WAL');
    const partialTarget = path.join(dir, 'partial.db');
    await writeFile(`${partialTarget}.incoming`, 'valued existing file');
    await assert.rejects(downloadHostedBackup(receipt, partialTarget), {code:'EEXIST'});
    assert.equal(await readFile(`${partialTarget}.incoming`, 'utf8'), 'valued existing file');
    const corruptTarget = path.join(dir, 'corrupt.db');
    await assert.rejects(downloadHostedBackup({...receipt, sha256:'0'.repeat(64)}, corruptTarget), /checksum/);
    await assert.rejects(readFile(corruptTarget), {code:'ENOENT'});
  } finally {
    if (previousUrl === undefined) delete process.env.APP_BACKUP_RECEIVER_URL; else process.env.APP_BACKUP_RECEIVER_URL = previousUrl;
    if (previousToken === undefined) delete process.env.APP_BACKUP_RECEIVER_TOKEN; else process.env.APP_BACKUP_RECEIVER_TOKEN = previousToken;
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(dir, {recursive:true, force:true});
  }
});
