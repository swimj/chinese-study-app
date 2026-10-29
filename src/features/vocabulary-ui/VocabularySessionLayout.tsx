import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { WordHistoryTray } from './WordHistoryTray';
import type { VocabularySessionViewProps } from './types';
import './vocabulary-session-layout.css';

export function VocabularySessionLayout({ props, children }: { props: VocabularySessionViewProps; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const drawerId = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  const words = (props.history ?? []).filter(entry => entry.status === 'covered');
  const hasHistory = !props.completion && words.length > 0;
  useEffect(() => { setOpen(false); }, [props.presentation.key, hasHistory]);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing || event.keyCode === 229) return;
      event.preventDefault(); event.stopPropagation();
      setOpen(false); toggle.current?.focus();
    };
    document.addEventListener('keydown', close, true);
    return () => document.removeEventListener('keydown', close, true);
  }, [open]);
  return <div className="vocab-layout-container">
    <div className={`vocab-layout${!props.completion ? ' has-rail' : ''}`}>
      <div className="vocab-layout-session">{children}</div>
      {hasHistory && <>
        <div className="vocab-history-toggle"><button ref={toggle} type="button" aria-expanded={open} aria-controls={drawerId}
          aria-label={`Covered in this session, ${words.length} words. ${open ? 'Close' : 'Open'} covered words`}
          onClick={() => setOpen((value) => !value)}>Covered <span>{words.length}</span></button></div>
        <aside id={drawerId} className={`vocab-history-rail${open ? ' is-open' : ''}`}>
          <WordHistoryTray words={words} orientation="vertical" busy={props.busy} onResume={(wordId, source) => {
            props.onPractiseWord(wordId, source); setOpen(false);
          }} />
        </aside>
      </>}
    </div>
  </div>;
}
