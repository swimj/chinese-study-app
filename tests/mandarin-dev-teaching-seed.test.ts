import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { wordContentFixtures } from '../src/features/introduction-lab/samples.ts';

test('default Mandarin dev seed admits all six authored lessons through ordinary study', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mandarin-teaching-seed-'));
  process.env.APP_MODE = 'dev';
  process.env.APP_AUTH_MODE = 'trusted_local';
  process.env.APP_STUDY_PROFILE = 'mandarin';
  process.env.APP_DATA_DIR = dataDir;
  process.env.APP_SEED_DATA_PATH = path.resolve('server/seeds/mandarin-dev.json');
  const db = await import('../server/db.ts');
  const { getDb } = await import('../server/db/connection.ts');
  try {
    const payload = db.getSessionPayload(new Date().toISOString().slice(0, 10));
    assert.deepEqual(payload.buckets.unstudied.map((word) => word.id),
      wordContentFixtures.map(({ content }) => content.word.wordId));
    assert.ok(payload.buckets.review.length > 0, 'existing review fixtures remain available');
    for (const { content, teaching } of wordContentFixtures) {
      const library = payload.buckets.introductions?.[content.word.wordId];
      assert.equal(library?.selectedPackageId, teaching.id);
      assert.equal(library?.completed, false);
      assert.deepEqual(db.getSharedWordIntroductionPreparation(content.word.wordId), {
        contentId: content.id, packageId: teaching.id, activeStage: null,
      });
    }
    assert.equal(getDb().prepare('SELECT COUNT(*) AS count FROM learner_word_introduction_events').get()?.count, 0);
  } finally {
    getDb().close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
