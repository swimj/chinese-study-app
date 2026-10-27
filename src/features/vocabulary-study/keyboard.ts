import { qualityVoteForKey } from '../content-quality/keyboard';
import { shortcutEventBlocked } from '../../lib/keyboard';
export type VocabularyShortcutCommand =
  | 'primary' | 'noClue' | 'focusInput' | 'forgot' | 'correct'
  | 'choice1' | 'choice2' | 'undo' | 'another' | 'skip' | 'enough'
  | 'more' | 'finish' | 'reactions' | 'helpful' | 'notHelpful'
  | 'guide' | 'home' | 'previous';

export interface VocabularyKeyEvent {
  key: string;
  code?: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  repeat?: boolean;
  isComposing?: boolean;
  keyCode?: number;
  defaultPrevented?: boolean;
}

export interface VocabularyKeyboardContext {
  available: ReadonlySet<VocabularyShortcutCommand>;
  target: 'answer' | 'editable' | 'native' | 'surface';
  modalOpen: boolean;
}

export const VOCABULARY_SHORTCUTS: Record<VocabularyShortcutCommand, { keys: string[]; label: string }> = {
  primary: { keys: ['Space', 'Enter'], label: 'Continue or submit answer' },
  noClue: { keys: ['Shift+Enter'], label: 'No clue' },
  focusInput: { keys: ['Escape'], label: 'Focus answer field' },
  forgot: { keys: ['1'], label: 'Forgot' },
  correct: { keys: ['2', 'Space'], label: 'Correct' },
  choice1: { keys: ['1'], label: 'Choose first option' },
  choice2: { keys: ['2'], label: 'Choose second option' },
  undo: { keys: ['U'], label: 'Undo' },
  another: { keys: ['A'], label: 'Try another' },
  skip: { keys: ['S'], label: 'Skip' },
  enough: { keys: ['D'], label: 'Enough for now' },
  more: { keys: ['M'], label: 'More practice' },
  finish: { keys: ['F'], label: 'Finish session' },
  reactions: { keys: ['R'], label: 'Open reactions' },
  helpful: { keys: [']'], label: 'Helpful' },
  notHelpful: { keys: ['['], label: 'Not helpful' },
  guide: { keys: ['?'], label: 'Keyboard shortcuts' },
  home: { keys: ['Space'], label: 'Go home' },
  previous: { keys: ['←'], label: 'Previous word' },
};

/** Resolve only explicitly available actions; answer grading stays with the caller. */
export function resolveVocabularyKey(
  event: VocabularyKeyEvent,
  context: VocabularyKeyboardContext,
): VocabularyShortcutCommand | null {
  if (shortcutEventBlocked(event) || context.modalOpen) return null;

  const available = (...commands: VocabularyShortcutCommand[]): VocabularyShortcutCommand | null =>
    commands.find((command) => context.available.has(command)) ?? null;
  const canActivate = context.target === 'answer' || context.target === 'surface';
  const isTyping = context.target === 'answer' || context.target === 'editable';

  if (event.key === '?' && !isTyping) return available('guide');
  if (event.shiftKey) {
    return event.key === 'Enter' && canActivate ? available('noClue') : null;
  }
  if (event.key === 'Escape') return canActivate ? available('focusInput') : null;
  if (event.key === 'Enter') return canActivate ? available('primary') : null;
  if (event.key === ' ') {
    return context.target === 'surface' ? available('correct', 'primary', 'home') : null;
  }
  if (isTyping) return null;
  const vote = qualityVoteForKey(event, false);
  if (vote) return available(vote === 'up' ? 'helpful' : 'notHelpful');
  switch (event.key.toLowerCase()) {
    case '1': return available('choice1', 'forgot');
    case '2': return available('choice2', 'correct');
    case 'u':
    case 'z': return available('undo');
    case 'a': return available('another');
    case 's': return available('skip');
    case 'd': return available('enough');
    case 'm': return available('more');
    case 'f': return available('finish');
    case 'r': return available('reactions');
    case 'arrowleft': return context.target === 'surface' ? available('previous') : null;
    default: return null;
  }
}
