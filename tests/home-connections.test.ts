import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SessionDebrief } from '../src/domain/session-debrief.ts';
import { HomeConnections } from '../src/features/session/HomeConnections.tsx';
import { beginHomeConnectionsVisit, connectionExcerpt, homeConnectionNeighbors,
  readHomeConnectionsPreference, receiveHomeConnections, toggleHomeConnections } from '../src/features/session/home-connections-state.ts';

const ready: SessionDebrief = { sessionId: 'completed-session', completedAt: '2026-10-07T00:00:00.000Z',
  status: 'ready', exerciseCount: 20, error: null, attemptCount: 1,
  notes: Array.from({ length: 10 }, (_, i) => ({ text: `Exact paragraph ${i + 1}\n中文 <literal text>`, refs: ['w1'], followUp: 'Do not display this' })) };
const pending: SessionDebrief = { ...ready, status: 'running', notes: null };

test('new completed result opens large, and a ready-result toggle persists across reloads', () => {
  let view = receiveHomeConnections(beginHomeConnectionsVisit(null), ready);
  assert.equal(view.expanded, true);
  assert.equal(view.introduced, true);
  view = toggleHomeConnections(view, true);
  assert.equal(receiveHomeConnections(beginHomeConnectionsVisit(view), ready).expanded, false);
  assert.equal(receiveHomeConnections(beginHomeConnectionsVisit(null), { ...ready, sessionId: 'next-completed-session' }).expanded, true);
});

test('minimizing pending holds through polling, but an unseen ready batch opens on the next document visit', () => {
  const view = toggleHomeConnections(receiveHomeConnections(beginHomeConnectionsVisit(null), pending), false);
  assert.equal(view.expanded, false);
  assert.equal(view.introduced, false);
  assert.equal(receiveHomeConnections(view, ready).expanded, false);
  assert.equal(receiveHomeConnections(beginHomeConnectionsVisit(view), ready).expanded, true);
  const nextVisit = receiveHomeConnections(beginHomeConnectionsVisit(view), pending);
  assert.equal(nextVisit.expanded, false);
  assert.equal(receiveHomeConnections(nextVisit, ready).expanded, true);
});

test('proactively reopening pending connections consumes the deferred introduction', () => {
  const minimized = toggleHomeConnections(beginHomeConnectionsVisit(null), false);
  const reopened = toggleHomeConnections(minimized, false);
  const minimizedAgain = toggleHomeConnections(reopened, false);
  assert.equal(minimizedAgain.introduced, true);
  assert.equal(receiveHomeConnections(beginHomeConnectionsVisit(minimizedAgain), ready).expanded, false);
});

test('empty or failed results do not count as introducing ready notes; retry retains same visit choice', () => {
  const compact = toggleHomeConnections(beginHomeConnectionsVisit(null), false);
  for (const result of [{ ...ready, notes: [] }, { ...pending, status: 'failed' as const }, pending]) {
    assert.equal(receiveHomeConnections(compact, result), compact);
  }
  assert.equal(receiveHomeConnections(compact, ready).expanded, false);
});

test('storage is validated and contains presentation choices only', () => {
  for (const raw of [null, '', '{', 'null', '[]', '{"expanded":"false","introduced":true}']) {
    assert.equal(readHomeConnectionsPreference(raw), null);
  }
  assert.deepEqual(readHomeConnectionsPreference('{"expanded":false,"introduced":true,"text":"ignored"}'), { expanded: false, introduced: true });
});

test('one/two/ten note navigation has unique bounded neighbors and wraps', () => {
  assert.deepEqual(homeConnectionNeighbors(0, 1), []);
  assert.deepEqual(homeConnectionNeighbors(0, 2), [{ index: 1, side: 'next' }]);
  assert.deepEqual(homeConnectionNeighbors(9, 10), [{ index: 8, side: 'previous' }, { index: 0, side: 'next' }]);
  assert.throws(() => homeConnectionNeighbors(10, 10));
  assert.equal(connectionExcerpt('𠮷中文', 2), '𠮷中…');
});

function render(debrief = ready, expanded = true, error: string | null = null) {
  const noop = () => {};
  return renderToStaticMarkup(createElement(HomeConnections, { debrief, expanded, error, retrying: false,
    onToggle: noop, onRetry: noop, onReload: noop, onSummary: noop }));
}

test('expanded ring shows exact text, count and bounded neighbors, without generated fields or numbered pagination', () => {
  const html = render();
  assert.match(html, /Exact paragraph 1\n中文 &lt;literal text&gt;/);
  assert.match(html, /Connection 1 of 10/);
  assert.match(html, /Session summary/);
  assert.equal((html.match(/class="home-connections-neighbor/g) ?? []).length, 2);
  assert.doesNotMatch(html, /Do not display this|w1|Exact paragraph 5|>10<\/button>/);
  assert.equal((render({ ...ready, notes: ready.notes!.slice(0, 1) }).match(/class="home-connections-neighbor/g) ?? []).length, 0);
});

test('compact preview always uses the first note and a count, with bounded text', () => {
  const html = render({ ...ready, notes: [{ ...ready.notes![0], text: '字'.repeat(1000) }, ...ready.notes!.slice(1)] }, false);
  assert.match(html, /10 connections · Open connections/);
  assert.match(html, new RegExp('字'.repeat(240) + '…'));
  assert.doesNotMatch(html, /Exact paragraph 2|字{241}|home-connections-ring/);
});

test('pending, failure, empty and stale read errors retain correct recovery and summary actions', () => {
  assert.match(render(pending), /home-connections-astral/);
  assert.doesNotMatch(render(pending, false), /home-connections-astral/);
  assert.match(render({ ...pending, status: 'failed' }), /Try again/);
  assert.match(render({ ...ready, notes: [] }, false), /Nothing extra to add/);
  const stale = render(ready, true, 'Offline');
  assert.match(stale, /Exact paragraph 1/);
  assert.match(stale, /Try loading again/);
});
