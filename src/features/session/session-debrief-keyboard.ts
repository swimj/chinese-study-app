import { isImeComposingEvent, isShortcutGuideToggleKey, type SessionKeyEvent } from './session-keyboard';

export function resolveSessionDebriefKey(event: SessionKeyEvent & {
  repeat?: boolean; defaultPrevented?: boolean; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean;
}, context: { editable: boolean; native: boolean; guideOpen: boolean; busy: boolean; ready: boolean; canGoBack: boolean }) {
  if (event.repeat || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey
    || isImeComposingEvent(event) || context.editable || context.guideOpen || context.busy) return null;
  if (isShortcutGuideToggleKey(event)) return 'guide';
  if (context.native) return null;
  if (event.key === ' ' || event.code === 'Space') return 'home';
  if (!context.ready) return null;
  if (event.key === 'Enter' || event.key === 'ArrowRight') return 'next';
  if (event.key === 'ArrowLeft' && context.canGoBack) return 'back';
  return null;
}
