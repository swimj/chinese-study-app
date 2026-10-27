import { VocabularyCardActions } from '../vocabulary-ui/VocabularyCardActions';
import { Fragment, useEffect, useState } from 'react';
import type { VocabularySessionJson } from '../../domain/vocabulary-session';
import type { VocabularyStudyWord } from '../../domain/vocabulary-study-api';
import { parseWordContent } from '../../domain/word-content';
import { convertSentenceCharacters } from '../../domain/sentence-characters';
import { formatCardCharacters, type CharacterPresentation, type SentenceCharacterPresentation } from '../../domain/card-characters';
import { isEditableKeyboardTarget, isImeComposingEvent } from '../session/session-keyboard';
import { ShortcutHint } from '../../components/ShortcutHint';
import { VocabularyCharacterRuby, vocabularySentenceRuby } from './VocabularyRuby';

type MaterialObject = { [key: string]: VocabularySessionJson };
function object(value: VocabularySessionJson | undefined): MaterialObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
export type VocabularyWarmupExample = { sentence: string; pronunciation: string | null; translation: string | null; sense?: string };

/** Select authored example evidence only; lexical facts never become a fabricated example. */
export function vocabularyWarmupExample(material: VocabularySessionJson | undefined, wordId: string,
  teachingSource?: VocabularySessionJson): VocabularyWarmupExample | null {
  if (teachingSource !== undefined) {
    const content = parseWordContent(teachingSource);
    if (content.word.wordId !== wordId) throw new Error('Warmup source belongs to another word');
    const linkedId = content.uses.flatMap((use) => use.exampleIds)[0];
    const example = content.examples.find((entry) => entry.id === linkedId) ?? content.examples[0];
    const use = example && content.uses.find((entry) => entry.exampleIds.includes(example.id));
    return example ? { sentence: example.text, pronunciation: example.pronunciation, translation: example.translation,
      ...(use ? { sense: use.label } : {}) } : null;
  }
  const beats = object(material).beats;
  const parts = Array.isArray(beats) ? beats.flatMap((beat) => {
    const values = object(beat).parts;
    return Array.isArray(values) ? values.map(object) : [];
  }) : [];
  const sentence = parts.find((part) => object(part.source).kind === 'example' && object(part.source).field === 'sentence'
    && typeof part.text === 'string' && part.text.trim());
  if (!sentence || typeof sentence.text !== 'string') {
    // Independent introductions can retain an explicitly named example as one
    // materialized text beat, rather than individual typed example fields.
    if (!Array.isArray(beats)) return null;
    for (const value of beats) {
      const beat = object(value);
      if (typeof beat.id !== 'string' || !/^example(?:$|[-_:])/i.test(beat.id) || typeof beat.text !== 'string') continue;
      const [first, ...rest] = beat.text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const translation = rest.join('\n');
      if (first && /\p{Script=Han}/u.test(first) && /[。！？!?]$/u.test(first)
        && translation && /\p{Script=Latin}/u.test(translation)) {
        return { sentence: first, pronunciation: null, translation };
      }
    }
    return null;
  }
  const exampleId = object(sentence.source).exampleId;
  const field = (name: 'translation' | 'pronunciation') => {
    const part = parts.find((part) => object(part.source).kind === 'example' && object(part.source).exampleId === exampleId
      && object(part.source).field === name && typeof part.text === 'string');
    return typeof part?.text === 'string' && part.text.trim() ? part.text : null;
  };
  return { sentence: sentence.text, pronunciation: field('pronunciation'), translation: field('translation') };
}

export type VocabularyWarmupStage = 0 | 1 | 2 | 3;

export function nextVocabularyWarmupStage(stage: VocabularyWarmupStage, example: VocabularyWarmupExample | null): VocabularyWarmupStage {
  if (stage === 0) return 1;
  if (stage === 1 && example?.translation?.trim()) return 2;
  return 3;
}

/** A familiar example to read once; Continue advances without recording an assessment. */
export function VocabularyWarmup({ material, teachingSource, word, onContinue, busy, characterPresentation, sentenceCharacterPresentation }: {
  material: VocabularySessionJson | undefined;
  teachingSource?: VocabularySessionJson;
  word: VocabularyStudyWord;
  onContinue: () => void;
  busy: boolean;
  characterPresentation: CharacterPresentation;
  sentenceCharacterPresentation: SentenceCharacterPresentation;
}) {
  const example = vocabularyWarmupExample(material, word.wordId, teachingSource);
  const [stage, setStage] = useState<VocabularyWarmupStage>(0);
  function primary() {
    if (busy) return;
    if (stage === 3) onContinue(); else setStage(nextVocabularyWarmupStage(stage, example));
  }
  useEffect(() => { setStage(0); }, [word.wordId, example?.sentence]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (busy || event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey
        || isImeComposingEvent(event) || isEditableKeyboardTarget(event.target)
        || (event.target instanceof HTMLElement && event.target.closest('button, a, summary'))
        || document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')) return;
      if (event.key !== ' ' && event.key !== 'Enter') return;
      event.preventDefault(); primary();
    };
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, [busy, onContinue, stage, example?.translation]);
  return <VocabularyWarmupContent example={example} word={word} stage={stage} busy={busy} onPrimary={primary}
    characterPresentation={characterPresentation} sentenceCharacterPresentation={sentenceCharacterPresentation} />;
}

export function VocabularyWarmupContent({ example, word, stage, busy, onPrimary, characterPresentation, sentenceCharacterPresentation }: {
  example: VocabularyWarmupExample | null; word: VocabularyStudyWord; stage: VocabularyWarmupStage; busy: boolean; onPrimary: () => void;
  characterPresentation: CharacterPresentation; sentenceCharacterPresentation: SentenceCharacterPresentation;
}) {
  const revealed = stage > 0;
  const sentence = example ? convertSentenceCharacters(example.sentence, sentenceCharacterPresentation) : formatCardCharacters(word, characterPresentation);
  const target = example ? convertSentenceCharacters(word.hanzi, sentenceCharacterPresentation) : sentence;
  const parts = target ? sentence.split(target) : [sentence];
  const matched = parts.length > 1;
  const sentenceRuby = revealed && example ? vocabularySentenceRuby(sentence, example.pronunciation, target, word.pinyin) : null;
  return <section className="vocab-card-main" aria-label="Familiar warmup">
    <div className="vocab-card-content" tabIndex={0} role="region" aria-label="Warmup example and meaning">
    <p className="vocab-eyebrow">Familiar warmup</p>
    <div className={`vocab-prompt vocab-warmup-sentence${revealed && matched ? ' is-revealed' : ''}`} lang={sentenceCharacterPresentation === 'traditional' ? 'zh-Hant' : 'zh-Hans'}>
      {sentenceRuby ?? (revealed && matched ? parts.map((part, index) => <Fragment key={index}>
        {index > 0 && <VocabularyCharacterRuby text={target} pinyin={word.pinyin} target />}{part}
      </Fragment>) : sentence)}
    </div>
    {revealed && <div className="vocab-supporting" aria-label="Warmup meaning">
      {stage >= 2 && example?.translation && <p>{convertSentenceCharacters(example.translation, sentenceCharacterPresentation)}</p>}
      {!sentenceRuby && example?.pronunciation && example.pronunciation !== word.pinyin && <details className="vocab-warmup-pinyin">
        <summary>Pinyin</summary><p lang="zh-Latn">{example.pronunciation}</p>
      </details>}
      {!matched && <p lang="zh-Latn">{word.pinyin}</p>}
      {stage === 3 && <p className="vocab-warmup-sense">{formatCardCharacters(word, characterPresentation)}：{convertSentenceCharacters(example?.sense ?? word.meaning, sentenceCharacterPresentation)}</p>}
    </div>}
    </div>
    <VocabularyCardActions><div className="vocab-response"><div className="vocab-main-actions"><button type="button" className="vocab-primary" disabled={busy}
      aria-keyshortcuts={busy ? undefined : 'Space Enter'} onClick={onPrimary}>{stage === 3 ? 'Continue' : 'Reveal'}<ShortcutHint shortcuts={['Space', 'Enter']} /></button></div></div></VocabularyCardActions>
  </section>;
}
