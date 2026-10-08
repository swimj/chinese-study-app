import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

test('fresh annotation command creates ready real-session content and refuses reuse', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-fixtures-'));
  const dataDir = path.join(root, 'first');
  try {
    const result = prepare(dataDir);
    assert.equal(result.status, 0, result.stderr);
    const manifest = JSON.parse(fs.readFileSync(path.join(dataDir, 'fixture-manifest.json'), 'utf8'));
    assert.equal(manifest.learnerId, 'dev-learner');
    const before = fs.readFileSync(path.join(dataDir, 'app.db'));
    const reused = prepare(dataDir);
    assert.notEqual(reused.status, 0);
    assert.deepEqual(fs.readFileSync(path.join(dataDir, 'app.db')), before, 'existing database is untouched');
    const unsupported = prepare(path.join(root, 'bad'), ['--mode=study']);
    assert.notEqual(unsupported.status, 0);
    assert.equal(fs.existsSync(path.join(root, 'bad')), false);
    const repeat = prepare(path.join(root, 'second'));
    assert.equal(repeat.status, 0, repeat.stderr);

    Object.assign(process.env, { APP_MODE: 'dev', APP_AUTH_MODE: 'trusted_local', APP_STUDY_PROFILE: 'mandarin',
      APP_LEARNER_ID: 'dev-learner', APP_DATA_DIR: dataDir, APP_SEED_DATA_PATH: path.join(dataDir, 'annotation-seed.json') });
    const db = await import('../server/db.ts');
    const { closeDbConnection } = await import('../server/db/connection.ts');
    try {
      assert.deepEqual(db.validateStudySchedulerStateInvariants(), []);
      const buckets = db.getSessionPayload(manifest.preparedAt.slice(0, 10), { random: () => 0.5 }).buckets;
      assert.deepEqual(new Set(buckets.unstudied.map(word => word.id)), new Set(annotationWords.introduction));
      const topWords = db.getPrioritizedUnstudiedWords().words.filter(entry => entry.forceTop).map(entry => entry.word.id);
      assert.deepEqual(new Set(topWords), new Set(annotationWords.introduction));
      for (const wordId of annotationWords.introduction) {
        assert.equal(buckets.introductions?.[wordId]?.completed, false);
        assert.ok(buckets.introductions?.[wordId]?.selectedPackageId);
      }
      for (const [index, wordId] of annotationWords.learning.entries()) {
        assert.equal(buckets.learning.find(word => word.id === wordId)?.learningStreak, index);
        assert.ok(buckets.learningContent?.[wordId]);
        assert.ok(buckets.learningRehearsals?.[wordId]);
        assert.equal(db.getWordIntroductionLibrary(wordId)?.completed, true);
      }
      const review = buckets.review.filter(item => item.targetWordId === annotationWords.review);
      const dueSkills = db.getWordSkillStates().filter(row => row.wordId === annotationWords.review);
      assert.deepEqual(dueSkills.map(row => row.skillId).sort(), ['production', 'recognition']);
      assert.ok(dueSkills.every(row => row.nextDueAt !== null && row.nextDueAt < manifest.preparedAt));
      assert.ok(review.some(item => item.actionKind === 'production' && item.production?.cueId));
      const debrief = db.getLatestSessionDebrief();
      assert.equal(debrief?.status, 'ready');
      assert.equal(debrief?.notes?.length, 5);
      assert.equal(db.listQueuedSessionDebriefs().length, 0);
      const posts = db.listWhatsNewPosts();
      assert.equal(posts.filter(post => post.id.startsWith('annotation-')).length, 2);
      assert.ok(posts.slice(0, 2).every(post => post.id.startsWith('annotation-')));
    } finally { closeDbConnection(); }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
