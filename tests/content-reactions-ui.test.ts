import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SessionDebrief } from '../src/domain/session-debrief.ts';
import type { ContentReactionState, SavedCollection } from '../src/domain/content-reactions.ts';
import { HomeConnections } from '../src/features/session/HomeConnections.tsx';
import { ReactionControls } from '../src/features/reactions/ReactionControls.tsx';
import { NO_REACTION, reactionShortcut, toggleNotForMe, toggleReason, toggleSaved, withNote } from '../src/features/reactions/reaction-state.ts';
import { groupItems, initiallySaved, savedItems, shuffled, visibleItems } from '../src/features/reactions/saved-collection.ts';

const saved = (sessionId: string, noteIndex: number, note: string | null = null): ContentReactionState =>
  ({ subject: { kind: 'connection', sessionId, noteIndex }, reaction: 'saved', reasons: [], note, updatedAt: '2026-11-01T00:00:00.000Z' });

test('Save and Not for me are exclusive toggles; reasons and notes belong to their reaction', () => {
  const kept = toggleSaved(NO_REACTION);
  assert.deepEqual(kept, { reaction: 'saved', reasons: [], note: null });
  assert.deepEqual(toggleSaved(withNote(kept, 'mine')), NO_REACTION);
  assert.equal(withNote(kept, '   ').note, null);
  const rejected = toggleReason(toggleReason(toggleNotForMe(withNote(kept, 'mine')), 'too_long'), 'wrong');
  assert.deepEqual(rejected, { reaction: 'not_for_me', reasons: ['wrong', 'too_long'], note: null });
  assert.deepEqual(toggleReason(rejected, 'wrong').reasons, ['too_long']);
  assert.deepEqual(toggleSaved(rejected), kept);
  assert.deepEqual(toggleNotForMe(rejected), NO_REACTION);
  assert.throws(() => toggleReason(kept, 'wrong'));
  assert.throws(() => withNote(rejected, 'x'));
});

test('S and X shortcuts respect typing, modifiers and composition', () => {
  const base = { key: 's', altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, isComposing: false, repeat: false, defaultPrevented: false };
  assert.equal(reactionShortcut(base, false), 'save');
  assert.equal(reactionShortcut({ ...base, key: 'x' }, false), 'not_for_me');
  assert.equal(reactionShortcut(base, true), null);
  for (const flag of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey', 'isComposing', 'repeat', 'defaultPrevented']) {
    assert.equal(reactionShortcut({ ...base, [flag]: true }, false), null, flag);
  }
});

test('controls expose pressed state and show reasons only for Not for me', () => {
  const none = renderToStaticMarkup(createElement(ReactionControls, { label: 'Reaction', state: null, onChange: () => undefined }));
  assert.match(none, /aria-pressed="false"[^>]*>.*Save/);
  assert.doesNotMatch(none, /Already knew/);
  const rejected = renderToStaticMarkup(createElement(ReactionControls, { label: 'Reaction', shortcuts: true, onChange: () => undefined,
    state: { subject: { kind: 'lesson', messageId: 'm' }, reaction: 'not_for_me', reasons: ['wrong'], note: null, updatedAt: '' } }));
  assert.match(rejected, /aria-pressed="true"[^>]*>Not for me/);
  assert.match(rejected, /aria-pressed="true"[^>]*>Wrong</);
  assert.match(rejected, /aria-pressed="false"[^>]*>Already knew</);
  assert.match(rejected, /aria-keyshortcuts="x"/);
});

test('Home connections render reactions for the active note only when supplied', () => {
  const debrief: SessionDebrief = { sessionId: 's', completedAt: '2026-10-07T00:00:00.000Z', status: 'ready', exerciseCount: 20, error: null,
    attemptCount: 1, notes: [{ text: 'One', refs: ['w1'], followUp: null }, { text: 'Two', refs: ['w1'], followUp: null }] };
  const props = { debrief, expanded: true, error: null, retrying: false, onToggle: () => undefined, onRetry: () => undefined, onReload: () => undefined };
  assert.doesNotMatch(renderToStaticMarkup(createElement(HomeConnections, props)), /Not for me/);
  const markup = renderToStaticMarkup(createElement(HomeConnections, { ...props, reactions: {
    stateFor: (index: number) => index === 0 ? saved('s', 0) : null, onChange: () => undefined, error: 'Could not save.' } }));
  assert.match(markup, /aria-label="Connection 1 reaction"/);
  assert.match(markup, /aria-pressed="true"[^>]*>.*Saved/);
  assert.match(markup, /role="alert">Could not save\./);
});

const collection: SavedCollection = {
  connections: [
    { sessionId: 'new', noteIndex: 0, completedAt: '2026-11-10T03:00:00.000Z', text: 'New A', words: [{ word: '学', pinyin: 'xué' }], reaction: null },
    { sessionId: 'new', noteIndex: 1, completedAt: '2026-11-10T03:00:00.000Z', text: 'New B', words: [{ word: '问', pinyin: 'wèn' }], reaction: saved('new', 1) },
    { sessionId: 'old', noteIndex: 0, completedAt: '2026-10-02T03:00:00.000Z', text: 'Old', words: [{ word: '学', pinyin: 'xué' }], reaction: saved('old', 0) },
  ],
  lessons: [{ messageId: 'm', subjectLabel: '馋', body: 'Lesson', createdAt: '2026-11-05T00:00:00.000Z',
    reaction: { subject: { kind: 'lesson', messageId: 'm' }, reaction: 'saved', reasons: [], note: null, updatedAt: '' } }],
};

test('saved view keeps items un-saved during the visit, lists all connections separately, and filters by word', () => {
  const items = savedItems(collection);
  assert.deepEqual(items.map((item) => item.key), ['connection:new#0', 'connection:new#1', 'lesson:m', 'connection:old#0']);
  const listed = initiallySaved(collection);
  assert.deepEqual([...listed].sort(), ['connection:new#1', 'connection:old#0', 'lesson:m']);
  const unsavedNow = new Map<string, ContentReactionState>();
  assert.deepEqual(visibleItems(items, 'saved', listed, unsavedNow, null).map((item) => item.key),
    ['connection:new#1', 'lesson:m', 'connection:old#0']);
  const savedNow = new Map([['connection:new#0', saved('new', 0)]]);
  assert.equal(visibleItems(items, 'saved', new Set(), savedNow, null).length, 1);
  assert.deepEqual(visibleItems(items, 'connections', listed, unsavedNow, null).map((item) => item.key),
    ['connection:new#0', 'connection:new#1', 'connection:old#0']);
  assert.deepEqual(visibleItems(items, 'connections', listed, unsavedNow, '学').map((item) => item.key), ['connection:new#0', 'connection:old#0']);
  assert.deepEqual(visibleItems(items, 'saved', listed, unsavedNow, '学').map((item) => item.key), ['connection:old#0']);
});

test('saved items group by month; all connections group by session day', () => {
  const items = savedItems(collection);
  assert.deepEqual(groupItems(items, 'saved', 'en-US').map((group) => [group.label, group.items.length]),
    [['November 2026', 3], ['October 2026', 1]]);
  assert.deepEqual(groupItems(items.filter((item) => item.kind === 'connection'), 'connections', 'en-US').map((group) => group.label),
    ['Tue, Nov 10, 2026', 'Fri, Oct 2, 2026']);
});

test('shuffle is a permutation', () => {
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const result = shuffled(['a', 'b', 'c', 'd', 'e'], random);
  assert.deepEqual([...result].sort(), ['a', 'b', 'c', 'd', 'e']);
});
