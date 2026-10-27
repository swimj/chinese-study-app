/** Common event safety, independent of each surface's command map. */
export interface ShortcutKeyEvent {
  key: string;
  code?: string;
  repeat?: boolean;
  isComposing?: boolean;
  keyCode?: number;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  defaultPrevented?: boolean;
}
export function shortcutEventBlocked(event: ShortcutKeyEvent, options: { allowRepeat?: boolean } = {}): boolean {
  return Boolean(event.defaultPrevented || (!options.allowRepeat && event.repeat)
    || event.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey);
}
