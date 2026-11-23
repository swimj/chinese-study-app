import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { buildFixture } from './fixture.ts';
import { openJournal } from './journal.ts';
import { copyDatabase, resolveStorage, snapshot } from './storage.ts';

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'journal-storage-'));
  return { root, checkout: join(root, 'checkout'), env: { JOURNAL_HOME: join(root, 'home') }, done: () => rmSync(root, { recursive: true, force: true }) };
}
function seed(path: string, body: string) {
  const db = new DatabaseSync(path);
  db.exec('CREATE TABLE journal(id INTEGER PRIMARY KEY, revision INTEGER, body TEXT)');
  db.prepare('INSERT INTO journal VALUES (1, 7, ?)').run(body);
  db.close();
}

test('a checkout gets its own fixture by default; the live journal stays outside every checkout', async () => {
  const s = sandbox();
  try {
    const fixture = await resolveStorage({ env: s.env, checkout: s.checkout, primary: true });
    assert.equal(fixture.profile, 'fixture');
    assert.equal(fixture.path, join(s.checkout, '.local', 'fixture.sqlite'));
    assert.ok(fixture.fresh);
    const live = await resolveStorage({ env: { ...s.env, JOURNAL_PROFILE: 'live' }, checkout: s.checkout, primary: true });
    assert.equal(live.path, join(s.env.JOURNAL_HOME, 'live.sqlite'));
    assert.ok(!live.path.startsWith(s.checkout));
    const custom = await resolveStorage({ env: { ...s.env, JOURNAL_DB: join(s.root, 'x.sqlite') }, checkout: s.checkout });
    assert.equal(custom.profile, 'custom');
  } finally {
    s.done();
  }
});

test('a worktree cannot open the live journal, and a copy must be made deliberately', async () => {
  const s = sandbox();
  try {
    await assert.rejects(resolveStorage({ env: { ...s.env, JOURNAL_PROFILE: 'live' }, checkout: s.checkout, primary: false }), /primary checkout/);
    await assert.rejects(resolveStorage({ env: { ...s.env, JOURNAL_PROFILE: 'copy' }, checkout: s.checkout, primary: false }), /copy-live/);
    const allowed = await resolveStorage({ env: { ...s.env, JOURNAL_PROFILE: 'live', JOURNAL_ALLOW_LIVE: '1' }, checkout: s.checkout, primary: false });
    assert.equal(allowed.profile, 'live');
  } finally {
    s.done();
  }
});

test('opening the live journal snapshots it first, keeping the newest copies', async () => {
  const s = sandbox();
  try {
    const first = await resolveStorage({ env: { ...s.env, JOURNAL_PROFILE: 'live' }, checkout: s.checkout, primary: true });
    assert.equal(first.snapshot, undefined, 'nothing to snapshot yet');
    seed(first.path, '{"words":1}');
    const second = await resolveStorage({ env: { ...s.env, JOURNAL_PROFILE: 'live' }, checkout: s.checkout, primary: true });
    assert.ok(second.snapshot && existsSync(second.snapshot));
    const copy = new DatabaseSync(second.snapshot!, { readOnly: true });
    assert.equal(copy.prepare('SELECT body FROM journal').get()!.body, '{"words":1}');
    copy.close();
    const dir = join(s.env.JOURNAL_HOME, 'backups');
    for (let i = 0; i < 4; i++) {
      await new Promise((r) => setTimeout(r, 2));
      await snapshot(first.path, dir, 3);
    }
    assert.equal(readdirSync(dir).length, 3);
  } finally {
    s.done();
  }
});

test('a copy of the live journal is a separate, consistent database', async () => {
  const s = sandbox();
  try {
    const live = join(s.root, 'live.sqlite');
    seed(live, '{"words":2}');
    const target = join(s.checkout, '.local', 'live-copy.sqlite');
    await copyDatabase(live, target);
    seed(join(s.root, 'other.sqlite'), '{}');
    const db = new DatabaseSync(target);
    db.prepare('UPDATE journal SET body = ?').run('{"changed":true}');
    db.close();
    const original = new DatabaseSync(live, { readOnly: true });
    assert.equal(original.prepare('SELECT body FROM journal').get()!.body, '{"words":2}');
    original.close();
    const copy = await resolveStorage({ env: { ...s.env, JOURNAL_PROFILE: 'copy' }, checkout: s.checkout, primary: false });
    assert.equal(copy.path, target);
  } finally {
    s.done();
  }
});

test('the fixture is a realistic week that opens like any journal', async () => {
  const s = sandbox();
  try {
    const path = join(s.checkout, '.local', 'fixture.sqlite');
    const state = await buildFixture(path);
    assert.equal(state.threads.length, 2);
    assert.equal(state.reflections.length, 2);
    assert.deepEqual(state.saved.filter((w: { kind: string }) => w.kind === 'Word').map((w: { title: string }) => w.title).sort(), ['分心', '报备', '透透气'].sort());
    assert.ok(state.annotationThreads.some((t: { anchor: { surface: string } }) => t.anchor.surface === 'read'));
    assert.ok(state.practice.card, 'practice is underway');
    const reopened = openJournal(path);
    try {
      assert.equal(reopened.get().threads.length, 2);
    } finally {
      reopened.close();
    }
  } finally {
    s.done();
  }
});
