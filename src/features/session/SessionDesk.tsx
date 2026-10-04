import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, type ReactNode } from 'react';

import type { SessionDeskOutcome } from './session-desk-model';
export type SessionDeskHandle = { depart: (outcome: SessionDeskOutcome, showNext: () => void) => Promise<void> };

/** Presentation only: the controller owns when the study transition is applied. */
export const SessionDesk = forwardRef<SessionDeskHandle, {
  children: ReactNode;
  enabled: boolean;
  mistakeKey: string | null;
  remaining: number;
  again: number;
  answered: number;
  elapsed: string;
}>(function SessionDesk({ children, enabled, mistakeKey, remaining, again, answered, elapsed }, ref) {
  const surface = useRef<HTMLDivElement>(null);
  const pile = useRef<HTMLDivElement>(null);
  const cleanup = useRef<(() => void) | null>(null);
  const arriving = useRef(false);
  const running = useRef<Promise<void> | null>(null);
  useEffect(() => () => cleanup.current?.(), []);
  // Render the successor underneath the moving clone, then lift its contents in.
  // The paper surface stays opaque throughout the handoff.
  useLayoutEffect(() => {
    if (!arriving.current) return;
    arriving.current = false;
    const host = surface.current;
    host?.classList.remove('is-departing');
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    host?.querySelectorAll('.session-card-scroll, .session-action-bar').forEach((content) => content.animate([
      { opacity: 0, transform: 'translateY(5px)' },
      { opacity: 1, transform: 'translateY(0)' },
    ], { duration: 360, easing: 'ease-out' }));
  }, [children]);
  useEffect(() => {
    if (!mistakeKey || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const card = surface.current?.querySelector<HTMLElement>('.session-card-shell');
    const animation = card?.animate([
      { transform: 'translateX(0)' }, { transform: 'translateX(-7px) rotate(-.5deg)' },
      { transform: 'translateX(6px) rotate(.5deg)' }, { transform: 'translateX(-3px)' },
      { transform: 'translateX(0)' },
    ], { duration: 300, easing: 'ease-out' });
    return () => animation?.cancel();
  }, [mistakeKey]);
  useImperativeHandle(ref, () => ({
    depart(outcome, showNext) {
      if (running.current) return running.current;
      const host = surface.current;
      const card = host?.querySelector<HTMLElement>('.session-card-shell');
      if (!host || !card || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        showNext();
        return Promise.resolve();
      }
      const pending = new Promise<void>((resolve) => {
        const rect = card.getBoundingClientRect();
        const ghost = document.createElement('div');
        ghost.className = 'desk-departure session-desk';
        ghost.setAttribute('aria-hidden', 'true');
        ghost.inert = true;
        Object.assign(ghost.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
        const turn = document.createElement('div');
        turn.className = 'desk-departure-turn';
        const front = card.cloneNode(true) as HTMLElement;
        front.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
        front.removeAttribute('id');
        front.classList.add('desk-departure-front');
        const clonedScroll = front.querySelector('.session-card-scroll');
        const originalScroll = card.querySelector('.session-card-scroll');
        const back = document.createElement('div');
        back.className = 'desk-departure-back';
        // Show the earned recall on the outgoing card without changing study state.
        if (outcome === 'ongoing' || outcome === 'done') {
          front.querySelector('.desk-chips > span:not(.is-filled)')?.classList.add('is-filled');
        }
        turn.append(front, back);
        ghost.append(turn);
        document.body.append(ghost);
        if (clonedScroll && originalScroll) clonedScroll.scrollTop = originalScroll.scrollTop;
        host.classList.add('is-departing');
        let finished = false;
        const finish = () => {
          if (finished) return;
          finished = true;
          ghost.remove();
          cleanup.current = null;
          running.current = null;
          resolve();
        };
        cleanup.current = finish;
        const target = pile.current?.getBoundingClientRect();
        const wrong = outcome === 'wrong';
        const direction = outcome === 'ongoing' ? -1 : 1;
        const x = wrong && target ? target.left + target.width / 2 - rect.left - rect.width / 2 : direction * (window.innerWidth + rect.width) / 2;
        const y = wrong && target ? target.top + target.height / 2 - rect.top - rect.height / 2 : -35;
        const rattle = wrong && host.dataset.mistake !== 'true';
        const duration = wrong ? rattle ? 940 : 780 : 650;
        const delay = !wrong && front.querySelector('.desk-chips') ? 160 : 0;
        const frames: Keyframe[] = wrong ? [
          { transform: 'translate(0,0) scale(1)', opacity: 1, offset: 0 },
          ...(rattle ? [
            { transform: 'translate(-7px,0) scale(1)', opacity: 1, offset: .06 },
            { transform: 'translate(6px,0) scale(1)', opacity: 1, offset: .12 },
            { transform: 'translate(0,0) scale(1)', opacity: 1, offset: .2 },
          ] : []),
          { transform: `translate(${x * .55}px, -45px) scale(.74)`, opacity: 1, offset: .55 },
          { transform: `translate(${x}px, ${y}px) scale(.08)`, opacity: .1 },
        ] : [
          { transform: 'translate(0,0) rotate(0)', opacity: 1 },
          { transform: `translate(${x}px, ${y}px) rotate(${direction * 12}deg)`, opacity: 0 },
        ];
        turn.animate([{ transform: 'rotateY(0deg)' }, { transform: `rotateY(${direction * 180}deg)` }], { duration, delay, fill: 'forwards', easing: 'ease-in-out' });
        const motion = ghost.animate(frames, { duration, delay, fill: 'forwards', easing: 'cubic-bezier(.3,.05,.25,1)' });
        motion.finished.then(finish, finish);
        arriving.current = true;
        showNext();
      });
      running.current = pending;
      return pending;
    },
  }), []);
  if (!enabled) return <>{children}</>;
  return <div className="session-desk">
    <header className="desk-heading">
      <span className="desk-remaining">{remaining} remaining</span>
      <details className="desk-overview"><summary>Session overview</summary><div>
        <span>{answered} answered</span><span>{again} to practice again</span><span>{elapsed} elapsed</span>
      </div></details>
    </header>
    <div className="desk-stack" ref={surface} data-mistake={Boolean(mistakeKey)}>
      <div className="desk-under-card" aria-hidden="true" />
      <div className="desk-front">{children}</div>
    </div>
    <footer className="desk-footer"><div ref={pile} className={`desk-again-pile${again ? ' has-cards' : ''}`} aria-live="polite">
      <span className="desk-pile-mark" aria-hidden="true" /> Practice again <strong>{again}</strong>
    </div></footer>
  </div>;
});

export function RecallChips({ count, total = 3, label }: { count: number; total?: number; label: string }) {
  return <div className="desk-recall-progress" role="group" aria-label={`${label}: ${count} of ${total}`}>
    <span>{label}</span><span className="desk-chips" aria-hidden="true">{Array.from({ length: total }, (_, index) =>
      <span key={index} className={index < count ? 'is-filled' : ''}>{index + 1}</span>)}
    </span>
  </div>;
}
