import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  resolveVocabularyKey,
  VOCABULARY_SHORTCUTS,
  type VocabularyKeyEvent,
  type VocabularyKeyboardContext,
  type VocabularyShortcutCommand,
} from '../src/features/vocabulary-study/keyboard.ts';

function context(
  commands: VocabularyShortcutCommand[] = Object.keys(VOCABULARY_SHORTCUTS) as VocabularyShortcutCommand[],
  target: VocabularyKeyboardContext['target'] = 'surface',
): VocabularyKeyboardContext {
  return { available: new Set(commands), target, modalOpen: false };
}

test('shortcuts resolve only available actions, with contextual choices taking precedence', () => {
  for (const [key, expected] of [
    ['1', 'choice1'], ['2', 'choice2'], [' ', 'correct'], ['Enter', 'primary'],
    ['Escape', 'focusInput'], ['u', 'undo'], ['Z', 'undo'], ['a', 'another'],
    ['s', 'skip'], ['d', 'enough'], ['m', 'more'], ['f', 'finish'],
    ['r', 'reactions'], [']', 'helpful'], ['[', 'notHelpful'],
    ['?', 'guide'], ['ArrowLeft', 'previous'],
  ] as const) {
    assert.equal(resolveVocabularyKey({ key }, context()), expected, key);
    assert.equal(resolveVocabularyKey({ key }, context([])), null, `${key} unavailable`);
  }
  assert.equal(resolveVocabularyKey({ key: '1' }, context(['forgot'])), 'forgot');
  assert.equal(resolveVocabularyKey({ key: '2' }, context(['correct'])), 'correct');
  assert.equal(resolveVocabularyKey({ key: ' ' }, context(['primary', 'home'])), 'primary');
  assert.equal(resolveVocabularyKey({ key: ' ' }, context(['home'])), 'home');
  assert.equal(resolveVocabularyKey({ key: 'Enter' }, context(['correct', 'home'])), null);
});

test('answer fields preserve typing and permit only explicit submit, no clue, and focus actions', () => {
  for (const target of ['answer', 'editable'] as const) {
    for (const key of [' ', '1', '2', 'u', 'a', 's', 'd', 'm', 'f', 'r', '[', ']', '?', 'ArrowLeft']) {
      assert.equal(resolveVocabularyKey({ key }, context(undefined, target)), null, `${target}: ${key}`);
    }
  }
  for (const target of ['answer', 'surface'] as const) {
    assert.equal(resolveVocabularyKey({ key: 'Enter' }, context(['primary'], target)), 'primary');
    assert.equal(resolveVocabularyKey({ key: 'Enter', shiftKey: true }, context(['noClue'], target)), 'noClue');
    assert.equal(resolveVocabularyKey({ key: 'Escape' }, context(['focusInput'], target)), 'focusInput');
    assert.equal(resolveVocabularyKey({ key: 'Enter', shiftKey: true }, context(['primary'], target)), null);
    assert.equal(resolveVocabularyKey({ key: 'Enter' }, context(['noClue'], target)), null);
  }
  for (const event of [{ key: 'Enter' }, { key: 'Enter', shiftKey: true }, { key: 'Escape' }]) {
    assert.equal(resolveVocabularyKey(event, context(undefined, 'editable')), null);
  }
});

test('native controls keep activation keys while allowing nonactivation shortcuts', () => {
  const native = context(undefined, 'native');
  for (const event of [{ key: 'Enter' }, { key: ' ' }, { key: 'Enter', shiftKey: true }, { key: 'Escape' }, { key: 'ArrowLeft' }]) {
    assert.equal(resolveVocabularyKey(event, native), null);
  }
  for (const [key, command] of [['1', 'choice1'], ['u', 'undo'], ['?', 'guide'], [']', 'helpful']] as const) {
    assert.equal(resolveVocabularyKey({ key }, native), command);
  }
});

test('modifiers, consumed events, composition, repeats, and modals block all commands', () => {
  const guards: Partial<VocabularyKeyEvent>[] = [
    { defaultPrevented: true }, { repeat: true }, { isComposing: true }, { keyCode: 229 },
    { ctrlKey: true }, { metaKey: true }, { altKey: true },
  ];
  const events: VocabularyKeyEvent[] = [
    { key: 'Enter' }, { key: 'Enter', shiftKey: true }, { key: '?' },
    { key: 'Escape' }, { key: ' ' }, { key: '1' }, { key: 'u' }, { key: 'ArrowLeft' },
  ];
  for (const event of events) {
    for (const guard of guards) assert.equal(resolveVocabularyKey({ ...event, ...guard }, context()), null);
    assert.equal(resolveVocabularyKey(event, { ...context(), modalOpen: true }), null);
  }
});

test('Shift is accepted only for question mark and no clue; Caps Lock letters still work', () => {
  assert.equal(resolveVocabularyKey({ key: '?', shiftKey: true }, context()), 'guide');
  assert.equal(resolveVocabularyKey({ key: 'Enter', shiftKey: true }, context()), 'noClue');
  assert.equal(resolveVocabularyKey({ key: 'U' }, context()), 'undo');
  for (const key of ['U', 'A', '1', ' ', 'Escape', 'ArrowLeft', '/', '[', ']']) {
    assert.equal(resolveVocabularyKey({ key, shiftKey: true }, context()), null, key);
  }
});

test('advertised key strings agree with contextual shortcuts and keep Z as an unadvertised alias', () => {
  assert.deepEqual(VOCABULARY_SHORTCUTS.primary.keys, ['Space', 'Enter']);
  assert.deepEqual(VOCABULARY_SHORTCUTS.correct.keys, ['2', 'Space']);
  assert.deepEqual(VOCABULARY_SHORTCUTS.noClue.keys, ['Shift+Enter']);
  assert.deepEqual(VOCABULARY_SHORTCUTS.undo.keys, ['U']);
  for (const definition of Object.values(VOCABULARY_SHORTCUTS)) {
    assert.ok(definition.label.trim());
    assert.ok(definition.keys.length > 0);
  }
});
