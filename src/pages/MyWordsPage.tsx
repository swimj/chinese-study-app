import { useLayoutEffect, useRef } from 'react';
import { formatStudyDate, WORD_STAGE_LABELS, type MyWord, type MyWordsResponse, type MyWordsView } from '../domain/my-words';

export type MyWordsPageProps = {
  view: MyWordsView;
  query: string;
  words: MyWord[];
  currentDeck: MyWordsResponse['currentDeck'];
  selectedId: string | null;
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  scrollTop: number;
  onViewChange: (view: MyWordsView) => void;
  onQueryChange: (query: string) => void;
  onSelect: (id: string | null) => void;
  onLoadMore: () => void;
  onRetry: () => void;
  onScroll: (top: number) => void;
};

export function MyWordsPage(props: MyWordsPageProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const selected = props.words.find((entry) => entry.word.id === props.selectedId);

  useLayoutEffect(() => {
    if (listRef.current) listRef.current.scrollTop = props.scrollTop;
  }, [props.scrollTop]);

  function closeDetails() {
    props.onSelect(null);
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>('[data-word-id]');
    buttons?.forEach((button) => {
      if (button.dataset.wordId === props.selectedId) button.focus({ preventScroll: true });
    });
  }

  return (
    <section className="my-words-page" aria-label="My words"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && selected) { event.stopPropagation(); closeDetails(); }
      }}>
      <header className="my-words-header">
        <h1>My words</h1>
        <div className="my-words-toolbar">
          <select aria-label="Word collection" value={props.view}
            onChange={(event) => props.onViewChange(event.target.value as MyWordsView)}>
            <option value="recent">Recently studied</option>
            <option value="personal">Personally added</option>
            {props.currentDeck && <option value="deck">Current deck</option>}
            {!props.currentDeck && props.view === 'deck' &&
              <option value="deck" disabled>Current deck unavailable</option>}
          </select>
          <input type="search" aria-label="Search this word collection"
            placeholder="Search words, pronunciation, meanings…" value={props.query}
            onChange={(event) => props.onQueryChange(event.target.value)} />
        </div>
        <p className="notes">{props.view === 'recent'
          ? 'Words you’ve begun studying, most recent first.'
          : props.view === 'personal'
            ? 'Your personal collection, including waiting words. Most recently updated first.'
            : props.currentDeck
              ? `All words in ${props.currentDeck.label}, including words you haven’t studied. Ordered by pronunciation.`
              : 'Current deck is unavailable. Choose another collection.'}</p>
      </header>
      <div className={`my-words-browser${selected ? ' has-detail' : ''}`}>
        <div className="my-words-list" ref={listRef} aria-label="Words"
          aria-busy={props.loading} onScroll={(event) => props.onScroll(event.currentTarget.scrollTop)}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
            if (!(event.target instanceof HTMLButtonElement) || !event.target.dataset.wordId) return;
            const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-word-id]'));
            const index = buttons.indexOf(event.target);
            const next = buttons[index + (event.key === 'ArrowDown' ? 1 : -1)];
            event.preventDefault();
            if (next?.dataset.wordId) { next.focus(); props.onSelect(next.dataset.wordId); }
          }}>
          {props.words.map((entry) => (
            <button type="button" key={entry.word.id} data-word-id={entry.word.id}
              className={`my-word-row${selected?.word.id === entry.word.id ? ' selected' : ''}`}
              aria-expanded={selected?.word.id === entry.word.id}
              aria-controls={selected?.word.id === entry.word.id ? 'my-word-detail' : undefined}
              onClick={() => props.onSelect(entry.word.id)}>
              <span className="my-word-lexical">
                <span className="my-word-heading"><strong>{entry.word.hanzi}</strong><span>{entry.word.pinyin}</span></span>
                <span className="my-word-gloss">{entry.word.meanings[0] ?? entry.word.meaning}</span>
              </span>
              <span className="my-word-summary">
                <span>{WORD_STAGE_LABELS[entry.word.status]}</span>
                {props.view === 'recent' && <span className="my-word-date">{entry.lastStudiedAt
                  ? `Studied ${formatStudyDate(entry.lastStudiedAt)}` : 'Study date not recorded'}</span>}
              </span>
            </button>
          ))}
          {props.loading && <p className="my-words-message" role="status">Loading words…</p>}
          {props.error && <div className="my-words-message" role="alert">
            <p>{props.error}</p><button type="button" onClick={props.onRetry}>Try again</button>
          </div>}
          {!props.loading && !props.error && props.words.length === 0 && (
            <p className="my-words-message">{props.view === 'deck' && !props.currentDeck
              ? 'Current deck is unavailable. Choose another collection.'
              : props.query.trim()
              ? 'No matching words in this collection.'
              : props.view === 'recent'
                ? 'Once you begin studying, your words will appear here.'
                : props.view === 'personal'
                  ? 'Add words in Stash to start your personal collection.'
                  : 'There are no words in your current deck.'}</p>
          )}
          {props.hasMore && !props.error && <button type="button" className="my-words-more secondary-button"
            disabled={props.loading} onClick={props.onLoadMore}>Load more words</button>}
        </div>
        {selected && <aside key={selected.word.id} className="my-word-detail" id="my-word-detail" aria-label={`Details for ${selected.word.hanzi}`}>
          <button type="button" className="secondary-button my-word-close" onClick={closeDetails}
            aria-label="Close word details">Close ×</button>
          <h2>{selected.word.hanzi}</h2>
          <p className="my-word-pronunciation">{selected.word.pinyin}</p>
          {selected.word.traditional && selected.word.traditional !== selected.word.hanzi &&
            <p className="notes">Traditional: {selected.word.traditional}</p>}
          <span className="my-word-stage">{WORD_STAGE_LABELS[selected.word.status]}</span>
          <h3>Meaning</h3>
          <ul className="my-word-meanings">{(selected.word.meanings.length ? selected.word.meanings : [selected.word.meaning])
            .map((meaning, index) => <li key={index}>{meaning}</li>)}</ul>
          <h3>Study</h3>
          {selected.word.status === 'unstudied' ? <p className="notes">{props.view === 'deck'
            ? 'You haven’t studied this word yet.' : 'This word is waiting for study.'}</p> : <dl>
            <dt>Last studied</dt><dd>{formatStudyDate(selected.lastStudiedAt)}</dd>
          </dl>}
          {selected.word.personalNotes && <><h3>Your notes</h3><p className="my-word-notes">{selected.word.personalNotes}</p></>}
        </aside>}
      </div>
    </section>
  );
}
