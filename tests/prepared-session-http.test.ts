import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { wordContentFixtures } from './fixtures/word-content.ts';

test('session entry hydrates lessons; open and complete stay model-free and defer study credit', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'prepared-session-http-'));
  process.env.APP_MODE = 'study'; process.env.APP_AUTH_MODE = 'trusted_local';
  process.env.APP_LEARNER_ID = 'prepared-session'; process.env.APP_DATA_DIR = directory;
  const db = await import('../server/db.ts');
  const { getDb, closeDbConnection } = await import('../server/db/connection.ts');
  const { createApp } = await import('../server/index.ts');
  const { createWordPreparationWorker } = await import('../server/word-content/preparation-worker.ts');
  const { getWordPreparationWork } = await import('../server/db/preparation-work.ts');
  const sql = getDb();
  const fixture = wordContentFixtures[0]!;
  const lexical = fixture.content.word;
  const id = 'session-word';
  sql.prepare(`INSERT INTO lexical_words (id, hanzi, traditional, pinyin, meaning, meanings_json, examples_json, priority, created_at)
    VALUES (?, ?, ?, ?, 'meaning', '["meaning"]', '[]', 10, '2026-10-01T00:00:00.000Z')`)
    .run(id, lexical.hanzi, lexical.traditional, lexical.pinyin);
  db.setDailyNewWordLimit(1);
  let calls = 0;
  const worker = createWordPreparationWorker({ provider: {
    model: 'fake', isConfigured: () => true,
    async generateBootstrap() { calls++; return { uses: fixture.content.uses, examples: fixture.content.examples }; },
    async generateTeaching() { calls++; return { beats: fixture.teaching.beats,
      rehearsals: [{ id: 'rehearse', stimulus: { kind: 'direct_text', text: 'Recall this expression.' } }] }; },
    async generateReview() { throw new Error('Review must wait for durable study'); },
  } });
  const app = createApp({ frontendDistPath: null, wakeWordPreparation: worker.wake, canPrepareWords: () => true });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const post = (url: string, body: object) => fetch(`${base}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    assert.equal((await post('/api/session-payload', { studyDayKey: 'bad' })).status, 400);
    assert.equal((await fetch(`${base}/api/learning-policy/daily-new-word-limit`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dailyNewWordLimit: 21 }) })).status, 400);
    const response = await post('/api/session-payload', { studyDayKey: '2026-10-01' });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(payload.buckets.unstudied.map((word: { id: string }) => word.id), [id]);
    assert.equal(payload.preparation.pending, false);
    const introduction = payload.buckets.introductions[id];
    assert.ok(introduction.selectedPackageId);
    assert.equal(calls, 2);
    assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM learner_word_introduction_events').get()!.n, 0);
    for (const action of ['open', 'complete']) {
      const result = await post(`/api/words/${id}/introduction/${action}`, { packageId: introduction.selectedPackageId });
      assert.equal(result.status, 200);
    }
    assert.equal(calls, 2);
    assert.equal(getWordPreparationWork(id, 'review'), null);
    assert.equal(sql.prepare('SELECT status FROM words WHERE id = ?').get(id)!.status, 'unstudied');
    const again = await post('/api/session-payload', { studyDayKey: '2026-10-01' });
    assert.equal((await again.json()).buckets.introductions[id].selectedPackageId, introduction.selectedPackageId);
    assert.equal(calls, 2);
    await worker.stop();
    db.completeUnstudiedWordSession(id, '2026-10-01');
    assert.equal(getWordPreparationWork(id, 'review')?.status, 'queued');
  } finally {
    await worker.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    closeDbConnection(); fs.rmSync(directory, { recursive: true, force: true });
  }
});
