import { useRef, useState } from 'react';
import type { SessionDebrief } from '../../domain/session-debrief';
import { connectionExcerpt, homeConnectionNeighbors } from './home-connections-state';

export function HomeConnections({ debrief, expanded, error, retrying, onToggle, onRetry, onReload, onSummary }: {
  debrief: SessionDebrief; expanded: boolean; error: string | null; retrying: boolean;
  onToggle: () => void; onRetry: () => void; onReload: () => void; onSummary: () => void;
}) {
  const [index, setIndex] = useState(0);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const previousRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const notes = debrief.status === 'ready' ? debrief.notes ?? [] : [];
  const activeIndex = Math.min(index, Math.max(0, notes.length - 1));
  const pending = debrief.status === 'queued' || debrief.status === 'running' || retrying;
  const date = new Date(debrief.completedAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
  const count = `${notes.length} connection${notes.length === 1 ? '' : 's'}`;
  function move(direction: -1 | 1) {
    if (!notes.length) throw new Error('Cannot navigate an empty connection result.');
    setIndex((activeIndex + direction + notes.length) % notes.length);
  }
  function toggle() {
    onToggle();
    // Both layouts retain this button, keeping keyboard focus across the change.
    toggleRef.current?.focus();
  }
  return <section className={`home-connections${expanded ? ' is-expanded' : ' is-compact'}`} aria-label="Last session connections">
    <header className="home-connections-heading">
      <div><h2>Connections from your last session</h2><p>{date} · {debrief.exerciseCount} exercises</p></div>
      <button type="button" className="secondary-button" ref={toggleRef} onClick={toggle}
        aria-expanded={expanded} aria-controls="home-connections-content"
        disabled={debrief.status === 'ready' && notes.length === 0}>
        {expanded ? 'Minimize' : 'Expand'}
      </button>
    </header>
    <div id="home-connections-content">
      {notes.length > 0 ? expanded ? <>
        <div className="home-connections-ring" role="group" aria-roledescription="carousel" aria-label="Session connections">
          {homeConnectionNeighbors(activeIndex, notes.length).map((neighbor) => <button type="button"
            key={neighbor.side} className={`home-connections-neighbor is-${neighbor.side}`}
            aria-label={`${neighbor.side === 'previous' ? 'Previous' : 'Next'} connection: ${neighbor.index + 1} of ${notes.length}`}
            onClick={() => { move(neighbor.side === 'previous' ? -1 : 1); (neighbor.side === 'previous' ? previousRef : nextRef).current?.focus(); }}>
            <span aria-hidden="true">{connectionExcerpt(notes[neighbor.index].text, 220)}</span>
          </button>)}
          <article className="home-connections-note" aria-live="polite" aria-atomic="true">
            <div className="home-connections-note-content" key={activeIndex}>
            <p className="home-connections-position">Connection {activeIndex + 1} of {notes.length}</p>
            <p className="home-connections-prose">{notes[activeIndex].text}</p>
            </div>
          </article>
        </div>
        {notes.length > 1 ? <div className="home-connections-navigation">
          <button type="button" className="secondary-button" ref={previousRef} onClick={() => move(-1)} aria-label="Previous connection">← <span>Previous</span></button>
          <span aria-hidden="true">{activeIndex + 1} / {notes.length}</span>
          <button type="button" className="secondary-button" ref={nextRef} onClick={() => move(1)} aria-label="Next connection"><span>Next</span> →</button>
        </div> : null}
      </> : <button type="button" className="home-connections-preview" onClick={toggle}>
        <span>{connectionExcerpt(notes[0].text, 240)}</span><small>{count} · Open connections ↗</small>
      </button> : pending ? <div className="home-connections-waiting" role="status">
        {expanded ? <div className="home-connections-astral" aria-hidden="true"><i /><i /><i /><b /><b /><b /></div> : null}
        <p>Finding a few connections…</p><p className="notes">Your session is saved. You can leave this open or come back later.</p>
      </div> : debrief.status === 'failed' ? <div className="home-connections-waiting">
        <p>The connections couldn’t load. Your session is saved.</p>
        <button type="button" className="secondary-button" disabled={retrying} onClick={onRetry}>Try again</button>
      </div> : <p className="notes">Nothing extra to add this time.</p>}
      {error ? <p className="home-connections-error" role="alert">Couldn’t refresh the connections. <button type="button" className="secondary-button" onClick={onReload}>Try loading again</button></p> : null}
    </div>
    <footer><button type="button" className="home-connections-summary" onClick={onSummary}>Session summary ↗</button></footer>
  </section>;
}
