import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CardInbox } from '../src/components/CardInbox.tsx';
import { completionDeadline } from '../src/features/session/useSessionCompletionFlow.ts';
import { vocabularyCompletionDeadline } from '../src/features/vocabulary-study/useVocabularyStudy.ts';

test('both card inbox styles preserve pager boundaries, busy state, content and empty state', () => {
  for (const sessionButtons of [false, true]) {
    const render = (index: number, count = 3, busy = false) => renderToStaticMarkup(createElement(CardInbox, {
      index, count, busy, sessionButtons, itemLabel: 'feedback', emptyCopy: 'Nothing here', onSelect: () => {},
      metadata: 'Word and date', children: 'Lesson content',
    }));
    const disabled = (html: string, direction: string) => /disabled/.test(html.match(new RegExp(`<button[^>]*aria-label="${direction} feedback"[^>]*>`))?.[0] ?? '');
    assert.equal(disabled(render(0), 'Previous'), true);
    assert.equal(disabled(render(0), 'Next'), false);
    assert.equal(disabled(render(2), 'Next'), true);
    assert.equal(disabled(render(1), 'Previous'), false);
    assert.equal(disabled(render(1, 3, true), 'Previous'), true);
    assert.equal(disabled(render(1, 3, true), 'Next'), true);
    assert.match(render(1), /2 \/ 3/);
    assert.match(render(1), /Word and date/);
    assert.match(render(1), /Lesson content/);
    assert.match(render(0, 0), /Nothing here/);
    assert.doesNotMatch(render(0, 0), /<button|Lesson content/);
  }
});

test('both completion adapters share clock-skew, expiry and partial-window cases', () => {
  assert.equal(completionDeadline, vocabularyCompletionDeadline);
  for (const resolve of [completionDeadline, vocabularyCompletionDeadline]) {
    // The adapter's runtime state carries additional fields; this test isolates the clock contract.
    const input = { closeAt: '2026-10-12T00:00:15Z', serverNow: '2026-10-12T00:00:00Z' };
    assert.equal(resolve(input, 1000), 16000);
    assert.equal(resolve({ ...input, serverNow: '2026-10-12T00:00:20Z' }, 1000), 1000);
    assert.equal(resolve({ ...input, serverNow: '2026-10-12T00:00:14.750Z' }, 1000), 1250);
  }
});
