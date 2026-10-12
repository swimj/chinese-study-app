import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { resetPreviewWelcome } from '../src/features/welcome/reset-preview-welcome.ts';

test('welcome reset removes only three local welcome markers and consumes the URL flag', () => {
  const values = new Map([
    ['getting-started-seen:v1:trusted-local', 'true'],
    ['getting-started-stash-seen:v1:trusted-local', 'true'],
    ['getting-started-settings-seen:v1:trusted-local', 'true'],
    ['getting-started-seen:v1:user_other', 'true'], ['other-preference', 'keep'],
  ]);
  const storage = { removeItem: (key: string) => { values.delete(key); } };
  assert.equal(resetPreviewWelcome(new URL('http://localhost/?reset-welcome=1&x=2#operator-usage'), storage), '/?x=2');
  assert.deepEqual([...values.keys()], ['getting-started-seen:v1:user_other', 'other-preference']);
  assert.equal(resetPreviewWelcome(new URL('http://localhost/'), storage), null);
});

test('preview creates a fresh learner and shared content, refuses existing directories, and reset-only creates nothing', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'new-learner-test-'));
  const target = path.join(parent, 'preview');
  const inherited = path.join(parent, 'valuable');
  fs.mkdirSync(inherited);
  fs.writeFileSync(path.join(inherited, 'app.db'), 'untouched');
  const run = (...args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', 'scripts/dev-new-learner.ts', ...args], {
    encoding: 'utf8', env: { ...process.env, APP_DATA_DIR: inherited, APP_LEARNER_ID: 'unrelated', APP_MODE: 'dev' },
  });
  try {
    const result = run(`--data-dir=${target}`, '--prepare-only=true');
    assert.equal(result.status, 0, result.stderr);
    const db = new DatabaseSync(path.join(target, 'app.db'), { readOnly: true });
    try {
      db.function('current_learner_id', () => 'new-learner-preview');
      assert.deepEqual(db.prepare('SELECT learner_id FROM learners').all().map(row => row.learner_id), ['new-learner-preview']);
      assert.ok(Number(db.prepare('SELECT COUNT(*) AS n FROM words').get()!.n) > 0);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM study_attempt_events').get()!.n, 0);
    } finally { db.close(); }
    const before = fs.readFileSync(path.join(target, 'app.db'));
    assert.notEqual(run(`--data-dir=${target}`, '--prepare-only=true').status, 0);
    assert.deepEqual(fs.readFileSync(path.join(target, 'app.db')), before);
    assert.equal(fs.readFileSync(path.join(inherited, 'app.db'), 'utf8'), 'untouched');
    const reset = run('--reset-welcome=true', '--port=4193');
    assert.equal(reset.status, 0, reset.stderr);
    assert.match(reset.stdout, /http:\/\/localhost:4193\/\?reset-welcome=1/);
    assert.notEqual(run('--port=0', '--reset-welcome=true').status, 0);
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});
