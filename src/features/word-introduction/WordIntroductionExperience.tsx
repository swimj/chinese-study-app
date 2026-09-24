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
  prepareWordIntroduction,
} from '../../services/api';
import { assertIntroductionWord, selectedIntroduction } from './model';

export type WordIntroductionExperienceProps = {
  wordId: string;
  onClose: () => void;
  onCompleted?: (library: WordIntroductionResponse) => void;
  autoPrepare?: boolean;
  closeLabel?: string;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Could not open this introduction.';
}

export function WordIntroductionExperience({
  wordId, onClose, onCompleted, autoPrepare = false, closeLabel = 'Back to word',
}: WordIntroductionExperienceProps) {
  const [library, setLibrary] = useState<WordIntroductionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'prepare' | 'complete' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playerState, setPlayerState] = useState(initialIntroductionPlayerState);
  const requestVersion = useRef(0);
  const busyRef = useRef(false);

  useEffect(() => {
    const version = ++requestVersion.current;
    const controller = new AbortController();
    busyRef.current = false;
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
        if (!autoPrepare || (loaded.preparationUnavailable && loaded.selectedPackageId === null)) return;
        busyRef.current = true;
        setBusy('prepare');
        const prepared = assertIntroductionWord(wordId, await prepareWordIntroduction(wordId));
        if (requestVersion.current !== version) return;
        if (!selectedIntroduction(prepared)) throw new Error('The introduction is not ready yet.');
        setLibrary(prepared);
        setPlaying(true);
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
  }, [wordId, autoPrepare]);

  const selected = useMemo(() => {
    if (!library) return { value: null, error: null as string | null };
    try {
      return { value: selectedIntroduction(library), error: null as string | null };
    } catch (cause) {
      return { value: null, error: errorMessage(cause) };
    }
  }, [library]);
  const focusedRehearsal = playing && shouldConcealIntroductionAnswers(playerState.phase);

  async function handlePrepare(): Promise<void> {
    if (busyRef.current || loading || (library?.preparationUnavailable && !selected.value)) return;
    const version = requestVersion.current;
    busyRef.current = true;
    setBusy('prepare');
    setError(null);
    try {
      const prepared = assertIntroductionWord(wordId, await prepareWordIntroduction(wordId));
      if (requestVersion.current !== version) return;
      if (!selectedIntroduction(prepared)) throw new Error('The introduction is not ready yet.');
      setLibrary(prepared);
      setPlayerState(initialIntroductionPlayerState());
      setPlaying(true);
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
      const completed = assertIntroductionWord(wordId,
        await completeWordIntroduction(wordId, selected.value.package.teaching.id));
      if (requestVersion.current !== version) return;
      setLibrary(completed);
      if (onCompleted) onCompleted(completed);
      else onClose();
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
    setPlayerState((current) => reduceIntroductionPlayer(current, action, selected.value!.snapshot));
  }

  const lexical = selected.value?.content.content.word ?? library?.contents[0]?.content.word;
  const unavailable = library?.preparationUnavailable === true && selected.value === null;
  const available = Boolean(selected.value) || (!unavailable && library?.generationAvailable === true);

  return <section className="intro-lab word-intro-experience" aria-label="Word introduction"
    onKeyDown={(event) => {
      if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
    }}>
    <div className="word-intro-shell">
      <div className="word-intro-topline">
        <button type="button" className="intro-lab-button outline" onClick={onClose}>← {closeLabel}</button>
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

      {loading && <p className="word-intro-status" role="status">Loading introduction…</p>}
      {busy === 'prepare' && <p className="word-intro-status" role="status">Preparing this introduction…</p>}
      {error && <p className="intro-lab-error" role="alert">{error}</p>}
      {selected.error && <p className="intro-lab-error" role="alert">{selected.error}</p>}

      {!playing && !loading && busy !== 'prepare' && library && <div className="word-intro-start">
        <h2>{unavailable ? 'Introduction unavailable' : selected.value ? 'Ready to begin' : 'Meet this word in context'}</h2>
        <p>{unavailable ? 'The prepared material is no longer available for study.' : selected.value
          ? 'Read the introduction at your own pace, then recall the expression it taught.'
          : 'Prepare a short introduction with examples and a focused rehearsal.'}</p>
        {unavailable ? <p className="word-intro-muted">This introduction is unavailable. Continue with the usual study cards.</p>
          : <button type="button" className="intro-lab-button primary" disabled={!available || busy !== null}
            onClick={() => void handlePrepare()}>{selected.value ? 'Open introduction' : 'Prepare introduction'}</button>}
        {!unavailable && !available && <p className="word-intro-muted">Introduction generation is unavailable right now. Try again when the model is available.</p>}
      </div>}

      {playing && selected.value && <IntroductionPlayer
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
