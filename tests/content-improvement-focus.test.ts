import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rehearsalFocus, replaceFocusedRehearsal, focusedRehearsalPreview } from '../src/pages/content-improvement-focus.ts';
import type { ContentExercise, TeachingPackage, WordContentDocument } from '../src/domain/word-content/types.ts';

const content: WordContentDocument = { schemaVersion: 1, id: 'content', word: { wordId: 'word', hanzi: '由此', traditional: null, pinyin: 'yóu cǐ' }, uses: [{ id: 'use', label: 'From this', notes: [], exampleIds: ['example'] }], examples: [{ id: 'example', text: '由此可见。', translation: 'From this we can see.', pronunciation: null }] };
const exercise: ContentExercise = { id: 'r1', responseMode: 'hanzi_entry', contract: { kind: 'target_rehearsal', wordId: 'word' }, instruction: '', stimulus: { kind: 'direct_text', text: 'From this.' }, acceptedAnswers: [{ wordId: 'word', hanzi: '由此', traditional: null }] };
const pkg: TeachingPackage = { schemaVersion: 1, id: 'package', wordContentId: content.id, beats: [{ id: 'beat', parts: [{ kind: 'text', text: 'Teaching stays intact.' }] }], rehearsals: [exercise, { ...exercise, id: 'r2' }] };
const proposed = { content, package: pkg };

test('focused edits preserve source, teaching, other rehearsals, and identities', () => {
  const next = replaceFocusedRehearsal(proposed, 'package/r1', { ...exercise, stimulus: { kind: 'phrase_cloze', frame: 'From this, we can see…', text: '____可见。' } });
  assert.equal(next.content, content);
  const nextPackage = next.package as TeachingPackage;
  assert.equal(nextPackage.id, pkg.id);
  assert.equal(nextPackage.beats, pkg.beats);
  assert.equal(nextPackage.rehearsals[1], pkg.rehearsals[1]);
  assert.equal(rehearsalFocus(next, 'package/r1').acceptedAnswers, exercise.acceptedAnswers);
  const preview = focusedRehearsalPreview(next, 'package/r1') as { stimulus: { text: string } };
  assert.equal(preview.stimulus.text, 'From this, we can see…\n____可见。');
  assert.equal(exercise.stimulus.kind, 'direct_text');
});

test('referenced example cloze resolves the source and optional frame', () => {
  const next = replaceFocusedRehearsal(proposed, 'package/r1', { ...exercise, stimulus: { kind: 'example_cloze', example: { contentId: content.id, exampleId: 'example' }, blanks: [{ start: 0, end: 2, expectedText: '由此' }], frame: 'From this, we can see…' } });
  const preview = focusedRehearsalPreview(next, 'package/r1') as { stimulus: { text: string } };
  assert.match(preview.stimulus.text, /____可见。/);
  assert.match(preview.stimulus.text, /From this/);
});

test('unfinished text remains editable and missing focus fails explicitly', () => {
  const next = replaceFocusedRehearsal(proposed, 'package/r1', { ...exercise, stimulus: { kind: 'direct_text', text: '' } });
  assert.equal(rehearsalFocus(next, 'package/r1').stimulus.kind, 'direct_text');
  assert.throws(() => focusedRehearsalPreview(next, 'package/r1'));
  assert.throws(() => rehearsalFocus(proposed, 'package/missing'), /missing/);
});

test('focused form renders the selected cue and answers without unrelated teaching', async () => {
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { FocusedRehearsalFields, RehearsalPreview } = await import('../src/pages/ContentImprovementWorkspace.tsx');
  const next = replaceFocusedRehearsal(proposed, 'package/r1', { ...exercise, stimulus: { kind: 'example_cloze', example: { contentId: content.id, exampleId: 'example' }, blanks: [{ start: 0, end: 2, expectedText: '由此' }], frame: null } });
  const markup = renderToStaticMarkup(createElement(FocusedRehearsalFields, { proposed: next, sourceId: 'package/r1', onChange: () => {} }));
  assert.match(markup, /English frame \(optional\)/);
  assert.match(markup, /由此/);
  assert.doesNotMatch(markup, /Teaching stays intact/);
  const preview = renderToStaticMarkup(createElement(RehearsalPreview, { value: next, sourceId: 'package/r1' }));
  assert.match(preview, /____可见。/);
  assert.doesNotMatch(preview, /Preview unavailable/);
});
