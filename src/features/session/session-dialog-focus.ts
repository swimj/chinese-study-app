import { useEffect, useRef, type RefObject } from 'react';
import { isImeComposingEvent } from './session-keyboard';

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export function getFocusableElements(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter((element) => {
    return element.tabIndex >= 0 && !element.hasAttribute('disabled');
  });
}

export function useSessionDialogFocus({
  open,
  containerRef,
  initialFocusRef,
  onClose,
  closeEnabled = true,
  isolateSessionKeys = false,
}: {
  open: boolean;
  containerRef: RefObject<HTMLElement | null>;
  initialFocusRef?: { current: HTMLElement | null };
  onClose: () => void;
  closeEnabled?: boolean;
  isolateSessionKeys?: boolean;
}) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const closeEnabledRef = useRef(closeEnabled);
  closeEnabledRef.current = closeEnabled;
  const isolateSessionKeysRef = useRef(isolateSessionKeys);
  isolateSessionKeysRef.current = isolateSessionKeys;

  useEffect(() => {
    if (!open) {
      return;
    }

    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const initialFocus = initialFocusRef?.current
      ?? getFocusableElements(containerRef.current ?? document.body)[0]
      ?? null;
    initialFocus?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (isImeComposingEvent(event)) {
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        if (closeEnabledRef.current) {
          onCloseRef.current();
        }
        return;
      }

      if (event.key === 'Tab') {
        const trapRoot = containerRef.current;
        if (!trapRoot) {
          return;
        }

        const focusable = getFocusableElements(trapRoot);
        if (focusable.length === 0) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          return;
        }

        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        if (event.shiftKey && (active === first || !trapRoot.contains(active))) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          last.focus();
          return;
        }

        if (!event.shiftKey && (active === last || !trapRoot.contains(active))) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          first.focus();
        }
        return;
      }

      if (isolateSessionKeysRef.current) {
        event.stopPropagation();
        event.stopImmediatePropagation();
        if (event.key === ' ') {
          event.preventDefault();
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      previouslyFocused?.focus();
    };
  }, [containerRef, initialFocusRef, open]);
}
