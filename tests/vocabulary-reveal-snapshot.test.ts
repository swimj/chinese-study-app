import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, test } from 'node:test';
import { setDb } from '../server/db/connection.ts';
import { vocabularyRevealSnapshot } from '../server/vocabulary/reveal-snapshot.ts';
import type { VocabularyContent } from '../src/domain/vocabulary-content.ts';
import type { WordContentDocument } from '../src/domain/word-content/types.ts';

let db: DatabaseSync;
beforeEach(() => {
  db = new DatabaseSync(':memory:'); setDb(db);
  db.exec(`CREATE TABLE lexical_words(id TEXT,hanzi TEXT,traditional TEXT,pinyin TEXT,meaning TEXT);
    INSERT INTO lexical_words VALUES('a','馋',NULL,'chán','greedy; gluttonous'),('b','贪吃',NULL,'tān chī','gluttonous');
    CREATE TABLE senses(sense_id TEXT,word_id TEXT,description_json TEXT,status TEXT,version INTEGER,created_at TEXT,updated_at TEXT);
    CREATE TABLE word_content_documents(content_id TEXT,content_json TEXT);
    CREATE TABLE word_introduction_preparation(word_id TEXT,content_id TEXT);
    CREATE TABLE legacy_sense_imports(source_content_id TEXT,source_use_id TEXT,sense_id TEXT,imported_sense_version INTEGER);`);
});
afterEach(() => { setDb(null); db.close(); });
function exercise(overrides: Partial<VocabularyContent> = {}): VocabularyContent {
  return { contentId: 'exercise',version: 1,createdAt: '2026-01-01',updatedAt: '2026-01-01',
    kind: 'exercise',payloadVersion: 1,body: { prompt: 'A desire for tasty food' },exerciseType: 'definition',skill: 'production',
    exerciseRole: 'general',assessment: {},answers: [{ wordId: 'a',acceptedForms: ['馋'] }],
    words: [{ wordId: 'a',relation: 'target' }],accessScope: 'shared',availability: 'active',originKind: 'human',...overrides } as VocabularyContent;
}
function document(): WordContentDocument {
  return { schemaVersion: 1,id: 'source',word: { wordId: 'a',hanzi: '馋',traditional: null,pinyin: 'chán' },
    uses: [{ id: 'food',label: 'A desire for tasty food',notes: ['Desire, rather than eating quantity.'],exampleIds: ['example'] }],
    examples: [{ id: 'example',text: '我有点馋。',translation: 'I am craving something tasty.',pronunciation: null }] };
}
test('freezes exact mapped sense and version separately from a broad dictionary gloss', () => {
  const description = { label: 'A desire for tasty food',notes: ['Desire, rather than eating quantity.'],extra: { retained: true } };
  db.prepare('INSERT INTO senses VALUES(?,?,?, ?,?,?,?)').run('food','a',JSON.stringify(description),'retired',3,'2026-01-01','2026-01-02');
  const result = vocabularyRevealSnapshot(exercise({ words: [{ wordId: 'a',relation: 'target',senseId: 'food' }] }));
  assert.deepEqual(result.revealWords?.[0].sense, { senseId: 'food',version: 3,description });
  assert.equal(result.revealWords?.[0].meaning, 'greedy; gluttonous');
  db.exec(`UPDATE senses SET description_json='"changed"',version=4; UPDATE lexical_words SET meaning='changed';`);
  assert.deepEqual(result.revealWords?.[0].sense?.description, description);
  assert.equal(result.revealWords?.[0].meaning, 'greedy; gluttonous');
});
test('an unmapped exercise retains each accepted answer word without inventing a sense', () => {
  const result = vocabularyRevealSnapshot(exercise({ exerciseType: 'pure_cue',answers: [
    { wordId: 'a',acceptedForms: ['馋'] },{ wordId: 'b',acceptedForms: ['贪吃'] }] }));
  assert.deepEqual(result.revealWords?.map(word => [word.wordId,word.sense]), [['a',undefined],['b',undefined]]);
  assert.equal(result.bootstrapReveal, undefined);
});
test('definition and recognition freeze a pinned bootstrap reveal and full word reference without providers', () => {
  const source = document();
  db.prepare('INSERT INTO word_content_documents VALUES(?,?)').run(source.id,JSON.stringify(source));
  for (const skill of ['production','recognition']) {
    const result = vocabularyRevealSnapshot(exercise({ skill,body: { prompt: 'Recall',source: { bootstrapContentId: source.id } } }), {
      completedTeachingRecognitionAttempts: skill === 'recognition' ? 2 : undefined,
      fallbackIntroduction: () => { throw new Error('Pinned source must win'); },
    });
    assert.deepEqual(result.wordReference, source);
    assert.deepEqual(result.bootstrapReveal, { contentId: source.id,useId: 'food',exampleId: 'example',
      englishFrame: source.uses[0].label,exampleSentence: source.examples[0].text,exampleTranslation: source.examples[0].translation });
  }
});
test('published introduction fallback is frozen while imported supplement material stays intact', () => {
  const source = document();
  db.prepare('INSERT INTO word_content_documents VALUES(?,?)').run(source.id,JSON.stringify(source));
  const content = exercise({ body: { prompt: 'Recall',reveal: { englishFrame: 'Kept supplement' } } });
  const result = vocabularyRevealSnapshot(content,{ fallbackIntroduction: () => ({ bootstrapContentId: source.id }) });
  assert.deepEqual(result.wordReference, source);
  assert.deepEqual(content.body, { prompt: 'Recall',reveal: { englishFrame: 'Kept supplement' } });
});
test('broken mapped identities fail loudly instead of silently substituting a dictionary sense', () => {
  assert.throws(() => vocabularyRevealSnapshot(exercise({ words: [{ wordId: 'a',relation: 'target',senseId: 'missing' }] })), /Missing mapped reveal sense/);
});
test('mapped source use chooses its own example while a sense without source association retains only the full reference', () => {
  const source = document();
  const expanded = { ...source,uses: [...source.uses,{ id: 'tempted',label: 'Have an appetite tempted',notes: [],exampleIds: ['tempted-example'] }],
    examples: [...source.examples,{ id: 'tempted-example',text: '看得我都馋了。',translation: 'Seeing it made my mouth water.',pronunciation: null }] };
  db.prepare('INSERT INTO word_content_documents VALUES(?,?)').run(source.id,JSON.stringify(expanded));
  const description = { label: 'Have an appetite tempted',source: { contentId: source.id,useId: 'tempted' } };
  db.prepare('INSERT INTO senses VALUES(?,?,?,?,?,?,?)').run('tempted','a',JSON.stringify(description),'active',1,'2026-01-01','2026-01-01');
  const content = exercise({ words: [{ wordId: 'a',relation: 'target',senseId: 'tempted' }] });
  const mapped = vocabularyRevealSnapshot(content,{ now: new Date(0),completedTeachingRecognitionAttempts: 0 });
  assert.equal(mapped.bootstrapReveal?.useId,'tempted');
  assert.equal(mapped.bootstrapReveal?.exampleSentence,expanded.examples[1].text);
  db.prepare('UPDATE senses SET description_json=?').run(JSON.stringify({label:'Have an appetite tempted'}));
  const unassociated = vocabularyRevealSnapshot(content,{ fallbackIntroduction: () => ({bootstrapContentId:source.id}) });
  assert.deepEqual(unassociated.wordReference,expanded);
  assert.equal(unassociated.bootstrapReveal,undefined);
});

test('direct-text teaching clozes never acquire a rotating bootstrap example through their definition type', () => {
  for (const prompt of ['Mom keeps reminding me.\n妈妈在旁边____。', '我有点（ ）。']) {
    const content = exercise({ exerciseRole: 'teaching', body: { prompt, source: { bootstrapContentId: 'unrelated' } } });
    const result = vocabularyRevealSnapshot(content, { fallbackIntroduction: () => { throw new Error('Must not seek an unrelated example'); } });
    assert.equal(result.bootstrapReveal, undefined);
    assert.equal(result.wordReference, undefined);
    assert.equal(result.revealWords?.[0].meaning, 'greedy; gluttonous');
  }
});
