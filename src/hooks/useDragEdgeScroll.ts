import { useEffect, useRef } from 'react';

/** Keep the containing review pane moving while a native drag rests at its edge. */
export function useDragEdgeScroll() {
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);
  return (origin: HTMLElement, initialY: number) => {
    cleanup.current?.();
    let pane: HTMLElement | null = origin.parentElement;
    while (pane && !/(auto|scroll)/.test(getComputedStyle(pane).overflowY)) pane = pane.parentElement;
    if (!pane) return;
    const scroller = pane;
    let pointerY = initialY, frame = 0, previousTime = 0;
    const track = (event: DragEvent) => { pointerY = event.clientY; };
    const tick = (time: number) => {
      const rect = scroller.getBoundingClientRect();
      const top = Math.max(0, rect.top), bottom = Math.min(window.innerHeight, rect.bottom);
      const edge = Math.min(64, (bottom - top) / 3);
      const velocity = pointerY < top + edge ? -Math.min(1, (top + edge - pointerY) / edge)
        : pointerY > bottom - edge ? Math.min(1, (pointerY - bottom + edge) / edge) : 0;
      const elapsed = previousTime ? Math.min(time - previousTime, 50) : 0;
      scroller.scrollTop += velocity * elapsed * .65;
      previousTime = time;
      frame = requestAnimationFrame(tick);
    };
    const stop = () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('dragover', track, true);
      document.removeEventListener('drop', stop, true);
      document.removeEventListener('dragend', stop, true);
      cleanup.current = null;
    };
    document.addEventListener('dragover', track, true);
    document.addEventListener('drop', stop, true);
    document.addEventListener('dragend', stop, true);
    cleanup.current = stop;
    frame = requestAnimationFrame(tick);
  };
}
