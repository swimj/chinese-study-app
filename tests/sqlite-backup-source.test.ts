import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { createBackupSourceServer } from '../server/backups/source.ts';

const token = 'synthetic-test-token-'.repeat(3);
test('backup source authenticates and returns a coherent standalone SQLite file during writes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-source-test-'));
  const database = path.join(dir, 'app.db');
  const db = new DatabaseSync(database);
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE entries(id INTEGER PRIMARY KEY, value INTEGER); INSERT INTO entries VALUES(1,0),(2,0)');
  db.exec('CREATE TABLE padding(value BLOB); WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<4000) INSERT INTO padding SELECT zeroblob(4096) FROM n');
  const server = createBackupSourceServer({ databasePath: database, token, sourceApp: 'fixture', sourceRevision: 'a'.repeat(40), scratchDirectory: dir });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/backup`;
  let n = 0; const writeTimes: number[] = [];
  const writer = setInterval(() => { n++; db.exec(`BEGIN; UPDATE entries SET value=${n}; COMMIT`); writeTimes.push(Date.now()); }, 1);
  try {
    assert.equal((await fetch(url, { method: 'POST' })).status, 401);
    const response: Response = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({id:'test_capture'}) });
    assert.equal(response.status, 200);
    assert.ok(writeTimes.some(time => time >= Date.parse(response.headers.get('x-backup-started-at')!) && time <= Date.parse(response.headers.get('x-backup-completed-at')!)), 'writes completed during the actual SQLite capture');
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(createHash('sha256').update(bytes).digest('hex'), response.headers.get('x-backup-sha256'));
    assert.equal(response.headers.get('x-backup-source-revision'), 'a'.repeat(40));
    const output = path.join(dir, 'restored.db'); fs.writeFileSync(output, bytes);
    const restored = new DatabaseSync(output, { readOnly: true });
    assert.equal(restored.prepare('PRAGMA integrity_check').get()?.integrity_check, 'ok');
    assert.equal(restored.prepare('SELECT count(DISTINCT value) AS n FROM entries').get()?.n, 1);
    assert.ok(Number(restored.prepare('SELECT value FROM entries LIMIT 1').get()?.value) <= n);
    restored.close();
  } finally {
    clearInterval(writer); db.close(); server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


test('failed source workers clean scratch and release the busy guard', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-timeout-test-'));
  const database = path.join(dir, 'app.db');
  const db = new DatabaseSync(database); db.exec('CREATE TABLE t(id INTEGER)'); db.close();
  const server = createBackupSourceServer({databasePath:database, token, sourceApp:'fixture', sourceRevision:'a'.repeat(40), scratchDirectory:dir, timeoutMs:1});
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const response: Response = await fetch(`http://127.0.0.1:${address.port}/backup`, {method:'POST', headers:{authorization:`Bearer ${token}`},body:JSON.stringify({id:`timeout-${attempt}`})});
      assert.equal(response.status, 503); await response.text();
      // Response precedes finally cleanup; wait for owned scratch removal.
      for (let n=0; n<100 && fs.readdirSync(dir).some(name => name.startsWith('sqlite-backup-')); n++) await new Promise(resolve => setTimeout(resolve, 5));
      assert.deepEqual(fs.readdirSync(dir), ['app.db']);
    }
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    fs.rmSync(dir, {recursive:true, force:true});
  }
});

test('the capture worker lowers its own CPU priority only for background captures', async () => {
  const { execFileSync } = await import('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-priority-test-'));
  const database = path.join(dir, 'app.db');
  const db = new DatabaseSync(database); db.exec('CREATE TABLE t(id INTEGER); INSERT INTO t VALUES (1)'); db.close();
  const run = (name: string, extra: string[]) => JSON.parse(execFileSync(process.execPath, ['--import', 'tsx', 'scripts/create-sqlite-backup.ts',
    `--database=${database}`, `--output=${path.join(dir, name)}`, '--max-bytes=1048576', ...extra], { encoding: 'utf8' })) as { niceness: number };
  try {
    assert.equal(run('background.db', ['--priority=background']).niceness, os.constants.priority.PRIORITY_LOW);
    assert.equal(run('normal.db', []).niceness, os.getPriority());
    assert.throws(() => run('bad.db', ['--priority=urgent']));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
