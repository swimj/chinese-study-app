import { useEffect, type RefObject } from 'react';
import { observeVisibleElement } from './visible-element';

export function useVisibleAcknowledgement(
  ref: RefObject<HTMLElement>, acknowledge: (() => Promise<void>) | undefined, enabled = true,
) {
  useEffect(() => {
    if (!enabled || !acknowledge || !ref.current) return;
    let active = true;
    let pending = false;
    let done = false;
    const stop = observeVisibleElement(ref.current, () => {
      if (!active || pending || done) return;
      pending = true;
      void acknowledge().then(() => { done = true; }).catch(() => {
        // Retry a failed write on the next focus/visibility event.
      }).finally(() => { pending = false; });
    });
    return () => { active = false; stop(); };
  }, [ref, acknowledge, enabled]);
}
