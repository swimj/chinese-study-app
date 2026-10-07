import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { WhatsNewPost } from '../src/domain/whats-new.ts';
import { WhatsNewPosts, WhatsNewFeed } from '../src/pages/WhatsNewFeed.tsx';
import { HomeUpdates, UpdatePreviews } from '../src/pages/HomeUpdates.tsx';
import { activeWhatsNewPostIds } from '../src/features/attention/whats-new-attention.ts';
import { WHATS_NEW_BADGE_WINDOW_MS, type WhatsNewAttention } from '../src/domain/whats-new-attention.ts';
import { observeVisibleElement } from '../src/features/attention/visible-element.ts';

function post(id: string, publicationSequence: number): WhatsNewPost {
  return { id, publicationSequence, revision: 1, date: '2026-10-07', title: 'A useful update',
    summary: 'A concise preview.', paragraphs: ['First paragraph.', 'Second paragraph.'], status: 'published', sourceFrom: null,
    sourceThrough: null, updatedAt: '2026-10-07T00:00:00Z' };
}

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
  const html = renderToStaticMarkup(createElement(WhatsNewFeed, { catalog: { posts: null, error: null, retry: () => {} }, onRead: async () => { acknowledged = true; } }));
  assert.ok(html.includes('Loading updates'));
  assert.equal(acknowledged, false);
});

test('home previews contain safe summary text and do not mark full posts read', () => {
  const preview = post('preview', 1);
  preview.summary = '<img src=x> Read a useful improvement.';
  let opened = false;
  const html = renderToStaticMarkup(createElement(UpdatePreviews, { posts: [preview], onOpenPost: () => { opened = true; } }));
  assert.match(html, /&lt;img src=x&gt;/);
  assert.doesNotMatch(html, /First paragraph|Second paragraph|<img/);
  assert.match(html, /<button type="button"/);
  assert.equal(opened, false);
});

test('local badge expiry counts each window independently, leaving unexposed updates eligible', () => {
  const firstSeen = Date.parse('2026-10-07T00:00:00.000Z');
  const attention: WhatsNewAttention = {
    items: [
      { postId: 'old', firstBadgeSeenAt: new Date(firstSeen).toISOString(), readAt: null },
      { postId: 'new', firstBadgeSeenAt: new Date(firstSeen + 3600000).toISOString(), readAt: null },
      { postId: 'away', firstBadgeSeenAt: null, readAt: null },
      { postId: 'read', firstBadgeSeenAt: null, readAt: new Date(firstSeen).toISOString() },
    ],
    unseenPostIds: ['old', 'new', 'away', 'read'], nextExpiryAt: null, serverNow: new Date(firstSeen).toISOString(),
  };
  assert.deepEqual(activeWhatsNewPostIds(attention, firstSeen + WHATS_NEW_BADGE_WINDOW_MS - 1), ['old', 'new', 'away']);
  assert.deepEqual(activeWhatsNewPostIds(attention, firstSeen + WHATS_NEW_BADGE_WINDOW_MS), ['new', 'away']);
  assert.deepEqual(activeWhatsNewPostIds(attention, firstSeen + 7 * 86400000), ['away']);
});

test('exposure requires an intersecting element in a visible focused tab and cleans up listeners', (t) => {
  let visibilityState = 'hidden';
  let focused = false;
  let intersection: (entries: Array<{ isIntersecting: boolean; intersectionRatio: number }>) => void = () => {};
  let disconnected = false;
  const events = new Map<string, () => void>();
  const target = {
    addEventListener: (name: string, callback: () => void) => events.set(name, callback),
    removeEventListener: (name: string) => events.delete(name),
  };
  for (const name of ['document', 'window', 'IntersectionObserver']) {
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: undefined });
    t.after(() => { Reflect.deleteProperty(globalThis, name); });
  }
  t.mock.property(globalThis, 'document', { ...target, get visibilityState() { return visibilityState; }, hasFocus: () => focused });
  t.mock.property(globalThis, 'window', target);
  t.mock.property(globalThis, 'IntersectionObserver', class {
    constructor(callback: typeof intersection) { intersection = callback; }
    observe() {}
    disconnect() { disconnected = true; }
  });
  let count = 0;
  const stop = observeVisibleElement({} as HTMLElement, () => { count++; });
  intersection([{ isIntersecting: true, intersectionRatio: 1 }]);
  assert.equal(count, 0, 'background mounting is not exposure');
  visibilityState = 'visible';
  events.get('visibilitychange')!();
  assert.equal(count, 0, 'unfocused window is not exposure');
  focused = true;
  events.get('focus')!();
  assert.equal(count, 1);
  intersection([{ isIntersecting: false, intersectionRatio: 0 }]);
  events.get('focus')!();
  assert.equal(count, 1, 'hidden navigation during study is not exposure');
  stop();
  assert.equal(events.size, 0);
  assert.equal(disconnected, true);
});


test('Home and the archive immediately render the app-owned catalog when reopened', () => {
  const catalog = { posts: [post('retained', 1)], error: null, retry: () => {} };
  for (let visit = 0; visit < 2; visit++) {
    const home = renderToStaticMarkup(createElement(HomeUpdates, {
      catalog, onOpenPost: () => {}, onViewAll: () => {},
    }));
    const archive = renderToStaticMarkup(createElement(WhatsNewFeed, { catalog }));
    assert.match(home, /A concise preview/);
    assert.match(archive, /First paragraph/);
    assert.doesNotMatch(home + archive, /Loading updates/);
  }
});

test('both catalog views retain an explicit retry after a failed load', () => {
  const catalog = { posts: null, error: 'Network unavailable', retry: () => {} };
  const home = renderToStaticMarkup(createElement(HomeUpdates, {
    catalog, onOpenPost: () => {}, onViewAll: () => {},
  }));
  const archive = renderToStaticMarkup(createElement(WhatsNewFeed, { catalog }));
  assert.match(home, /Try again/);
  assert.match(archive, /Retry loading updates/);
  assert.doesNotMatch(home + archive, /Loading updates/);
});
