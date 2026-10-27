import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { VocabularyPersonalNotes } from '../src/features/vocabulary-study/VocabularyPersonalNotes.tsx';

test('vocabulary personal notes retain existing learner text without authoring controls', () => {
  const html = renderToStaticMarkup(createElement(VocabularyPersonalNotes, { word: { wordId: 'a', hanzi: '字', traditional: null,
    pinyin: 'zì', meaning: 'character', personalNotes: 'Remember <this>\nSecond line.' } }));
  assert.match(html, /Your notes/);
  assert.match(html, /Remember &lt;this&gt;\nSecond line/);
  assert.doesNotMatch(html, /Edit notes|<button|<textarea|role="dialog"/);
});

test('words without notes have no authoring entry point or empty notes section', () => {
  const html = renderToStaticMarkup(createElement(VocabularyPersonalNotes, { word: { wordId: 'a', hanzi: '字', traditional: null,
    pinyin: 'zì', meaning: 'character' } }));
  assert.equal(html, '');
});
