import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WordHistoryTray } from '../src/features/vocabulary-ui/WordHistoryTray.tsx';
import type { VocabularySessionHistoryWord } from '../src/features/vocabulary-ui/types.ts';

test('covered tray labels shuffle actions and queued work, excluding merely encountered words', () => {
  const words: VocabularySessionHistoryWord[] = [
    { word: { id: 'a',hanzi: '鼓舞' },status: 'covered',active: false,canResume: true },
    { word: { id: 'b',hanzi: '馋' },status: 'covered',active: false,queued: true,canResume: false },
    { word: { id: 'c',hanzi: '藤椒' },status: 'open',active: true,canResume: true },
    { word: { id: 'd',hanzi: '泡沫' },status: 'left',active: false,canResume: true },
  ];
  const html = renderToStaticMarkup(createElement(WordHistoryTray,{ words,busy: false,onResume: () => {} }));
  assert.match(html,/Covered in this session/);
  assert.match(html,/2 words/);
  assert.match(html,/鼓舞\. Covered in this session\. Shuffle back in for extra practice/);
  assert.doesNotMatch(html,/>Shuffle back in<\/span>/);
  assert.match(html,/馋\. Covered in this session\. Queued for extra practice/);
  assert.match(html,/disabled=""[^>]*aria-label="馋/);
  assert.doesNotMatch(html,/藤椒|泡沫|Earlier in this session|Practise again/);
});
