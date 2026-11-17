import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

const script = path.resolve('scripts/promote-hosted-rc-database.ts');
function database(file: string, value: number) {
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE marker(value INTEGER); INSERT INTO marker VALUES(${value})`);
  db.close(); fs.chmodSync(file, 0o600);
}
function marker(file: string) {
  const db = new DatabaseSync(file, { readOnly: true });
  try { return db.prepare('SELECT value FROM marker').get()?.value; }
  finally { db.close(); }
}
function promote(dir: string, incoming: string) {
  return execFileSync(process.execPath, ['--import', 'tsx', script, `--data-dir=${dir}`, `--incoming-db=${incoming}`, '--confirm-disposable-rc-data=true'], {
    env: { ...process.env, APP_DEPLOYMENT_TIER: 'release_candidate' }, encoding: 'utf8', stdio: 'pipe',
  });
}

for (const existing of [true, false]) {
  test(`RC promotion preserves ${existing ? 'existing database' : 'data directory'} ownership and private file mode`, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-owner-'));
    const target = path.join(dir, 'app.db');
    const incoming = path.join(dir, 'incoming.db');
    try {
      if (existing) database(target, 1);
      database(incoming, 2);
      const owner = fs.statSync(existing ? target : dir);
      // Exercise a real ownership change without root when a supplementary
      // group is available (macOS and many contributor environments).
      const alternateGroup = process.getgroups?.().find(group => group !== owner.gid);
      if (alternateGroup !== undefined) fs.chownSync(incoming, owner.uid, alternateGroup);
      promote(dir, incoming);
      const restored = fs.statSync(target);
      assert.equal(restored.uid, owner.uid);
      assert.equal(restored.gid, owner.gid);
      assert.equal(restored.mode & 0o777, 0o600);
      assert.equal(marker(target), 2);
      assert.equal(fs.existsSync(incoming), false);
      if (existing) assert.equal(marker(path.join(dir, 'rc-previous-app.db')), 1);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}

test('RC promotion rejects a linked incoming file before changing the target or rollback copy', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-owner-link-'));
  try {
    database(path.join(dir, 'app.db'), 1);
    database(path.join(dir, 'rc-previous-app.db'), 3);
    database(path.join(dir, 'source.db'), 2);
    fs.symlinkSync(path.join(dir, 'source.db'), path.join(dir, 'incoming.db'));
    assert.throws(() => promote(dir, path.join(dir, 'incoming.db')), /existing file/);
    assert.equal(marker(path.join(dir, 'app.db')), 1);
    assert.equal(marker(path.join(dir, 'rc-previous-app.db')), 3);
    assert.equal(marker(path.join(dir, 'source.db')), 2);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
