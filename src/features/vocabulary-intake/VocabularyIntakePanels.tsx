import { useEffect, useId, useLayoutEffect, useRef } from 'react';
import type { VocabularyIntakeTurn, VocabularyIntakeProgress } from '../../domain/vocabulary-intake';
import { VocabularyIntakeCard } from './VocabularyIntakeCard';
import type { VocabularyIntakeController } from './useVocabularyIntake';
import './vocabulary-intake.css';

function CardList({ ids, controller }: { ids: string[]; controller: VocabularyIntakeController }) {
  return (
    <div className="intake-card-list">
      {ids.map(id => {
        const card = controller.records[id]?.card;
        return card ? <VocabularyIntakeCard key={id} card={card} controller={controller} /> : null;
      })}
    </div>
  );
}

function TranscriptTurn({
  turn, cardIds, controller, local = false, progress,
}: {
  turn: VocabularyIntakeTurn;
  cardIds: string[];
  controller: VocabularyIntakeController;
  local?: boolean;
  progress?: VocabularyIntakeProgress;
}) {
  return (
    <section className="intake-turn" aria-label="Conversation turn" data-intake-turn={turn.id}>
      <p className="intake-user-message">{turn.userText}</p>
      {turn.assistantText && <p className="intake-reply">{turn.assistantText}</p>}
      {cardIds.length > 0 && <CardList ids={cardIds} controller={controller} />}
      {turn.status === 'running' && !turn.assistantText && <p className="intake-muted" role="status">{({checking:'Checking your request…',looking_up:'Looking up words…',preparing_reply:'Preparing your reply…'})[progress ?? 'checking']}</p>}
      {turn.status === 'failed' && !local && <p className="intake-muted">This reply was interrupted.</p>}
    </section>
  );
}

export function VocabularyIntakeChat({ controller, visible }: { controller: VocabularyIntakeController; visible: boolean }) {
  const transcriptRef = useRef<HTMLDivElement>(null);
  const previousRevision = useRef(controller.latestRevision);
  const currentAnchor = useRef<{ turnId: string; top: number } | null>(null);
  const wasVisible = useRef(false);
  const composerId = useId();
  const transcriptHeading = useId();
  const providerNotice = useId();
  const { turns, composeTurn, scroll, latestRevision } = controller;
  // A revision brings the live card forward without repeating every earlier control set.
  const latestCardTurn = new Map<string, string>();
  for (const turn of composeTurn ? [...turns, composeTurn] : turns) {
    for (const id of turn.cardIds) latestCardTurn.set(id, turn.id);
  }
  const visibleCards = (turn: VocabularyIntakeTurn) => turn.cardIds.filter(id => latestCardTurn.get(id) === turn.id);

  useLayoutEffect(() => {
    const transcript = transcriptRef.current;
    if (!visible || !transcript) {
      wasVisible.current = false;
      return;
    }
    const goToEnd = scroll.current.atEnd || latestRevision !== previousRevision.current;
    if (goToEnd) transcript.scrollTop = transcript.scrollHeight;
    else if (!wasVisible.current) transcript.scrollTop = scroll.current.top;
    wasVisible.current = true;
    previousRevision.current = latestRevision;
  });

  useLayoutEffect(() => {
    const transcript = transcriptRef.current;
    const anchor = currentAnchor.current;
    if (!visible || !transcript || !anchor || controller.loadingEarlier) return;
    const previousTurn = Array.from(transcript.querySelectorAll<HTMLElement>('[data-intake-turn]'))
      .find(node => node.dataset.intakeTurn === anchor.turnId);
    if (previousTurn) transcript.scrollTop += previousTurn.getBoundingClientRect().top - anchor.top;
    currentAnchor.current = null;
  }, [controller.loadingEarlier, turns, visible]);

  const sending = composeTurn?.status === 'running';
  const canSend = controller.initialized && !composeTurn && Boolean(controller.draft.trim());

  function send() {
    if (canSend) void controller.send();
  }

  return (
    <section className="intake-chat" aria-labelledby={transcriptHeading}>
      <h1 className="intake-sr-only" id={transcriptHeading}>Add words chat</h1>
      <div className="intake-transcript" tabIndex={0} ref={transcriptRef} role="region" aria-label="Chat history"
        onScroll={event => {
          if (!visible) return;
          const { scrollHeight, scrollTop, clientHeight } = event.currentTarget;
          scroll.current = { top: scrollTop, atEnd: scrollHeight - scrollTop - clientHeight < 36 };
        }}>
        <div className="intake-transcript-inner">
          {!controller.initialized && controller.historyError !== 'initial' && <p role="status">Loading chat…</p>}
          {controller.historyError === 'initial' && (
            <div className="intake-card-recovery"><p role="alert">Could not open the chat.</p>
              <button type="button" onClick={() => void controller.retryHistory()}>Retry</button>
            </div>
          )}
          {controller.before && (
            <button className="intake-quiet intake-earlier" type="button" disabled={controller.loadingEarlier}
              onClick={() => {
                const firstTurn = transcriptRef.current?.querySelector<HTMLElement>('[data-intake-turn]');
                if (firstTurn?.dataset.intakeTurn) currentAnchor.current = {
                  turnId: firstTurn.dataset.intakeTurn, top: firstTurn.getBoundingClientRect().top,
                };
                void controller.loadEarlier();
              }}>{controller.loadingEarlier ? 'Loading earlier messages…' : 'Load earlier messages'}</button>
          )}
          {controller.historyError === 'earlier' && <p role="alert">Could not load earlier messages. Try again.</p>}
          {turns.map(turn => <TranscriptTurn key={turn.id} turn={turn} cardIds={visibleCards(turn)} controller={controller} />)}
          {composeTurn && <TranscriptTurn key={composeTurn.id} turn={composeTurn} cardIds={visibleCards(composeTurn)} controller={controller} local progress={composeTurn.progress} />}
          {composeTurn?.error && (
            <div className="intake-card-recovery">
              <p role="alert">{composeTurn.error}</p>
              <div className="intake-card-actions">
                <button type="button" onClick={() => void controller.send(true)}>Retry message</button>
                <button className="intake-quiet" type="button" onClick={controller.stopRetrying}>Continue chat</button>
              </div>
            </div>
          )}
        </div>
      </div>
      <form className="intake-composer" onSubmit={event => { event.preventDefault(); send(); }}>
        <label className="intake-sr-only" htmlFor={composerId}>Word or sentence</label>
        <textarea
          id={composerId}
          aria-describedby={providerNotice}
          placeholder="A word or a sentence where you met it"
          rows={2}
          maxLength={4000}
          value={controller.draft}
          onChange={event => controller.setDraft(event.target.value)}
          onKeyDown={event => {
            if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || event.keyCode === 229) return;
            event.preventDefault();
            send();
          }}
        />
        <button type="submit" disabled={!canSend}>{sending ? 'Sending…' : 'Send'}</button>
        <p id={providerNotice} className="intake-composer-notice">Messages are sent to an AI provider.</p>
      </form>
    </section>
  );
}

export function VocabularyIntakeOutstanding({
  controller, onClose,
}: {
  controller: VocabularyIntakeController;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const heading = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);

  const { outstandingIds, outstandingError } = controller;

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (dialog?.open && !dialog.contains(document.activeElement)) closeRef.current?.focus();
  }, [outstandingIds]);

  function close() {
    dialogRef.current?.close();
    onClose();
  }
  return (
    <dialog ref={dialogRef} className="intake-outstanding" aria-labelledby={heading}
      onCancel={event => { event.preventDefault(); close(); }}>
      <header className="intake-outstanding-header">
        <h2 id={heading}>Outstanding words</h2>
        <button type="button" onClick={close} ref={closeRef} className="intake-quiet">Close</button>
      </header>
      <div className="intake-outstanding-body">
        {outstandingError && <div className="intake-card-recovery">
          <p role="alert">Could not load outstanding words.</p>
          <button type="button" onClick={() => void controller.refreshOutstanding()}>Retry</button>
        </div>}
        {outstandingIds === null && !outstandingError && <p role="status">Loading outstanding words…</p>}
        {outstandingIds?.length === 0 && !outstandingError && <p>No outstanding words.</p>}
        {outstandingIds && <CardList ids={outstandingIds} controller={controller} />}
      </div>
    </dialog>
  );
}
