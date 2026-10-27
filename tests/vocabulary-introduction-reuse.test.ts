import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { setDb } from '../server/db/connection.ts';
import { vocabularyTeachingSource } from '../server/vocabulary/teaching-source.ts';
import { vocabularyIntroductionMaterial } from '../src/features/vocabulary-study/VocabularyIntroduction.tsx';
import { materializeTeachingPackage } from '../src/domain/word-content/materialize.ts';
import { wordContentFixtures } from './fixtures/word-content.ts';
import type { VocabularySessionJson } from '../src/domain/vocabulary-session.ts';
const json = (value: unknown): VocabularySessionJson => JSON.parse(JSON.stringify(value)) as VocabularySessionJson;
const fixture = wordContentFixtures[0]!;
const word = { ...fixture.content.word, meaning: 'dictionary fallback' };

test('new study adapts exact materialized beats and pinned recap without substituting lexical meaning', () => {
  const original = materializeTeachingPackage(fixture.teaching, [fixture.content]);
  const material = json({ beats: original.beats, bootstrapContentId: original.wordContentId, sourcePackageId: original.packageId });
  const adapted = vocabularyIntroductionMaterial(material, word, json(fixture.content));
  assert.deepEqual(adapted.snapshot.beats, original.beats);
  assert.deepEqual(adapted.content, fixture.content);
  assert.equal(adapted.snapshot.rehearsals.length, 0);
});

test('independently authored text beats retain their wording and have a lexical recap fallback', () => {
  const { snapshot, content } = vocabularyIntroductionMaterial({ beats: [{ id: 'one', text: 'Authored teaching.' }] }, word);
  assert.equal(snapshot.beats[0]!.parts[0]!.text, 'Authored teaching.');
  assert.equal(content.uses[0]!.label, word.meaning);
  assert.deepEqual(content.examples, []);
  assert.throws(() => vocabularyIntroductionMaterial({ beats: [] }, word), /no teaching beats/);
});

test('serving resolves the exact pinned bootstrap source rather than another document for the same word', () => {
  const db = new DatabaseSync(':memory:');
  setDb(db);
  try {
    db.exec('CREATE TABLE word_content_documents(content_id TEXT PRIMARY KEY,content_json TEXT)');
    db.prepare('INSERT INTO word_content_documents VALUES (?,?)').run(fixture.content.id, JSON.stringify(fixture.content));
    db.prepare('INSERT INTO word_content_documents VALUES (?,?)').run('other-source', JSON.stringify({ ...fixture.content, id: 'other-source', uses: [] }));
    assert.deepEqual(vocabularyTeachingSource({ bootstrapContentId: fixture.content.id }), fixture.content);
    assert.equal(vocabularyTeachingSource({ beats: [{ text: 'Independent teaching' }] }), undefined);
    assert.throws(() => vocabularyTeachingSource({ bootstrapContentId: 'missing' }), /source document is missing/);
  } finally { db.close(); }
});
