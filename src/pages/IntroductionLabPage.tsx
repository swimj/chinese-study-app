import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  adaptLegacyProductionSnapshot,
  adaptTargetedReviewExercise,
  materializeTeachingPackage,
  parseContentExercise,
  parseTeachingPackage,
  parseWordContent,
  toProductionExerciseSnapshot,
  type TeachingPackageSnapshot,
} from '../domain/word-content';
import type {
  IntroductionDraft,
  IntroductionLabStatus,
  IntroductionLexicalInput,
} from '../domain/word-content/lab';
import {
  bootstrapIntroduction,
  fetchIntroductionDrafts,
  fetchIntroductionLabStatus,
  generateIntroductionTeaching,
  importIntroductionDraft,
} from '../services/api';
import {
  initialIntroductionPlayerState,
  introductionPlayerKeyAction,
  reduceIntroductionPlayer,
  shouldConcealIntroductionAnswers,
  type IntroductionPlayerAction,
  type IntroductionPlayerState,
} from '../features/introduction-lab/player';
import {
  authoredDefinitionFixture,
  authoredDefinitionMetadata,
  authoredReviewFixture,
  authoredReviewMetadata,
  legacyReviewFixture,
  wordContentFixtures,
} from '../../tests/fixtures/word-content';
import '../features/introduction-lab/styles.css';

const sampleDrafts: IntroductionDraft[] = wordContentFixtures.map(({ content, teaching }) => ({
  id: `sample-${content.id}`,
  createdAt: '2026-09-24T00:00:00.000Z',
  origin: 'sample',
  content,
  teaching,
}));

const reviewContent = parseWordContent(wordContentFixtures[0]!.content);
const reviewExamples = [
  {
    label: 'Existing definition cue',
    snapshot: adaptLegacyProductionSnapshot(legacyReviewFixture, reviewContent.word.wordId),
  },
  {
    label: 'New cloze review cue',
    snapshot: adaptTargetedReviewExercise(
      parseContentExercise(authoredReviewFixture), [reviewContent], authoredReviewMetadata,
    ),
  },
  {
    label: 'New definition cue with example supplement',
    snapshot: adaptTargetedReviewExercise(
      parseContentExercise(authoredDefinitionFixture), [reviewContent], authoredDefinitionMetadata,
    ),
  },
] as const;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (
    target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(target.tagName)
  );
}

function downloadDraft(draft: IntroductionDraft): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${draft.content.word.hanzi}-${draft.id}.json`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function IntroductionLabPage() {
  const [savedDrafts, setSavedDrafts] = useState<IntroductionDraft[]>([]);
  const [selected, setSelected] = useState<IntroductionDraft>(sampleDrafts[0]!);
  const [playerState, setPlayerState] = useState(initialIntroductionPlayerState);
  const [status, setStatus] = useState<IntroductionLabStatus | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'bootstrap' | 'teaching' | 'saving' | 'importing' | null>(null);
  const [lexical, setLexical] = useState<IntroductionLexicalInput>({
    hanzi: '', traditional: null, pinyin: '', guidance: '',
  });
  const [showCreate, setShowCreate] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const snapshot = useMemo(() => selected.teaching === null
    ? null
    : materializeTeachingPackage(selected.teaching, [selected.content]), [selected]);
  const focusedRehearsal = snapshot !== null && shouldConcealIntroductionAnswers(playerState.phase);

  function selectDraft(draft: IntroductionDraft): void {
    setSelected(draft);
    setPlayerState(initialIntroductionPlayerState());
  }

  function handlePlayerAction(action: IntroductionPlayerAction): void {
    if (snapshot === null) return;
    setPlayerState((current) => reduceIntroductionPlayer(current, action, snapshot));
  }

  useEffect(() => {
    let cancelled = false;
    void Promise.allSettled([fetchIntroductionLabStatus(), fetchIntroductionDrafts()]).then((results) => {
      if (cancelled) return;
      const [statusResult, draftsResult] = results;
      if (statusResult.status === 'fulfilled') setStatus(statusResult.value);
      if (draftsResult.status === 'fulfilled') setSavedDrafts(draftsResult.value);
      if (statusResult.status === 'rejected' || draftsResult.status === 'rejected') {
        setConnectionError('The local authoring server is unavailable. The six samples are ready to explore; start the dev backend to generate or save.');
      }
    });
    return () => { cancelled = true; };
  }, []);

  async function refreshSaved(): Promise<void> {
    setSavedDrafts(await fetchIntroductionDrafts());
    setConnectionError(null);
  }

  async function refreshSavedAfterWrite(): Promise<void> {
    try {
      await refreshSaved();
    } catch {
      setConnectionError('The draft was saved, but the library could not refresh. Use Refresh to load it.');
    }
  }

  async function handleBootstrap(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy || !lexical.hanzi.trim() || !lexical.pinyin.trim()) return;
    setBusy('bootstrap');
    setActionError(null);
    try {
      const draft = await bootstrapIntroduction(lexical);
      selectDraft(draft);
      setShowCreate(false);
      await refreshSavedAfterWrite();
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function handleTeaching(): Promise<void> {
    if (busy || selected.teaching !== null) return;
    setBusy('teaching');
    setActionError(null);
    try {
      const next = await generateIntroductionTeaching(selected.id);
      selectDraft(next);
      await refreshSavedAfterWrite();
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function handleSaveSample(): Promise<void> {
    if (busy) return;
    setBusy('saving');
    setActionError(null);
    try {
      const saved = await importIntroductionDraft({
        content: selected.content,
        teaching: selected.teaching,
        origin: 'sample',
      });
      selectDraft(saved);
      await refreshSavedAfterWrite();
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function handleImport(file: File): Promise<void> {
    if (busy) return;
    setBusy('importing');
    setActionError(null);
    try {
      const input: unknown = JSON.parse(await file.text());
      if (!input || typeof input !== 'object' || !('content' in input)) {
        throw new Error('Choose a draft JSON file with a content document.');
      }
      const value = input as { content: unknown; teaching?: unknown };
      const content = parseWordContent(value.content);
      const teaching = value.teaching == null ? null : parseTeachingPackage(value.teaching);
      if (teaching) materializeTeachingPackage(teaching, [content]);
      const saved = await importIntroductionDraft({ content, teaching, origin: 'imported' });
      selectDraft(saved);
      await refreshSavedAfterWrite();
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      if (importInputRef.current) importInputRef.current.value = '';
      setBusy(null);
    }
  }

  return (
    <main className="intro-lab">
      <div className="intro-lab-shell">
        <header className="intro-lab-header">
          <div>
            <p className="intro-lab-kicker">Local study prototype</p>
            <h1>Word introduction lab</h1>
            <p>Meet a word, see how a lesson unfolds, and try the expression it taught.</p>
          </div>
          <div className="intro-lab-header-actions">
            <span className="intro-lab-status">{status?.generationAvailable ? `Generation ready · ${status.model}` : status ? 'Generation needs a provider key' : 'Sample mode'}</span>
            <a href="/">Return to app</a>
          </div>
        </header>

        {!focusedRehearsal && connectionError && <p className="intro-lab-notice" role="status">{connectionError}</p>}
        {!focusedRehearsal && actionError && <p className="intro-lab-error" role="alert">{actionError}</p>}

        <div className={`intro-lab-layout${focusedRehearsal ? ' focused' : ''}`}>
          {!focusedRehearsal && <aside className="intro-lab-library" aria-label="Introduction library">
            <div className="intro-lab-library-head">
              <h2>Explore</h2>
              <button type="button" className="intro-lab-button subtle" onClick={() => setShowCreate((value) => !value)}>
                {showCreate ? 'Close' : 'Create new'}
              </button>
            </div>
            {showCreate && (
              <form className="intro-lab-create" onSubmit={(event) => void handleBootstrap(event)}>
                <h3>Start from a word</h3>
                <label>Chinese word<input required value={lexical.hanzi}
                  onChange={(event) => setLexical((current) => ({ ...current, hanzi: event.target.value }))} /></label>
                <label>Pinyin<input required value={lexical.pinyin}
                  onChange={(event) => setLexical((current) => ({ ...current, pinyin: event.target.value }))} /></label>
                <label>Traditional form <span>(optional)</span><input value={lexical.traditional ?? ''}
                  onChange={(event) => setLexical((current) => ({ ...current, traditional: event.target.value.trim() || null }))} /></label>
                <label>Meaning or teaching guidance <span>(optional)</span><textarea rows={3} value={lexical.guidance}
                  onChange={(event) => setLexical((current) => ({ ...current, guidance: event.target.value }))} /></label>
                <button type="submit" className="intro-lab-button primary" disabled={busy !== null || status?.generationAvailable !== true}>
                  {busy === 'bootstrap' ? 'Preparing word…' : 'Prepare word content'}
                </button>
                {status?.generationAvailable !== true && <p className="intro-lab-help">Start the local backend with a provider key to generate content.</p>}
              </form>
            )}
            <h3 className="intro-lab-list-title">Worked examples <span>6</span></h3>
            <div className="intro-lab-draft-list">
              {sampleDrafts.map((draft) => <DraftButton key={draft.id} draft={draft}
                selected={selected.id === draft.id} onSelect={() => selectDraft(draft)} />)}
            </div>
            <div className="intro-lab-saved-heading">
              <h3 className="intro-lab-list-title">Saved locally <span>{savedDrafts.length}</span></h3>
              <button type="button" className="intro-lab-text-button" onClick={() => void refreshSaved().catch((error: unknown) => setConnectionError(errorMessage(error)))}>Refresh</button>
            </div>
            {savedDrafts.length ? <div className="intro-lab-draft-list">
              {savedDrafts.map((draft) => <DraftButton key={draft.id} draft={draft}
                selected={selected.id === draft.id} onSelect={() => selectDraft(draft)} />)}
            </div> : <p className="intro-lab-help">Generated and imported drafts appear here.</p>}
            <input ref={importInputRef} className="intro-lab-visually-hidden" type="file" accept=".json,application/json"
              aria-label="Import a draft JSON file" onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleImport(file);
              }} />
            <button type="button" className="intro-lab-button outline intro-lab-import" disabled={busy !== null}
              onClick={() => importInputRef.current?.click()}>{busy === 'importing' ? 'Importing…' : 'Import draft JSON'}</button>
          </aside>}

          <section className="intro-lab-workspace" aria-label="Selected introduction">
            <div className="intro-lab-word-head">
              {focusedRehearsal ? <div>
                <p className="intro-lab-kicker">Focused recall</p>
                <h2>Try the expression</h2>
              </div> : <div>
                <p className="intro-lab-kicker">{selected.origin === 'sample' ? 'Worked example' : `${selected.origin} draft`}</p>
                <h2>{selected.content.word.hanzi}</h2>
                <p className="intro-lab-pinyin">{selected.content.word.pinyin}</p>
              </div>}
              {!focusedRehearsal && <div className="intro-lab-word-actions">
                {selected.id.startsWith('sample-') && <button type="button" className="intro-lab-button outline"
                  disabled={busy !== null} onClick={() => void handleSaveSample()}>{busy === 'saving' ? 'Saving…' : 'Save sample'}</button>}
                <button type="button" className="intro-lab-button outline" onClick={() => downloadDraft(selected)}>Export JSON</button>
              </div>}
            </div>
            {snapshot ? (
              <IntroductionPlayer snapshot={snapshot} state={playerState}
                onAction={handlePlayerAction} onRestart={() => setPlayerState(initialIntroductionPlayerState())} />
            ) : (
              <div className="intro-lab-empty-lesson">
                <p className="intro-lab-kicker">Word content prepared</p>
                <h3>Turn this content into an introduction</h3>
                <p>The selected uses and examples are saved. Generate a paced lesson and its target rehearsal from this exact content.</p>
                <button type="button" className="intro-lab-button primary" disabled={busy !== null || status?.generationAvailable !== true}
                  onClick={() => void handleTeaching()}>{busy === 'teaching' ? 'Writing introduction…' : 'Write introduction and rehearsal'}</button>
              </div>
            )}
            {!focusedRehearsal && <><details className="intro-lab-inspection">
              <summary>Inspect the source material and IDs</summary>
              <div className="intro-lab-inspection-body">
                <p>Content <code>{selected.content.id}</code> · Package <code>{selected.teaching?.id ?? 'not generated'}</code></p>
                {selected.content.uses.map((use) => <div key={use.id}>
                  <strong>{use.label}</strong><span> · {use.id}</span>
                  {use.notes.map((note, index) => <p key={index}>{note}</p>)}
                </div>)}
                <h4>Examples</h4>
                {selected.content.examples.map((example) => <div key={example.id} className="intro-lab-inspection-example">
                  <code>{example.id}</code><p lang="zh-Hans">{example.text}</p><p>{example.translation}</p>
                </div>)}
              </div>
            </details>
            <details className="intro-lab-inspection">
              <summary>Existing review compatibility · 报备</summary>
              <div className="intro-lab-inspection-body">
                <p>These review cues remain separate from the introduction and its target rehearsal. This is a model inspection only.</p>
                {reviewExamples.map(({ label, snapshot }) => <div key={label} className="intro-lab-compat-item">
                  <strong>{label}</strong>
                  <p><code>{snapshot.origin}</code> · <code>{snapshot.review.cueType}</code> · <code>{snapshot.review.cueId}</code></p>
                  <p>{snapshot.exercise.stimulus.text}</p>
                  <p>Source: <code>{snapshot.exercise.stimulus.source.kind}</code> · Supplement: {snapshot.review.supplement?.exampleSentence ?? 'none'}</p>
                  <details>
                    <summary>Inspect existing review export</summary>
                    <pre>{JSON.stringify(toProductionExerciseSnapshot(snapshot), null, 2)}</pre>
                  </details>
                </div>)}
              </div>
            </details>
            </>}
          </section>
        </div>
      </div>
    </main>
  );
}

function DraftButton({ draft, selected, onSelect }: {
  draft: IntroductionDraft;
  selected: boolean;
  onSelect: () => void;
}) {
  return <button type="button" className={`intro-lab-draft${selected ? ' selected' : ''}`}
    aria-current={selected ? 'true' : undefined} onClick={onSelect}>
    <span className="intro-lab-draft-word">{draft.content.word.hanzi}</span>
    <span className="intro-lab-draft-description">{draft.content.uses[0]?.label ?? 'Word content'}</span>
    <span className="intro-lab-draft-state">{draft.teaching ? 'Introduction ready' : 'Content ready'}
      {!draft.id.startsWith('sample-') && ` · ${new Date(draft.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
    </span>
  </button>;
}

function IntroductionPlayer({ snapshot, state, onAction, onRestart }: {
  snapshot: TeachingPackageSnapshot;
  state: IntroductionPlayerState;
  onAction: (action: IntroductionPlayerAction) => void;
  onRestart: () => void;
}) {
  const newestRef = useRef<HTMLElement>(null);
  const answerRef = useRef<HTMLInputElement>(null);
  const composingRef = useRef(false);
  const resultRef = useRef<HTMLDivElement>(null);

  function act(action: IntroductionPlayerAction) {
    onAction(action);
  }

  useLayoutEffect(() => {
    if (state.phase === 'introduction') newestRef.current?.focus();
    else if (state.phase === 'rehearsal') answerRef.current?.focus();
    else if (state.phase === 'result') resultRef.current?.focus();
  }, [snapshot, state.phase, state.beatIndex, state.exerciseIndex]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      const action = introductionPlayerKeyAction({
        key: event.key,
        repeat: event.repeat,
        composing: event.isComposing || event.keyCode === 229,
        editable: isInteractiveTarget(event.target),
        modified: event.metaKey || event.ctrlKey || event.altKey,
      }, state.phase);
      if (!action) return;
      event.preventDefault();
      act(action);
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [snapshot, state.phase, onAction]);

  const exercise = snapshot.rehearsals[state.exerciseIndex];
  return <div className="intro-lab-player">
    {state.phase === 'introduction' && <>
      <div className="intro-lab-progress"><span>Introduction</span><span>{state.beatIndex + 1} of {snapshot.beats.length}</span></div>
      <div className="intro-lab-beat-stack">
        {snapshot.beats.slice(0, state.beatIndex + 1).map((beat, index) => (
          <article key={beat.id} ref={index === state.beatIndex ? newestRef : undefined}
            tabIndex={index === state.beatIndex ? -1 : undefined}
            className={`intro-lab-beat${index === state.beatIndex ? ' newest' : ' past'}`}
            aria-label={`Beat ${index + 1}${index === state.beatIndex ? ', current' : ''}`}>
            <span className="intro-lab-beat-number">{String(index + 1).padStart(2, '0')}</span>
            <div className="intro-lab-beat-copy">
              {beat.parts.map((part, partIndex) => <p key={partIndex}
                lang={part.source.kind === 'example' && part.source.field === 'sentence' ? 'zh-Hans' : undefined}
                className={part.source.kind === 'example' ? `intro-lab-part-${part.source.field}` : undefined}>
                {part.text}
              </p>)}
            </div>
          </article>
        ))}
      </div>
      <div className="intro-lab-player-actions">
        <button type="button" className="intro-lab-button outline" disabled={state.beatIndex === 0} onClick={() => act({ type: 'back' })}>Back</button>
        <button type="button" className="intro-lab-button primary" onClick={() => act({ type: 'advance' })}>
          {state.beatIndex === snapshot.beats.length - 1 ? 'Try the expression' : 'Next beat'} <kbd>Space</kbd>
        </button>
      </div>
    </>}
    {state.phase === 'rehearsal' && exercise && <>
      <div className="intro-lab-progress"><span>Target rehearsal</span><span>{state.exerciseIndex + 1} of {snapshot.rehearsals.length}</span></div>
      <div className="intro-lab-practice-card">
        <p className="intro-lab-kicker">Bring back the word you just met</p>
        <h3>{exercise.instruction}</h3>
        <p className="intro-lab-stimulus" lang={exercise.stimulus.source.kind === 'example_cloze' ? 'zh-Hans' : undefined}>{exercise.stimulus.text}</p>
        <form onSubmit={(event) => {
          event.preventDefault();
          if (!composingRef.current) act({ type: 'submit' });
        }}>
          <label htmlFor="intro-lab-answer">Your answer</label>
          <input id="intro-lab-answer" ref={answerRef} value={state.response} autoComplete="off"
            onCompositionStart={() => { composingRef.current = true; }}
            onCompositionEnd={() => { composingRef.current = false; }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.keyCode === 229 || composingRef.current)) {
                event.preventDefault();
              }
            }}
            onChange={(event) => act({ type: 'edit', response: event.target.value })}
            placeholder="Type Chinese characters" />
          <div className="intro-lab-player-actions">
            <button type="button" className="intro-lab-button outline" onClick={() => act({ type: 'back' })}>Back to introduction</button>
            <button type="button" className="intro-lab-button subtle" onClick={() => act({ type: 'reveal' })}>Show taught answer</button>
            <button type="submit" className="intro-lab-button primary" disabled={!state.response.trim()}>Check answer</button>
          </div>
        </form>
      </div>
    </>}
    {state.phase === 'result' && exercise && <div ref={resultRef} tabIndex={-1} className="intro-lab-result">
      <p className="intro-lab-kicker">{state.result === 'accepted' ? 'That is the taught expression' : state.result === 'revealed' ? 'The taught expression' : 'Keep this expression in mind'}</p>
      <h3 lang="zh-Hans">{exercise.acceptedAnswers[0]?.hanzi}</h3>
      {exercise.acceptedAnswers[0]?.traditional && exercise.acceptedAnswers[0].traditional !== exercise.acceptedAnswers[0].hanzi &&
        <p>Traditional: {exercise.acceptedAnswers[0].traditional}</p>}
      {state.result === 'rejected' && <p>Your answer did not match this constrained rehearsal. Another expression may be natural in the sentence; this exercise asks for the one just taught.</p>}
      <div className="intro-lab-player-actions">
        <button type="button" className="intro-lab-button outline" onClick={() => act({ type: 'retry' })}>Try again</button>
        <button type="button" className="intro-lab-button primary" onClick={() => act({ type: 'next' })}>
          {state.exerciseIndex < snapshot.rehearsals.length - 1 ? 'Next rehearsal' : 'Finish preview'} <kbd>Space</kbd>
        </button>
      </div>
    </div>}
    {state.phase === 'finished' && <div className="intro-lab-finished">
      <p className="intro-lab-kicker">Preview complete</p>
      <h3>One word, a little more familiar.</h3>
      <p>This local preview does not record study progress.</p>
      <button type="button" className="intro-lab-button primary" onClick={onRestart}>Start again</button>
    </div>}
    <p className="intro-lab-preview-note">A local preview · no study progress is recorded</p>
  </div>;
}
