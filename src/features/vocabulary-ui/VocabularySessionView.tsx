import { useEffect, useId, useRef, useState } from 'react';
import type { VocabularyCompletionView, VocabularyControl, VocabularySessionViewProps, VocabularyWordOutcome } from './types';
import './vocabulary-ui.css';
import { WordHistoryTray } from './WordHistoryTray';

function Action({ control, onClick, children }: {
  control: VocabularyControl;
  onClick: () => void;
  children: React.ReactNode;
}) {
  if (!control.visible) return null;
  return <button type="button" className="vocab-text-button" disabled={!control.enabled}
    title={control.reason} onClick={onClick}>{children}</button>;
}

/** A controlled presentation surface. Session rules and keyboard shortcuts live outside it. */
export function VocabularySessionView(props: VocabularySessionViewProps) {
  const { controls, response, presentation } = props;
  const answerId = useId();
  const dialogTitleId = useId();
  const dialogDescriptionId = useId();
  const finishDialog = useRef<HTMLDialogElement>(null);
  const cancelFinish = useRef<HTMLButtonElement>(null);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const feedbackId = useId();
  useEffect(() => { setFeedbackOpen(false); }, [presentation.key]);

  useEffect(() => {
    if (!confirmFinish) return;
    const dialog = finishDialog.current;
    dialog?.showModal();
    cancelFinish.current?.focus();
    return () => { dialog?.close(); };
  }, [confirmFinish]);
  useEffect(() => {
    if (props.phase !== 'finishing') setConfirmFinish(false);
  }, [props.phase]);
  const closeFinishDialog = () => {
    finishDialog.current?.close();
    setConfirmFinish(false);
  };

  if (props.completion) return <Completion props={props} completion={props.completion} />;

  return <section className="vocab-session" aria-label="Study session" aria-busy={props.busy}>
    <header className="vocab-session-topline">
      <details className="vocab-overview"><summary>This session <span aria-hidden="true">⌄</span></summary>
        <dl><div><dt>Words encountered</dt><dd>{props.progress.encountered}</dd></div>
          <div><dt>Covered for today</dt><dd>{props.progress.covered}</dd></div>
          <div><dt>Study time</dt><dd>{props.progress.elapsedLabel}</dd></div></dl>
      </details>
      <Action control={controls.finishForNow} onClick={props.onFinishForNow}>Finish for now</Action>
    </header>

    {props.phase === 'finishing' && <div className="vocab-finishing" role="status">
      <div><strong>Wrapping up</strong><span>No new words. Finish the work already open.</span></div>
      <Action control={controls.finishImmediately} onClick={() => setConfirmFinish(true)}>Finish immediately</Action>
    </div>}
    {props.error && <div className="vocab-error" role="alert">{props.error}</div>}

    <article className="vocab-paper" key={presentation.key}>
      <div className="vocab-card-main">
        <div className="vocab-card-topline">
          <span className="vocab-eyebrow">{presentation.label}</span>
          <span className="vocab-mode-label">{props.modeLabel}</span>
        </div>
        {props.visibleWord && !response.revealed && <div className="vocab-visible-word">
          <strong lang="zh">{props.visibleWord.hanzi}</strong><span>{props.visibleWord.pinyin}</span>
        </div>}
        <div className={`vocab-prompt vocab-prompt-${presentation.kind}`}>{presentation.prompt}</div>
        {presentation.supportingContent && <div className="vocab-supporting">{presentation.supportingContent}</div>}

        {response.revealed && <section className={`vocab-answer vocab-answer-${response.assessment}`} aria-label="Answer">
          <p className="vocab-eyebrow">{response.assessment === 'accepted' ? 'That works' : response.assessment === 'rejected' ? 'Not quite — expected answer' : 'Answer'}</p>
          {response.answer}
          {response.message && <p className="vocab-answer-message">{response.message}</p>}
        </section>}

        <form className="vocab-response" onSubmit={(event) => {
          event.preventDefault();
          if (response.primaryEnabled && !props.busy) props.onPrimary();
        }}>
          {response.visible && !response.revealed && <div className="vocab-input-wrap">
            <label htmlFor={answerId}>Your answer</label>
            <input id={answerId} value={response.value} placeholder={response.placeholder} autoComplete="off"
              disabled={response.disabled || props.busy} onChange={(event) => props.onResponseChange(event.target.value)} />
          </div>}
          <div className="vocab-main-actions">
            <button type="submit" className="vocab-primary" disabled={!response.primaryEnabled || props.busy}>{response.primaryLabel}</button>
            <Action control={controls.another} onClick={props.onAnother}>Try another way</Action>
            <Action control={controls.skip} onClick={props.onSkip}>Skip exercise</Action>
          </div>
        </form>
      </div>

      <footer className="vocab-card-footer">
        <div className="vocab-word-controls">
          <Action control={controls.enough} onClick={props.onEnough}>{props.wordWork?.enoughLabel ?? (props.wordWork?.extraPractice ? "I’m satisfied" : "Enough for today")}</Action>
          {props.leaveForToday && props.onLeaveForToday && <Action control={props.leaveForToday} onClick={props.onLeaveForToday}>Leave for today</Action>}
          <Action control={controls.more} onClick={props.onMore}>More practice</Action>
        </div>
        {props.feedback.visible && <button type="button" className="vocab-feedback-toggle" aria-expanded={feedbackOpen} aria-controls={feedbackId}
          onClick={() => setFeedbackOpen((open) => !open)}>How was this exercise? <span aria-hidden="true">{feedbackOpen ? "−" : "+"}</span></button>}
        {props.feedback.visible && feedbackOpen && <div id={feedbackId} className="vocab-feedback-body">
            <div className="vocab-reactions" role="group" aria-label="Exercise feedback">
              <button type="button" aria-pressed={props.feedback.reaction === 'helpful'} disabled={props.feedback.status === 'saving'}
                onClick={() => props.onReaction(props.feedback.reaction === 'helpful' ? null : 'helpful')}>Helpful</button>
              <button type="button" aria-pressed={props.feedback.reaction === 'not-helpful'} disabled={props.feedback.status === 'saving'}
                onClick={() => props.onReaction(props.feedback.reaction === 'not-helpful' ? null : 'not-helpful')}>Not helpful</button>
            </div>
            <label>Anything you want to add?<textarea value={props.feedback.comment} placeholder="What felt off, or what might help?"
              disabled={props.feedback.status === 'saving'} onChange={(event) => props.onCommentChange(event.target.value)} /></label>
            <div className="vocab-feedback-send"><button type="button" disabled={!props.feedback.comment.trim() || props.feedback.status === 'saving'}
              onClick={props.onCommentSubmit}>{props.feedback.status === 'saving' ? 'Sending…' : 'Send note'}</button>
              <span role="status">{props.feedback.status === 'saved' ? 'Feedback saved' : ''}</span></div>
          </div>}
      </footer>
    </article>

    {props.history && props.history.length > 0 && <WordHistoryTray words={props.history} busy={props.busy} onResume={props.onPractiseWord} />}

    <div className="vocab-session-bottomline">
      <Action control={controls.undo} onClick={props.onUndo}>Undo last action</Action>
      <span>{props.progress.covered} covered <span className="vocab-dot">·</span> {props.progress.elapsedLabel}</span>
    </div>

    {confirmFinish && <dialog ref={finishDialog} className="vocab-finish-dialog" aria-labelledby={dialogTitleId}
      aria-describedby={dialogDescriptionId} onCancel={(event) => { event.preventDefault(); closeFinishDialog(); }} onClose={() => setConfirmFinish(false)}>
      <h2 id={dialogTitleId}>Finish here?</h2>
      <p id={dialogDescriptionId}>Unfinished words will stay due for your next session. Your answers and feedback will be saved.</p>
      <div><button ref={cancelFinish} type="button" className="vocab-secondary" onClick={closeFinishDialog}>Keep wrapping up</button>
        <button type="button" className="vocab-primary" disabled={!controls.finishImmediately.enabled || props.busy} onClick={() => {
          closeFinishDialog();
          props.onFinishImmediately();
        }}>Finish immediately</button></div>
    </dialog>}
  </section>;
}

function OutcomeModeControl({ props, outcome }: { props: VocabularySessionViewProps; outcome: VocabularyWordOutcome }) {
  if (!props.onWordModeChange || !outcome.modeChoices?.length) return null;
  return <details className="vocab-mode-picker"><summary>{outcome.modeLabel ?? outcome.mode} <span aria-hidden="true">⌄</span></summary>
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

function Completion({ props, completion }: { props: VocabularySessionViewProps; completion: VocabularyCompletionView }) {
  const pending = completion.status === 'pending';
  const failed = completion.status === 'failed';
  const status = completion.status === 'saving' ? 'Saving your session…'
    : failed ? 'Your session still needs to be saved.'
      : pending ? `Session closes in ${completion.remainingSeconds ?? 'a few'} seconds.` : 'Session saved.';
  return <section className="vocab-session vocab-completion" aria-labelledby="vocab-summary-heading" aria-busy={props.busy}>
    <header className="vocab-session-topline"><span>Session summary</span><span>{completion.elapsedLabel} of study</span></header>
    <article className="vocab-paper">
      <div className="vocab-card-main">
        <p className="vocab-eyebrow">{pending ? 'Wrapping up' : 'For today'}</p>
        <h1 id="vocab-summary-heading">Your session</h1>
        <p className="vocab-summary-facts"><strong>{completion.covered}</strong> words covered <span className="vocab-dot">·</span> {completion.encountered} encountered</p>
        <div className={`vocab-save-status${failed ? ' vocab-error' : ''}`} role="status"><span className="vocab-status-dot" aria-hidden="true" />{status}</div>
        {props.error && <p className="vocab-error" role="alert">{props.error}</p>}
        {pending && <p className="vocab-summary-hint">You can still undo the last action or return to study before this closes.</p>}

        {completion.outcomes.length > 0 && <section className="vocab-outcomes" aria-label="Words from this session">
          <h2>Words from this session</h2>
          <ul>{completion.outcomes.map((outcome) => <li key={outcome.word.id}>
            <div className="vocab-outcome-word"><strong lang="zh">{outcome.word.hanzi}</strong><span>{outcome.word.pinyin}</span><p>{outcome.detail}</p></div>
            <div><OutcomeModeControl props={props} outcome={outcome} />{outcome.canPractise && <button type="button" className="vocab-text-button" disabled={props.busy} onClick={() => props.onPractiseWord(outcome.word.id)}>Practise more</button>}
              {outcome.canDismiss && <button type="button" className="vocab-text-button" disabled={props.busy} onClick={() => props.onDismissWord(outcome.word.id)}>Dismiss word</button>}</div>
          </li>)}</ul>
        </section>}
        {completion.feedback.length > 0 && <section className="vocab-lessons" aria-label="Study feedback">
          <h2>A note on your practice</h2>
          {completion.feedback.map((message) => <article key={message.id}><h3>{message.title}</h3><div>{message.body}</div></article>)}
        </section>}
      </div>
      <footer className="vocab-summary-actions">
        <button type="button" className="vocab-primary" disabled={!completion.canReturnHome || props.busy} onClick={props.onReturnHome}>Return home</button>
        {pending && completion.canUndo && <button type="button" className="vocab-text-button" disabled={props.busy} onClick={props.onUndo}>Undo last action</button>}
        {pending && completion.canCancel && <button type="button" className="vocab-text-button" disabled={props.busy} onClick={props.onCancelCompletion}>Return to study</button>}
        {failed && <button type="button" className="vocab-secondary" disabled={props.busy} onClick={props.onRetryCompletion}>Try saving again</button>}
      </footer>
    </article>
  </section>;
}
