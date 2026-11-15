import { useId, useLayoutEffect, useRef } from 'react';
import type { VocabularyIntakeCard as Card, VocabularyIntakeSelection } from '../../domain/vocabulary-intake';
import { defaultIntakeSelection, intakeSelectionFitsCard, toggleIntakeSense } from './sense-selection';
import type { VocabularyIntakeController } from './useVocabularyIntake';

const stateLabels = {
  proposed: 'Proposed',
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
  const intended = edit?.request.command.type === 'undo' ? null : edit?.request.command.selection;
  const proposed = card.state === 'proposed';
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
      onFocusCapture={event => { lastFocused.current = event.target; }}
      onBlurCapture={event => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) lastFocused.current = null;
      }}
    >
      <header className="intake-card-header">
        <h3 id={headingId}><span lang="zh-Hans">{card.hanzi}</span> <span className="intake-pinyin">{card.pinyin}</span></h3>
        <span className="intake-card-state" data-state={card.state} role="status">{stateLabels[card.state]}</span>
      </header>
      {card.attention && <p className="intake-card-attention">{card.attention}</p>}
      {!card.attention && !card.senses.length && !card.proposedSense && !card.defaultsEstablished
        && <p className="intake-muted">Senses are being prepared.</p>}
      {!card.attention && proposed && !canAdd && card.senses.length > 0 && !card.defaultsEstablished
        && <p className="intake-muted">Default senses are being prepared.</p>}
      {(card.senses.length > 0 || card.proposedSense) && (
        <fieldset className="intake-senses">
          <legend>Senses to study</legend>
          <ul>
            {card.senses.map(sense => renderSense(sense.senseId, sense.label, sense.notes, sense.isDefault))}
            {card.proposedSense && renderSense(null, card.proposedSense.label, card.proposedSense.notes)}
          </ul>
        </fieldset>
      )}
      {(canAdd || canSetSenses || canUndo) && (
        <div className="intake-card-actions">
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
