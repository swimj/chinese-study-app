/** Run explicitly with LITESTREAM_BINARY=/absolute/litestream node --import tsx --test tests/integration/litestream-continuity.test.ts */
import assert from 'node:assert/strict';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { createBaselineFixture } from '../helpers/baseline-database.ts';
import { assertSchemaCurrent } from '../../server/db/migrations.ts';

const binary = process.env.LITESTREAM_BINARY;
assert.ok(binary && path.isAbsolute(binary), 'Set LITESTREAM_BINARY to the built executable');
const exec = promisify(execFile);
const repo = process.cwd();

function fixture() {
  // Short path also stays below Unix-domain socket path limits on macOS.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-'));
  const database = path.join(dir, 'app.db'), socket = path.join(dir, 'litestream.sock');
  const db = new DatabaseSync(database);
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE sample(id INTEGER PRIMARY KEY, payload BLOB); BEGIN');
  const insert = db.prepare('INSERT INTO sample(payload) VALUES (?)');
  for (let n = 0; n < 1000; n++) insert.run(Buffer.alloc(8192, n % 256));
  db.exec('COMMIT'); db.close();
  const config = path.join(dir, 'litestream.yml');
  fs.writeFileSync(config, `logging:\n  level: debug\n  type: json\nsocket:\n  enabled: true\n  path: ${socket}\nshutdown-sync-timeout: 10s\nsnapshot:\n  interval: 1h\n  retention: 168h\ndbs:\n  - path: ${database}\n    monitor-interval: 1s\n    checkpoint-interval: 1s\n    replica:\n      url: file://${dir}/replica\n      sync-interval: 1s\n`);
  return { dir, database, socket, config };
}
type Fixture = ReturnType<typeof fixture>;
function start(f: Fixture, child?: string) {
  let log = '';
  const proc = spawn(binary!, ['replicate', '-config', f.config, ...(child ? ['-exec', child] : [])], { cwd: repo, detached: true });
  proc.stdout.on('data', (b: Buffer) => { log += b.toString(); });
  proc.stderr.on('data', (b: Buffer) => { log += b.toString(); });
  const closed = new Promise<number | null>((resolve, reject) => { proc.once('error', reject); proc.once('close', resolve); });
  return { proc, closed, log: () => log };
}
async function waitFor(check: () => boolean, description: string) {
  const end = Date.now() + 20_000;
  while (!check()) { if (Date.now() > end) throw new Error(`Timeout: ${description}`); await delay(25); }
}
async function stop(r: ReturnType<typeof start>) {
  r.proc.kill('SIGTERM');
  await waitFor(() => r.proc.exitCode !== null || r.proc.signalCode !== null, 'Litestream exit');
  assert.equal(await r.closed, 0, r.log());
}
function snapshots(log: string) {
  return log.split('\n').filter(line => line.includes('"msg":"sync"') && line.includes('"snap":"true"'));
}
async function sync(f: Fixture) {
  return exec(binary!, ['sync', '-wait', '-timeout', '15', '-socket', f.socket, '-json', f.database]);
}
function digest(file: string) {
  const db = new DatabaseSync(file, { readOnly: true }), hash = createHash('sha256');
  for (const row of db.prepare('SELECT id,payload FROM sample ORDER BY id').iterate()) {
    hash.update(String(row.id)); hash.update(row.payload as Uint8Array);
  }
  db.close(); return hash.digest('hex');
}
async function restore(f: Fixture) {
  const output = path.join(f.dir, 'restored.db');
  await exec(binary!, ['restore', '-integrity-check', 'full', '-o', output, `file://${f.dir}/replica`]);
  assert.equal(digest(output), digest(f.database));
  return output;
}
function cleanup(f: Fixture, processes: ChildProcess[]) {
  for (const p of processes) if (p.pid !== undefined) {
    try { process.kill(-p.pid, 'SIGKILL'); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  }
  // All artifacts are synthetic; retain on failure only when explicitly requested.
  if (process.env.KEEP_LITESTREAM_TEST_DATA) console.log(`Evidence: ${f.dir}`);
  else fs.rmSync(f.dir, { recursive: true, force: true });
}

test('clean shutdown after a final checkpoint preserves WAL and two restarts stay incremental', { timeout: 90_000 }, async () => {
  const f = fixture(), processes: ChildProcess[] = [];
  const child = path.join(f.dir, 'child.cjs');
  fs.writeFileSync(child, `const {DatabaseSync}=require('node:sqlite'); const d=new DatabaseSync(${JSON.stringify(f.database)}); d.prepare('SELECT count(*) FROM sample').get(); const timer=setInterval(()=>{},1000); process.on('SIGTERM',()=>{d.exec('UPDATE sample SET payload=randomblob(8192)');d.close();clearInterval(timer);});`);
  try {
    for (let run = 0; run < 3; run++) {
      const r = start(f, `${JSON.stringify(process.execPath)} ${JSON.stringify(child)}`); processes.push(r.proc);
      await waitFor(() => r.log().includes('"msg":"sync"'), 'first sync');
      await sync(f);
      if (run === 0) await waitFor(() => r.log().includes('"msg":"checkpoint"'), 'monitor checkpoint');
      await delay(150);
      await stop(r);
      assert.ok(fs.existsSync(`${f.database}-wal`), 'WAL disappeared on clean shutdown');
      if (run > 0) assert.deepEqual(snapshots(r.log()), [], r.log());
    }
    await restore(f);
  } finally { cleanup(f, processes); }
});

test('legacy binary captures atomic DDL/data changes incrementally and snapshots genuine discontinuity', { timeout: 90_000 }, async () => {
  const f = fixture(), processes: ChildProcess[] = [];
  try {
    let r = start(f); processes.push(r.proc);
    await waitFor(() => fs.existsSync(f.socket), 'socket'); await sync(f); await stop(r);
    r = start(f); processes.push(r.proc);
    await waitFor(() => fs.existsSync(f.socket), 'migration socket');
    // Legacy binary evidence only: the hosted migration path now uses SQLite
    // backup receipts, not this Litestream lifecycle.
    await sync(f);
    const sql = `const {DatabaseSync}=require('node:sqlite'); const d=new DatabaseSync(process.argv[1]); d.exec('BEGIN IMMEDIATE; ALTER TABLE sample ADD COLUMN migrated INTEGER DEFAULT 1; UPDATE sample SET payload=randomblob(8192) WHERE id=1; COMMIT');d.close();`;
    await exec(process.execPath, ['-e', sql, f.database]);
    await sync(f);
    await stop(r); assert.deepEqual(snapshots(r.log()), [], r.log());
    r = start(f); processes.push(r.proc);
    await waitFor(() => fs.existsSync(f.socket), 'restart socket'); await sync(f); await stop(r);
    assert.deepEqual(snapshots(r.log()), [], r.log());
    const restored = await restore(f), db = new DatabaseSync(restored, { readOnly: true });
    assert.equal(db.prepare('SELECT migrated FROM sample WHERE id=1').get()?.migrated, 1); db.close();
    // Deliberately lose continuity only on this disposable fixture. SQLite
    // checkpoints the changed row safely; never manually unlink a live WAL.
    const offline = new DatabaseSync(f.database);
    offline.exec('UPDATE sample SET payload=randomblob(8192) WHERE id=2'); offline.close();
    r = start(f); processes.push(r.proc);
    await waitFor(() => fs.existsSync(f.socket), 'fallback socket'); await sync(f); await stop(r);
    assert.ok(snapshots(r.log()).length > 0, 'Missing WAL must still trigger a full baseline');
    fs.unlinkSync(restored); await restore(f);
  } finally { cleanup(f, processes); }
});

test('legacy binary restores the real migration CLI schema and retained learner data', { timeout: 120_000 }, async () => {
  const f = fixture(), processes: ChildProcess[] = [];
  try {
    fs.unlinkSync(f.database); // Only the unopened synthetic fixture is replaced.
    createBaselineFixture(f.dir);
    const before = new DatabaseSync(f.database);
    before.exec("INSERT INTO learners VALUES ('continuity-test', 'Keep me', '2026-01-01', NULL)"); before.close();
    const r = start(f); processes.push(r.proc);
    await waitFor(() => fs.existsSync(f.socket), 'initial socket'); await sync(f);
    // Exercise the general schema CLI while the legacy binary is running.
    // Do not invoke the replacement hosted migration supervisor here: its
    // independent receiver pre/post backup gates have separate coverage.
    await exec(process.execPath, ['--import', 'tsx', 'scripts/migrate-database.ts',
      `--database=${f.database}`, '--confirm-app-stopped=true'], { cwd: repo, timeout: 60_000, maxBuffer: 1024 * 1024 });
    await sync(f); await stop(r);
    assert.ok(fs.existsSync(`${f.database}-wal`));
    const restored = path.join(f.dir, 'real-migration-restore.db');
    await exec(binary!, ['restore', '-integrity-check', 'full', '-o', restored, `file://${f.dir}/replica`]);
    const db = new DatabaseSync(restored, { readOnly: true });
    assertSchemaCurrent(db);
    assert.equal(db.prepare("SELECT display_name FROM learners WHERE learner_id='continuity-test'").get()?.display_name, 'Keep me');
    db.close();
  } finally { cleanup(f, processes); }
});

test('RC refresh safely retires a database with a retained WAL', { timeout: 30_000 }, async () => {
  const f = fixture(), processes: ChildProcess[] = [];
  try {
    const r = start(f); processes.push(r.proc);
    await waitFor(() => fs.existsSync(f.socket), 'RC socket'); await sync(f); await stop(r);
    assert.ok(fs.existsSync(`${f.database}-wal`));
    const original = digest(f.database), incoming = path.join(f.dir, 'incoming.db');
    const db = new DatabaseSync(incoming); db.exec('CREATE TABLE replacement(id INTEGER); INSERT INTO replacement VALUES(42)'); db.close();
    await exec(process.execPath, ['--import', 'tsx', 'scripts/promote-hosted-rc-database.ts', `--data-dir=${f.dir}`,
      `--incoming-db=${incoming}`, '--confirm-disposable-rc-data=true'], { env: { ...process.env, APP_DEPLOYMENT_TIER: 'release_candidate' } });
    assert.equal(digest(path.join(f.dir, 'rc-previous-app.db')), original);
    const promoted = new DatabaseSync(f.database, { readOnly: true });
    assert.equal(promoted.prepare('SELECT id FROM replacement').get()?.id, 42); promoted.close();
  } finally { cleanup(f, processes); }
});
