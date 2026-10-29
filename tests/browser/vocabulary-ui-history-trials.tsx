import { useEffect, useId, useRef, useState } from 'react';
import { VocabularySessionView, VocabularySessionContent } from '../../src/features/vocabulary-ui/VocabularySessionView';
import { WordHistoryTray } from '../../src/features/vocabulary-ui/WordHistoryTray';
import type { VocabularySessionViewProps } from '../../src/features/vocabulary-ui/types';
import './vocabulary-ui-history-trials.css';

export type HistoryTrial = 'below' | 'left' | 'right' | 'drawer';

/** Preview placement trials; the production surface and its history stay unchanged. */
export function VocabularyHistoryTrial({ placement, props }: { placement: HistoryTrial; props: VocabularySessionViewProps }) {
  const [open, setOpen] = useState(false);
  const drawerId = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  const history = props.history ?? [];
  const external = placement !== 'below' && !props.completion && history.length > 0;
  useEffect(() => { setOpen(false); }, [placement, props.presentation.key]);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing || event.keyCode === 229) return;
      event.preventDefault(); event.stopPropagation(); setOpen(false); toggle.current?.focus();
    };
    document.addEventListener('keydown', close, true);
    return () => document.removeEventListener('keydown', close, true);
  }, [open]);
  const tray = () => <WordHistoryTray words={history} busy={props.busy} onResume={(wordId) => {
    setOpen(false); props.onPractiseWord(wordId);
  }} />;
  if (placement === 'right') return <VocabularySessionView {...props} />;
  return <div className={`vocab-history-trial is-${external ? placement : 'below'}`}>
    <div className="vocab-history-trial-session"><VocabularySessionContent {...props} history={external ? undefined : props.history} /></div>
    {external && <>
      {placement !== 'drawer' && <aside className="vocab-history-trial-rail">{tray()}</aside>}
      <div className="vocab-history-trial-toggle"><button type="button" ref={toggle} aria-expanded={open} aria-controls={open ? drawerId : undefined}
        aria-label={`Earlier words, ${history.length}. ${open ? 'Close' : 'Open'} history`}
        onClick={() => setOpen((value) => !value)}><span>Words</span><span>{history.length}</span></button></div>
      {open && <aside id={drawerId} className="vocab-history-trial-drawer">{tray()}</aside>}
    </>}
  </div>;
}
