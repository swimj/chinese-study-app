import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { VocabularySessionHistoryWord } from './types';

/** Covered words can be shuffled back into normal practice without replacing the current card. */
export function WordHistoryTray({ words: history, busy, onResume, orientation = 'horizontal' }: {
  words: VocabularySessionHistoryWord[];
  orientation?: 'horizontal' | 'vertical';
  busy: boolean;
  onResume: (wordId: string, source?: HTMLElement) => void;
}) {
  const words = history.filter(entry => entry.status === 'covered');
  const vertical = orientation === 'vertical';
  const strip = useRef<HTMLDivElement>(null);
  const anchor = useRef<{ wordId: string; offset: number } | null>(null);
  const [edges, setEdges] = useState({ recent: false, older: false });
  const orderKey = JSON.stringify(words.map((entry) => entry.word.id));

  function rememberPosition() {
    const node = strip.current;
    if (!node) return;
    const next = { recent: (vertical ? node.scrollTop : node.scrollLeft) > 2, older: vertical ? node.scrollTop + node.clientHeight < node.scrollHeight - 2 : node.scrollLeft + node.clientWidth < node.scrollWidth - 2 };
    setEdges((previous) => previous.recent === next.recent && previous.older === next.older ? previous : next);
    const start = vertical ? node.getBoundingClientRect().top : node.getBoundingClientRect().left;
    const first = next.recent ? Array.from(node.querySelectorAll<HTMLButtonElement>('[data-word-id]'))
      .find((tile) => (vertical ? tile.getBoundingClientRect().bottom : tile.getBoundingClientRect().right) > start + 4) : undefined;
    anchor.current = first ? { wordId: first.dataset.wordId!, offset: (vertical ? first.getBoundingClientRect().top : first.getBoundingClientRect().left) - start } : null;
  }
  useLayoutEffect(() => {
    const node = strip.current;
    if (!node) return;
    if (anchor.current) {
      const saved = anchor.current;
      const tile = Array.from(node.querySelectorAll<HTMLButtonElement>('[data-word-id]'))
        .find((entry) => entry.dataset.wordId === saved.wordId);
      if (tile) {
        if (vertical) node.scrollTop += tile.getBoundingClientRect().top - node.getBoundingClientRect().top - saved.offset;
        else node.scrollLeft += tile.getBoundingClientRect().left - node.getBoundingClientRect().left - saved.offset;
      }
    }
    rememberPosition();
  }, [orderKey, vertical]);
  useEffect(() => { rememberPosition(); });
  useEffect(() => {
    const node = strip.current;
    if (!node) return;
    const observer = new ResizeObserver(rememberPosition);
    observer.observe(node);
    return () => observer.disconnect();
  }, [vertical]);

  function scroll(direction: -1 | 1) {
    const node = strip.current;
    if (!node) return;
    node.scrollBy({ [vertical ? 'top' : 'left']: direction * Math.max(100, (vertical ? node.clientHeight : node.clientWidth) * .75),
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
  return <nav className="vocab-word-tray" aria-label="Covered in this session">
    <div className="vocab-tray-heading"><span>Covered in this session</span>
      <div className="vocab-tray-navigation"><span>{words.length} words</span>
        {(edges.recent || edges.older) && <>
          <button type="button" aria-label="Scroll toward recent words" disabled={!edges.recent} onClick={() => scroll(-1)}>{vertical ? '↑' : '←'}</button>
          <button type="button" aria-label="Scroll toward older words" disabled={!edges.older} onClick={() => scroll(1)}>{vertical ? '↓' : '→'}</button>
        </>}
      </div>
    </div>
    <div className="vocab-word-tray-items" ref={strip} onScroll={rememberPosition}>
      {words.map((entry) => <button type="button" key={entry.word.id} data-word-id={entry.word.id}
        className={`vocab-word-tile vocab-word-tile-${entry.status}${entry.active ? ' is-active' : ''}`}
        aria-current={entry.active ? 'true' : undefined} disabled={!entry.canResume || busy}
        aria-label={`${entry.word.hanzi}. Covered in this session. ${entry.queued ? 'Queued for extra practice' : entry.active ? 'Currently practising' : 'Shuffle back in for extra practice'}.`}
        onClick={(event) => onResume(entry.word.id, event.currentTarget)}>
        <strong lang="zh">{entry.word.hanzi}</strong>{(entry.queued || entry.active) && <span>{entry.queued ? 'Queued for practice' : 'Practising'}</span>}
      </button>)}
    </div>
  </nav>;
}
