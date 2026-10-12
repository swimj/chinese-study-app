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

test('only unresolved draft chips expose an accessible discard action', async () => {
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { ImprovementCaseChip } = await import('../src/pages/ContentImprovementWorkspace.tsx');
  const item = { status: 'draft', source: { title: 'Rehearsal: 由此' }, revision: 1 } as import('../src/domain/content-improvement.ts').ImprovementCase;
  const render = (status: typeof item.status) => renderToStaticMarkup(createElement(ImprovementCaseChip, { item: { ...item, status }, selected: true, busy: false, onOpen: () => {}, onDiscard: () => {} }));
  assert.match(render('draft'), /aria-label="Discard draft: Rehearsal: 由此"/);
  assert.doesNotMatch(render('applied'), /Discard draft/);
  assert.doesNotMatch(render('closed'), /Discard draft/);
});

test('exercise preview presents cue then expected forms without answer-testing controls', async () => {
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { ContentPreview, RehearsalPreview } = await import('../src/pages/ContentImprovementWorkspace.tsx');
  const production = renderToStaticMarkup(createElement(ContentPreview, { value: { cueText: 'Squat (exercise).', acceptedWordIds: ['squat'] }, answerSource: { acceptedAnswers: [{ wordId: 'squat', hanzi: '深蹲', traditional: '深蹲' }] } }));
  assert.match(production, /Expected answers/);
  assert.match(production, /深蹲/);
  assert(production.indexOf('Squat (exercise).') < production.indexOf('深蹲'));
  assert.doesNotMatch(production, /<input|<button|Try an answer|Check preview answer|Reveal content/);
  assert.doesNotMatch(production, /深蹲 \/ 深蹲/);
  const rehearsal = renderToStaticMarkup(createElement(RehearsalPreview, { value: proposed, sourceId: 'package/r1' }));
  assert.match(rehearsal, /Expected answers/);
  assert.match(rehearsal, /由此/);
  assert.doesNotMatch(rehearsal, /<input|<button/);
});

test('unvalidated changed answer identities do not display stale source answers', async () => {
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { ContentPreview } = await import('../src/pages/ContentImprovementWorkspace.tsx');
  const markup = renderToStaticMarkup(createElement(ContentPreview, { value: { cueText: 'A different action.', acceptedWordIds: ['changed'] }, answerSource: { acceptedAnswers: [{ wordId: 'old', hanzi: '深蹲' }] } }));
  assert.doesNotMatch(markup, /深蹲/);
  assert.match(markup, /Validate the draft to resolve expected answers/);
  const resolved = renderToStaticMarkup(createElement(ContentPreview, { value: { stimulus: { text: 'An idea you cannot let go of.' }, acceptedAnswers: [{ wordId: 'idea', hanzi: '执念', traditional: '執念' }] } }));
  assert.match(resolved, /执念 \/ 執念/);
});
