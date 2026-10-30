import { useEffect, useId, useRef, useState } from 'react';
import type { VocabularyControl, VocabularySessionViewProps } from './types';
import './vocabulary-ui.css';
import { VocabularySessionLayout } from './VocabularySessionLayout';
import { WordHistoryTray } from './WordHistoryTray';
import { StudyStageIcon } from '../session/StudyStageBadge';
import { ShortcutHint } from '../../components/ShortcutHint';
import { RecallChips, SessionDesk } from '../session/SessionDesk';
import { VocabularyCardActionTarget } from './VocabularyCardActions';
import { VocabularyCompletionPanel } from './VocabularyCompletionPanel';

function Action({ control, onClick, children }: {
  control: VocabularyControl;
  onClick: () => void;
  children: React.ReactNode;
}) {
  if (!control.visible) return null;
  return <button type="button" className="vocab-text-button" disabled={!control.enabled}
    title={control.reason} aria-keyshortcuts={control.enabled ? control.shortcut : undefined} onClick={onClick}>{children}<ShortcutHint shortcut={control.shortcut} /></button>;
}

/** Focus once when this input becomes usable, including after an animated arrival. */
function ResponseInput({ blocked, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { blocked: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const focused = useRef(false);
  useEffect(() => {
    if (focused.current || props.disabled || blocked) return;
    input.current?.focus({ preventScroll: true });
    focused.current = document.activeElement === input.current;
  }, [props.disabled, blocked]);
  return <input {...props} ref={input} />;
}

/** A controlled presentation surface. Session rules and keyboard shortcuts live outside it. */
export function VocabularySessionView(props: VocabularySessionViewProps) {
  return <VocabularySessionLayout props={props}><VocabularySessionContent {...props} history={undefined} /></VocabularySessionLayout>;
}

/** Unplaced content is also used by the layout comparison preview. */
export function VocabularySessionContent(props: VocabularySessionViewProps) {
  const { controls, response, presentation } = props;
  const sendNoteButton = useRef<HTMLButtonElement>(null);
  const composingNote = useRef(false);
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  const sendNoteShortcut = mac ? 'Meta+Enter' : 'Control+Enter';
  const primaryInFooter = response.primaryPlacement === 'footer' && !response.revealActions;
  const primaryButton = <button type={primaryInFooter ? 'button' : 'submit'}
    className={`${response.shortcuts?.includes('Space') ? 'vocab-primary' : 'vocab-secondary'}${props.cardMotion?.confirmingPrimary ? ' is-confirming-action' : ''}`}
    aria-keyshortcuts={response.primaryEnabled ? response.shortcuts?.join(' ') : undefined}
    disabled={!response.primaryEnabled || props.busy} onClick={primaryInFooter ? props.onPrimary : undefined}>
    {response.visible && !response.revealed ? <span className="vocab-action-label"><span>{response.primaryLabel}</span><span className="vocab-action-width" aria-hidden="true">Check answer</span><span className="vocab-action-width" aria-hidden="true">No clue</span></span> : response.primaryLabel}<ShortcutHint shortcuts={response.shortcuts} /></button>;
  const showResponse = !primaryInFooter || (response.visible && !response.revealed) || controls.another.visible;
  const [actionTarget, setActionTarget] = useState<HTMLDivElement | null>(null);
  const answerId = useId();
  const dialogTitleId = useId();
  const dialogDescriptionId = useId();
  const finishDialog = useRef<HTMLDialogElement>(null);
  const cancelFinish = useRef<HTMLButtonElement>(null);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [localReactionOpen, setLocalReactionOpen] = useState(false);
  const reactionOpen = props.reactionInput.open ?? localReactionOpen;
  const setReactionOpen = props.onReactionOpenChange ?? setLocalReactionOpen;
  const reactionId = useId();
  useEffect(() => { setReactionOpen(false); }, [presentation.key]);

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

  if (props.completion) return <VocabularyCompletionPanel props={props} completion={props.completion} />;

  return <section className="vocab-session" aria-label="Study session" aria-busy={props.busy}>
    <header className="vocab-session-topline vocab-session-actions">
      <Action control={controls.finishForNow} onClick={props.onFinishForNow}>Finish for now</Action>
    </header>

    {props.phase === 'finishing' && <div className="vocab-finishing" role="status">
      <div><strong>Wrapping up</strong><span>No new words. Finish the work already open.</span></div>
      <Action control={controls.finishImmediately} onClick={() => setConfirmFinish(true)}>Finish immediately</Action>
    </div>}
    {props.error && <div className="vocab-error" role="alert">{props.error}</div>}

    <SessionDesk ref={props.cardMotion?.ref} embedded enabled={Boolean(props.cardMotion)} cardKey={presentation.key}
      mistakeKey={response.revealed && response.assessment === 'rejected' ? presentation.key : null}
      remaining={0} again={0} answered={0} elapsed={props.progress.elapsedLabel}>
    <VocabularyCardActionTarget.Provider value={actionTarget}>
    <article className="vocab-paper" key={presentation.key}>
      {props.recallProgress && props.recallProgress.length > 0 && <div className="vocab-recall-progress">
        {props.recallProgress.map((row) => <RecallChips key={row.key} label={row.label} count={row.count} total={row.total} />)}
      </div>}
      {props.teachingContent ?? <div className="vocab-card-main">
        <div className="vocab-card-content" tabIndex={0} role="region" aria-label="Exercise content">
        <div className="vocab-card-topline">
          <span className="vocab-eyebrow">{presentation.label}</span>
          <span className="vocab-mode-label"><StudyStageIcon status={props.mode === 'unstudied' ? 'unstudied' : props.mode === 'maintain' ? 'review' : 'learning'} />{props.modeLabel}</span>
        </div>
        {props.visibleWord && !response.revealed && <div className="vocab-visible-word">
          <strong lang="zh">{props.visibleWord.hanzi}</strong><span>{props.visibleWord.pinyin}</span>
        </div>}
        <div className={`vocab-prompt vocab-prompt-${presentation.kind}${presentation.recognition ? ' vocab-prompt-recognition' : ''}`}>{presentation.prompt}</div>
        {presentation.supportingContent && <div className="vocab-supporting">{presentation.supportingContent}</div>}

        {response.revealed && <section className={`vocab-answer vocab-answer-${response.assessment}${presentation.recognition ? ' vocab-answer-recognition' : ''}`} aria-label="Answer">
          {!presentation.recognition && <p className="vocab-eyebrow">{response.assessment === 'accepted' ? 'That works' : response.assessment === 'rejected' ? 'Not quite — expected answer' : 'Answer'}</p>}
          {response.answer}
          {response.message && <p className="vocab-answer-message">{response.message}</p>}
        </section>}
        </div>

        {showResponse && <form className="vocab-response" onSubmit={(event) => {
          event.preventDefault();
          if (response.primaryEnabled && !props.busy) props.onPrimary();
        }}>
          {response.visible && !response.revealed && <div className="vocab-input-wrap">
            <ResponseInput blocked={reactionOpen || confirmFinish} id={answerId} aria-label="Your answer" name="study-answer" type="text" data-1p-ignore data-lpignore="true" value={response.value} placeholder={response.placeholder} autoComplete="off"
              disabled={response.disabled || props.busy} onChange={(event) => props.onResponseChange(event.target.value)} />
          </div>}
          <div className="vocab-main-actions">
            {response.revealed && response.revealActions}
            {!response.revealActions && !primaryInFooter && primaryButton}
            <Action control={controls.another} onClick={props.onAnother}>Try another way</Action>
            {!primaryInFooter && <Action control={controls.skip} onClick={props.onSkip}>Skip exercise</Action>}
          </div>
        </form>}
      </div>}

      <footer className="vocab-card-footer">
        <div className="vocab-word-controls">
          <div className="vocab-continuation-slot" ref={setActionTarget} />
          {primaryInFooter && primaryButton}
          {primaryInFooter && <Action control={controls.skip} onClick={props.onSkip}>Skip exercise</Action>}
          {props.stopWord && props.onStopWord && <Action control={props.stopWord} onClick={props.onStopWord}>Come back later</Action>}
          <Action control={controls.enough} onClick={props.onEnough}>{props.wordWork?.enoughLabel ?? (props.wordWork?.extraPractice ? "I’m satisfied" : "Enough for today")}</Action>
          <Action control={controls.more} onClick={props.onMore}>More practice</Action>
        </div>
        {props.reactionInput.visible && <button type="button" className="vocab-reaction-toggle" aria-expanded={reactionOpen} aria-controls={reactionId}
          aria-keyshortcuts="R" onClick={() => setReactionOpen(!reactionOpen)}>How was this exercise? <span aria-hidden="true">{reactionOpen ? "−" : "+"}</span><ShortcutHint shortcut="R" /></button>}
        {props.reactionInput.visible && <div id={reactionId} className={`vocab-reaction-drawer${reactionOpen ? ' is-open' : ''}`}
          aria-hidden={!reactionOpen} ref={(node) => { node?.toggleAttribute('inert', !reactionOpen); }}>
          <div className="vocab-reaction-clip"><div className="vocab-reaction-body">
            <div className="vocab-reactions" role="group" aria-label="Exercise reactions">
              <button type="button" aria-keyshortcuts="[" aria-pressed={props.reactionInput.reaction === 'not-helpful'} disabled={props.reactionInput.status === 'saving'}
                onClick={() => props.onReaction(props.reactionInput.reaction === 'not-helpful' ? null : 'not-helpful')}>Not helpful<ShortcutHint shortcut="[" /></button>
              <button type="button" aria-keyshortcuts="]" aria-pressed={props.reactionInput.reaction === 'helpful'} disabled={props.reactionInput.status === 'saving'}
                onClick={() => props.onReaction(props.reactionInput.reaction === 'helpful' ? null : 'helpful')}>Helpful<ShortcutHint shortcut="]" /></button>
            </div>
            <label>Anything you want to add?<textarea rows={2} aria-keyshortcuts={reactionOpen ? `Escape ${sendNoteShortcut}` : undefined}
              onCompositionStart={() => { composingNote.current = true; }}
              onCompositionEnd={() => { composingNote.current = false; }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || event.shiftKey || event.altKey
                  || !(mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey)) return;
                if (composingNote.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
                event.preventDefault();
                event.stopPropagation();
                if (!event.repeat) sendNoteButton.current?.click();
              }}
              value={props.reactionInput.comment} placeholder="What felt off, or what might help?"
              disabled={props.reactionInput.status === 'saving'} onChange={(event) => props.onCommentChange(event.target.value)} /></label>
            <div className="vocab-reaction-send"><button ref={sendNoteButton} type="button" className="vocab-secondary" disabled={!props.reactionInput.comment.trim() || props.reactionInput.status === 'saving'}
              aria-keyshortcuts={sendNoteShortcut}
              onClick={props.onCommentSubmit}>{props.reactionInput.status === 'saving' ? 'Sending…' : 'Send note'}<ShortcutHint shortcut={mac ? '⌘+Enter' : 'Ctrl+Enter'} /></button>
              <span role="status">{props.reactionInput.status === 'saved' ? 'Reaction saved' : ''}</span></div>
          </div></div></div>}
      </footer>
    </article>
    </VocabularyCardActionTarget.Provider>
    </SessionDesk>

    {props.history && props.history.length > 0 && <WordHistoryTray words={props.history} busy={props.busy} onResume={props.onPractiseWord} />}

    <div className="vocab-session-bottomline">
      <Action control={controls.undo} onClick={props.onUndo}>Undo last action</Action>
      {props.onShowShortcuts && <button type="button" className="vocab-text-button" aria-keyshortcuts="?" onClick={props.onShowShortcuts}>Shortcuts<ShortcutHint shortcut="?" /></button>}
      <span className="vocab-session-status">
        <span style={{ visibility: props.saving ? 'hidden' : 'visible' }} aria-hidden={props.saving || undefined}>{props.progress.remaining} remaining <span className="vocab-dot">·</span> {props.progress.covered} covered <span className="vocab-dot">·</span> {props.progress.elapsedLabel}</span>
        <span role="status" style={{ visibility: props.saving ? 'visible' : 'hidden' }} aria-hidden={!props.saving}>Saving your response…</span>
      </span>
    </div>

    {confirmFinish && <dialog ref={finishDialog} className="vocab-finish-dialog" aria-labelledby={dialogTitleId}
      aria-describedby={dialogDescriptionId} onCancel={(event) => { event.preventDefault(); closeFinishDialog(); }} onClose={() => setConfirmFinish(false)}>
      <h2 id={dialogTitleId}>Finish here?</h2>
      <p id={dialogDescriptionId}>Unfinished words will stay due for your next session. Your answers and reactions will be saved.</p>
      <div><button ref={cancelFinish} type="button" className="vocab-secondary" onClick={closeFinishDialog}>Keep wrapping up</button>
        <button type="button" className="vocab-secondary" disabled={!controls.finishImmediately.enabled || props.busy} onClick={() => {
          closeFinishDialog();
          props.onFinishImmediately();
        }}>Finish immediately</button></div>
    </dialog>}
  </section>;
}
