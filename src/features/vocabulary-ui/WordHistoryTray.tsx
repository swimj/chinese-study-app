import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { VocabularySessionHistoryWord } from './types';

/** The controller supplies the full history, ordered most recently used first. */
export function WordHistoryTray({ words, busy, onResume }: {
  words: VocabularySessionHistoryWord[];
  busy: boolean;
  onResume: (wordId: string) => void;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const anchor = useRef<{ wordId: string; offset: number } | null>(null);
  const [edges, setEdges] = useState({ recent: false, older: false });
  const orderKey = JSON.stringify(words.map((entry) => entry.word.id));

  function rememberPosition() {
    const node = strip.current;
    if (!node) return;
    const next = { recent: node.scrollLeft > 2, older: node.scrollLeft + node.clientWidth < node.scrollWidth - 2 };
    setEdges((previous) => previous.recent === next.recent && previous.older === next.older ? previous : next);
    const left = node.getBoundingClientRect().left;
    const first = next.recent ? Array.from(node.querySelectorAll<HTMLButtonElement>('[data-word-id]'))
      .find((tile) => tile.getBoundingClientRect().right > left + 4) : undefined;
    anchor.current = first ? { wordId: first.dataset.wordId!, offset: first.getBoundingClientRect().left - left } : null;
  }
  useLayoutEffect(() => {
    const node = strip.current;
    if (!node) return;
    if (anchor.current) {
      const saved = anchor.current;
      const tile = Array.from(node.querySelectorAll<HTMLButtonElement>('[data-word-id]'))
        .find((entry) => entry.dataset.wordId === saved.wordId);
      if (tile) node.scrollLeft += tile.getBoundingClientRect().left - node.getBoundingClientRect().left - saved.offset;
    }
    rememberPosition();
  }, [orderKey]);
  useEffect(() => { rememberPosition(); });
  useEffect(() => {
    const node = strip.current;
    if (!node) return;
    const observer = new ResizeObserver(rememberPosition);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  function scroll(direction: -1 | 1) {
    const node = strip.current;
    if (!node) return;
    node.scrollBy({ left: direction * Math.max(100, node.clientWidth * .75),
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
  return <nav className="vocab-word-tray" aria-label="Earlier words in this session">
    <div className="vocab-tray-heading"><span>Earlier in this session</span>
      <div className="vocab-tray-navigation"><span>{words.length} words</span>
        {(edges.recent || edges.older) && <>
          <button type="button" aria-label="Scroll toward recent words" disabled={!edges.recent} onClick={() => scroll(-1)}>←</button>
          <button type="button" aria-label="Scroll toward older words" disabled={!edges.older} onClick={() => scroll(1)}>→</button>
        </>}
      </div>
    </div>
    <div className="vocab-word-tray-items" ref={strip} onScroll={rememberPosition}>
      {words.map((entry) => <button type="button" key={entry.word.id} data-word-id={entry.word.id}
        className={`vocab-word-tile vocab-word-tile-${entry.status}${entry.active ? ' is-active' : ''}`}
        aria-current={entry.active ? 'true' : undefined} disabled={!entry.canResume || busy}
        aria-label={`${entry.word.hanzi}. ${entry.status === 'covered' ? 'Covered for today' : entry.status === 'left' ? 'Left for today, still due' : 'In progress'}. ${entry.active ? 'Currently practising' : 'Practise again'}.`}
        onClick={() => onResume(entry.word.id)}>
        <strong lang="zh">{entry.word.hanzi}</strong><span>{entry.active ? 'Practising' : entry.status === 'covered' ? '✓ Covered' : entry.status === 'left' ? 'Left for today' : 'In progress'}</span>
      </button>)}
    </div>
  </nav>;
}
