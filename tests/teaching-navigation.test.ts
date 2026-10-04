import assert from 'node:assert/strict';
import { test } from 'node:test';
import { teachingNavigationKeyAction } from '../src/features/introduction-lab/teaching-navigation.js';
import { initialIntroductionPlayerState, reduceIntroductionPlayer } from '../src/features/introduction-lab/player.js';
import { materializeTeachingPackage } from '../src/domain/word-content/materialize.js';
import { wordContentFixtures } from './fixtures/word-content.js';

const space = { key: ' ', repeat: false, composing: false, editable: false, modified: false };

test('Space returns from lesson browsing, then a distinct press advances the whole beat', () => {
  const { content, teaching } = wordContentFixtures[0]!;
  const snapshot = materializeTeachingPackage(teaching, [content]);
  const state = initialIntroductionPlayerState();
  assert.deepEqual(teachingNavigationKeyAction(space, state.phase, true), { type: 'focus-current' });
  assert.equal(teachingNavigationKeyAction({ ...space, repeat: true }, state.phase, false), null);
  const next = teachingNavigationKeyAction(space, state.phase, false);
  assert.ok(next && next.type !== 'focus-current');
  assert.equal(reduceIntroductionPlayer(state, next, snapshot, 'teaching-only').beatIndex, 1);
});

test('browse return preserves typing and composition guards and cannot change finishing semantics', () => {
  for (const flag of ['repeat', 'composing', 'editable', 'modified'] as const) {
    assert.equal(teachingNavigationKeyAction({ ...space, [flag]: true }, 'introduction', true), null);
  }
  assert.equal(teachingNavigationKeyAction(space, 'finished', true), null);
  assert.deepEqual(teachingNavigationKeyAction({ ...space, key: 'Enter' }, 'finished', true), { type: 'continue' });
  assert.equal(teachingNavigationKeyAction(space, 'rehearsal', true), null);
});

test('teaching surface renders revealed beats once and keeps unrevealed material out of history', async () => {
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { IntroductionPlayer } = await import('../src/features/introduction-lab/IntroductionPlayer.js');
  const { content, teaching } = wordContentFixtures[0]!;
  const snapshot = materializeTeachingPackage(teaching, [content]);
  const markup = renderToStaticMarkup(createElement(IntroductionPlayer, {
    snapshot,
    state: { ...initialIntroductionPlayerState(), beatIndex: 1 },
    onAction: () => {},
    onRestart: () => {},
    mode: 'teaching-only',
  }));
  assert.match(markup, /aria-label="Beat 1"/);
  assert.match(markup, /aria-label="Beat 2, current"/);
  assert.doesNotMatch(markup, /aria-label="Beat 3/);
  assert.equal((markup.match(/<article/g) ?? []).length, 2);
  assert.match(markup, /Teaching steps; scroll up to revisit/);
});
