import { shortcutEventBlocked, type ShortcutKeyEvent } from '../../lib/keyboard';
export type QualityKeyEvent = {
  key: string;
  code: string;
  repeat: boolean;
  isComposing: boolean;
  keyCode: number;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  defaultPrevented: boolean;
};

/** Brackets leave the existing study ratings and text entry untouched. */
export function qualityVoteForKey(event: ShortcutKeyEvent, editable: boolean): 'up' | 'down' | null {
  if (editable || shortcutEventBlocked(event) || event.shiftKey) return null;
  // Pinyin input sources can emit localized punctuation for these physical keys.
  if (event.code === 'BracketLeft') return 'down';
  if (event.code === 'BracketRight') return 'up';
  return event.key === '[' ? 'down' : event.key === ']' ? 'up' : null;
}
