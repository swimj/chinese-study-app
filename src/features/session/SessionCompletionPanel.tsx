import { SessionRecoveryHighlights } from './SessionSummaryPanel';
import { useEffect } from 'react';
import { formatCardCharacters, type CharacterPresentation } from '../../domain/card-characters';
import type { SessionCompletion } from '../../domain/session-completion';
import type { SessionSummary } from './session-summary';
import { isEditableKeyboardTarget, isImeComposingEvent, type SessionKeyEvent } from './session-keyboard';

export type SessionCompletionPanelProps = {
  summary: SessionSummary;
  completion: SessionCompletion | null;
  saving: boolean;
  busy: boolean;
  error: string | null;
  hasUndo: boolean;
  onUndo: () => void;
  onReturnHome: () => void;
  onKeepOpen: () => void;
  onRetry: () => void;
  keepOpen: boolean;
  remainingSeconds: number | null;
  characterPresentation: CharacterPresentation;
};

export function resolveCompletionKey(event: SessionKeyEvent & { repeat?: boolean; defaultPrevented?: boolean },
  blocked: boolean, canUndo: boolean): 'undo' | 'home' | null {
  const letterUndo = event.key.toLowerCase() === 'u' || event.key.toLowerCase() === 'z';
  if (blocked || event.repeat || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey
    || (event.shiftKey && !letterUndo) || isImeComposingEvent(event)) return null;
  if ((event.key === 'Backspace' || letterUndo) && canUndo) return 'undo';
  return event.key === ' ' ? 'home' : null;
}

export function SessionCompletionPanel({ summary, completion, saving, busy, error, hasUndo,
  onUndo, onReturnHome, onKeepOpen, onRetry, keepOpen, remainingSeconds, characterPresentation }: SessionCompletionPanelProps) {
  const closed = completion?.status === 'closed';
  const pending = completion?.status === 'pending';
  const canUndo = hasUndo && pending && completion.canUndo && remainingSeconds !== null
    && remainingSeconds > 0 && !saving && !busy;
  const canReturn = !saving && !busy && (pending || closed);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const nativeTarget = event.target instanceof HTMLElement
        && event.target.closest('button, a, summary, [role="button"], [role="link"]') !== null;
      const command = resolveCompletionKey(event,
        busy || saving || isEditableKeyboardTarget(event.target) || nativeTarget, canUndo);
      if (!command || (command === 'home' && !canReturn)) return;
      event.preventDefault();
      if (command === 'undo') onUndo();
      else onReturnHome();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [busy, saving, canUndo, canReturn, onUndo, onReturnHome]);

  let status = 'Saving…';
  if (closed) status = keepOpen ? 'Session saved. Take your time reviewing it.' : 'Session saved. Returning to Home…';
  else if (pending && remainingSeconds !== null) {
    status = remainingSeconds <= 0 ? 'Closing session…'
      : keepOpen ? `Undo is available for ${remainingSeconds} more seconds.`
        : `Returning to Home in ${remainingSeconds} seconds.`;
  }
  if (error || completion?.status === 'failed') status = 'Your session could not be saved. Try again to finish.';

  return (
    <section className="session-completion" aria-labelledby="session-completion-title" aria-busy={saving || busy}>
      <h2 id="session-completion-title">Session Summary</h2>
      <p className="session-completion-status" aria-live="off">{status}</p>
      <p className="session-completion-sr-only" role="status">
        {saving ? 'Saving the session.' : closed ? 'Session closed and saved.'
          : pending ? 'Completion saved. The final Undo window is open.' : ''}
      </p>
      {pending ? <p className="notes">Your results are provisional until the Undo window closes.</p> : null}
      {error || completion?.error ? <p className="session-completion-error" role="alert">{error ?? completion?.error}</p> : null}
      <div className="session-completion-actions">
        <button type="button" className="primary-button" disabled={!canReturn} onClick={onReturnHome}>
          Return to Home <kbd>Space</kbd>
        </button>
        {hasUndo && !closed ? <button type="button" className="secondary-button" disabled={!canUndo} onClick={onUndo}>
          Undo last action <kbd>U</kbd>
        </button> : null}
        {!keepOpen && !closed ? <button type="button" className="secondary-button" disabled={busy} onClick={onKeepOpen}>
          Keep summary open
        </button> : null}
        {error || completion?.status === 'failed' ? <button type="button" className="secondary-button" disabled={saving || busy} onClick={onRetry}>Try saving again</button> : null}
      </div>
      {keepOpen && pending ? <p className="notes">The session will still close automatically. This summary will stay open.</p> : null}
      {completion ? <div className="session-completion-report">
        <CompletionWords title="New words studied" words={completion.report.newWords} characterPresentation={characterPresentation} />
        <CompletionWords title="Graduated to Review" words={completion.report.graduatedWords} characterPresentation={characterPresentation} />
      </div> : null}
      {closed ? <SessionRecoveryHighlights sessionId={summary.sessionId} characterPresentation={characterPresentation} /> : null}
      <p className="notes">{summary.answeredCount} answers · {formatElapsed(summary.activeDurationMs)} of study</p>
    </section>
  );
}

function CompletionWords({ title, words, characterPresentation }: {
  title: string;
  words: SessionCompletion['report']['newWords'];
  characterPresentation: CharacterPresentation;
}) {
  if (!words.length) return null;
  const wordList = <ul>{words.map((word) => <li key={word.id}>
    <strong>{formatCardCharacters(word, characterPresentation)}</strong>
    <span>{word.pinyin}</span><span>{word.meaning}</span>
  </li>)}</ul>;
  return <section className="session-completion-word-group" aria-label={title}>
    <h3>{title} <span className="session-completion-count">{words.length}</span></h3>
    {words.length > 6 ? <details><summary>View words</summary>{wordList}</details> : wordList}
  </section>;
}

function formatElapsed(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
