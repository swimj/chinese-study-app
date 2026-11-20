

export type SessionKeyEvent = {
  key: string;
  code?: string;
  isComposing: boolean;
  keyCode: number;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
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
