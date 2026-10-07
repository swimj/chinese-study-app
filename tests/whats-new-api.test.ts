import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type http from 'node:http';
import { after, before, test } from 'node:test';
const keys = ['APP_MODE', 'APP_DATA_DIR', 'APP_LEARNER_ID', 'APP_AUTH_MODE', 'APP_OPERATOR_CLERK_USER_IDS'] as const;
const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
let dir: string; let server: http.Server; let base: string;
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blog-api-'));
  Object.assign(process.env, { APP_MODE: 'study', APP_DATA_DIR: dir, APP_LEARNER_ID: 'blog-reader', APP_AUTH_MODE: 'trusted_local', APP_OPERATOR_CLERK_USER_IDS: '' });
  const { createApp } = await import('../server/index.ts');
  server = createApp({ frontendDistPath: null }).listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const address = server.address(); assert(address && typeof address === 'object'); base = `http://127.0.0.1:${address.port}`;
});
after(async () => {
  if (server?.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});
const write = (route: string, body: unknown, method = 'PUT') => fetch(`${base}/api/${route}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const post = { id: 'api-post', expectedRevision: null, date: '2026-10-07', title: 'Update', paragraphs: ['Hello'], status: 'draft', sourceFrom: null, sourceThrough: null };
test('blog reader feed excludes drafts, operator writes need allowlist, revision conflicts are explicit', async () => {
  assert.equal((await fetch(`${base}/api/operator/whats-new`)).status, 403);
  assert.equal((await write('operator/whats-new', post)).status, 403);
  process.env.APP_OPERATOR_CLERK_USER_IDS = 'trusted_local';
  assert.equal((await write('operator/whats-new', post)).status, 200);
  let feed = await (await fetch(`${base}/api/whats-new`)).json(); assert.equal(feed.posts.length, 12);
  assert.equal((await write('operator/whats-new', { ...post, id: 'large-draft', paragraphs: Array(10).fill('你'.repeat(10000)) })).status, 200, 'valid UTF-8 payload above the default JSON parser bound');
  const drafts = await (await fetch(`${base}/api/operator/whats-new`)).json(); assert.equal(drafts.posts.length, 14);
  assert.equal((await write('operator/whats-new', { ...post, expectedRevision: 1, status: 'published' })).status, 200);
  assert.equal((await write('operator/whats-new', { ...post, expectedRevision: 1 })).status, 409);
  const concurrent = await Promise.all(['First writer', 'Second writer'].map(title => write('operator/whats-new', { ...post, expectedRevision: 2, status: 'published', title })));
  assert.deepEqual(concurrent.map(response => response.status).sort(), [200, 409], 'only one writer can save the same revision');
  feed = await (await fetch(`${base}/api/whats-new`)).json(); assert.equal(feed.posts[0].id, 'api-post');
  const { getDb } = await import('../server/db/connection.ts');
  assert.equal(getDb().prepare("SELECT actor_id FROM whats_new_post_revisions WHERE post_id='api-post' LIMIT 1").get()!.actor_id, 'blog-reader');
  for (const changes of [{ date: '2026-99-01' }, { unknown: true }, { sourceFrom: 'abcdef' }]) assert.equal((await write('operator/whats-new', { ...post, ...changes })).status, 400);
});
test('sequence endpoint initializes newcomers, is monotonic, and bounds cursors to publication history', async () => {
  assert.equal((await (await fetch(`${base}/api/attention-badges`)).json()).whatsNewSeenThroughSequence, null);
  let response = await write('whats-new-seen-sequence', { throughSequence: 13, mode: 'ensure' }, 'POST');
  assert.equal(response.status, 200); assert.equal((await response.json()).whatsNewSeenThroughSequence, 13);
  response = await write('whats-new-seen-sequence', { throughSequence: 0, mode: 'seen' }, 'POST'); assert.equal((await response.json()).whatsNewSeenThroughSequence, 13);
  for (const body of [{ throughSequence: 14, mode: 'seen' }, { throughSequence: -1, mode: 'seen' }, { throughSequence: 1.1, mode: 'seen' }, { throughSequence: 1, mode: 'other' }]) assert.equal((await write('whats-new-seen-sequence', body, 'POST')).status, 400);
});
