import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import type { TeachingPackage, WordContentDocument } from '../src/domain/word-content/types.ts';
import { assertSchemaCurrent, migrateDatabase, schemaMigrations } from '../server/db/migrations.ts';
import { createBaselineFixture } from './helpers/baseline-database.ts';

type DbModule = typeof import('../server/db.ts');
const content: WordContentDocument = {
  schemaVersion: 1,
  id: 'content-1',
  word: { wordId: 'word-1', hanzi: '你好', traditional: null, pinyin: 'nǐ hǎo' },
  uses: [{ id: 'use-1', label: 'a greeting', notes: ['Use it to say hello.'], exampleIds: ['example-1'] }],
  examples: [{ id: 'example-1', text: '你好！', translation: 'Hello!', pronunciation: 'nǐ hǎo' }],
};
const teaching: TeachingPackage = {
  schemaVersion: 1,
  id: 'package-1',
  wordContentId: content.id,
  beats: [{ id: 'beat-1', parts: [{ kind: 'example', exampleId: 'example-1', field: 'sentence' }] }],
  rehearsals: [{
    id: 'rehearsal-1', responseMode: 'hanzi_entry',
    contract: { kind: 'target_rehearsal', wordId: 'word-1' },
    instruction: 'Write the greeting.',
    stimulus: { kind: 'direct_text', text: 'Hello!' },
    acceptedAnswers: [{ wordId: 'word-1', hanzi: '你好', traditional: null }],
  }],
};
let dataDir = '';
let db: DbModule;
let sqlite: DatabaseSync;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'word-introductions-'));
  const previous = { mode: process.env.APP_MODE, dataDir: process.env.APP_DATA_DIR, auth: process.env.APP_AUTH_MODE };
  process.env.APP_MODE = 'study';
  process.env.APP_AUTH_MODE = 'clerk';
  process.env.APP_DATA_DIR = dataDir;
  try {
    db = await import(`${pathToFileURL(path.resolve('server/db.ts')).href}?intro=${Date.now()}`);
  } finally {
    for (const [key, value] of [
      ['APP_MODE', previous.mode], ['APP_DATA_DIR', previous.dataDir], ['APP_AUTH_MODE', previous.auth],
    ] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
  db.bootstrapLearner({ learnerId: 'learner-a' });
  db.bootstrapLearner({ learnerId: 'learner-b' });
  sqlite = new DatabaseSync(path.join(dataDir, 'app.db'));
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.function('current_learner_id', () => 'learner-a');
  sqlite.prepare(`
    INSERT INTO lexical_words
      (id, hanzi, traditional, pinyin, meaning, meanings_json, examples_json, priority, created_at)
    VALUES (?, ?, NULL, ?, ?, ?, '[]', 10, ?)
  `).run('word-1', '你好', 'nǐ hǎo', 'hello', '["hello"]', '2026-09-25T00:00:00.000Z');
  sqlite.prepare(`
    INSERT INTO lexical_word_meanings (id, word_id, position, text, created_at, updated_at)
    VALUES (?, ?, 0, ?, ?, ?)
  `).run('meaning-1', 'word-1', 'hello', '2026-09-25T00:00:00.000Z', '2026-09-25T00:00:00.000Z');
});

after(() => {
  sqlite?.close();
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

test('requires context, pins lexical forms, and publishes canonical immutable content and package', () => {
  assert.throws(() => db.getWordIntroductionLibrary('word-1'), /Learner context is required/);
  assert.equal(db.runWithLearnerId('learner-a', () => db.getWordIntroductionLibrary('missing')), null);
  assert.deepEqual(db.runWithLearnerId('learner-a', () => db.getIntroductionLexicalWord('word-1')),
    { wordId: 'word-1', hanzi: '你好', traditional: null, pinyin: 'nǐ hǎo', meanings: ['hello'] });
  assert.throws(() => db.runWithLearnerId('learner-a', () => db.saveWordContentDocument({
    ...content, word: { ...content.word, pinyin: 'wrong' },
  }, 'fake-model')), /lexical source/);
  const savedContent = db.runWithLearnerId('learner-a', () => db.saveWordContentDocument(content, 'fake-model'));
  const savedTeaching = db.runWithLearnerId('learner-a', () => db.saveWordTeachingPackage(teaching, 'fake-model'));
  assert.deepEqual(savedContent.content, content);
  assert.deepEqual(savedTeaching.teaching, teaching);
  assert.deepEqual(db.runWithLearnerId('learner-b', () => db.getWordIntroductionLibrary('word-1'))?.packages,
    [savedTeaching]);
  assert.equal(db.runWithLearnerId('learner-b', () => db.getWordIntroductionLibrary('word-1'))?.selectedPackageId,
    teaching.id);
  assert.equal(db.runWithLearnerId('learner-a', () => db.saveWordContentDocument(content, 'fake-model')).createdAt,
    savedContent.createdAt);
  assert.throws(() => db.runWithLearnerId('learner-a', () => db.saveWordContentDocument({
    ...content, examples: [{ ...content.examples[0], translation: 'Hi!' }],
  }, 'fake-model')), /different payload/);
  assert.throws(() => db.runWithLearnerId('learner-a', () => db.saveWordTeachingPackage({
    ...teaching, beats: [{ id: 'beat-1', parts: [{ kind: 'text', text: 'Changed' }] }],
  }, 'fake-model')), /different payload/);
  assert.throws(() => sqlite.exec("UPDATE word_content_documents SET model = 'changed'"), /immutable/);
  assert.throws(() => sqlite.exec('DELETE FROM word_teaching_packages'), /cannot be deleted/);
  assert.equal((sqlite.prepare(`SELECT publication_status AS status FROM shared_content_publications
    WHERE content_kind = 'teaching_package' AND content_id = ?`).get(teaching.id) as { status: string }).status,
  'shared_trial');
  assert.equal((sqlite.prepare(`SELECT COUNT(*) AS count FROM shared_content_publication_events
    WHERE reason = 'automatic validated word introduction publication'`).get() as { count: number }).count, 2);
});

test('private open and completion markers are idempotent and never alter study state', () => {
  const before = sqlite.prepare('SELECT * FROM learner_word_state').all();
  assert.throws(() => db.runWithLearnerId('learner-a', () => db.completeWordTeachingPackage('word-1', teaching.id)),
    /opened before completion/);
  db.runWithLearnerId('learner-a', () => db.pinWordTeachingPackage('word-1', teaching.id));
  db.runWithLearnerId('learner-a', () => db.pinWordTeachingPackage('word-1', teaching.id));
  db.runWithLearnerId('learner-a', () => db.completeWordTeachingPackage('word-1', teaching.id));
  db.runWithLearnerId('learner-a', () => db.completeWordTeachingPackage('word-1', teaching.id));
  assert.equal(db.runWithLearnerId('learner-a', () => db.getWordIntroductionLibrary('word-1'))?.completed, true);
  assert.equal(db.runWithLearnerId('learner-b', () => db.getWordIntroductionLibrary('word-1'))?.completed, false);
  assert.equal((sqlite.prepare('SELECT COUNT(*) AS count FROM learner_word_introduction_events').get() as { count: number }).count, 2);
  assert.deepEqual(sqlite.prepare('SELECT * FROM learner_word_state').all(), before);
  assert.throws(() => db.runWithLearnerId('learner-a', () => db.pinWordTeachingPackage('word-1', 'missing')),
    /Eligible teaching package not found/);
  assert.throws(() => sqlite.prepare(`INSERT INTO learner_word_introduction_events
    (event_id, learner_id, word_id, package_id, event_kind, occurred_at)
    VALUES ('forged', 'learner-b', 'word-1', 'package-1', 'opened', '2026-09-25T00:00:00.000Z')`).run(),
  /learner mismatch/);
});

test('withdrawal of source content hides package even from a completed learner', () => {
  const publication = db.getSharedContentPublicationForContent('word_content', content.id);
  assert.ok(publication);
  db.quarantineSharedContentPublication({ publicationId: publication.publicationId, operatorId: 'operator-a', reason: 'incorrect' });
  const library = db.runWithLearnerId('learner-a', () => db.getWordIntroductionLibrary('word-1'));
  assert.deepEqual(library?.contents, []);
  assert.deepEqual(library?.packages, []);
  assert.equal(library?.selectedPackageId, null);
  assert.equal(library?.completed, false);
});

test('per-word stage lease prevents duplicate generation and recovers an expired worker', () => {
  sqlite.prepare(`
    INSERT INTO lexical_words
      (id, hanzi, traditional, pinyin, meaning, meanings_json, examples_json, priority, created_at)
    VALUES (?, ?, NULL, ?, ?, ?, '[]', 10, ?)
  `).run('word-2', '你好', 'nǐ hǎo', 'hello', '["hello"]', '2026-09-25T00:00:00.000Z');
  const content2 = { ...content, id: 'content-2', word: { ...content.word, wordId: 'word-2' } };
  const teaching2 = {
    ...teaching, id: 'package-2', wordContentId: 'content-2',
    rehearsals: [{ ...teaching.rehearsals[0], contract: { kind: 'target_rehearsal' as const, wordId: 'word-2' },
      acceptedAnswers: [{ wordId: 'word-2', hanzi: '你好', traditional: null }] }],
  };
  const call = <T>(fn: () => T): T => db.runWithLearnerId('learner-a', fn);
  const now = new Date().toISOString();
  const future = new Date(Date.now() + 300_000).toISOString();
  assert.equal(call(() => db.claimWordIntroductionStage('word-2', 'bootstrap', 'worker-a', now, future)), 'claimed');
  assert.equal(db.runWithLearnerId('learner-b', () => (
    db.claimWordIntroductionStage('word-2', 'bootstrap', 'worker-b', now, future))), 'busy');
  call(() => db.releaseWordIntroductionStage('word-2', 'worker-b'));
  assert.equal(call(() => db.getWordIntroductionPreparation('word-2'))?.activeStage, 'bootstrap');
  call(() => db.releaseWordIntroductionStage('word-2', 'worker-a'));
  assert.equal(call(() => db.claimWordIntroductionStage('word-2', 'bootstrap', 'old-worker',
    '2026-01-01T00:00:00.000Z', '2026-01-01T00:01:00.000Z')), 'claimed');
  assert.equal(call(() => db.claimWordIntroductionStage('word-2', 'bootstrap', 'worker-new', now, future)), 'claimed');
  assert.throws(() => call(() => db.finishWordIntroductionBootstrap('word-2', 'old-worker', content2, 'fake')),
    /lease is not active/);
  call(() => db.finishWordIntroductionBootstrap('word-2', 'worker-new', content2, 'fake'));
  assert.equal(call(() => db.claimWordIntroductionStage('word-2', 'bootstrap', 'worker-c', now, future)), 'ready');
  assert.equal(call(() => db.getWordIntroductionPreparation('word-2'))?.contentId, 'content-2');
  assert.equal(call(() => db.claimWordIntroductionStage('word-2', 'teaching', 'teacher-a', now, future)), 'claimed');
  assert.throws(() => call(() => db.finishWordIntroductionTeaching('word-2', 'teacher-a',
    { ...teaching2, wordContentId: 'content-1' }, 'fake')), /prepared word content/);
  call(() => db.finishWordIntroductionTeaching('word-2', 'teacher-a', teaching2, 'fake'));
  assert.equal(call(() => db.claimWordIntroductionStage('word-2', 'teaching', 'teacher-b', now, future)), 'ready');
  assert.equal(call(() => db.getWordIntroductionPreparation('word-2'))?.packageId, 'package-2');
  assert.equal((sqlite.prepare(`SELECT COUNT(*) AS count FROM word_teaching_packages WHERE word_id = 'word-2'`)
    .get() as { count: number }).count, 1);
});

test('a withdrawn learner pin does not silently switch to another eligible package', () => {
  const alternative: TeachingPackage = {
    ...teaching, id: 'package-3', wordContentId: 'content-2',
    rehearsals: [{ ...teaching.rehearsals[0], id: 'rehearsal-3',
      contract: { kind: 'target_rehearsal', wordId: 'word-2' },
      acceptedAnswers: [{ wordId: 'word-2', hanzi: '你好', traditional: null }] }],
  };
  db.runWithLearnerId('learner-a', () => {
    db.saveWordTeachingPackage(alternative, 'fake');
    db.pinWordTeachingPackage('word-2', 'package-2');
  });
  const old = db.getSharedContentPublicationForContent('teaching_package', 'package-2');
  assert.ok(old);
  db.quarantineSharedContentPublication({
    publicationId: old.publicationId, operatorId: 'operator-a', reason: 'incorrect',
  });
  const pinned = db.runWithLearnerId('learner-a', () => db.getWordIntroductionLibrary('word-2'));
  assert.deepEqual(pinned?.packages.map((item) => item.teaching.id), ['package-3']);
  assert.equal(pinned?.selectedPackageId, null);
  assert.equal(pinned?.completed, false);
  assert.equal(db.runWithLearnerId('learner-b', () => db.getWordIntroductionLibrary('word-2'))?.selectedPackageId,
    'package-3');
});

test('0011 database migrates to 0012 preserving existing shared publications and fingerprints', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'word-intro-upgrade-'));
  try {
    createBaselineFixture(dir);
    const upgrade = new DatabaseSync(path.join(dir, 'app.db'));
    try {
      upgrade.exec('PRAGMA foreign_keys=ON');
      upgrade.function('current_learner_id', () => 'learner-a');
      const index = schemaMigrations.findIndex((migration) => migration.id === 'app_schema:0012_word_introduction_content');
      const through0012 = schemaMigrations.slice(0, index + 1);
      migrateDatabase(upgrade, schemaMigrations.slice(0, index));
      upgrade.prepare(`INSERT INTO shared_content_publications
        (publication_id, content_kind, content_id, learning_purpose_key,
         publication_status, published_at, status_updated_at)
        VALUES ('existing', 'pure_cue', 'old', 'old', 'available', ?, ?)`)
        .run('2026-09-25T00:00:00.000Z', '2026-09-25T00:00:00.000Z');
      // Existing data does not change the schema fingerprint.
      assert.deepEqual(migrateDatabase(upgrade, through0012), ['app_schema:0012_word_introduction_content']);
      assertSchemaCurrent(upgrade, through0012);
      assert.deepEqual(migrateDatabase(upgrade, through0012), []);
      assert.equal((upgrade.prepare(`SELECT publication_status AS status
        FROM shared_content_publications WHERE publication_id = 'existing'`).get() as { status: string }).status,
      'available');
    } finally { upgrade.close(); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
