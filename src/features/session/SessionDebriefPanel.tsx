import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { SessionDesk, type SessionDeskHandle } from './SessionDesk';
import { useSessionDebrief } from './useSessionDebrief';
import type { SessionDebriefLoadState } from './session-debrief-loader';
import { resolveSessionDebriefKey } from './session-debrief-keyboard';
import { isEditableKeyboardTarget } from './session-keyboard';
import { useSessionDialogFocus } from './session-dialog-focus';
import { SessionRecoveryHighlights, SessionReflectionStatus } from './SessionSummaryPanel';
import { DEFAULT_CHARACTER_PRESENTATION, type CharacterPresentation } from '../../domain/card-characters';
import type { SessionFinalizationState } from './session-finalization';

export function SessionDebriefPanel({ sessionId, completedAt, exerciseCount, onDone, finalization, onRetryReflection, characterPresentation = DEFAULT_CHARACTER_PRESENTATION }: {
  sessionId: string; completedAt?: string; exerciseCount?: number; onDone: () => void;
  characterPresentation?: CharacterPresentation;
  finalization?: SessionFinalizationState; onRetryReflection?: () => void;
}) {
  const load = useSessionDebrief(sessionId);
  const [index, setIndex] = useState(0);
  const [guideOpen, setGuideOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const desk = useRef<SessionDeskHandle>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const notes = load.debrief?.status === 'ready' ? load.debrief.notes ?? [] : [];
  async function move(direction: 'next' | 'back') {
    if (busyRef.current || guideOpen || notes.length === 0) return;
    if (direction === 'next' && index === notes.length - 1) { onDone(); return; }
    if (direction === 'back' && index === 0) return;
    busyRef.current = true;
    setBusy(true);
    const change = () => {
      setIndex((current) => current + (direction === 'next' ? 1 : -1));
      scroll.current?.scrollTo({ top: 0 });
    };
    try {
      if (desk.current) await desk.current.depart(direction === 'next' ? 'done' : 'ongoing', change);
      else change();
    } finally { busyRef.current = false; setBusy(false); }
  }
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const command = resolveSessionDebriefKey(event, {
        editable: isEditableKeyboardTarget(event.target),
        native: event.target instanceof Element && !!event.target.closest('button,a[href],summary'),
        guideOpen, busy: busyRef.current, ready: notes.length > 0, canGoBack: index > 0,
      });
      if (!command) return;
      event.preventDefault();
      if (command === 'guide') setGuideOpen(true);
      else void move(command);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [guideOpen, index, notes.length, onDone]);
  const date = load.debrief?.completedAt ?? completedAt;
  return <div className="panel study-session-panel session-panel-active session-debrief-panel">
    <div className={`session-interaction-surface${guideOpen ? ' is-paused' : ''}`}>
      <SessionDesk ref={desk} enabled mistakeKey={null} remaining={0} again={0} answered={0} elapsed=""
        summaryDate={date ? new Date(date).toLocaleDateString() : ''}>
        <SessionDebriefCard sessionId={sessionId} characterPresentation={characterPresentation} state={load} index={index} date={date} exerciseCount={load.debrief?.exerciseCount ?? exerciseCount}
          busy={busy} scrollRef={scroll} onNext={() => void move('next')} onBack={() => void move('back')}
          onDone={onDone} onRetry={load.retry} onReload={load.reload} onGuide={() => setGuideOpen(true)}>
          {finalization && onRetryReflection ? <details className="debrief-reflection-details">
            <summary>Content improvements</summary>
            <SessionReflectionStatus finalization={finalization} onRetryReflection={onRetryReflection} />
          </details> : null}
        </SessionDebriefCard>
      </SessionDesk>
    </div>
    {guideOpen ? <DebriefShortcutGuide onClose={() => setGuideOpen(false)} /> : null}
  </div>;
}

export function SessionDebriefCard({ sessionId, characterPresentation = DEFAULT_CHARACTER_PRESENTATION, state, index, date, exerciseCount, busy, scrollRef, onNext, onBack, onDone, onRetry, onReload, onGuide, children }: {
  sessionId: string; characterPresentation?: CharacterPresentation;
  state: SessionDebriefLoadState; index: number; date?: string; exerciseCount?: number; busy: boolean;
  scrollRef?: RefObject<HTMLDivElement>; onNext: () => void; onBack: () => void; onDone: () => void;
  onRetry: () => void; onReload: () => void; onGuide: () => void; children?: ReactNode;
}) {
  const { debrief, error, loading, retrying } = state;
  const notes = debrief?.status === 'ready' ? debrief.notes ?? [] : [];
  const pending = debrief?.status === 'queued' || debrief?.status === 'running' || retrying || loading;
  return <section className="review-card session-card-shell" aria-label="Session summary">
    <div className="session-card-scroll" ref={scrollRef}>
      <p className="debrief-kicker">Session saved</p>
      <h2 className="debrief-title">Session complete</h2>
      <p className="debrief-facts">{exerciseCount !== undefined ? `${exerciseCount} exercise${exerciseCount === 1 ? '' : 's'}` : ''}
        {date ? ` · ${new Date(date).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}` : ''}</p>
      <SessionRecoveryHighlights key={sessionId} sessionId={sessionId} characterPresentation={characterPresentation} />
      {error ? <div className="debrief-waiting" role="alert">
        <p>The connections couldn’t load.</p><p className="notes">{error}</p>
        <button type="button" className="secondary-button" onClick={onReload}>Try loading again</button>
      </div> : pending ? <div className="debrief-waiting" role="status">
        <span className="debrief-breath" aria-hidden="true"><i /><i /><i /></span>
        <p>Finding a few connections…</p><p className="notes">You can find this session on Home while it finishes.</p>
      </div> : debrief?.status === 'failed' ? <div className="debrief-waiting" role="status">
        <p>The connections couldn’t load.</p><p className="notes">Your session is saved.</p>
        <button type="button" className="secondary-button" disabled={retrying} onClick={onRetry}>Try again</button>
      </div> : notes.length ? <div className="debrief-connection" key={index}>
        <p className="debrief-progress" role="status">Connection {index + 1} of {notes.length}</p>
        <article><p className="debrief-note">{notes[index].text}</p></article>
      </div> : <div className="debrief-waiting"><p>{debrief?.status === 'ready' ? 'Nothing extra to add this time.' : 'No connections are available for this session.'}</p></div>}
      {children}
    </div>
    <div className="session-action-bar debrief-actions">
      {notes.length && !error ? <><button type="button" disabled={busy} onClick={onNext}>
        {index === notes.length - 1 ? 'Done' : 'Next connection'} <kbd>Space / Enter</kbd></button>
        <button type="button" className="secondary-button" disabled={index === 0 || busy} onClick={onBack}>Back <kbd>←</kbd></button>
        <button type="button" className="secondary-button debrief-home" disabled={busy} onClick={onDone}>Home</button></>
        : <button type="button" onClick={onDone}>Back to Home</button>}
      <button type="button" className="secondary-button debrief-shortcuts" onClick={onGuide}>Shortcuts <kbd>?</kbd></button>
    </div>
  </section>;
}

function DebriefShortcutGuide({ onClose }: { onClose: () => void }) {
  const root = useRef<HTMLElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  useSessionDialogFocus({ open: true, containerRef: root, initialFocusRef: close, onClose,
    isolateSessionKeys: true, alsoCloseOn: ['?'] });
  return <div className="keyboard-shortcuts-backdrop" onClick={onClose}>
    <section className="keyboard-shortcuts-card" role="dialog" aria-modal="true" aria-labelledby="debrief-shortcuts-title"
      ref={root} onClick={(event) => event.stopPropagation()}>
      <div className="keyboard-shortcuts-heading"><h3 id="debrief-shortcuts-title">Keyboard shortcuts</h3>
        <button type="button" ref={close} className="secondary-button" onClick={onClose}>Close <kbd>Escape</kbd></button></div>
      <dl className="keyboard-shortcuts-list"><div><dt>Space / Enter / →</dt><dd>Next connection, or Done on the last card</dd></div>
        <div><dt>←</dt><dd>Previous connection</dd></div><div><dt>?</dt><dd>Open or close this guide</dd></div></dl>
      <p className="notes">Shortcuts pause while typing or using buttons and disclosures.</p>
    </section>
  </div>;
}
