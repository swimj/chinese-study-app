import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { annotationWords, buildUiAnnotationSeed } from '../server/seeds/ui-annotation-data.ts';

function prepare(dataDir: string, extraArgs: string[] = []) {
  return spawnSync(process.execPath, ['--import', 'tsx', 'scripts/prepare-ui-fixtures.ts', `--data-dir=${dataDir}`, ...extraArgs], {
    encoding: 'utf8', env: { ...process.env, APP_MODE: 'study', APP_AUTH_MODE: 'clerk',
      APP_STUDY_PROFILE: 'french', APP_LEARNER_ID: 'inherited-learner', APP_SEED_DATA_PATH: '/nonexistent/seed.json' },
  });
}

test('fixture dates follow creation time across UTC month/year boundaries', () => {
  for (const now of ['2026-01-01T00:01:00.000Z', '2031-04-01T23:59:00.000Z']) {
    const seed = buildUiAnnotationSeed(new Date(now));
    const yesterday = new Date(Date.parse(now) - 86_400_000).toISOString();
    const review = seed.words.find(word => word.id === annotationWords.review)!;
    assert.equal(review.lastLearningSuccessOn, new Date(Date.parse(now) - 2 * 86_400_000).toISOString().slice(0, 10));
    for (const [index, wordId] of annotationWords.learning.entries()) {
      const word = seed.words.find(word => word.id === wordId)!;
      assert.equal(word.status, 'learning');
      assert.equal(word.learningStreak, index);
      assert.equal(word.lastLearningCoveredOn, yesterday.slice(0, 10));
    }
    const skills = seed.wordSkillStates.filter(row => row.wordId === annotationWords.review);
    assert.deepEqual(skills.map(row => row.skillId).sort(), ['production', 'recognition']);
    assert.ok(skills.every(row => row.nextDueAt === yesterday));
  }
});
