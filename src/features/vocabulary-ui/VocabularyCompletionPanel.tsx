import { CompletionWordGroup } from '../session/CompletionWordGroup';
import { useEffect, useId, useRef } from 'react';
import { ShortcutHint } from '../../components/ShortcutHint';
import type { VocabularyCompletionView, VocabularySessionViewProps, VocabularyWordOutcome } from './types';

export type VocabularyCompletionPanelActions = Pick<VocabularySessionViewProps, 'busy' | 'error' | 'onWordModeChange' | 'onPractiseWord' | 'onDismissWord' | 'onReturnHome' | 'onUndo' | 'onKeepSummaryOpen' | 'onCancelCompletion' | 'onRetryCompletion'>;

function OutcomeModeControl({ props, outcome }: { props: VocabularyCompletionPanelActions; outcome: VocabularyWordOutcome }) {
  if (!props.onWordModeChange || !outcome.modeChoices?.length) return null;
  return <details className="vocab-mode-picker" onToggle={(event) => { if(event.currentTarget.open) props.onKeepSummaryOpen?.(); }}><summary>{outcome.modeLabel ?? outcome.mode} <span aria-hidden="true">⌄</span></summary>
    <div className="vocab-mode-options" role="group" aria-label={`Learning mode for ${outcome.word.hanzi}`}>
      <p>Learning mode</p>
      {outcome.modeChoices.map((choice) => <button key={choice.value} type="button" aria-label={`${choice.label}. ${choice.description}`} aria-pressed={choice.value === outcome.mode}
        disabled={!choice.enabled || props.busy} onClick={(event) => {
          props.onWordModeChange?.(outcome.word.id, choice.value);
          const details = event.currentTarget.closest('details');
          details?.removeAttribute('open');
          details?.querySelector('summary')?.focus();
        }}><strong>{choice.label}</strong><span>{choice.description}</span></button>)}
    </div>
  </details>;
}

function CompletionWords({ title, outcomes, props }: {
  title: string; outcomes: VocabularyWordOutcome[]; props: VocabularyCompletionPanelActions;
}) {
  if (!outcomes.length) return null;
  const words = <ul>{outcomes.map((outcome) => <li key={outcome.word.id}>
    <div className="vocab-outcome-word"><strong lang="zh">{outcome.word.hanzi}</strong><span>{outcome.word.pinyin}</span>
      <p className="vocab-outcome-meaning">{outcome.word.meaning}</p>{outcome.detail && <p>{outcome.detail}</p>}</div>
    <div><OutcomeModeControl props={props} outcome={outcome} />
      {outcome.canPractise && <button type="button" className="vocab-text-button" disabled={props.busy} onClick={() => props.onPractiseWord(outcome.word.id)}>Practise more</button>}
      {outcome.canDismiss && <button type="button" className="vocab-text-button" disabled={props.busy} onClick={() => props.onDismissWord(outcome.word.id)}>Dismiss word</button>}</div>
  </li>)}</ul>;
  return <CompletionWordGroup title={title} count={outcomes.length} variant="vocabulary"
    onExpand={props.onKeepSummaryOpen}>{words}</CompletionWordGroup>;
}

/** Retains the completion report layout while using vocabulary learning modes and outcomes. */
export function VocabularyCompletionPanel({ props, completion }: { props: VocabularyCompletionPanelActions; completion: VocabularyCompletionView }) {
  const titleId = useId();
  const homeButton = useRef<HTMLButtonElement>(null);
  const undoButton = useRef<HTMLButtonElement>(null);
  const hadUndo = useRef(completion.canUndo);
  const pending = completion.status === 'pending';
  const closed = completion.status === 'closed';
  const failed = completion.status === 'failed';
  useEffect(() => { if (completion.canUndo) hadUndo.current = true; }, [completion.canUndo]);
  useEffect(() => {
    if (closed && document.activeElement === undoButton.current) homeButton.current?.focus();
  }, [closed]);
  const seconds = completion.remainingSeconds;
  const status = completion.status === 'saving' ? 'Saving your session…'
    : failed ? 'Your session could not be saved. Try again to finish.'
      : pending ? seconds === null ? 'Session saved. The final Undo window is open.'
        : seconds <= 0 ? 'Closing session…'
          : completion.keepOpen ? `Undo is available for ${seconds} more seconds.` : `Returning to Home in ${seconds} seconds.`
        : 'Session saved.';
  const groups: Array<{ title: string; group: VocabularyWordOutcome['group'] }> = [
    { title: "Today’s new words", group: 'new' },
    { title: 'Words solidified', group: 'graduated' },
    { title: 'Covered for today', group: 'covered' },
    { title: 'Left for next time', group: 'unfinished' },
    { title: 'Words from this session', group: undefined },
  ];
  return <section className="vocab-session vocab-completion" aria-labelledby={titleId} aria-busy={props.busy}>
    <article className="vocab-paper">
      <div className="vocab-card-main">
        <h1 id={titleId}>Session Summary</h1>
        <p className={`vocab-save-status${failed ? ' vocab-error' : ''}`} aria-live="off">{status}</p>
        <p className="vocab-completion-sr-only" role="status">{completion.status === 'saving' ? 'Saving the session.'
          : closed ? 'Session closed and saved.' : pending ? 'Completion saved. The final Undo window is open.' : 'Your session still needs to be saved.'}</p>
        {pending && <p className="vocab-summary-hint">Your results are provisional until the Undo window closes.</p>}
        {props.error && <p className="vocab-error" role="alert">{props.error}</p>}
        <div className="vocab-summary-actions">
          <button ref={homeButton} type="button" className="vocab-primary" disabled={!completion.canReturnHome || props.busy} aria-keyshortcuts="Space" onClick={props.onReturnHome}>Return to Home<ShortcutHint shortcut="Space" /></button>
          {((pending && completion.canUndo) || (closed && hadUndo.current)) && <button ref={undoButton} type="button" className={`vocab-text-button${closed ? ' vocab-expired-action' : ''}`}
            disabled={closed || props.busy} aria-hidden={closed || undefined} tabIndex={closed ? -1 : undefined}
            aria-keyshortcuts={closed ? undefined : 'U'} onClick={props.onUndo}>Undo last action<ShortcutHint shortcut="U" /></button>}
          {pending && !completion.keepOpen && props.onKeepSummaryOpen && <button type="button" className="vocab-text-button" disabled={props.busy} onClick={props.onKeepSummaryOpen}>Keep summary open</button>}
          {pending && completion.canCancel && <button type="button" className="vocab-text-button" disabled={props.busy} onClick={props.onCancelCompletion}>Return to study</button>}
          {failed && <button type="button" className="vocab-secondary" disabled={props.busy} onClick={props.onRetryCompletion}>Try saving again</button>}
        </div>
        {pending && completion.keepOpen && <p className="vocab-summary-hint">The session will still close automatically. This summary will stay open.</p>}
        <div className="vocab-summary-report">
          {groups.map(({ title, group }) => <CompletionWords key={title} title={title} outcomes={completion.outcomes.filter((outcome) => outcome.group === group)} props={props} />)}
        </div>
        <p className="vocab-summary-facts">{completion.elapsedLabel} of study <span className="vocab-dot">·</span> {completion.covered} words covered <span className="vocab-dot">·</span> {completion.encountered} encountered</p>
        {completion.feedback.length > 0 && <section className="vocab-lessons" aria-label="Study feedback">
          <h2>A note on your practice</h2>
          {completion.feedback.map((message) => <article key={message.id}><h3>{message.title}</h3><div>{message.body}</div></article>)}
        </section>}
      </div>
    </article>
  </section>;
}
