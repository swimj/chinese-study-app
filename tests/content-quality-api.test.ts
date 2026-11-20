import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type http from 'node:http';
import { after, before, test } from 'node:test';

const envKeys = ['APP_MODE', 'APP_DATA_DIR', 'APP_LEARNER_ID', 'APP_AUTH_MODE', 'APP_OPERATOR_CLERK_USER_IDS'] as const;
const previous = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
let dir: string;
let server: http.Server;
let base: string;
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'content-quality-api-'));
  Object.assign(process.env, { APP_MODE: 'study', APP_DATA_DIR: dir, APP_LEARNER_ID: 'quality-api', APP_AUTH_MODE: 'trusted_local', APP_OPERATOR_CLERK_USER_IDS: '' });
  const { createApp } = await import('../server/index.ts');
  server = createApp({ frontendDistPath: null }).listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const address = server.address(); assert(address && typeof address === 'object');
  base = `http://127.0.0.1:${address.port}`;
});
after(async () => {
  if (server?.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  for (const key of envKeys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});
test('historical ratings require operator access and retain the snapshot without identifying learners', async () => {
  const { getDb } = await import('../server/db/connection.ts');
  const db = getDb();
  db.exec(`INSERT INTO content_quality_items VALUES
    ('historical-content', 'definition_fallback', 'w', 'w', 'Hello', '{"promptText":"Hello"}', '{}', '2026-09-01');
    INSERT INTO learner_content_quality_encounters VALUES ('quality-api', 'encounter', 'historical-content', '2026-09-01');
    INSERT INTO learner_content_quality_ratings VALUES ('quality-api', 'historical-content', 'up', '2026-09-01');`);
  for (const [method, path] of [
    ['POST', '/api/content-quality/encounters'], ['PUT', '/api/content-quality/ratings'],
    ['GET', '/api/operator/content-quality'],
  ]) {
    assert.equal((await fetch(base + path, { method })).status, 404, path);
  }
  const route = `${base}/api/operator/content-quality/ratings`;
  assert.equal((await fetch(route)).status, 403);
  process.env.APP_OPERATOR_CLERK_USER_IDS = 'trusted_local';
  const response = await fetch(route);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ratings: [{
      contentKey: 'historical-content', kind: 'definition_fallback', sourceId: 'w', title: 'Hello',
      content: { promptText: 'Hello' }, rating: 'up', updatedAt: '2026-09-01',
    }],
    totalRatings: 1,
  });
});
