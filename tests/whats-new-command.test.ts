import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { migrateDatabase } from '../server/db/migrations.ts';
import { createBaselineFixture } from './helpers/baseline-database.ts';

function command(args: string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', 'scripts/manage-whats-new.ts', ...args], {
    encoding: 'utf8',
    env: { ...process.env, CLERK_SECRET_KEY: '', CLERK_PUBLISHABLE_KEY: '' },
  });
}

test('operator command changes a running database without bootstrap and rejects stale saves', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whats-new-command-'));
  createBaselineFixture(dir);
  const reader = new DatabaseSync(path.join(dir, 'app.db'));
  try {
    reader.exec('PRAGMA journal_mode=WAL;');
    reader.function('current_learner_id', () => { throw new Error('CLI fixture migrations must supply ownership'); });
    migrateDatabase(reader);
    const schema = reader.prepare('SELECT type, name, sql FROM sqlite_schema ORDER BY type, name').all();
    const learners = reader.prepare('SELECT * FROM learners').all();
    const input = path.join(dir, 'post.json');
    const request = {
      id: 'live-update', expectedRevision: null, date: '2026-10-07',
      title: 'Clearer updates', paragraphs: ['Read changes while continuing to study.'],
      status: 'published', sourceFrom: null, sourceThrough: null,
    };
    fs.writeFileSync(input, JSON.stringify(request));
    const args = [`--data-dir=${dir}`, '--actor-id=test-operator', `--input=${input}`];
    const result = command(args);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).post.revision, 1);
    assert.equal(reader.prepare("SELECT title FROM whats_new_posts WHERE post_id='live-update'").get()?.title, request.title);
    assert.equal(reader.prepare("SELECT actor_id FROM whats_new_post_revisions WHERE post_id='live-update'").get()?.actor_id, 'test-operator');
    const stale = command(args);
    assert.notEqual(stale.status, 0);
    assert.match(stale.stderr, /Reload it before saving/);
    assert.equal(reader.prepare("SELECT revision FROM whats_new_posts WHERE post_id='live-update'").get()?.revision, 1);
    const list = command([`--data-dir=${dir}`, '--list=true']);
    assert.equal(list.status, 0, list.stderr);
    assert.ok(JSON.parse(list.stdout).posts.some((post: { id: string }) => post.id === request.id));
    assert.deepEqual(reader.prepare('SELECT type, name, sql FROM sqlite_schema ORDER BY type, name').all(), schema);
    assert.deepEqual(reader.prepare('SELECT * FROM learners').all(), learners);
  } finally {
    reader.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('operator command never creates a missing target or migrates an old one', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whats-new-command-target-'));
  try {
    const missing = path.join(dir, 'missing');
    assert.notEqual(command([`--data-dir=${missing}`, '--list=true']).status, 0);
    assert.equal(fs.existsSync(missing), false);
    assert.notEqual(command([`--data-dir=${dir}`, '--list=true']).status, 0);
    assert.equal(fs.existsSync(path.join(dir, 'app.db')), false);
    createBaselineFixture(dir);
    const old = command([`--data-dir=${dir}`, '--list=true']);
    assert.notEqual(old.status, 0);
    const db = new DatabaseSync(path.join(dir, 'app.db'), { readOnly: true });
    try {
      assert.equal(db.prepare("SELECT name FROM sqlite_schema WHERE name='whats_new_posts'").get(), undefined);
    } finally { db.close(); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
