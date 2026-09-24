import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import type { TeachingPackage, WordContentDocument } from '../src/domain/word-content/types.ts';

type DbModule = typeof import('../server/db.ts');
let dir = '';
let sqlite: DatabaseSync;
let db: DbModule;
const wordId = 'learning-word';
const content: WordContentDocument = {
  schemaVersion: 1, id: 'learning-content',
  word: { wordId, hanzi: '你好', traditional: null, pinyin: 'nǐ hǎo' },
  uses: [{ id: 'use', label: 'greeting', notes: ['A friendly hello.'], exampleIds: ['example'] }],
  examples: [{ id: 'example', text: '你好！', translation: 'Hello!', pronunciation: 'nǐ hǎo' }],
};
const packageData: TeachingPackage = {
  schemaVersion: 1, id: 'learning-package', wordContentId: content.id,
  beats: [{ id: 'beat', parts: [{ kind: 'example', exampleId: 'example', field: 'sentence' }] }],
  rehearsals: [0, 1].map((index) => ({
    id: `rehearsal-${index}`, responseMode: 'hanzi_entry' as const,
    contract: { kind: 'target_rehearsal' as const, wordId },
    instruction: 'Write the greeting.',
    stimulus: { kind: 'direct_text' as const, text: index ? 'Say hello.' : 'Hello!' },
    acceptedAnswers: [{ wordId, hanzi: '你好', traditional: null }],
  })),
};

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'word-intro-session-'));
  const beforeEnv = { mode: process.env.APP_MODE, dir: process.env.APP_DATA_DIR, auth: process.env.APP_AUTH_MODE };
  process.env.APP_MODE = 'study';
  process.env.APP_DATA_DIR = dir;
  process.env.APP_AUTH_MODE = 'clerk';
  try {
    db = await import(`${pathToFileURL(path.resolve('server/db.ts')).href}?word-intro-session=${Date.now()}`);
  } finally {
    for (const [key, value] of [
      ['APP_MODE', beforeEnv.mode], ['APP_DATA_DIR', beforeEnv.dir], ['APP_AUTH_MODE', beforeEnv.auth],
    ] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
  db.bootstrapLearner({ learnerId: 'learner-a' });
  sqlite = new DatabaseSync(path.join(dir, 'app.db'));
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.function('current_learner_id', () => 'learner-a');
  sqlite.prepare(`INSERT INTO lexical_words
    (id, hanzi, traditional, pinyin, meaning, meanings_json, examples_json, priority, created_at)
    VALUES (?, '你好', NULL, 'nǐ hǎo', 'hello', '["hello"]', '[]', 10, '2026-01-01T00:00:00.000Z')`)
    .run(wordId);
  sqlite.prepare(`INSERT INTO learner_word_state (learner_id, word_id, status)
    VALUES ('learner-a', ?, 'learning')`).run(wordId);
  db.runWithLearnerId('learner-a', () => {
    db.saveWordContentDocument(content, 'fake');
    db.saveWordTeachingPackage(packageData, 'fake');
    db.pinWordTeachingPackage(wordId, packageData.id);
    db.completeWordTeachingPackage(wordId, packageData.id);
  });
});

after(() => {
  sqlite?.close();
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

test('learning composition freezes the selected content and one rotated rehearsal without changing progress', () => {
  const today = new Date().toISOString().slice(0, 10);
  const nextDay = new Date(Date.parse(`${today}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10);
  const before = sqlite.prepare('SELECT * FROM learner_word_state').all();
  const initialEvents = sqlite.prepare('SELECT * FROM learner_word_introduction_events').all();
  const first = db.runWithLearnerId('learner-a', () => db.getSessionPayload(today, { random: () => 0.5 })).buckets;
  const repeat = db.runWithLearnerId('learner-a', () => db.getSessionPayload(today, { random: () => 0.5 })).buckets;
  const next = db.runWithLearnerId('learner-a', () => db.getSessionPayload(nextDay, { random: () => 0.5 })).buckets;
  assert.deepEqual(first.learning.map((word) => word.id), [wordId]);
  assert.deepEqual(first.learningContent?.[wordId], content);
  assert.equal(first.learningRehearsals?.[wordId]?.contract.kind, 'target_rehearsal');
  assert.equal(first.learningRehearsals?.[wordId]?.acceptedAnswers[0].wordId, wordId);
  assert.equal(first.learningRehearsals?.[wordId]?.packageId, packageData.id);
  assert.equal(first.learningRehearsals?.[wordId]?.wordContentId, content.id);
  assert.equal(first.learningRehearsals?.[wordId]?.exerciseId, repeat.learningRehearsals?.[wordId]?.exerciseId);
  assert.notEqual(first.learningRehearsals?.[wordId]?.exerciseId, next.learningRehearsals?.[wordId]?.exerciseId);
  assert.deepEqual(sqlite.prepare('SELECT * FROM learner_word_state').all(), before);
  assert.deepEqual(sqlite.prepare('SELECT * FROM learner_word_introduction_events').all(), initialEvents);
});

test('shared introduction is not served as learning content before this learner completes it', () => {
  db.bootstrapLearner({ learnerId: 'learner-b' });
  sqlite.prepare(`INSERT INTO learner_word_state (learner_id, word_id, status)
    VALUES ('learner-b', ?, 'learning')`).run(wordId);
  const today = new Date().toISOString().slice(0, 10);
  const noPin = db.runWithLearnerId('learner-b', () => db.getSessionPayload(today)).buckets;
  assert.deepEqual(noPin.learning.map((word) => word.id), [wordId]);
  assert.equal(noPin.learningContent?.[wordId], undefined);
  assert.equal(noPin.learningRehearsals?.[wordId], undefined);
  db.runWithLearnerId('learner-b', () => db.pinWordTeachingPackage(wordId, packageData.id));
  const partial = db.runWithLearnerId('learner-b', () => db.getSessionPayload(today)).buckets;
  assert.equal(partial.learningContent?.[wordId], undefined);
  assert.equal(partial.learningRehearsals?.[wordId], undefined);
  db.runWithLearnerId('learner-b', () => db.completeWordTeachingPackage(wordId, packageData.id));
  const taught = db.runWithLearnerId('learner-b', () => db.getSessionPayload(today)).buckets;
  assert.equal(taught.learningContent?.[wordId]?.id, content.id);
  assert.equal(taught.learningRehearsals?.[wordId]?.packageId, packageData.id);
});

test('withdrawing source content removes both recognition and rehearsal from new sessions', () => {
  const publication = db.getSharedContentPublicationForContent('word_content', content.id);
  assert.ok(publication);
  db.quarantineSharedContentPublication({
    publicationId: publication.publicationId, operatorId: 'operator-a', reason: 'incorrect',
  });
  const today = new Date().toISOString().slice(0, 10);
  const buckets = db.runWithLearnerId('learner-a', () => db.getSessionPayload(today)).buckets;
  assert.deepEqual(buckets.learning.map((word) => word.id), [wordId]);
  assert.equal(buckets.learningContent?.[wordId], undefined);
  assert.equal(buckets.learningRehearsals?.[wordId], undefined);
});
