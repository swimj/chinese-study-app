import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { WhatsNewPost } from '../src/domain/whats-new.ts';
import { countUnseenWhatsNew, latestWhatsNewSequence } from '../src/features/attention/whats-new-attention.ts';
import { WhatsNewPosts, WhatsNewFeed } from '../src/pages/WhatsNewFeed.tsx';

function post(id: string, publicationSequence: number): WhatsNewPost {
  return { id, publicationSequence, revision: 1, date: '2026-10-07', title: 'A useful update',
    paragraphs: ['First paragraph.', 'Second paragraph.'], status: 'published', sourceFrom: null,
    sourceThrough: null, updatedAt: '2026-10-07T00:00:00Z' };
}

test('same-day publications count separately and corrections preserve seen sequence', () => {
  const posts = [post('first', 1), post('second', 2), post('third', 3)];
  posts[0].revision = 4;
  assert.equal(countUnseenWhatsNew(posts, 1), 2);
  assert.equal(latestWhatsNewSequence(posts), 3);
  assert.equal(countUnseenWhatsNew(posts, null), 0);
  assert.equal(countUnseenWhatsNew(posts, 3), 0);
  assert.equal(latestWhatsNewSequence([]), 0);
});

test('learner posts render paragraphs as safe text with stable distinct article labels', () => {
  const first = post('first', 1);
  first.title = '<script>bad()</script>';
  first.paragraphs = ['<img src=x onerror=bad()>', 'Another paragraph.'];
  const html = renderToStaticMarkup(createElement(WhatsNewPosts, { posts: [first, post('second', 2)] }));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&lt;img'));
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('id="update-first"'));
  assert.ok(html.includes('id="update-second"'));
  assert.ok(html.includes('October 7, 2026'));
  assert.ok(html.includes('<p>Another paragraph.</p>'));
});

test('initial loading does not acknowledge an unloaded feed', () => {
  let acknowledged = false;
  const html = renderToStaticMarkup(createElement(WhatsNewFeed, { onDisplayed: async () => { acknowledged = true; } }));
  assert.ok(html.includes('Loading updates'));
  assert.equal(acknowledged, false);
});
