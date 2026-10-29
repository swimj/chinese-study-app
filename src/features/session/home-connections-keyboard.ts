import { isImeComposingEvent, type SessionKeyEvent } from './session-keyboard';

export function resolveHomeConnectionKey(event: SessionKeyEvent & {
  repeat?: boolean; defaultPrevented?: boolean; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean;
}, blocked: boolean): -1 | 1 | null {
  if (blocked || event.repeat || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey
    || event.shiftKey || isImeComposingEvent(event)) return null;
  return event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : null;
}

export function isHomeConnectionLoop(index: number, count: number, direction: -1 | 1) {
  return count > 1 && direction === 1 && index === count - 1;
}
