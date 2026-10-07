import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeTeachingBeats, normalizePracticeRehearsals, normalizeTeachingPackage } from '../server/word-content/authoring.ts';
import { wordContentFixtures } from './fixtures/word-content.ts';
import { materializeTeachingPackage } from '../src/domain/word-content/materialize.ts';

const { content, teaching } = wordContentFixtures[0]!;
const practice = { rehearsals: [{ id: 'phrase', stimulus: {
  kind: 'phrase_cloze', frame: 'An authored phrase.', text: '请先____。',
} }] };

test('independent teaching and practice normalize into the same immutable package as combined authoring', () => {
  const beats = normalizeTeachingBeats({ beats: teaching.beats }, content);
  const rehearsals = normalizePracticeRehearsals(practice, content);
  const combined = normalizeTeachingPackage({ beats: teaching.beats, ...practice }, content, 'assembled');
  assert.deepEqual(combined.beats, beats);
  assert.deepEqual(combined.rehearsals, rehearsals);
  assert.ok(Object.isFrozen(beats));
  assert.ok(Object.isFrozen(rehearsals));
  assert.equal(materializeTeachingPackage(combined, [content]).rehearsals[0].stimulus.text,
    'An authored phrase.\n请先____。');
});

test('independent teaching rejects bad source references and duplicate beats before practice exists', () => {
  assert.throws(() => normalizeTeachingBeats({ beats: [
    { id: 'bad', parts: [{ kind: 'example', exampleId: 'absent', field: 'sentence' }] },
  ] }, content), /Unknown example/);
  assert.throws(() => normalizeTeachingBeats({ beats: [teaching.beats[0], teaching.beats[0]] }, content), /duplicate/);
  assert.throws(() => normalizeTeachingBeats({ beats: teaching.beats, rehearsals: [] }, content), /unsupported/);
});

test('independent practice rejects missing exercises, duplicate IDs, and target leaks', () => {
  assert.throws(() => normalizePracticeRehearsals({ rehearsals: [] }, content), /at least one/);
  assert.throws(() => normalizePracticeRehearsals({ rehearsals: [practice.rehearsals[0], practice.rehearsals[0]] }, content), /duplicate/);
  assert.throws(() => normalizePracticeRehearsals({ rehearsals: [{ id: 'leak', stimulus: {
    kind: 'direct_text', text: content.word.hanzi,
  } }] }, content), /exposes/);
});
