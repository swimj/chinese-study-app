import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  getActiveRatingOptions,
  getDefaultRating,
  getRatingForKey,
} from '../src/features/session/session-rating.ts';
import {
  getSessionInteractionKind,
  getSessionPrimaryAction,
  getSessionShortcutGuide,
  isAdvertisedUndoKey,
  isShortcutGuideToggleKey,
  isUndoKey,
  resolveSessionKey,
  type SessionKeyboardContext,
} from '../src/features/session/session-keyboard.ts';

function createContext(overrides: Partial<SessionKeyboardContext> = {}): SessionKeyboardContext {
  return {
    sessionStarted: true,
    isEditableTarget: false,
    productionInputActive: false,
    productionAwaitingNext: false,
    contrastAwaitingNext: false,
    unstudiedIntro: false,
    productionRequiresHanziInput: false,
    contrastSelectionActive: false,
    contrastHasSelection: false,
    answerRevealed: false,
    ratingAvailable: false,
    hasUndo: false,
    hasActiveWord: true,
    ratingOptions: getActiveRatingOptions({
      actionKind: 'recognition',
      wordStatus: 'review',
      reviewInReinforcement: false,
    }),
    ...overrides,
  };
}

function key(value: string, extras: Partial<{ isComposing: boolean; keyCode: number }> = {}) {
  return {
    key: value,
    isComposing: extras.isComposing ?? false,
    keyCode: extras.keyCode ?? 0,
  };
}

describe('session keyboard contract', () => {
  test('unrevealed recognition uses Space to reveal', () => {
    const context = createContext();
    assert.equal(getSessionInteractionKind(context), 'recognition_unrevealed');
    assert.deepEqual(getSessionPrimaryAction(context), {
      command: 'reveal',
      label: 'Reveal answer',
      shortcut: 'Space',
    });
    assert.deepEqual(resolveSessionKey(key(' '), context), { type: 'reveal' });
  });

  test('typed production submits with Enter and toggles field focus with Escape', () => {
    const context = createContext({
      productionInputActive: true,
      productionRequiresHanziInput: true,
      isEditableTarget: true,
    });
    assert.equal(getSessionInteractionKind(context), 'production_input');
    assert.deepEqual(getSessionPrimaryAction(context), {
      command: 'submit_production',
      label: 'Submit response',
      shortcut: 'Enter',
    });
    assert.deepEqual(resolveSessionKey(key('Enter'), context), { type: 'submit_production' });
    assert.deepEqual(resolveSessionKey(key('Escape'), context), { type: 'toggle_production_input_focus' });
    assert.equal(resolveSessionKey(key(' '), context), null);
    assert.equal(resolveSessionKey(key('u'), context), null);
  });

  test('typed production Enter still submits after the field is unfocused', () => {
    const context = createContext({
      productionInputActive: true,
      productionRequiresHanziInput: true,
      isEditableTarget: false,
    });
    assert.deepEqual(resolveSessionKey(key('Enter'), context), { type: 'submit_production' });
  });

  test('IME composition keeps Escape and Enter from stealing the production field', () => {
    const context = createContext({
      productionInputActive: true,
      productionRequiresHanziInput: true,
      isEditableTarget: true,
    });
    assert.equal(resolveSessionKey(key('Escape', { isComposing: true }), context), null);
    assert.equal(resolveSessionKey(key('Enter', { keyCode: 229 }), context), null);
  });

  test('contrast selection previews with 1/2 and confirms with Enter only after a choice is selected', () => {
    const unselected = createContext({ contrastSelectionActive: true });
    assert.equal(getSessionInteractionKind(unselected), 'contrast_selection');
    assert.deepEqual(resolveSessionKey(key('1'), unselected), { type: 'preview_contrast', choiceIndex: 0 });
    assert.deepEqual(resolveSessionKey(key('2'), unselected), { type: 'preview_contrast', choiceIndex: 1 });
    assert.equal(resolveSessionKey(key('Enter'), unselected), null);
    assert.equal(getSessionPrimaryAction(unselected)?.shortcut, '1 / 2');

    const selected = createContext({ contrastSelectionActive: true, contrastHasSelection: true });
    assert.deepEqual(resolveSessionKey(key('Enter'), selected), { type: 'confirm_contrast' });
    assert.deepEqual(getSessionPrimaryAction(selected), {
      command: 'confirm_contrast',
      label: 'Confirm selection',
      shortcut: 'Enter',
    });
  });

  test('rating keys follow allowed options and Space uses the visible default', () => {
    const review = createContext({
      answerRevealed: true,
      ratingAvailable: true,
    });
    assert.equal(getSessionInteractionKind(review), 'rating');
    assert.deepEqual(resolveSessionKey(key('1'), review), { type: 'rate', rating: 'forgot' });
    assert.deepEqual(resolveSessionKey(key(' '), review), { type: 'rate_default' });
    assert.equal(getDefaultRating(review.ratingOptions), 'good');
    assert.equal(getSessionPrimaryAction(review)?.shortcut, 'Space');

    const contrastRating = createContext({
      answerRevealed: true,
      ratingAvailable: true,
      ratingOptions: getActiveRatingOptions({
        actionKind: 'contrast_selection',
        wordStatus: 'review',
        reviewInReinforcement: false,
      }),
    });
    assert.equal(resolveSessionKey(key('1'), contrastRating), null);
    assert.deepEqual(resolveSessionKey(key('2'), contrastRating), { type: 'rate', rating: 'hard' });
    assert.deepEqual(resolveSessionKey(key(' '), contrastRating), { type: 'rate_default' });
  });

  test('auto-rated correction continues with Space', () => {
    const context = createContext({ productionAwaitingNext: true, answerRevealed: true });
    assert.equal(getSessionInteractionKind(context), 'await_next');
    assert.deepEqual(resolveSessionKey(key(' '), context), { type: 'continue_after_auto_forgot' });
    assert.equal(resolveSessionKey(key('1'), context), null);
  });

  test('Undo is advertised as U and still accepts Z', () => {
    const context = createContext({ hasUndo: true });
    assert.equal(isAdvertisedUndoKey('U'), true);
    assert.equal(isAdvertisedUndoKey('z'), false);
    assert.equal(isUndoKey('z'), true);
    assert.deepEqual(resolveSessionKey(key('u'), context), { type: 'undo' });
    assert.deepEqual(resolveSessionKey(key('Z'), context), { type: 'undo' });
    assert.equal(resolveSessionKey(key('u'), createContext({ hasUndo: false })), null);
  });

  test('question mark toggles the shortcut guide', () => {
    assert.equal(isShortcutGuideToggleKey('?'), true);
    assert.equal(isShortcutGuideToggleKey('/'), false);
    assert.equal(isShortcutGuideToggleKey('Escape'), false);
  });

  test('guide rows stay state-aware and do not advertise unavailable actions as active', () => {
    const production = createContext({
      productionInputActive: true,
      productionRequiresHanziInput: true,
      hasUndo: false,
    });
    const sections = getSessionShortcutGuide(production, { includeDialogClose: true });
    const thisCard = sections.find((section) => section.title === 'This card');
    const session = sections.find((section) => section.title === 'Session');
    const dialog = sections.find((section) => section.title === 'This dialog');
    assert.ok(thisCard?.rows.some((row) => row.key === 'Enter' && row.available));
    assert.ok(thisCard?.rows.some((row) => row.key === 'Escape' && row.description.includes('answer field')));
    assert.equal(session?.rows.find((row) => row.key === 'U')?.available, false);
    assert.equal(session?.rows.find((row) => row.key === '?')?.available, true);
    assert.equal(dialog?.rows[0]?.key, 'Escape');
    assert.equal(dialog?.rows[0]?.description.includes('Close'), true);
  });
});

describe('session rating labels', () => {
  test('reinforcement labels state the decision without changing stored rating values', () => {
    const options = getActiveRatingOptions({
      actionKind: 'recognition',
      wordStatus: 'review',
      reviewInReinforcement: true,
    });
    assert.deepEqual(
      options.map((option) => ({ value: option.value, label: option.label, shortcutKey: option.shortcutKey })),
      [
        { value: 'forgot', label: 'Still missed', shortcutKey: '1' },
        { value: 'good', label: 'Recalled it', shortcutKey: '2' },
      ],
    );
    assert.equal(getRatingForKey('1', options), 'forgot');
    assert.equal(getRatingForKey('2', options), 'good');
    assert.equal(getRatingForKey('3', options), 'good');
  });

  test('binary learning labels remain Forgot and Good', () => {
    const options = getActiveRatingOptions({
      actionKind: 'production',
      wordStatus: 'learning',
      reviewInReinforcement: false,
    });
    assert.equal(options[0]?.label, 'Forgot');
    assert.equal(options[1]?.label, 'Good');
    assert.equal(getRatingForKey('2', options), 'good');
  });
});
