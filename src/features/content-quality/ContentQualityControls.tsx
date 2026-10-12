import { useEffect, useRef, useState } from 'react';
import type { ContentQualityState, ContentQualityTarget } from '../../domain/content-quality';
import { recordContentQualityEncounter, saveContentQualityRating } from '../../services/api';
import { qualityVoteForKey } from './keyboard';

const QUALITY_UPDATED_EVENT = 'content-quality-updated';

export type ContentQualityControlsProps = {
  target: ContentQualityTarget;
  encounterId: string;
  label: string;
  hotkeysActive?: boolean;
  disabled?: boolean;
  onRatingChange?: (rating: 'up' | 'down' | null) => void;
  onSavingChange?: (saving: boolean) => void;
};

/** A target change remounts local request state; votes themselves live on the server. */
export function ContentQualityControls(props: ContentQualityControlsProps) {
  return <QualityControls key={`${JSON.stringify(props.target)}:${props.encounterId}`} {...props} />;
}

function QualityControls({ target, encounterId, label, hotkeysActive = false, disabled = false, onRatingChange, onSavingChange }: ContentQualityControlsProps) {
  const [state, setState] = useState<ContentQualityState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const pending = useRef(false);
  const mounted = useRef(true);
  const targetKey = JSON.stringify(target);

  useEffect(() => {
    mounted.current = true;
    let current = true;
    setError(null);
    void recordContentQualityEncounter(JSON.parse(targetKey) as ContentQualityTarget, encounterId)
      .then((value) => { if (current) setState(value); })
      .catch((cause: unknown) => {
        if (current) setError(cause instanceof Error ? cause.message : 'Could not load content feedback.');
      });
    return () => { current = false; mounted.current = false; };
  }, [targetKey, encounterId, retry]);

  useEffect(() => {
    // A save may complete after moving to another encounter of this content.
    // Re-read using the current authenticated account, never a shared vote cache.
    const refresh = () => setRetry((value) => value + 1);
    window.addEventListener(QUALITY_UPDATED_EVENT, refresh);
    return () => window.removeEventListener(QUALITY_UPDATED_EVENT, refresh);
  }, []);

  async function vote(value: 'up' | 'down') {
    if (disabled || !state || pending.current) return;
    pending.current = true;
    setBusy(true);
    onSavingChange?.(true);
    setError(null);
    try {
      const next = await saveContentQualityRating(state.contentKey, state.rating === value ? null : value);
      if (mounted.current) setState(next);
      onRatingChange?.(next.rating);
      window.dispatchEvent(new Event(QUALITY_UPDATED_EVENT));
    } catch {
      if (mounted.current) setError('Feedback was not saved. Please try again.');
    } finally {
      pending.current = false;
      onSavingChange?.(false);
      if (mounted.current) setBusy(false);
    }
  }

  useEffect(() => {
    if (!hotkeysActive || disabled) return;
    function onKey(event: KeyboardEvent) {
      const targetElement = event.target instanceof Element ? event.target : null;
      const editable = !!targetElement?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="dialog"], [aria-modal="true"]');
      const rating = qualityVoteForKey(event, editable);
      if (!rating || !state || pending.current) return;
      event.preventDefault();
      void vote(rating);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [hotkeysActive, disabled, state, onRatingChange, onSavingChange]);

  return <div className="content-quality-controls" data-content-quality-controls role="group" aria-label={label}>
    <span className="content-quality-label">Helpful?</span>
    <button type="button" className="content-quality-vote" aria-keyshortcuts={hotkeysActive ? '[' : undefined} aria-label={`Not helpful: ${label}`}
      aria-pressed={state?.rating === 'down'} disabled={disabled || !state || busy}
      title={`Unhelpful content${hotkeysActive ? ' ([)' : ''}. Click again to clear.`}
      onClick={() => void vote('down')}>
      <span>Not helpful</span>{hotkeysActive && <kbd>[</kbd>}
    </button>
    <button type="button" className="content-quality-vote" aria-keyshortcuts={hotkeysActive ? ']' : undefined} aria-label={`Helpful: ${label}`}
      aria-pressed={state?.rating === 'up'} disabled={disabled || !state || busy}
      title={`Helpful content${hotkeysActive ? ' (])' : ''}. Click again to clear.`}
      onClick={() => void vote('up')}>
      <span>Helpful</span>{hotkeysActive && <kbd>]</kbd>}
    </button>
    <span className="content-quality-status" role="status">{busy ? 'Saving…' : state?.rating ? 'Feedback saved' : ''}</span>
    {error && <span className="content-quality-error" role="alert">{error} {!state &&
      <button type="button" onClick={() => setRetry((value) => value + 1)}>Retry</button>}</span>}
  </div>;
}
