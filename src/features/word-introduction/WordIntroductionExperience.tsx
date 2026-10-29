import { DEFAULT_CHARACTER_PRESENTATION, formatCardCharacters, type CharacterPresentation, type SentenceCharacterPresentation } from '../../domain/card-characters';
import { convertSentenceCharacters, effectiveSentenceCharacterPresentation, sentenceCharacterLanguage } from '../../domain/sentence-characters';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { WordIntroductionResponse } from '../../domain/word-content/application';
import { ContentQualityControls } from '../content-quality/ContentQualityControls';
import { IntroductionPlayer } from '../introduction-lab/IntroductionPlayer';
import {
  initialIntroductionPlayerState,
  reduceIntroductionPlayer,
  shouldConcealIntroductionAnswers,
  type IntroductionPlayerAction,
} from '../introduction-lab/player';
import {
  completeWordIntroduction,
  openWordIntroduction,
} from '../../services/api';
import { assertIntroductionWord, selectedIntroduction } from './model';

export type WordIntroductionExperienceProps = {
  wordId: string;
  characterPresentation?: CharacterPresentation;
  sentenceCharacterPresentation?: SentenceCharacterPresentation;
  qualityEncounterId: string;
  onCompleted: (library: WordIntroductionResponse) => void;
  preloadedIntroduction: WordIntroductionResponse;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Could not open this introduction.';
}

export function WordIntroductionExperience({
  wordId, onCompleted, preloadedIntroduction, qualityEncounterId,
  characterPresentation = DEFAULT_CHARACTER_PRESENTATION, sentenceCharacterPresentation = 'simplified',
}: WordIntroductionExperienceProps) {
  const [library, setLibrary] = useState<WordIntroductionResponse>(preloadedIntroduction);
  const [busy, setBusy] = useState<'complete' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playerState, setPlayerState] = useState(initialIntroductionPlayerState);
  const requestVersion = useRef(0);
  const busyRef = useRef(false);
  const openPromiseRef = useRef<Promise<boolean> | null>(null);
  const openedPackageIdRef = useRef<string | null>(null);

  useEffect(() => {
    const version = ++requestVersion.current;
    busyRef.current = false;
    openPromiseRef.current = null;
    openedPackageIdRef.current = null;
    setLibrary(assertIntroductionWord(wordId, preloadedIntroduction));
    setBusy(null);
    setError(null);
    setPlayerState(initialIntroductionPlayerState());
    return () => { requestVersion.current = version + 1; };
  }, [wordId, preloadedIntroduction]);

  const selected = useMemo(() => {
    try {
      return { value: selectedIntroduction(library), error: null as string | null };
    } catch (cause) {
      return { value: null, error: errorMessage(cause) };
    }
  }, [library]);

  const selectedPackageId = selected.value?.package.teaching.id ?? null;
  useEffect(() => {
    if (!selectedPackageId || openedPackageIdRef.current === selectedPackageId) return;
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
  }, [selectedPackageId, wordId]);

  const focusedRehearsal = shouldConcealIntroductionAnswers(playerState.phase);

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
      onCompleted(completed);
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
    setPlayerState((current) => reduceIntroductionPlayer(current, action, selected.value!.snapshot, 'teaching-only'));
  }

  const sentenceScript = effectiveSentenceCharacterPresentation(characterPresentation, sentenceCharacterPresentation);
  const sentenceText = (text: string) => convertSentenceCharacters(text, sentenceScript);
  const lexical = selected.value?.content.content.word ?? library?.contents[0]?.content.word;
  return <section className="intro-lab word-intro-experience" aria-label="Word introduction">
    <div className="word-intro-shell">
      <div className="word-intro-topline">
        {!focusedRehearsal && library.completed && <span className="word-intro-completed">Previously introduced</span>}
      </div>
      {playerState.phase !== 'finished' && <header className="word-intro-heading">
        {focusedRehearsal ? <>
          <p className="intro-lab-kicker">Focused recall</p>
          <h1>Try the expression</h1>
        </> : <>
          <p className="intro-lab-kicker">Word introduction</p>
          <h1>{lexical ? formatCardCharacters(lexical, characterPresentation) : 'Meet this word'}</h1>
          {lexical && <p className="word-intro-pronunciation">{lexical.pinyin}</p>}
        </>}
      </header>}

      {library.reviewPreparationError && selected.value && <p className="word-intro-status" role="status">{library.reviewPreparationError}</p>}
      {error && <p className="intro-lab-error" role="alert">{error}</p>}
      {selected.error && <p className="intro-lab-error" role="alert">{selected.error}</p>}

      {selected.value && <ContentQualityControls
        target={{ kind: 'teaching_package', packageId: selected.value.snapshot.packageId }}
        encounterId={qualityEncounterId}
        label="Introduction quality"
        hotkeysActive
      />}
      {selected.value && <IntroductionPlayer
        mode="teaching-only"
        characterPresentation={characterPresentation}
        sentenceCharacterPresentation={sentenceScript}
        snapshot={selected.value.snapshot}
        content={selected.value.content.content}
        state={playerState}
        onAction={handlePlayerAction}
        onRestart={() => setPlayerState(initialIntroductionPlayerState())}
        onFinish={() => void handleComplete()}
        finishing={busy === 'complete'} />}

      {!focusedRehearsal && library.contents.length > 0 && <details className="word-intro-source">
        <summary>Inspect source material</summary>
        <div className="word-intro-source-body">
          {library.contents.map(({ content }) => <div key={content.id} className="word-intro-source-document">
            <p>Content <code>{content.id}</code></p>
            {content.uses.map((use) => <div key={use.id}>
              <strong>{sentenceText(use.label)}</strong>
              {use.notes.map((note, index) => <p key={index}>{sentenceText(note)}</p>)}
            </div>)}
            {content.examples.map((example) => <div key={example.id} className="word-intro-source-example">
              <p lang={sentenceCharacterLanguage(sentenceScript)}>{sentenceText(example.text)}</p><p>{sentenceText(example.translation)}</p>
            </div>)}
          </div>)}
          {library.packages.map(({ teaching }) => <p key={teaching.id}>Package <code>{teaching.id}</code> · source <code>{teaching.wordContentId}</code></p>)}
        </div>
      </details>}
    </div>
  </section>;
}
