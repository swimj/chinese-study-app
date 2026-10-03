export type QualityKeyEvent = {
  key: string;
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
export function qualityVoteForKey(event: QualityKeyEvent, editable: boolean): 'up' | 'down' | null {
  if (editable || event.defaultPrevented || event.repeat || event.isComposing || event.keyCode === 229
    || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return null;
  return event.key === '[' ? 'down' : event.key === ']' ? 'up' : null;
}
