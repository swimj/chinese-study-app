import { VocabularyCardActions } from '../vocabulary-ui/VocabularyCardActions';
import { useMemo, useState } from 'react';
import type { VocabularySessionJson } from '../../domain/vocabulary-session';
import type { VocabularyStudyWord } from '../../domain/vocabulary-study-api';
import { parseWordContent } from '../../domain/word-content';
import { parseTeachingBeats } from '../../domain/word-content/validation';
import type { TeachingPackageSnapshot, WordContentDocument } from '../../domain/word-content';
import { formatCardCharacters, type CharacterPresentation, type SentenceCharacterPresentation } from '../../domain/card-characters';
import { IntroductionPlayer } from '../introduction-lab/IntroductionPlayer';
import { initialIntroductionPlayerState, reduceIntroductionPlayer } from '../introduction-lab/player';
import { VocabularyWarmup } from './VocabularyWarmup';

type ObjectValue = { [key: string]: VocabularySessionJson };
function object(value: VocabularySessionJson | undefined): ObjectValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

/** Adapt frozen authored material to the existing production teaching player. */
export function vocabularyIntroductionMaterial(material: VocabularySessionJson | undefined, word: VocabularyStudyWord, teachingSource?: VocabularySessionJson) {
  const body = object(material);
  const beats = (Array.isArray(body.beats) ? body.beats : []).map((value, index) => {
    const beat = object(value);
    const id = typeof beat.id === 'string' ? beat.id : `beat-${index + 1}`;
    if (Array.isArray(beat.parts)) return { id, parts: beat.parts.map((value) => {
      const part = object(value);
      if (typeof part.text !== 'string') throw new Error('Introduction part is missing authored text');
      const [parsed] = parseTeachingBeats([{ id, parts: [part.source] }]);
      return { text: part.text, source: parsed!.parts[0]! };
    }) };
    if (typeof beat.text !== 'string') throw new Error('Introduction beat is missing authored text');
    return { id, parts: [{ text: beat.text, source: { kind: 'text' as const, text: beat.text } }] };
  });
  if (beats.length === 0) throw new Error('Introduction has no teaching beats');
  const snapshot: Pick<TeachingPackageSnapshot, 'beats' | 'rehearsals'> = { beats, rehearsals: [] };
  // Small independently authored introductions need only lexical recap; source-backed
  // introductions retain their exact published document, never reconstructed senses.
  const content: Pick<WordContentDocument, 'word' | 'uses' | 'examples'> = teachingSource !== undefined
    ? parseWordContent(teachingSource)
    : { word: { wordId: word.wordId, hanzi: word.hanzi, traditional: word.traditional, pinyin: word.pinyin },
      uses: [{ id: 'lexical-meaning', label: word.meaning, notes: [], exampleIds: [] }], examples: [] };
  if (content.word.wordId !== word.wordId) throw new Error('Introduction source belongs to another word');
  return { snapshot, content };
}

export type VocabularyIntroductionProps = {
  material: VocabularySessionJson | undefined;
  teachingSource?: VocabularySessionJson;
  word: VocabularyStudyWord;
  onContinue: () => void;
  busy: boolean;
  characterPresentation: CharacterPresentation;
  sentenceCharacterPresentation: SentenceCharacterPresentation;
  warmup?: boolean;
};

export function VocabularyIntroduction(props: VocabularyIntroductionProps) {
  if (props.warmup) return <VocabularyWarmup {...props} />;
  return <Introduction {...props} />;
}

function Introduction({ material, teachingSource, word, onContinue, busy, characterPresentation, sentenceCharacterPresentation }: VocabularyIntroductionProps) {
  const { snapshot, content } = useMemo(() => vocabularyIntroductionMaterial(material, word, teachingSource), [material, word, teachingSource]);
  const [state, setState] = useState(initialIntroductionPlayerState);
  return <section className="intro-lab word-intro-experience" aria-label="Word introduction">
    <div className="word-intro-shell">
      {state.phase !== 'finished' && <header className="word-intro-heading">
        <p className="intro-lab-kicker">Word introduction</p>
        <h1>{formatCardCharacters(content.word, characterPresentation)}</h1>
        <p className="word-intro-pronunciation">{content.word.pinyin}</p>
      </header>}
      <IntroductionPlayer renderTeachingActions={(primary, secondary) => <VocabularyCardActions><div className="vocab-main-actions">{primary}{secondary}</div></VocabularyCardActions>} mode="teaching-only" snapshot={snapshot} content={content} state={state}
        characterPresentation={characterPresentation} sentenceCharacterPresentation={sentenceCharacterPresentation}
        onAction={(action) => { if (!busy) setState((current) => reduceIntroductionPlayer(current, action, snapshot, 'teaching-only')); }}
        onRestart={() => { if (!busy) setState(initialIntroductionPlayerState()); }}
        onFinish={onContinue} finishing={busy} />
    </div>
  </section>;
}
