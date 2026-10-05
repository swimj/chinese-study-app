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
    content,
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

test('finished teaching shows pinned word uses and examples, with Enter continuing', async () => {
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { IntroductionPlayer } = await import('../src/features/introduction-lab/IntroductionPlayer.js');
  for (const { content, teaching } of wordContentFixtures) {
    const markup = renderToStaticMarkup(createElement(IntroductionPlayer, {
      snapshot: materializeTeachingPackage(teaching, [content]),
      content,
      state: { ...initialIntroductionPlayerState(), phase: 'finished' },
      onAction: () => {},
      onRestart: () => {},
      onFinish: () => {},
      mode: 'teaching-only',
    }));
    const escapeHtml = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#x27;');
    assert.ok(markup.includes(escapeHtml(content.word.hanzi)));
    assert.ok(markup.includes(escapeHtml(content.word.pinyin)));
    for (const use of content.uses) {
      assert.ok(markup.includes(escapeHtml(use.label)));
      const example = content.examples.find((row) => row.id === use.exampleIds[0]);
      if (example) {
        assert.ok(markup.includes(escapeHtml(example.text)));
        assert.ok(markup.includes(escapeHtml(example.translation)));
      }
    }
    assert.doesNotMatch(markup, /Introduction complete/);
    assert.match(markup, /Continue <kbd>Enter<\/kbd>/);
  }
});

test('session teaching converts source examples and inline explanation without rewriting the pinned package', async () => {
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { IntroductionPlayer } = await import('../src/features/introduction-lab/IntroductionPlayer.js');
  const { content, teaching } = wordContentFixtures[0]!;
  const source = { ...content, examples: content.examples.map(example => ({ ...example, text: '這份工作看似簡單，其實很考驗耐心。' })) };
  const original = JSON.stringify(source);
  const snapshot = { ...materializeTeachingPackage(teaching, [content]),
    beats: [{ id: 'sentence', parts: [
      { text: source.examples[0]!.text, source: { kind: 'example' as const, exampleId: source.examples[0]!.id, field: 'sentence' as const } },
      { text: 'Contrast the appearance with 其實.', source: { kind: 'text' as const, text: 'Contrast the appearance with 其實.' } },
    ] }],
  };
  const markup = renderToStaticMarkup(createElement(IntroductionPlayer, {
    snapshot, content: source, state: initialIntroductionPlayerState(), onAction: () => {}, onRestart: () => {},
    mode: 'teaching-only', characterPresentation: 'both', sentenceCharacterPresentation: 'simplified',
  }));
  assert.match(markup, /这份工作看似简单，其实很考验耐心。/);
  assert.match(markup, /Contrast the appearance with 其实/);
  assert.match(markup, /lang="zh-Hans"/);
  assert.equal(JSON.stringify(source), original);
  assert.equal(snapshot.beats[0]!.parts[0]!.text, source.examples[0]!.text);
});
