import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { test } from 'node:test';
import { MyWordsPage, type MyWordsPageProps } from '../src/pages/MyWordsPage.tsx';
import {
  ALL_MY_WORDS_STATUSES,
  myWordsRecentLapseSinceDay,
  normalizeMyWordsStatuses,
  toggleMyWordsStatus,
  type MyWord,
} from '../src/domain/my-words.ts';

const waiting: MyWord = {
  word: { id: 'word', hanzi: '今天', traditional: null, pinyin: 'jīntiān',
    meaning: 'today', meanings: ['today', 'this day'], personalNotes: 'From a book', examples: [],
    status: 'unstudied', priority: 0, createdAt: '2026-01-01T00:00:00Z', learningStreak: 0,
    lastLearningSuccessOn: null, lastLearningCoveredOn: null },
  lastStudiedAt: null, personalUpdatedAt: '2026-01-02T00:00:00Z',
};
function render(overrides: Partial<MyWordsPageProps>) {
  return renderToStaticMarkup(createElement(MyWordsPage, {
    view: 'personal', query: '', statuses: [], recentLapses: false,
    words: [waiting], currentDeck: null, selectedId: null, loading: false,
    error: null, hasMore: false, total: 1, scrollTop: 0, onViewChange: () => {}, onQueryChange: () => {},
    onToggleStatus: () => {}, onToggleRecentLapses: () => {},
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
  assert.match(render({ view: 'recent', words: [], total: 0 }), /Once you begin studying/);
  assert.match(render({ words: [], total: 0 }), /Add words in Stash/);
  assert.match(render({ words: [], total: 0, query: 'missing' }), /No matching words in this collection/);
  assert.match(render({ words: [], total: 0, recentLapses: true }), /No matching words in this collection/);
  assert.match(render({ words: [], total: 0, statuses: ['learning'] }), /No matching words in this collection/);
  const failed = render({ words: [], total: 0, error: 'Network unavailable' });
  assert.match(failed, /role="alert"/);
  assert.match(failed, /Try again/);
  assert.doesNotMatch(failed, /Add words in Stash/);
});

test('stage chips sit beside Recent lapses; Recently studied disables unstudied only', () => {
  const personal = render({});
  assert.match(personal, /aria-label="Word stage"/);
  assert.match(personal, />Not yet studied</);
  assert.match(personal, />Learning</);
  assert.match(personal, />In review</);
  assert.match(personal, />Recent lapses</);
  assert.match(personal, /aria-pressed="false"[^>]*>Not yet studied</);
  assert.match(personal, /aria-pressed="false"[^>]*>Learning</);
  assert.match(personal, /aria-pressed="false"[^>]*>In review</);
  assert.doesNotMatch(personal, /disabled=""[^>]*>Not yet studied</);
  const recent = render({ view: 'recent' });
  assert.match(recent, /disabled=""[^>]*>Not yet studied</);
  assert.doesNotMatch(recent, /disabled=""[^>]*>Recent lapses</);
  assert.match(render({ recentLapses: true }), /aria-pressed="true"[^>]*>Recent lapses</);
  assert.match(render({ statuses: ['learning'] }), /aria-pressed="true"[^>]*>Learning</);
});

test('current deck is available only with placement and includes unseen words in its detail', () => {
  assert.doesNotMatch(render({}), /<option value="deck"/);
  assert.match(render({ currentDeck: { label: 'HSK 2' } }), /<option value="deck">Current deck/);
  const markup = render({ view: 'deck', currentDeck: { label: 'HSK 3 · part 1' }, selectedId: 'word',
    words: [{ ...waiting, personalUpdatedAt: null }] });
  assert.match(markup, /Not yet studied/);
  assert.match(markup, /You haven’t studied this word yet/);
  assert.doesNotMatch(markup, /This word is waiting for study|Study date not recorded/);
});

test('current deck empty states distinguish an empty deck, unmatched search, and removed placement', () => {
  assert.match(render({ view: 'deck', currentDeck: { label: 'HSK 2' }, words: [], total: 0 }), /There are no words in your current deck/);
  assert.match(render({ view: 'deck', currentDeck: { label: 'HSK 2' }, words: [], total: 0, query: 'missing' }), /No matching words in this collection/);
  const unavailable = render({ view: 'deck', words: [], total: 0, query: 'missing' });
  assert.match(unavailable, /<option value="deck" disabled="" selected="">Current deck unavailable/);
  assert.match(unavailable, /Current deck is unavailable. Choose another collection/);
  assert.doesNotMatch(unavailable, /Settings/);
  assert.doesNotMatch(unavailable, /Add words in Stash|No matching words in this collection/);
});

test('muted count appears on bounded collections and lapses, not recency pagination', () => {
  assert.match(render({}), /1 word/);
  assert.match(render({ words: [], total: 0 }), /0 words/);
  assert.doesNotMatch(render({ view: 'recent' }), /1 word|0 words|\d+ words/);
  assert.match(render({ view: 'recent', recentLapses: true, words: [], total: 3 }), /3 words/);
  assert.match(render({ view: 'deck', currentDeck: { label: 'HSK 2' }, words: [], total: 12 }), /12 words/);
  assert.doesNotMatch(render({ view: 'deck', words: [], total: 0 }), /0 words/);
});

test('status chip helpers start from implicit all, isolate on first click, and drop unstudied-only on Recently studied', () => {
  assert.deepEqual(toggleMyWordsStatus([], 'learning'), ['learning']);
  assert.deepEqual(toggleMyWordsStatus([...ALL_MY_WORDS_STATUSES], 'learning'), ['learning']);
  assert.deepEqual(toggleMyWordsStatus(['learning'], 'learning'), []);
  assert.deepEqual(toggleMyWordsStatus(['learning'], 'review'), ['learning', 'review']);
  assert.deepEqual(normalizeMyWordsStatuses('recent', []), ['learning', 'review']);
  assert.deepEqual(normalizeMyWordsStatuses('recent', ['unstudied']), ['learning', 'review']);
  assert.deepEqual(normalizeMyWordsStatuses('personal', ['unstudied']), ['unstudied']);
  assert.equal(myWordsRecentLapseSinceDay('2026-09-16'), '2026-09-14');
});
