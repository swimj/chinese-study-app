import { useLayoutEffect, useRef, type ReactNode } from 'react';
import {
  formatStudyDate,
  MY_WORDS_STAGE_CHIPS,
  shouldShowMyWordsCount,
  type WordBrowserEntry,
  type MyWordsResponse,
  type MyWordsStatus,
  type MyWordsView,
} from '../domain/my-words';

export type MyWordsPageProps<Stage extends string = MyWordsStatus, Entry extends WordBrowserEntry<Stage> = WordBrowserEntry<Stage>> = {
  stages?: ReadonlyArray<{status: Stage; label: string}>;
  renderWordActions?: (entry: Entry) => ReactNode;
  view: MyWordsView;
  query: string;
  statuses: readonly Stage[];
  recentLapses: boolean;
  words: Entry[];
  currentDeck: MyWordsResponse['currentDeck'];
  selectedId: string | null;
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  total: number | null;
  scrollTop: number;
  onViewChange: (view: MyWordsView) => void;
  onQueryChange: (query: string) => void;
  onToggleStatus: (status: Stage) => void;
  onToggleRecentLapses: () => void;
  onSelect: (id: string | null) => void;
  onLoadMore: () => void;
  onRetry: () => void;
  onScroll: (top: number) => void;
};

export function WordBrowserPage<Stage extends string = MyWordsStatus, Entry extends WordBrowserEntry<Stage> = WordBrowserEntry<Stage>>(props: MyWordsPageProps<Stage, Entry>) {
  const stages = props.stages ?? MY_WORDS_STAGE_CHIPS;
  const label = (stage: Stage) => stages.find((item) => item.status === stage)?.label ?? stage;
  const available = stages.filter((item) => props.view !== 'recent' || item.status !== 'unstudied');
  const narrowed = props.statuses.length > 0 && available.some((item) => !props.statuses.some((stage) => stage === item.status));
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
        if (event.key !== 'Escape') return;
        if (selected) { event.stopPropagation(); closeDetails(); }
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
        <div className="my-words-stages">
          <div role="group" aria-label="Word stage">
            {stages.map(({ status, label }) => (
              <button type="button" key={status}
                className={`my-words-stage${props.statuses.some((stage) => stage === status) ? ' selected' : ''}`}
                aria-pressed={props.statuses.some((stage) => stage === status)}
                disabled={props.view === 'recent' && status === 'unstudied'}
                onClick={() => props.onToggleStatus(status as Stage)}>{label}</button>
            ))}
          </div>
          <button type="button"
            className={`my-words-stage my-words-lapses${props.recentLapses ? ' selected' : ''}`}
            aria-pressed={props.recentLapses}
            onClick={props.onToggleRecentLapses}>Recent lapses</button>
        </div>
        {shouldShowMyWordsCount(props.view, props.recentLapses)
          && !(props.view === 'deck' && !props.currentDeck)
          && props.total !== null && (
          <p className="notes my-words-count">{props.total === 1 ? '1 word' : `${props.total} words`}</p>
        )}
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
                <span>{label(entry.word.status)}</span>
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
              : props.query.trim() || props.recentLapses || narrowed
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
          {!props.renderWordActions && <span className="my-word-stage">{label(selected.word.status)}</span>}
          {props.renderWordActions?.(selected)}
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

export type { WordBrowserEntry } from '../domain/my-words';

export function MyWordsPage(props: MyWordsPageProps) {
  return <WordBrowserPage {...props} />;
}
