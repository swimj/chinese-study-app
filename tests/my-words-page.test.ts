import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { test } from 'node:test';
import { MyWordsPage, type MyWordsPageProps } from '../src/pages/MyWordsPage.tsx';
import type { MyWord } from '../src/domain/my-words.ts';

const waiting: MyWord = {
  word: { id: 'word', hanzi: '今天', traditional: null, pinyin: 'jīntiān',
    meaning: 'today', meanings: ['today', 'this day'], personalNotes: 'From a book', examples: [],
    status: 'unstudied', priority: 0, createdAt: '2026-01-01T00:00:00Z', learningStreak: 0,
    lastLearningSuccessOn: null, lastLearningCoveredOn: null },
  lastStudiedAt: null, personalUpdatedAt: '2026-01-02T00:00:00Z',
};
function render(overrides: Partial<MyWordsPageProps>) {
  return renderToStaticMarkup(createElement(MyWordsPage, {
    view: 'personal', query: '', words: [waiting], selectedId: null, loading: false,
    error: null, hasMore: false, scrollTop: 0, onViewChange: () => {}, onQueryChange: () => {},
    onSelect: () => {}, onLoadMore: () => {}, onRetry: () => {}, onScroll: () => {}, ...overrides,
  }));
}

test('waiting personal words show their stage and full details without invented study or addition dates', () => {
  const markup = render({ selectedId: 'word' });
  assert.match(markup, /Not yet studied/);
  assert.match(markup, /This word is waiting for study/);
  assert.match(markup, /this day/);
  assert.match(markup, /From a book/);
  assert.match(markup, /aria-controls="my-word-detail"/);
  assert.doesNotMatch(markup, /First studied|Last added|Jan 2/);
});

test('studied legacy words explicitly disclose missing dates', () => {
  const markup = render({ view: 'recent', selectedId: 'word', words: [{ ...waiting, word: { ...waiting.word, status: 'review' } }] });
  assert.match(markup, /In review/);
  assert.match(markup, /Study date not recorded/);
  assert.match(markup, /Not recorded/);
  assert.doesNotMatch(markup, /mastered/i);
});

test('collection empty states distinguish no history from no search match or a failed request', () => {
  assert.match(render({ view: 'recent', words: [] }), /Once you begin studying/);
  assert.match(render({ words: [] }), /Add words in Stash/);
  assert.match(render({ words: [], query: 'missing' }), /No matching words in this collection/);
  const failed = render({ words: [], error: 'Network unavailable' });
  assert.match(failed, /role="alert"/);
  assert.match(failed, /Try again/);
  assert.doesNotMatch(failed, /Add words in Stash/);
});
