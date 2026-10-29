import { useEffect, useRef, useState } from 'react';
import type { SessionDebrief } from '../../domain/session-debrief';
import { connectionExcerpt, homeConnectionNeighbors } from './home-connections-state';
import { isEditableKeyboardTarget } from './session-keyboard';
import { isHomeConnectionLoop, resolveHomeConnectionKey } from './home-connections-keyboard';

export function HomeConnections({ debrief, expanded, error, retrying, onToggle, onRetry, onReload }: {
  debrief: SessionDebrief; expanded: boolean; error: string | null; retrying: boolean;
  onToggle: () => void; onRetry: () => void; onReload: () => void;
}) {
  const [index, setIndex] = useState(0);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const previewRef = useRef<HTMLButtonElement>(null);
  const focusAfterToggle = useRef(false);
  const [loop, setLoop] = useState<number | null>(null);
  const loopSequence = useRef(0);
  const notes = debrief.status === 'ready' ? debrief.notes ?? [] : [];
  const activeIndex = Math.min(index, Math.max(0, notes.length - 1));
  const pending = debrief.status === 'queued' || debrief.status === 'running' || retrying;
  const count = `${notes.length} connection${notes.length === 1 ? '' : 's'}`;
  function move(direction: -1 | 1) {
    if (!notes.length) throw new Error('Cannot navigate an empty connection result.');
    setLoop(isHomeConnectionLoop(activeIndex, notes.length, direction) ? ++loopSequence.current : null);
    setIndex((activeIndex + direction + notes.length) % notes.length);
  }
  useEffect(() => {
    if (!expanded || notes.length < 2) return;
    function onKey(event: KeyboardEvent) {
      const target = event.target;
      const blocked = isEditableKeyboardTarget(target)
        || (target instanceof Element && !!target.closest('[role="dialog"], [role="slider"], [role="tablist"], audio, video'));
      if (event.key === 'Escape' && !blocked && !event.defaultPrevented
        && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
        && !event.repeat && !event.isComposing && event.keyCode !== 229) {
        event.preventDefault();
        toggle();
        return;
      }
      const direction = resolveHomeConnectionKey(event, blocked);
      if (direction === null) return;
      event.preventDefault();
      move(direction);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [expanded, activeIndex, notes.length]);
  function toggle() {
    setLoop(null);
    focusAfterToggle.current = true;
    onToggle();
  }
  useEffect(() => {
    if (!focusAfterToggle.current) return;
    focusAfterToggle.current = false;
    (expanded ? toggleRef : previewRef).current?.focus();
  }, [expanded]);
  if (debrief.status === 'ready' && notes.length === 0) return null;
  return <section className={`home-connections${expanded ? ' is-expanded' : ' is-compact'}`} aria-label="Last session connections">
    <header className="home-connections-heading">
      {!expanded ? <h2>don't miss these connections...</h2> : null}
      {expanded ? <button type="button" className="secondary-button" ref={toggleRef} onClick={toggle}
        aria-expanded="true" aria-controls="home-connections-content">Minimize</button> : null}
    </header>
    <div id="home-connections-content">
      {!expanded && debrief.status !== 'ready' ? <button type="button" className="home-connections-preview"
        ref={previewRef} onClick={toggle} aria-expanded="false">
        <span>{pending ? 'Finding a few connections…' : 'The connections couldn’t load.'}</span>
        <small>{pending ? 'Your session is saved. Open connections ↗' : 'Open connections to try again ↗'}</small>
      </button> : notes.length > 0 ? expanded ? <>
        <div className="home-connections-ring" role="group" aria-roledescription="carousel" aria-label="Session connections">
          {homeConnectionNeighbors(activeIndex, notes.length).map((neighbor) => <button type="button"
            key={neighbor.side} className={`home-connections-neighbor is-${neighbor.side}`}
            aria-label={`${neighbor.side === 'previous' ? 'Previous' : 'Next'} connection: ${neighbor.index + 1} of ${notes.length}`}
            onClick={() => move(neighbor.side === 'previous' ? -1 : 1)}>
            <span className="home-connections-turn" aria-hidden="true">{neighbor.side === 'previous' ? '←' : '→'}</span>
            <span className="home-connections-neighbor-text" aria-hidden="true">{connectionExcerpt(notes[neighbor.index].text, 220)}</span>
          </button>)}
          <article className="home-connections-note" aria-live="polite" aria-atomic="true">
            <div className="home-connections-note-content" key={activeIndex}>
            <span className="home-connections-sr-only">Connection {activeIndex + 1} of {notes.length}.</span>
            <p className="home-connections-prose">{notes[activeIndex].text}</p>
            </div>
            {loop !== null ? <svg key={loop} className="home-connections-loop" aria-hidden="true">
              <rect className="home-connections-loop-border" width="100%" height="100%" rx="12" pathLength="100"
                onAnimationEnd={() => setLoop(null)} />
              <rect className="home-connections-loop-dot" width="100%" height="100%" rx="12" pathLength="100" />
            </svg> : null}
          </article>
        </div>
      </> : <button type="button" className="home-connections-preview" ref={previewRef} onClick={toggle}
        aria-expanded="false">
        <span>{connectionExcerpt(notes[0].text, 240)}</span><small>{count} · Open connections ↗</small>
      </button> : pending ? <div className="home-connections-waiting" role="status">
        {expanded ? <div className="home-connections-astral" aria-hidden="true"><i /><i /><i /><b /><b /><b /></div> : null}
        <p>Finding a few connections…</p><p className="notes">Your session is saved. You can leave this open or come back later.</p>
      </div> : debrief.status === 'failed' ? <div className="home-connections-waiting">
        <p>The connections couldn’t load. Your session is saved.</p>
        <button type="button" className="secondary-button" disabled={retrying} onClick={onRetry}>Try again</button>
      </div> : null}
      {error ? <p className="home-connections-error" role="alert">Couldn’t refresh the connections. <button type="button" className="secondary-button" onClick={onReload}>Try loading again</button></p> : null}
    </div>
  </section>;
}
