import type { ReviewRating } from '../../types';
import { getDefaultRating, getRatingForKey, type RatingOption } from './session-rating';

export type SessionInteractionKind =
  | 'inactive'
  | 'unstudied_intro'
  | 'production_input'
  | 'contrast_selection'
  | 'recognition_unrevealed'
  | 'rating'
  | 'await_next'
  | 'other';

export type SessionKeyCommand =
  | { type: 'toggle_production_input_focus' }
  | { type: 'submit_production' }
  | { type: 'open_notes' }
  | { type: 'reveal' }
  | { type: 'begin_unstudied_drill' }
  | { type: 'continue_after_auto_forgot' }
  | { type: 'rate_default' }
  | { type: 'preview_contrast'; choiceIndex: 0 | 1 }
  | { type: 'confirm_contrast' }
  | { type: 'undo' }
  | { type: 'rate'; rating: ReviewRating };

export type SessionKeyEvent = {
  key: string;
  isComposing: boolean;
  keyCode: number;
};

export type SessionKeyboardContext = {
  sessionStarted: boolean;
  isEditableTarget: boolean;
  productionInputActive: boolean;
  productionAwaitingNext: boolean;
  contrastAwaitingNext: boolean;
  unstudiedIntro: boolean;
  productionRequiresHanziInput: boolean;
  contrastSelectionActive: boolean;
  contrastHasSelection: boolean;
  answerRevealed: boolean;
  ratingAvailable: boolean;
  hasUndo: boolean;
  hasActiveWord: boolean;
  ratingOptions: RatingOption[];
};

export type SessionPrimaryAction = {
  command: SessionKeyCommand['type'];
  label: string;
  shortcut: string | null;
};

export type SessionShortcutRow = {
  key: string;
  description: string;
  available: boolean;
};

export type SessionShortcutGuideSection = {
  title: string;
  rows: SessionShortcutRow[];
};

export function isImeComposingEvent(event: SessionKeyEvent) {
  return event.isComposing || event.keyCode === 229;
}

export function isEditableKeyboardTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' ||
      target.isContentEditable)
  );
}

export function isShortcutGuideToggleKey(key: string) {
  return key === '?';
}

export function getSessionInteractionKind(context: SessionKeyboardContext): SessionInteractionKind {
  if (!context.sessionStarted) {
    return 'inactive';
  }

  if (context.productionAwaitingNext || context.contrastAwaitingNext) {
    return 'await_next';
  }

  if (context.unstudiedIntro) {
    return 'unstudied_intro';
  }

  if (context.productionInputActive) {
    return 'production_input';
  }

  if (context.contrastSelectionActive && !context.answerRevealed) {
    return 'contrast_selection';
  }

  if (context.ratingAvailable) {
    return 'rating';
  }

  if (!context.answerRevealed) {
    return 'recognition_unrevealed';
  }

  return 'other';
}

export function getSessionPrimaryAction(context: SessionKeyboardContext): SessionPrimaryAction | null {
  switch (getSessionInteractionKind(context)) {
    case 'unstudied_intro':
      return { command: 'begin_unstudied_drill', label: 'Begin recall drills', shortcut: 'Space' };
    case 'production_input':
      return { command: 'submit_production', label: 'Submit response', shortcut: 'Enter' };
    case 'contrast_selection':
      return context.contrastHasSelection
        ? { command: 'confirm_contrast', label: 'Confirm selection', shortcut: 'Enter' }
        : { command: 'preview_contrast', label: 'Choose an option', shortcut: '1 / 2' };
    case 'recognition_unrevealed':
      return { command: 'reveal', label: 'Reveal answer', shortcut: 'Space' };
    case 'rating': {
      const defaultRating = getDefaultRating(context.ratingOptions);
      const defaultOption = context.ratingOptions.find((option) => option.value === defaultRating);
      return {
        command: 'rate_default',
        label: defaultOption ? defaultOption.label : 'Continue',
        shortcut: 'Space',
      };
    }
    case 'await_next':
      return { command: 'continue_after_auto_forgot', label: 'Next', shortcut: 'Space' };
    default:
      return null;
  }
}

export function getSessionShortcutGuide(
  context: SessionKeyboardContext,
  options: { includeDialogClose: boolean } = { includeDialogClose: false },
): SessionShortcutGuideSection[] {
  const kind = getSessionInteractionKind(context);
  const thisCard = getThisCardShortcutRows(kind, context);
  const sessionRows: SessionShortcutRow[] = [
    {
      key: 'U',
      description: 'Undo the last undoable session transition',
      available: context.hasUndo,
    },
    {
      key: 'E',
      description: 'Open personal notes',
      available: context.hasActiveWord,
    },
    {
      key: '?',
      description: 'Open or close the shortcut guide',
      available: true,
    },
  ];

  const sections: SessionShortcutGuideSection[] = [];
  if (thisCard.length > 0) {
    sections.push({ title: 'This card', rows: thisCard });
  }
  sections.push({ title: 'Session', rows: sessionRows });
  if (options.includeDialogClose) {
    sections.push({
      title: 'This dialog',
      rows: [
        {
          key: 'Escape',
          description: 'Close and return to the invoking control',
          available: true,
        },
      ],
    });
  }

  return sections;
}

export function resolveSessionKey(
  event: SessionKeyEvent,
  context: SessionKeyboardContext,
): SessionKeyCommand | null {
  if (!context.sessionStarted) {
    return null;
  }

  const composing = isImeComposingEvent(event);
  if (composing && (event.key === 'Escape' || event.key === 'Enter')) {
    return null;
  }

  if (event.key === 'Escape' && context.productionInputActive) {
    return { type: 'toggle_production_input_focus' };
  }

  if (event.key === 'Enter' && context.productionInputActive) {
    return { type: 'submit_production' };
  }

  if (context.isEditableTarget) {
    return null;
  }

  if ((event.key === 'e' || event.key === 'E') && context.hasActiveWord) {
    return { type: 'open_notes' };
  }

  if (event.key === ' ') {
    if (context.productionAwaitingNext || context.contrastAwaitingNext) {
      return { type: 'continue_after_auto_forgot' };
    }

    if (context.unstudiedIntro) {
      return { type: 'begin_unstudied_drill' };
    }

    if (context.productionRequiresHanziInput && !context.answerRevealed) {
      return null;
    }

    if (context.contrastSelectionActive && !context.answerRevealed) {
      return null;
    }

    if (!context.answerRevealed) {
      return { type: 'reveal' };
    }

    if (context.hasActiveWord && getDefaultRating(context.ratingOptions)) {
      return { type: 'rate_default' };
    }

    return null;
  }

  if (context.contrastSelectionActive && !context.answerRevealed) {
    if (event.key === '1' || event.key === '2') {
      return { type: 'preview_contrast', choiceIndex: event.key === '1' ? 0 : 1 };
    }

    if (event.key === 'Enter') {
      return context.contrastHasSelection ? { type: 'confirm_contrast' } : null;
    }
  }

  if (isUndoKey(event.key) && context.hasUndo) {
    return { type: 'undo' };
  }

  if (context.productionAwaitingNext || context.contrastAwaitingNext) {
    return null;
  }

  if (!context.answerRevealed) {
    return null;
  }

  const nextRating = getRatingForKey(event.key, context.ratingOptions);
  if (!nextRating) {
    return null;
  }

  if (!context.ratingOptions.some((option) => option.value === nextRating)) {
    return null;
  }

  return { type: 'rate', rating: nextRating };
}

export function isUndoKey(key: string) {
  const normalized = key.toLowerCase();
  return normalized === 'u' || normalized === 'z';
}

export function isAdvertisedUndoKey(key: string) {
  return key.toLowerCase() === 'u';
}

function getThisCardShortcutRows(
  kind: SessionInteractionKind,
  context: SessionKeyboardContext,
): SessionShortcutRow[] {
  switch (kind) {
    case 'unstudied_intro':
      return [{ key: 'Space', description: 'Begin recall drills', available: true }];
    case 'production_input':
      return [
        { key: 'Enter', description: 'Submit the typed response', available: true },
        {
          key: 'Escape',
          description: 'Leave or return to the answer field',
          available: true,
        },
      ];
    case 'contrast_selection':
      return [
        { key: '1 / 2', description: 'Preview a numbered choice', available: true },
        {
          key: 'Enter',
          description: 'Confirm the selected choice',
          available: context.contrastHasSelection,
        },
      ];
    case 'recognition_unrevealed':
      return [{ key: 'Space', description: 'Reveal the answer', available: true }];
    case 'rating':
      return [
        ...context.ratingOptions.map((option) => ({
          key: option.shortcutKey,
          description: `Rate ${option.label}`,
          available: true,
        })),
        {
          key: 'Space',
          description: `Rate ${getDefaultRatingLabel(context.ratingOptions)}`,
          available: true,
        },
      ];
    case 'await_next':
      return [{ key: 'Space', description: 'Continue to the next card', available: true }];
    default:
      return [];
  }
}

function getDefaultRatingLabel(ratingOptions: RatingOption[]) {
  const defaultRating = getDefaultRating(ratingOptions);
  return ratingOptions.find((option) => option.value === defaultRating)?.label ?? 'the default';
}
