import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import type { WordContentDocument } from '../src/domain/word-content/types.ts';
import { assertSchemaCurrent, migrateDatabase, schemaMigrations } from '../server/db/migrations.ts';
import { createBaselineFixture } from './helpers/baseline-database.ts';

type DbModule = typeof import('../server/db.ts');
let dir = '';
let db: DbModule;
let sqlite: DatabaseSync;
const wordId = 'word-review';
const content: WordContentDocument = {
  schemaVersion: 1, id: 'review-source',
  word: { wordId, hanzi: '你好', traditional: null, pinyin: 'nǐ hǎo' },
  uses: [{ id: 'use', label: 'greeting', notes: [], exampleIds: ['example'] }],
  examples: [{ id: 'example', text: '你好！', translation: 'Hello!', pronunciation: 'nǐ hǎo' }],
};

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'canonical-review-'));
  const old = { mode: process.env.APP_MODE, dir: process.env.APP_DATA_DIR, auth: process.env.APP_AUTH_MODE };
  process.env.APP_MODE = 'study'; process.env.APP_DATA_DIR = dir; process.env.APP_AUTH_MODE = 'clerk';
  try {
    db = await import(`${pathToFileURL(path.resolve('server/db.ts')).href}?review-content=${Date.now()}`);
  } finally {
    for (const [key, value] of [
      ['APP_MODE', old.mode], ['APP_DATA_DIR', old.dir], ['APP_AUTH_MODE', old.auth],
    ] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
  db.bootstrapLearner({ learnerId: 'learner-a' });
  db.bootstrapLearner({ learnerId: 'learner-b' });
  sqlite = new DatabaseSync(path.join(dir, 'app.db'));
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.function('current_learner_id', () => 'learner-a');
  sqlite.prepare(`INSERT INTO lexical_words
    (id,hanzi,traditional,pinyin,meaning,meanings_json,examples_json,priority,created_at)
    VALUES (?,'你好',NULL,'nǐ hǎo','hello','["hello"]','[]',10,'2026-09-25T00:00:00.000Z')`)
    .run(wordId);
  db.runWithLearnerId('learner-a', () => db.saveWordContentDocument(content, 'fake'));
});

after(() => { sqlite?.close(); if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

test('review claim publishes canonical shared exercise and supplement atomically once', () => {
  const now = new Date().toISOString();
  const expiry = new Date(Date.now() + 300_000).toISOString();
  const call = <T>(fn: () => T): T => db.runWithLearnerId('learner-a', fn);
  assert.equal(call(() => db.claimWordReviewPreparation(wordId, content.id, 'worker-a', now, expiry)), 'claimed');
  assert.equal(db.runWithLearnerId('learner-b', () =>
    db.claimWordReviewPreparation(wordId, content.id, 'worker-b', now, expiry)), 'busy');
  const acceptedAnswers = [{ wordId, hanzi: '你好', traditional: null }];
  const published = call(() => db.finishWordReviewPreparation(wordId, 'worker-a', [{
    cueType: 'circumstance', supplement: null,
    exercise: { id: 'review-circumstance', responseMode: 'hanzi_entry',
      contract: { kind: 'targeted_review', wordId }, instruction: '',
      stimulus: { kind: 'direct_text', text: 'You greet a friend at the door.' }, acceptedAnswers },
  }, {
    cueType: 'definition_gloss',
    supplement: { kind: 'example', supplementId: 'review-definition:supplement',
      englishFrame: 'Say hello:', example: { contentId: content.id, exampleId: 'example' } },
    exercise: { id: 'review-definition', responseMode: 'hanzi_entry',
      contract: { kind: 'targeted_review', wordId }, instruction: '',
      stimulus: { kind: 'direct_text', text: 'hello; a greeting' }, acceptedAnswers },
  }], 'fake-review-model'));
  assert.deepEqual(published, {
    cueIds: ['review-circumstance', 'review-definition'],
    supplementIds: ['review-definition:supplement'],
  });
  assert.equal(call(() => db.claimWordReviewPreparation(wordId, content.id, 'worker-c', now, expiry)), 'ready');
  assert.equal(call(() => db.getWordReviewPreparation(wordId))?.ready, true);
  const other = db.runWithLearnerId('learner-b', () =>
    db.getCanonicalReviewContent('production_cue', 'review-definition'));
  assert.equal(other?.kind, 'production_cue');
  assert.equal(other?.sourceWordContentId, content.id);
  assert.equal(other?.model, 'fake-review-model');
  assert.equal(db.runWithLearnerId('learner-b', () =>
    db.getCanonicalReviewContent('production_cue_supplement', 'review-definition:supplement'))?.kind,
  'production_cue_supplement');
  assert.throws(() => sqlite.exec(`UPDATE scoped_review_content_records SET model = 'changed'`), /immutable/);
  const publication = db.getSharedContentPublicationForContent('word_content', content.id);
  assert.ok(publication);
  db.quarantineSharedContentPublication({ publicationId: publication.publicationId,
    operatorId: 'operator-a', reason: 'incorrect' });
  assert.equal(call(() => db.isCanonicalReviewSourceEligible('production_cue', 'review-definition')), false);
  assert.equal(call(() => db.getCanonicalReviewContent('production_cue', 'review-definition'))?.kind,
    'production_cue');
  assert.equal(call(() => db.claimWordReviewPreparation(wordId, content.id, 'worker-d', now, expiry)), 'ready');
});

test('private embedded supplement source is invisible across learners', () => {
  const privateContent: WordContentDocument = {
    ...content, id: 'private-reflection-content',
    examples: [{ id: 'private-example', text: '你好，朋友。', translation: 'Hello, friend.', pronunciation: null }],
    uses: [{ id: 'private-use', label: 'greeting', notes: [], exampleIds: ['private-example'] }],
  };
  const task = sqlite.prepare('SELECT task_id FROM production_tasks WHERE word_id = ?')
    .get(wordId) as { task_id: string };
  sqlite.prepare(`INSERT INTO scoped_production_cue_supplements
    (supplement_id,task_id,cue_id,english_frame,example_sentence,example_translation,
     created_at,origin_invocation_id,content_scope,owner_learner_id)
    VALUES (?,?,NULL,'Say hello:','你好，朋友。','Hello, friend.',?,NULL,'learner','learner-a')`)
    .run('private-supplement', task.task_id, new Date().toISOString());
  db.runWithLearnerId('learner-a', () => db.appendCanonicalReviewSupplement({
    supplementId: 'private-supplement',
    source: { kind: 'example', supplementId: 'private-supplement', englishFrame: 'Say hello:',
      example: { contentId: privateContent.id, exampleId: 'private-example' } },
    contents: [privateContent],
  }));
  assert.equal(db.runWithLearnerId('learner-a', () =>
    db.getCanonicalReviewContent('production_cue_supplement', 'private-supplement'))?.kind,
  'production_cue_supplement');
  assert.equal(db.runWithLearnerId('learner-b', () =>
    db.getCanonicalReviewContent('production_cue_supplement', 'private-supplement')), null);
  assert.equal(sqlite.prepare(`SELECT 1 FROM shared_content_publications
    WHERE content_kind = 'production_cue_supplement' AND content_id = 'private-supplement'`).get(), undefined);
});

test('0012 to 0013 migration preserves existing publication and word content', () => {
  const upgradeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-content-upgrade-'));
  try {
    createBaselineFixture(upgradeDir);
    const upgrade = new DatabaseSync(path.join(upgradeDir, 'app.db'));
    try {
      upgrade.exec('PRAGMA foreign_keys=ON');
      upgrade.function('current_learner_id', () => 'learner-a');
      migrateDatabase(upgrade, schemaMigrations.slice(0, -1));
      upgrade.prepare(`INSERT INTO learners (learner_id,display_name,created_at,disabled_at)
        VALUES ('learner-a','A','2026-09-25T00:00:00.000Z',NULL)`).run();
      upgrade.prepare(`INSERT INTO lexical_words
        (id,hanzi,traditional,pinyin,meaning,meanings_json,examples_json,priority,created_at)
        VALUES (?,'你好',NULL,'nǐ hǎo','hello','["hello"]','[]',10,'2026-09-25T00:00:00.000Z')`).run(wordId);
      upgrade.prepare(`INSERT INTO shared_content_publications
        (publication_id,content_kind,content_id,learning_purpose_key,publication_status,published_at,status_updated_at)
        VALUES ('old-pub','word_content','old-content',?,'shared_trial',?,?)`)
        .run(wordId, '2026-09-25T00:00:00.000Z', '2026-09-25T00:00:00.000Z');
      upgrade.prepare(`INSERT INTO word_content_documents
        (content_id,word_id,content_json,model,created_at,publication_id)
        VALUES ('old-content',?,?, 'old-model',?,'old-pub')`)
        .run(wordId, JSON.stringify({ ...content, id: 'old-content' }), '2026-09-25T00:00:00.000Z');
      assert.deepEqual(migrateDatabase(upgrade), ['app_schema:0013_review_content_records']);
      assertSchemaCurrent(upgrade);
      assert.deepEqual(migrateDatabase(upgrade), []);
      assert.equal((upgrade.prepare(`SELECT model FROM word_content_documents WHERE content_id='old-content'`)
        .get() as { model: string }).model, 'old-model');
      assert.equal((upgrade.prepare(`SELECT content_id FROM shared_content_publications WHERE publication_id='old-pub'`)
        .get() as { content_id: string }).content_id, 'old-content');
    } finally { upgrade.close(); }
  } finally { fs.rmSync(upgradeDir, { recursive: true, force: true }); }
});
