import type { VocabularyEncounterSnapshot, VocabularySessionJson } from '../../domain/vocabulary-session';
import type { VocabularyStudyWord } from '../../domain/vocabulary-study-api';
import { formatCardCharacters, type CharacterPresentation, type SentenceCharacterPresentation } from '../../domain/card-characters';
import { convertSentenceCharacters } from '../../domain/sentence-characters';
import { BootstrapSourceReveal } from '../session/BootstrapSourceReveal';
import { WordSourceExamples } from '../session/WordSourceExamples';
import { renderVocabularyReveal } from './render-material';
import { VocabularyCharacterRuby } from './VocabularyRuby';

function object(value: VocabularySessionJson | undefined) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
export function vocabularySenseLabel(description: VocabularySessionJson | undefined): string | null {
  if (typeof description === 'string') return description.trim() || null;
  const label = object(description).label;
  return typeof label === 'string' && label.trim() ? label : null;
}

/** Pronunciation stays hidden until Reveal and comes from the served snapshot. */
export function VocabularyRecognitionPrompt({ snapshot, word, revealed, sentenceCharacterPresentation }: {
  snapshot: VocabularyEncounterSnapshot; word?: VocabularyStudyWord; revealed: boolean;
  sentenceCharacterPresentation: SentenceCharacterPresentation;
}) {
  const frozenWord = snapshot.body.revealWords?.find((entry) => entry.wordId === word?.wordId)
    ?? snapshot.body.revealWords?.[0] ?? word;
  const prompt = convertSentenceCharacters(snapshot.body.prompt, sentenceCharacterPresentation);
  return <span className="vocab-recognition-ruby">{frozenWord?.pinyin
    ? <VocabularyCharacterRuby text={prompt} pinyin={frozenWord.pinyin} readingVisible={revealed} />
    : prompt}</span>;
}

/** Render the served post-answer facts. A word's entire dictionary entry is only a fallback. */
export function VocabularyAnswer({ snapshot, word, characterPresentation, sentenceCharacterPresentation }: {
  snapshot: VocabularyEncounterSnapshot; word?: VocabularyStudyWord;
  characterPresentation: CharacterPresentation; sentenceCharacterPresentation: SentenceCharacterPresentation;
}) {
  const words = snapshot.body.revealWords?.length ? snapshot.body.revealWords : word ? [word] : [];
  const bootstrap = snapshot.body.bootstrapReveal;
  return <>
    {words.length ? words.map((entry) => {
      const sense = 'sense' in entry ? vocabularySenseLabel(entry.sense?.description) : null;
      if (snapshot.kind === 'recognition' && bootstrap && !sense) return null;
      return <div className="vocab-answer-word" key={entry.wordId}>
        {snapshot.kind !== 'recognition' && <p className="vocab-answer-hanzi" lang="zh"><strong>{formatCardCharacters(entry, characterPresentation)}</strong></p>}
        {snapshot.kind !== 'recognition' && <p>{entry.pinyin}</p>}
        {(sense || !bootstrap) && <p>{convertSentenceCharacters(sense ?? entry.meaning, sentenceCharacterPresentation)}</p>}
      </div>;
    }) : <p lang="zh">{snapshot.assessment?.acceptedAnswers.join(' / ')}</p>}
    {bootstrap ? <BootstrapSourceReveal reveal={bootstrap} sentenceCharacterPresentation={sentenceCharacterPresentation} />
      : renderVocabularyReveal(snapshot.body.material, sentenceCharacterPresentation)}
    {snapshot.body.wordReference && <details className="desk-reference vocab-word-reference"><summary>Word reference</summary>
      <WordSourceExamples content={snapshot.body.wordReference} sentenceCharacterPresentation={sentenceCharacterPresentation} />
    </details>}
  </>;
}

export function VocabularyContrastAnswer({ material, selectedWordId, correctWordId, sentenceCharacterPresentation }: {
  material: VocabularySessionJson | undefined; selectedWordId: string | undefined; correctWordId: string | undefined;
  sentenceCharacterPresentation: SentenceCharacterPresentation;
}) {
  const source = object(material);
  const choices = Array.isArray(source.choices) ? source.choices.map(object) : [];
  const note = object(source.source).note;
  return <div className="vocab-contrast-comparison" aria-label="Answer comparison">
    {choices.map((choice, index) => <div key={index} className={choice.wordId === correctWordId ? 'is-correct-choice' : choice.wordId === selectedWordId ? 'is-selected-choice' : ''}>
      <strong lang="zh">{convertSentenceCharacters(String(choice.hanzi ?? choice.label ?? ''), sentenceCharacterPresentation)}</strong>
      <span>{choice.wordId === correctWordId ? ' Expected answer' : ''}{choice.wordId === selectedWordId ? ' · Your choice' : ''}</span>
      {typeof choice.explanation === 'string' && <p>{convertSentenceCharacters(choice.explanation, sentenceCharacterPresentation)}</p>}
    </div>)}
    {typeof note === 'string' && note && <p>{convertSentenceCharacters(note, sentenceCharacterPresentation)}</p>}
  </div>;
}
