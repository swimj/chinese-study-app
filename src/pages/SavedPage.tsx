import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchSavedCollection } from '../services/api';
import { MAX_REACTION_NOTE_LENGTH, type ContentReactionState, type SavedCollection } from '../domain/content-reactions';
import type { VocabularyJson } from '../domain/vocabulary-content';
import { useContentReactions, type ContentReactionsApi } from '../features/reactions/useContentReactions';
import { ReactionControls } from '../features/reactions/ReactionControls';
import { choiceOf, reactionShortcut, toggleNotForMe, toggleSaved, withNote, type ReactionChoice } from '../features/reactions/reaction-state';
import { groupItems, initiallySaved, savedItems, shuffled, visibleItems, type SavedItem, type SavedView } from '../features/reactions/saved-collection';
import { feedbackShortcut } from '../features/vocabulary-feedback/keyboard';
import { FeedbackBody } from './VocabularyFeedbackPage';
import './SavedPage.css';
import '../features/reactions/reactions.css';

export type SavedPageApi = { fetchCollection: typeof fetchSavedCollection; reactions?: ContentReactionsApi };
const defaultApi: SavedPageApi = { fetchCollection: fetchSavedCollection };

function shortDate(at: string): string {
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
function isEditing(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable
    || Boolean(target.closest('input,textarea,select,[role="combobox"],[role="listbox"],[role="slider"],[role="spinbutton"]')));
}

function NoteEditor({ initial, onSave, onCancel }: { initial: string; onSave: (note: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { field.current?.focus(); }, []);
  return <form className="saved-note-editor" onSubmit={(event) => { event.preventDefault(); onSave(value); }}>
    <textarea ref={field} aria-label="Note" value={value} maxLength={MAX_REACTION_NOTE_LENGTH} rows={3}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); onCancel(); } }} />
    <div className="saved-note-actions">
      <button type="submit" className="saved-button is-primary">Save note</button>
      <button type="button" className="saved-button" onClick={onCancel}>Cancel</button>
    </div>
  </form>;
}

function SavedCard({ item, state, onChange, onWord, activeWord, large = false }: {
  item: SavedItem; state: ContentReactionState | null; onChange: (choice: ReactionChoice) => void;
  onWord: (word: string) => void; activeWord: string | null; large?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const choice = choiceOf(state);
  const saved = choice.reaction === 'saved';
  const heading = item.kind === 'connection' ? `Connection · ${shortDate(item.at)}` : `Feedback · ${item.label} · ${shortDate(item.at)}`;
  return <article className={`saved-card${large ? ' is-large' : ''}${choice.reaction === 'not_for_me' ? ' is-muted' : ''}`}
    aria-label={heading}>
    <p className="saved-card-kind">{heading}</p>
    {item.kind === 'connection'
      ? <p className="saved-card-prose">{item.text}</p>
      : <div className="saved-card-lesson"><FeedbackBody value={item.body as VocabularyJson} /></div>}
    {item.kind === 'connection' && item.words.length ? <ul className="saved-card-words" aria-label="Words">
      {item.words.map((entry) => <li key={entry.word}>
        <button type="button" className={`saved-word${activeWord === entry.word ? ' is-on' : ''}`} aria-pressed={activeWord === entry.word}
          onClick={() => onWord(entry.word)}>
          <span lang="zh">{entry.word}</span>{entry.pinyin ? <small>{entry.pinyin}</small> : null}
        </button>
      </li>)}
    </ul> : null}
    {saved && choice.note && !editing ? <blockquote className="saved-card-note">{choice.note}</blockquote> : null}
    {editing ? <NoteEditor initial={choice.note ?? ''} onCancel={() => setEditing(false)}
      onSave={(note) => { onChange(withNote(choice, note)); setEditing(false); }} /> : null}
    <footer className="saved-card-footer">
      <ReactionControls label="Your reaction" shortcuts={large} state={state} onChange={onChange} />
      {saved && !editing ? <button type="button" className="saved-button is-text" onClick={() => setEditing(true)}>
        {choice.note ? 'Edit note' : 'Add note'}</button> : null}
    </footer>
  </article>;
}

/** The learner's saved connections and lessons, plus recent connections to browse and save. */
export function SavedPage({ api = defaultApi }: { api?: SavedPageApi }) {
  const reactions = useContentReactions('saved', api.reactions);
  const [collection, setCollection] = useState<SavedCollection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<SavedView>('saved');
  const [word, setWord] = useState<string | null>(null);
  const [listed, setListed] = useState<Set<string>>(new Set());
  const [focus, setFocus] = useState<{ keys: string[]; index: number } | null>(null);
  const reload = useRef(0);
  async function load() {
    const version = ++reload.current;
    try {
      const next = await api.fetchCollection();
      if (version !== reload.current) return;
      setCollection(next); setListed(initiallySaved(next)); setError(null);
    } catch (cause) {
      if (version === reload.current) setError(cause instanceof Error ? cause.message : 'Could not load saved items.');
    }
  }
  useEffect(() => { void load(); return () => { reload.current++; }; }, [api]);

  const items = useMemo(() => collection ? savedItems(collection) : [], [collection]);
  const visible = visibleItems(items, view, listed, reactions.states, word);
  const groups = groupItems(visible, view);
  const byKey = useMemo(() => new Map(items.map((item) => [item.key, item])), [items]);
  const savedCount = items.filter((item) => reactions.states.get(item.key)?.reaction === 'saved').length;
  const connectionCount = items.filter((item) => item.kind === 'connection').length;

  function change(item: SavedItem, choice: ReactionChoice) {
    if (choice.reaction === 'saved') setListed((current) => current.has(item.key) ? current : new Set([...current, item.key]));
    reactions.change(item.subject, choice);
  }
  function chooseWord(next: string) {
    setWord((current) => current === next ? null : next);
    setFocus(null);
  }

  const focused = focus ? byKey.get(focus.keys[focus.index]) ?? null : null;
  const returnFocus = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!focus) return;
    function onKey(event: KeyboardEvent) {
      const editing = isEditing(event.target);
      if (event.key === 'Escape' && !editing && !event.defaultPrevented) { event.preventDefault(); setFocus(null); returnFocus.current?.focus(); return; }
      const move = feedbackShortcut(event, editing);
      if (move === 'previous' || move === 'next') {
        event.preventDefault();
        setFocus((current) => current && { ...current, index: (current.index + (move === 'next' ? 1 : -1) + current.keys.length) % current.keys.length });
        return;
      }
      const action = reactionShortcut(event, editing);
      if (!action || !focused) return;
      event.preventDefault();
      const current = choiceOf(reactions.stateFor(focused.subject));
      change(focused, action === 'save' ? toggleSaved(current) : toggleNotForMe(current));
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  return <section className="saved-page" aria-labelledby="saved-page-title">
    <header className="saved-header">
      <h1 id="saved-page-title">Saved</h1>
      <div className="saved-views" role="group" aria-label="Saved view">
        {([['saved', `Saved · ${savedCount}`], ['connections', `All connections · ${connectionCount}`]] as const).map(([key, label]) =>
          <button type="button" key={key} className={`saved-button${view === key ? ' is-on' : ''}`} aria-pressed={view === key}
            onClick={() => { setView(key); setFocus(null); }}>{label}</button>)}
      </div>
      {visible.length > 1 ? <button type="button" ref={returnFocus} className="saved-button" aria-pressed={focus !== null}
        onClick={() => setFocus(focus ? null : { keys: shuffled(visible.map((item) => item.key)), index: 0 })}>
        {focus ? 'Show list' : 'Shuffle one at a time'}</button> : null}
    </header>
    {word ? <p className="saved-filter">
      <button type="button" className="saved-word is-on" aria-label={`Clear word filter ${word}`} onClick={() => setWord(null)}>
        <span lang="zh">{word}</span> <span aria-hidden="true">×</span>
      </button>
    </p> : null}
    {error ? <p role="alert" className="reaction-error">{error} <button type="button" className="saved-button" onClick={() => void load()}>Try again</button></p> : null}
    {reactions.error ? <p role="alert" className="reaction-error">{reactions.error}</p> : null}
    {!collection && !error ? <p className="notes" role="status">Loading…</p> : null}
    {collection && !visible.length ? <p className="saved-empty">
      {word ? 'Nothing here with that word.' : view === 'saved' ? 'Nothing saved yet.' : 'No connections yet.'}</p> : null}
    {focus && focused ? <div className="saved-focus" role="group" aria-roledescription="carousel" aria-label="One at a time">
      <p className="saved-focus-position" aria-live="polite">{focus.index + 1} of {focus.keys.length}</p>
      <SavedCard key={focused.key} large item={focused} state={reactions.stateFor(focused.subject)} activeWord={word}
        onWord={chooseWord} onChange={(choice) => change(focused, choice)} />
      <div className="saved-focus-nav">
        <button type="button" className="saved-button" aria-label="Previous" onClick={() => setFocus({ ...focus, index: (focus.index - 1 + focus.keys.length) % focus.keys.length })}>←</button>
        <button type="button" className="saved-button" aria-label="Next" onClick={() => setFocus({ ...focus, index: (focus.index + 1) % focus.keys.length })}>→</button>
      </div>
    </div> : groups.map((group) => <section key={group.key} className="saved-group" aria-label={group.label}>
      <h2>{group.label}</h2>
      <div className="saved-grid">
        {group.items.map((item) => <SavedCard key={item.key} item={item} state={reactions.stateFor(item.subject)} activeWord={word}
          onWord={chooseWord} onChange={(choice) => change(item, choice)} />)}
      </div>
    </section>)}
  </section>;
}
