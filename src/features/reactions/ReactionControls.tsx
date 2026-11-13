import { NOT_FOR_ME_REASONS, NOT_FOR_ME_REASON_LABELS, type ContentReactionState } from '../../domain/content-reactions';
import { ShortcutHint } from '../../components/ShortcutHint';
import { choiceOf, toggleNotForMe, toggleReason, toggleSaved, type ReactionChoice } from './reaction-state';

/** Save / Not for me toggles, with optional reasons once Not for me is chosen. */
export function ReactionControls({ state, onChange, shortcuts = false, label }: {
  state: ContentReactionState | null;
  onChange: (choice: ReactionChoice) => void;
  shortcuts?: boolean;
  label: string;
}) {
  const choice = choiceOf(state);
  const saved = choice.reaction === 'saved';
  const notForMe = choice.reaction === 'not_for_me';
  return <div className="reaction-controls" role="group" aria-label={label}>
    <div className="reaction-controls-main">
      <button type="button" className={`reaction-button is-save${saved ? ' is-on' : ''}`} aria-pressed={saved}
        aria-keyshortcuts={shortcuts ? 's' : undefined} onClick={() => onChange(toggleSaved(choice))}>
        <span aria-hidden="true">{saved ? '★' : '☆'}</span> {saved ? 'Saved' : 'Save'}
        {shortcuts ? <ShortcutHint shortcut="S" /> : null}
      </button>
      <button type="button" className={`reaction-button is-not-for-me${notForMe ? ' is-on' : ''}`} aria-pressed={notForMe}
        aria-keyshortcuts={shortcuts ? 'x' : undefined} onClick={() => onChange(toggleNotForMe(choice))}>
        Not for me{shortcuts ? <ShortcutHint shortcut="X" /> : null}
      </button>
    </div>
    {notForMe ? <div className="reaction-reasons" role="group" aria-label="Reasons">
      {NOT_FOR_ME_REASONS.map((reason) => {
        const on = choice.reasons.includes(reason);
        return <button type="button" key={reason} className={`reaction-reason${on ? ' is-on' : ''}`} aria-pressed={on}
          onClick={() => onChange(toggleReason(choice, reason))}>{NOT_FOR_ME_REASON_LABELS[reason]}</button>;
      })}
    </div> : null}
  </div>;
}
