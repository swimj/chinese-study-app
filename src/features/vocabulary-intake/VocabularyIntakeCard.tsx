import { useId, useLayoutEffect, useRef } from 'react';
import type { VocabularyIntakeCard as Card, VocabularyIntakeSelection } from '../../domain/vocabulary-intake';
import { defaultIntakeSelection, intakeSelectionFitsCard, toggleIntakeSense } from './sense-selection';
import type { VocabularyIntakeController } from './useVocabularyIntake';

const stateLabels = {
  proposed: 'Proposed',
  'sense-proposed': 'New sense proposed',
  added: 'Added',
  preparing: 'Preparing',
  ready: 'Ready',
  'already-studying': 'Already studying',
} satisfies Record<Card['state'], string>;

export function VocabularyIntakeCard({ card, controller }: { card: Card; controller: VocabularyIntakeController }) {
  const headingId = useId();
  const article = useRef<HTMLElement>(null);
  const lastFocused = useRef<Element | null>(null);
  const edit = controller.edits[card.id];
  const draft = controller.drafts[card.id];
  const intended = edit && 'selection' in edit.request.command ? edit.request.command.selection : null;
  const proposed = card.state === 'proposed';
  const senseProposed = card.state === 'sense-proposed';
  const canAddSense = card.actions.includes('add_sense');
  const canAdd = card.actions.includes('add');
  const canSetSenses = card.actions.includes('change_senses');
  const canUndo = card.actions.includes('undo');
  const compatibleChoice = intended && intakeSelectionFitsCard(card, intended)
    && (edit?.request.command.type === 'add' ? canAdd : canSetSenses);
  const selection = compatibleChoice ? intended : draft && intakeSelectionFitsCard(card, draft) ? draft : card.selection;
  const defaults = defaultIntakeSelection(card);
  const canReturnToDefaults = card.defaultsEstablished && defaults.senseIds.length > 0;
  const usingDefaults = selection.targetSenseId === null && !selection.includeProposedSense
    && defaults.senseIds.length === selection.senseIds.length
    && defaults.senseIds.every(id => selection.senseIds.includes(id));

  useLayoutEffect(() => {
    const root = article.current;
    if (root && lastFocused.current && !root.contains(lastFocused.current) && document.activeElement === document.body) {
      root.focus({ preventScroll: true });
    }
  });

  useLayoutEffect(() => {
    const root = article.current;
    return () => {
      // A conversational revision moves this card to a newer turn. Do not strand
      // keyboard focus on the body when its old rendered instance disappears.
      if (root?.contains(document.activeElement)) {
        root.closest('.intake-chat')?.querySelector<HTMLTextAreaElement>('textarea')?.focus({ preventScroll: true });
      }
    };
  }, []);

  function applyChoice(next: VocabularyIntakeSelection) {
    if (!edit) controller.select(card, next);
  }

  function renderSense(senseId: string | null, label: string, notes: string[], isDefault = false) {
    const isNew = senseId === null;
    const checked = isNew ? selection.includeProposedSense : selection.senseIds.includes(senseId);
    const changesTo = toggleIntakeSense(selection, senseId, !checked);
    const wouldClearAll = !intakeSelectionFitsCard(card, changesTo);
    const disabled = Boolean(edit) || wouldClearAll;
    return (
      <li className="intake-sense" key={senseId ?? 'proposed'}>
        <label>
          <input
            type="checkbox"
            checked={checked}
            disabled={!(canAdd || canSetSenses) || undefined}
            aria-disabled={disabled || undefined}
            title={wouldClearAll && checked ? 'Keep at least one sense selected' : undefined}
            onChange={() => { if (!disabled) applyChoice(changesTo); }}
          />
          <span>
            {label}
            {isNew && <small className="intake-sense-tag">New proposed sense</small>}
            {isDefault && <small className="intake-sense-tag">Default</small>}
            {senseId !== null && selection.targetSenseId === senseId
              && <small className="intake-sense-tag">Your context</small>}
          </span>
        </label>
        {notes.length > 0 && (
          <details>
            <summary>Notes</summary>
            {notes.map((note, index) => <p key={index}>{note}</p>)}
          </details>
        )}
      </li>
    );
  }

  const readyToAdd = canAdd && intakeSelectionFitsCard(card, selection);
  return (
    <article
      ref={article}
      className="intake-card"
      aria-labelledby={headingId}
      tabIndex={-1}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        const target = event.target;
        if (!(target instanceof HTMLButtonElement) || !target.closest('.intake-card-actions')) return;
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('.intake-card-actions button'));
        const actions = buttons.filter(button => !button.disabled && button.getAttribute('aria-disabled') !== 'true');
        if (!actions.length) return;
        const index = buttons.indexOf(target);
        let next: number;
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
          next = actions.findIndex(button => buttons.indexOf(button) > index);
          if (next < 0) next = 0;
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
          next = actions.filter(button => buttons.indexOf(button) < index).length - 1;
          if (next < 0) next = actions.length - 1;
        } else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = actions.length - 1;
        else return;
        event.preventDefault();
        actions[next]?.focus();
      }}
      onFocusCapture={event => { lastFocused.current = event.target; }}
      onBlurCapture={event => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) lastFocused.current = null;
      }}
    >
      <header className="intake-card-header">
        <h3 id={headingId}><span lang="zh-Hans">{card.hanzi}</span> <span className="intake-pinyin">{card.pinyin}</span></h3>
        <span className="intake-card-state" data-state={card.state} role="status">{card.addedSenseId && card.state === 'already-studying' ? 'Sense added' : stateLabels[card.state]}</span>
      </header>
      {card.attention && <p className="intake-card-attention">{card.attention}</p>}
      {!card.attention && !card.senses.length && !card.proposedSense && !card.defaultsEstablished
        && <p className="intake-muted">Senses are being prepared.</p>}
      {!card.attention && proposed && !canAdd && card.senses.length > 0 && !card.defaultsEstablished
        && <p className="intake-muted">Default senses are being prepared.</p>}
      {senseProposed && card.proposedSense && (
        <div className="intake-sense-proposal">
          <p>{card.proposedSense.label}</p>
          {card.proposedSense.notes.length > 0 && <details><summary>Notes</summary>
            {card.proposedSense.notes.map((note, index) => <p key={index}>{note}</p>)}
          </details>}
          <p className="intake-muted">Adds a shared meaning alongside your current study senses.</p>
          <details><summary>Current senses ({card.selection.senseIds.length})</summary>
            <ul>{card.senses.filter(sense => card.selection.senseIds.includes(sense.senseId))
              .map(sense => <li key={sense.senseId}>{sense.label}</li>)}</ul>
          </details>
        </div>
      )}
      {!senseProposed && (card.senses.length > 0 || card.proposedSense) && (
        <fieldset className="intake-senses">
          <legend>Senses to study</legend>
          <ul>
            {card.senses.map(sense => renderSense(sense.senseId, sense.label, sense.notes, sense.isDefault))}
            {card.proposedSense && renderSense(null, card.proposedSense.label, card.proposedSense.notes)}
          </ul>
        </fieldset>
      )}
      {(canAdd || canAddSense || canSetSenses || canUndo) && (
        <div className="intake-card-actions">
          {canAddSense && <button type="button" aria-disabled={Boolean(edit) || undefined}
            onClick={() => { if (!edit) void controller.command(card, { type: 'add_sense' }); }}>Add sense</button>}
          {proposed && readyToAdd && <button type="button" aria-disabled={Boolean(edit) || undefined}
            onClick={() => { if (!edit) void controller.command(card, { type: 'add', selection }); }}>
            Add <span lang="zh-Hans">{card.hanzi}</span>
          </button>}
          {canUndo && <button type="button" className="intake-quiet" aria-disabled={Boolean(edit) || undefined}
            onClick={() => { if (!edit) void controller.command(card, { type: 'undo' }); }}>Undo add</button>}
          {(canAdd || canSetSenses) && canReturnToDefaults && (
            <button type="button" className="intake-quiet" aria-disabled={Boolean(edit) || usingDefaults || undefined}
              onClick={() => { if (!usingDefaults) applyChoice(defaults); }}>Return to defaults</button>
          )}
          {(canAdd || canSetSenses) && card.presets.map(preset => (
            <button type="button" className="intake-quiet" key={preset.label} aria-disabled={Boolean(edit) || undefined}
              onClick={() => applyChoice(preset.selection)}>{preset.label}</button>
          ))}
        </div>
      )}
      {edit?.status === 'saving' && <p role="status" className="intake-muted">{edit.refreshed === false ? 'Reloading…' : 'Saving…'}</p>}
      {edit?.status === 'failed' && (
        <div className="intake-card-recovery">
          <p role="alert">Could not confirm the change.{compatibleChoice ? ' Your choices are still shown.' : ''}</p>
          <div className="intake-card-actions">
            <button type="button" onClick={() => void controller.retryCommand(card, edit)}>Retry save</button>
            <button type="button" className="intake-quiet" onClick={() => void controller.reloadCard(card.id, edit, false)}>Reload card</button>
          </div>
        </div>
      )}
      {edit?.status === 'stale' && (
        <div className="intake-card-recovery">
          <p role="alert">{edit.refreshed
            ? (compatibleChoice ? 'This card changed. Your previous choices are shown and haven’t been saved.'
              : 'This card changed. Review the current card before trying again.')
            : 'This card changed and couldn’t be reloaded.'}</p>
          <div className="intake-card-actions">
            {!edit.refreshed
              ? <button type="button" onClick={() => void controller.reloadCard(card.id, edit, true)}>Reload card</button>
              : <>
                  {edit.request.command.type === 'add_sense' && canAddSense && (
                    <button type="button" onClick={() => void controller.command(card, { type: 'add_sense' })}>Add sense</button>
                  )}
                  {compatibleChoice && (
                    <button type="button" onClick={() => void controller.command(card, {
                      type: proposed ? 'add' : 'set_senses', selection: intended,
                    })}>{proposed ? 'Add with these choices' : 'Apply my choices'}</button>
                  )}
                  <button type="button" className="intake-quiet" onClick={() => controller.discardEdit(card.id)}>
                    {compatibleChoice ? 'Use current choices' : 'Continue'}
                  </button>
                </>}
          </div>
        </div>
      )}
    </article>
  );
}
