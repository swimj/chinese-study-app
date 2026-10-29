import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createBaselineFixture } from './helpers/baseline-database.ts';
import { migrateDatabase, schemaMigrations } from '../server/db/migrations.ts';
import { setDb } from '../server/db/connection.ts';
import { runWithLearnerId } from '../server/db/learner-context.ts';
import { getWhatsNewAttention, updateWhatsNewAttention } from '../server/db/whats-new-attention.ts';
import { saveWhatsNewPost } from '../server/db/whats-new.ts';
import { upsertLearnerParam } from '../server/db/identity.ts';
import { WhatsNewInputError } from '../src/domain/whats-new.ts';
import type { WhatsNewAttention } from '../src/domain/whats-new-attention.ts';

const start = '2026-10-08T00:00:00.000Z';
const later = '2026-10-08T08:00:00.000Z';
const expiry = '2026-10-08T12:00:00.000Z';
const afterDaysAway = '2026-10-15T00:00:00.000Z';
const firstId = 'update-2026-10-06';
const otherId = 'update-2026-09-09';

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blog-attention-'));
  createBaselineFixture(dir);
  const db = new DatabaseSync(path.join(dir, 'app.db'));
  db.function('current_learner_id', () => 'reader');
  migrateDatabase(db);
  db.prepare('INSERT INTO learners (learner_id, display_name, created_at) VALUES (?, ?, ?)').run('reader', 'Reader', start);
  db.prepare('INSERT INTO learners (learner_id, display_name, created_at) VALUES (?, ?, ?)').run('other', 'Other', start);
  setDb(db);
  return { db, dir, cleanup: () => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}
const get = (now = start, learner = 'reader') => runWithLearnerId(learner, () => getWhatsNewAttention(now));
const update = (postIds: string[], kind: 'badge-seen' | 'read', now = start, learner = 'reader') =>
  runWithLearnerId(learner, () => updateWhatsNewAttention({ postIds, kind }, now));

test('time away and pure reads preserve eligibility; twelve hours starts at actual badge exposure', () => {
  const f = fixture();
  try {
    const original = get();
    assert.equal(original.unseenPostIds.length, 12);
    assert.deepEqual(get(afterDaysAway).items, original.items);
    assert.equal(get(afterDaysAway).unseenPostIds.length, 12);
    assert.equal(f.db.prepare('SELECT count(*) n FROM learner_whats_new_attention').get()!.n, 0);
    const seen = update(original.unseenPostIds, 'badge-seen');
    assert.equal(seen.nextExpiryAt, expiry);
    assert.equal(get('2026-10-08T11:59:59.999Z').unseenPostIds.length, 12);
    assert.equal(get(expiry).unseenPostIds.length, 0);
    assert.equal(get(expiry).nextExpiryAt, null);
    assert(get(expiry).items.every(item => item.readAt === null), 'expiry is not a read');
    assert.deepEqual(update(original.unseenPostIds, 'badge-seen', afterDaysAway).items, seen.items, 'revisits never restart clocks');
  } finally { f.cleanup(); }
});

test('opening one post clears only it and learners have independent durable attention', () => {
  const f = fixture();
  try {
    update([firstId, otherId], 'badge-seen');
    const read = update([firstId], 'read', later);
    assert(!read.unseenPostIds.includes(firstId));
    assert(read.unseenPostIds.includes(otherId));
    assert.equal(read.items.find(item => item.postId === firstId)!.readAt, later);
    assert.deepEqual(update([firstId], 'read', expiry).items, read.items);
    assert.equal(get(start, 'other').unseenPostIds.length, 12);
    assert(get(start, 'other').items.every(item => item.firstBadgeSeenAt === null && item.readAt === null));
    update([otherId], 'read', start, 'other');
    assert(get().unseenPostIds.includes(otherId));
  } finally { f.cleanup(); }
});

test('each newly published post has its own exposure window and old snapshots cannot mark it', () => {
  const f = fixture();
  try {
    const snapshot = get().unseenPostIds;
    update(snapshot, 'badge-seen');
    saveWhatsNewPost({ id: 'later-post', expectedRevision: null, date: '2026-10-08', title: 'New', summary: 'A new update.', paragraphs: ['Hello'], status: 'published', sourceFrom: null, sourceThrough: null }, 'operator');
    const retry = update(snapshot, 'badge-seen', later);
    assert.equal(retry.items.find(item => item.postId === 'later-post')!.firstBadgeSeenAt, null);
    const seen = update(['later-post'], 'badge-seen', later);
    assert.equal(seen.nextExpiryAt, expiry);
    const oldExpired = get(expiry);
    assert.deepEqual(oldExpired.unseenPostIds, ['later-post']);
    assert.equal(oldExpired.nextExpiryAt, '2026-10-08T20:00:00.000Z');
  } finally { f.cleanup(); }
});

test('legacy sequence and date acknowledgements preserve old reads without mutating or swallowing new posts', () => {
  const f = fixture();
  try {
    runWithLearnerId('reader', () => upsertLearnerParam('whats_new_seen_through_sequence', 5, start));
    const sequence = get(later);
    assert.equal(sequence.unseenPostIds.length, 7);
    assert.equal(sequence.items.filter(item => item.readAt === start).length, 5);
    runWithLearnerId('other', () => upsertLearnerParam('whats_new_seen_through_date', '2026-09-16', start));
    assert.deepEqual(get(later, 'other').items, sequence.items);
    assert.equal(f.db.prepare('SELECT count(*) n FROM learner_whats_new_attention').get()!.n, 0);
    const latest = sequence.items[0];
    assert.equal(latest.readAt, null);
    assert.equal(latest.firstBadgeSeenAt, null);
  } finally { f.cleanup(); }
});

test('invalid or withdrawn IDs reject whole snapshots without partial writes', () => {
  const f = fixture();
  try {
    saveWhatsNewPost({ id: 'draft', expectedRevision: null, date: '2026-10-08', title: 'Draft', summary: 'Private draft.', paragraphs: ['Hidden'], status: 'draft', sourceFrom: null, sourceThrough: null }, 'operator');
    for (const ids of [[firstId, 'missing'], [firstId, 'draft'], [firstId, firstId], []]) {
      assert.throws(() => update(ids, 'badge-seen'), WhatsNewInputError);
    }
    assert.equal(f.db.prepare('SELECT count(*) n FROM learner_whats_new_attention').get()!.n, 0);
    assert(!get().items.some(item => item.postId === 'draft'));
  } finally { f.cleanup(); }
});

function inFreshProcess(dir: string, request: unknown, now: string): Promise<WhatsNewAttention> {
  const code = `
    import { openDatabase, setDb } from './server/db/connection.ts';
    import { runWithLearnerId } from './server/db/learner-context.ts';
    import { getWhatsNewAttention, updateWhatsNewAttention } from './server/db/whats-new-attention.ts';
    const db = openDatabase(process.env.ATTENTION_TEST_DB);
    setDb(db);
    const request = JSON.parse(process.env.ATTENTION_TEST_REQUEST);
    const state = runWithLearnerId('reader', () => request === null
      ? getWhatsNewAttention(process.env.ATTENTION_TEST_NOW)
      : updateWhatsNewAttention(request, process.env.ATTENTION_TEST_NOW));
    process.stdout.write(JSON.stringify(state)); db.close();
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], {
      env: { ...process.env, ATTENTION_TEST_DB: path.join(dir, 'app.db'), ATTENTION_TEST_REQUEST: JSON.stringify(request), ATTENTION_TEST_NOW: now },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) { reject(new Error(stderr)); return; }
      try { resolve(JSON.parse(stdout) as WhatsNewAttention); } catch (error) { reject(error); }
    });
  });
}

test('concurrent connections, retries and fresh processes keep the first committed timestamps', async () => {
  const f = fixture();
  try {
    const request = { postIds: [firstId], kind: 'badge-seen' };
    const states = await Promise.all([inFreshProcess(f.dir, request, start), inFreshProcess(f.dir, request, later)]);
    const stored = get().items.find(item => item.postId === firstId)!;
    assert([start, later].includes(stored.firstBadgeSeenAt!));
    assert(states.every(state => state.items.find(item => item.postId === firstId)!.firstBadgeSeenAt === stored.firstBadgeSeenAt));
    await Promise.all([
      inFreshProcess(f.dir, { postIds: [otherId], kind: 'badge-seen' }, start),
      inFreshProcess(f.dir, { postIds: [otherId], kind: 'read' }, later),
    ]);
    const mixed = get().items.find(item => item.postId === otherId)!;
    assert.equal(mixed.firstBadgeSeenAt, start);
    assert.equal(mixed.readAt, later);
    update([firstId], 'read', expiry);
    const restarted = await inFreshProcess(f.dir, null, afterDaysAway);
    assert.deepEqual(restarted.items, get(afterDaysAway).items);
    assert.equal(restarted.items.find(item => item.postId === firstId)!.readAt, expiry);
  } finally { f.cleanup(); }
});

test('attention migration preserves prior data, starts empty, repeats safely and matches fresh schema', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blog-attention-upgrade-'));
  createBaselineFixture(dir);
  const db = new DatabaseSync(path.join(dir, 'app.db'));
  db.function('current_learner_id', () => 'reader');
  const fresh = fixture();
  try {
    const index = schemaMigrations.findIndex(m => m.id === 'app_schema:0031_whats_new_attention');
    assert(index > 0);
    migrateDatabase(db, schemaMigrations.slice(0, index));
    db.prepare('INSERT INTO learners (learner_id, display_name, created_at) VALUES (?, ?, ?)').run('reader', 'Preserved', start);
    db.prepare('INSERT INTO learner_params VALUES (?, ?, ?, ?)').run('reader', 'whats_new_seen_through_sequence', '5', start);
    const posts = db.prepare('SELECT * FROM whats_new_posts ORDER BY post_id').all();
    const history = db.prepare('SELECT * FROM whats_new_post_revisions ORDER BY post_id, revision').all();
    const params = db.prepare('SELECT * FROM learner_params').all();
    assert.deepEqual(migrateDatabase(db), schemaMigrations.slice(index).map(migration => migration.id));
    assert.deepEqual(db.prepare('SELECT * FROM whats_new_posts ORDER BY post_id').all(), posts);
    assert.deepEqual(db.prepare('SELECT * FROM whats_new_post_revisions ORDER BY post_id, revision').all(), history);
    assert.deepEqual(db.prepare('SELECT * FROM learner_params').all(), params);
    assert.equal(db.prepare('SELECT count(*) n FROM learner_whats_new_attention').get()!.n, 0);
    assert.deepEqual(migrateDatabase(db), []);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    const sql = "SELECT name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name";
    assert.deepEqual(db.prepare(sql).all(), fresh.db.prepare(sql).all());
    assert.throws(() => db.prepare('INSERT INTO learner_whats_new_attention VALUES (?, ?, ?, ?)').run('missing', firstId, start, null), /FOREIGN KEY/);
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); fresh.cleanup(); }
});
