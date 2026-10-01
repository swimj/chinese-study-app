import { useEffect, useMemo, useRef, useState } from 'react';
import type { WordIntroductionResponse } from '../../domain/word-content/application';
import { IntroductionPlayer } from '../introduction-lab/IntroductionPlayer';
import {
  initialIntroductionPlayerState,
  reduceIntroductionPlayer,
  shouldConcealIntroductionAnswers,
  type IntroductionPlayerAction,
} from '../introduction-lab/player';
import {
  completeWordIntroduction,
  fetchWordIntroduction,
  openWordIntroduction,
  prepareWordIntroduction,
} from '../../services/api';
import { assertIntroductionWord, selectedIntroduction } from './model';

export type WordIntroductionExperienceProps = {
  wordId: string;
  onClose?: () => void;
  onCompleted?: (library: WordIntroductionResponse) => void;
  preloadedIntroduction?: WordIntroductionResponse;
  closeLabel?: string;
  mode?: 'full' | 'teaching-only';
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Could not open this introduction.';
}

export function WordIntroductionExperience({
  wordId, onClose, onCompleted, preloadedIntroduction, closeLabel = 'Back to word',
  mode = 'full',
}: WordIntroductionExperienceProps) {
  const [library, setLibrary] = useState<WordIntroductionResponse | null>(preloadedIntroduction ?? null);
  const [loading, setLoading] = useState(preloadedIntroduction === undefined);
  const [busy, setBusy] = useState<'prepare' | 'complete' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(preloadedIntroduction !== undefined);
  const [playerState, setPlayerState] = useState(initialIntroductionPlayerState);
  const requestVersion = useRef(0);
  const busyRef = useRef(false);
  const openPromiseRef = useRef<Promise<boolean> | null>(null);
  const openedPackageIdRef = useRef<string | null>(null);

  useEffect(() => {
    const version = ++requestVersion.current;
    const controller = new AbortController();
    busyRef.current = false;
    openPromiseRef.current = null;
    openedPackageIdRef.current = null;
    if (preloadedIntroduction) {
      setLibrary(assertIntroductionWord(wordId, preloadedIntroduction));
      setLoading(false);
      setBusy(null);
      setError(null);
      setPlaying(true);
      setPlayerState(initialIntroductionPlayerState());
      return () => { requestVersion.current += 1; };
    }
    setLibrary(null);
    setLoading(true);
    setBusy(null);
    setError(null);
    setPlaying(false);
    setPlayerState(initialIntroductionPlayerState());

    void (async () => {
      try {
        const loaded = assertIntroductionWord(wordId, await fetchWordIntroduction(wordId, controller.signal));
        if (requestVersion.current !== version) return;
        setLibrary(loaded);
        setLoading(false);

      } catch (cause) {
        if (requestVersion.current !== version || controller.signal.aborted) return;
        setError(errorMessage(cause));
      } finally {
        if (requestVersion.current === version) {
          setLoading(false);
          setBusy(null);
          busyRef.current = false;
        }
      }
    })();

    return () => {
      controller.abort();
      requestVersion.current += 1;
    };
  }, [wordId, preloadedIntroduction]);

  const selected = useMemo(() => {
    if (!library) return { value: null, error: null as string | null };
    try {
      return { value: selectedIntroduction(library), error: null as string | null };
    } catch (cause) {
      return { value: null, error: errorMessage(cause) };
    }
  }, [library]);

  useEffect(() => {
    if (preloadedIntroduction || !library?.preparationPending || selected.value) return;
    const version = requestVersion.current;
    const timer = window.setTimeout(() => {
      void fetchWordIntroduction(wordId).then((updated) => {
        if (requestVersion.current !== version) return;
        const next = assertIntroductionWord(wordId, updated);
        setLibrary(next);
        if (selectedIntroduction(next)) {
          setPlayerState(initialIntroductionPlayerState());
          setPlaying(true);
        }
      }).catch(() => {
        if (requestVersion.current === version) {
          setError('The introduction is still being prepared. Please check again shortly.');
          setLibrary((current) => current ? { ...current } : current);
        }
      });
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [wordId, library, selected.value, preloadedIntroduction]);

  const selectedPackageId = selected.value?.package.teaching.id ?? null;
  useEffect(() => {
    if (!playing || !selectedPackageId || openedPackageIdRef.current === selectedPackageId) return;
    openedPackageIdRef.current = selectedPackageId;
    const version = requestVersion.current;
    openPromiseRef.current = openWordIntroduction(wordId, selectedPackageId)
      .then(() => true)
      .catch(() => {
        if (requestVersion.current === version) {
          setError('Could not record that this introduction was opened. Please try finishing again.');
        }
        return false;
      });
  }, [playing, selectedPackageId, wordId]);

  const focusedRehearsal = playing && shouldConcealIntroductionAnswers(playerState.phase);

  async function handlePrepare(): Promise<void> {
    if (busyRef.current || loading || library?.preparationPending
      || (library?.preparationUnavailable && !selected.value)) return;
    if (selected.value) {
      setPlayerState(initialIntroductionPlayerState());
      setPlaying(true);
      return;
    }
    const version = requestVersion.current;
    busyRef.current = true;
    setBusy('prepare');
    setError(null);
    try {
      const prepared = assertIntroductionWord(wordId, await prepareWordIntroduction(wordId));
      if (requestVersion.current !== version) return;
      setLibrary(prepared);
      if (selectedIntroduction(prepared)) {
        setPlayerState(initialIntroductionPlayerState());
        setPlaying(true);
      }
    } catch (cause) {
      if (requestVersion.current === version) setError(errorMessage(cause));
    } finally {
      if (requestVersion.current === version) {
        busyRef.current = false;
        setBusy(null);
      }
    }
  }

  async function handleComplete(): Promise<void> {
    if (busyRef.current || !selected.value || playerState.phase !== 'finished') return;
    const version = requestVersion.current;
    busyRef.current = true;
    setBusy('complete');
    setError(null);
    try {
      const opened = await openPromiseRef.current;
      if (!opened) {
        // Opening is model-free; a failed notification can be retried on Finish.
        await openWordIntroduction(wordId, selected.value.package.teaching.id);
      }
      const completed = assertIntroductionWord(wordId,
        await completeWordIntroduction(wordId, selected.value.package.teaching.id));
      if (requestVersion.current !== version) return;
      setLibrary(completed);
      if (onCompleted) onCompleted(completed);
      else onClose?.();
    } catch (cause) {
      if (requestVersion.current === version) setError(errorMessage(cause));
    } finally {
      if (requestVersion.current === version) {
        busyRef.current = false;
        setBusy(null);
      }
    }
  }

  function handlePlayerAction(action: IntroductionPlayerAction): void {
    if (!selected.value) return;
    setPlayerState((current) => reduceIntroductionPlayer(current, action, selected.value!.snapshot, mode));
  }

  const lexical = selected.value?.content.content.word ?? library?.contents[0]?.content.word;
  const unavailable = library?.preparationUnavailable === true && selected.value === null;
  const available = Boolean(selected.value) || (!unavailable && !library?.preparationPending && library?.generationAvailable === true);

  return <section className="intro-lab word-intro-experience" aria-label="Word introduction"
    onKeyDown={(event) => {
      if (event.key === 'Escape') { event.stopPropagation(); onClose?.(); }
    }}>
    <div className="word-intro-shell">
      <div className="word-intro-topline">
        {onClose && <button type="button" className="intro-lab-button outline" onClick={onClose}>← {closeLabel}</button>}
        {!focusedRehearsal && library?.completed && <span className="word-intro-completed">Previously introduced</span>}
      </div>
      <header className="word-intro-heading">
        {focusedRehearsal ? <>
          <p className="intro-lab-kicker">Focused recall</p>
          <h1>Try the expression</h1>
        </> : <>
          <p className="intro-lab-kicker">Word introduction</p>
          <h1>{lexical?.hanzi ?? 'Meet this word'}</h1>
          {lexical && <p className="word-intro-pronunciation">{lexical.pinyin}</p>}
        </>}
      </header>

      {library?.reviewPreparationError && selected.value && <p className="word-intro-status" role="status">{library.reviewPreparationError}</p>}
      {library?.preparationPending && !selected.value && <p className="word-intro-status" role="status">Preparing this introduction. It will open when ready…</p>}
      {loading && <p className="word-intro-status" role="status">Loading introduction…</p>}
      {busy === 'prepare' && <p className="word-intro-status" role="status">Preparing this introduction…</p>}
      {error && <p className="intro-lab-error" role="alert">{error}</p>}
      {selected.error && <p className="intro-lab-error" role="alert">{selected.error}</p>}

      {!playing && !loading && busy !== 'prepare' && library && <div className="word-intro-start">
        <h2>{unavailable ? 'Introduction unavailable' : library.preparationPending ? 'Preparing introduction' : selected.value ? 'Ready to begin' : 'Meet this word in context'}</h2>
        <p>{unavailable ? 'The prepared material is no longer available for study.' : library.preparationPending ? 'This usually takes a little time. You can leave this page and return later.' : selected.value
          ? 'Read the introduction at your own pace, then recall the expression it taught.'
          : 'Prepare a short introduction with examples and a focused rehearsal.'}</p>
        {unavailable ? <p className="word-intro-muted">This introduction is unavailable. Continue with the usual study cards.</p>
          : <button type="button" className="intro-lab-button primary" disabled={!available || busy !== null}
            onClick={() => void handlePrepare()}>{selected.value ? 'Open introduction' : 'Prepare introduction'}</button>}
        {!unavailable && !available && !library.preparationPending && <p className="word-intro-muted">Introduction preparation is unavailable right now. Please return later.</p>}
      </div>}

      {playing && selected.value && <IntroductionPlayer
        mode={mode}
        snapshot={selected.value.snapshot}
        state={playerState}
        onAction={handlePlayerAction}
        onRestart={() => setPlayerState(initialIntroductionPlayerState())}
        onFinish={() => void handleComplete()}
        finishing={busy === 'complete'} />}

      {!focusedRehearsal && library && library.contents.length > 0 && <details className="word-intro-source">
        <summary>Inspect source material</summary>
        <div className="word-intro-source-body">
          {library.contents.map(({ content }) => <div key={content.id} className="word-intro-source-document">
            <p>Content <code>{content.id}</code></p>
            {content.uses.map((use) => <div key={use.id}>
              <strong>{use.label}</strong>
              {use.notes.map((note, index) => <p key={index}>{note}</p>)}
            </div>)}
            {content.examples.map((example) => <div key={example.id} className="word-intro-source-example">
              <p lang="zh-Hans">{example.text}</p><p>{example.translation}</p>
            </div>)}
          </div>)}
          {library.packages.map(({ teaching }) => <p key={teaching.id}>Package <code>{teaching.id}</code> · source <code>{teaching.wordContentId}</code></p>)}
        </div>
      </details>}
    </div>
  </section>;
}
