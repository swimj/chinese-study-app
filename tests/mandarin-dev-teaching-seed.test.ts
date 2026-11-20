import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { wordContentFixtures } from '../src/features/introduction-lab/samples.ts';

test('Mandarin dev seed respects stash-only defaults and seeds unopened shared lessons', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mandarin-teaching-seed-'));
  process.env.APP_MODE = 'dev';
  process.env.APP_AUTH_MODE = 'trusted_local';
  process.env.APP_STUDY_PROFILE = 'mandarin';
  process.env.APP_DATA_DIR = dataDir;
  process.env.APP_SEED_DATA_PATH = path.resolve('server/seeds/mandarin-dev.json');
  const db = await import('../server/db.ts');
  const { getDb } = await import('../server/db/connection.ts');
  const composition = await import('../server/vocabulary/composition.ts');
  const { buildUnstudiedAdmissionSeedSource } = await import('../server/db/unstudied-admission.ts');
  try {
    const studyDayKey = new Date().toISOString().slice(0, 10);
    const admittedNewWordIds = () => {
      const limit = composition.vocabularyDailyNewWordLimit();
      return composition.planVocabularyNewWords({
        limit, seed: buildUnstudiedAdmissionSeedSource(studyDayKey, limit), now: new Date().toISOString(),
      }).newWordIds;
    };
    assert.deepEqual(db.getLearningPolicy(), {
      dailyNewWordLimit: 5, unstudiedAdmissionSource: 'stash_only',
    });
    assert.equal(admittedNewWordIds().length, 0, 'empty stash never falls back to diet');
    for (const { content, teaching } of wordContentFixtures) {
      const library = db.getWordIntroductionLibrary(content.word.wordId);
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
