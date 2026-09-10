import { useState } from 'react';

/**
 * Gut-level diet feedback at the session-completion moment (SPECS
 * diet-deck-distribution.md §2.6, §2.11). Intentionally coarse: the learner
 * never sees decks, weights, or HSK labels — just how the new words felt.
 */
export function DietNudgePrompt({
  onNudge,
}: {
  onNudge: (direction: 'easier' | 'harder') => Promise<void>;
}) {
  const [state, setState] = useState<'pending' | 'saving' | 'done'>('pending');
  const [error, setError] = useState<string | null>(null);

  if (state === 'done') {
    return <p className="notes diet-nudge-prompt">Noted — your upcoming sessions will adjust.</p>;
  }

  async function handle(direction: 'easier' | 'harder' | 'fine') {
    if (state === 'saving') {
      return;
    }
    if (direction === 'fine') {
      setState('done');
      return;
    }
    setState('saving');
    setError(null);
    try {
      await onNudge(direction);
      setState('done');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to record that');
      setState('pending');
    }
  }

  return (
    <div className="diet-nudge-prompt" role="group" aria-label="How did the new words feel?">
      <span className="diet-nudge-label">How did the new words feel?</span>
      <span className="diet-nudge-actions">
        <button type="button" className="diet-chip" disabled={state === 'saving'} onClick={() => void handle('harder')}>
          Too easy
        </button>
        <button type="button" className="diet-chip" disabled={state === 'saving'} onClick={() => void handle('fine')}>
          About right
        </button>
        <button type="button" className="diet-chip" disabled={state === 'saving'} onClick={() => void handle('easier')}>
          Too hard
        </button>
      </span>
      {error ? <span className="form-error" role="alert">{error}</span> : null}
    </div>
  );
}
