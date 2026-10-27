import type { ReactNode } from 'react';
import type { VocabularySessionJson } from '../../domain/vocabulary-session';
import { convertSentenceCharacters } from '../../domain/sentence-characters';
import type { SentenceCharacterPresentation } from '../../domain/card-characters';
import { ProductionSupplementAside } from '../session/ProductionSupplementAside';

type MaterialObject = { [key: string]: VocabularySessionJson };
function object(value: VocabularySessionJson | undefined): MaterialObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
export type VocabularyTeachingBeat = { id: string; parts: { text: string; kind: string; field?: string }[] };
/** Imported introduction beats already contain the authored, materialized text. */
export function vocabularyTeachingBeats(material: VocabularySessionJson | undefined): VocabularyTeachingBeat[] {
  const source = object(material);
  if (!Array.isArray(source.beats)) return [];
  return source.beats.map((value, index) => {
    const beat = object(value);
    const parts = Array.isArray(beat.parts) ? beat.parts.map((part) => {
      const row = object(part); const origin = object(row.source);
      return { text: typeof row.text === 'string' ? row.text : '', kind: typeof origin.kind === 'string' ? origin.kind : 'text',
        ...(typeof origin.field === 'string' ? { field: origin.field } : {}) };
    }).filter((part) => part.text.length > 0) : typeof beat.text === 'string' ? [{ text: beat.text, kind: 'text' }] : [];
    return { id: typeof beat.id === 'string' ? beat.id : `beat-${index + 1}`, parts };
  }).filter((beat) => beat.parts.length > 0);
}
export function renderVocabularyTeaching(material: VocabularySessionJson | undefined, throughBeat: number,
  sentencePresentation: SentenceCharacterPresentation = 'simplified'): ReactNode {
  const beats = vocabularyTeachingBeats(material);
  if (!beats.length) {
    const body = object(material);
    return typeof body.text === 'string' ? <p>{convertSentenceCharacters(body.text, sentencePresentation)}</p> : null;
  }
  return <div aria-label="Introduction steps">
    {beats.slice(0, throughBeat + 1).map((beat, index) => <section key={beat.id} aria-label={`Step ${index + 1} of ${beats.length}`}>
      {beat.parts.map((part, partIndex) => <p key={partIndex}
        lang={part.kind === 'example' && part.field === 'sentence' ? sentencePresentation === 'traditional' ? 'zh-Hant' : 'zh-Hans' : undefined}>
        {convertSentenceCharacters(part.text, sentencePresentation)}
      </p>)}
    </section>)}
  </div>;
}
/** Render only known learner-facing reveal fields; provenance and answer criteria stay out of the lesson. */
export function renderVocabularyReveal(material: VocabularySessionJson | undefined,
  sentencePresentation: SentenceCharacterPresentation = 'simplified'): ReactNode {
  const body = object(material); const reveal = object(body.reveal);
  const text = (value: VocabularySessionJson | undefined) => typeof value === 'string' ? value.trim() : '';
  const frame = text(reveal.englishFrame), sentence = text(reveal.exampleSentence), translation = text(reveal.exampleTranslation);
  const note = text(reveal.teachingNote);
  const explanations = [...new Set([text(reveal.explanation), text(body.explanation)].filter(Boolean))];
  return <>
    {(frame || sentence || translation) && <ProductionSupplementAside supplement={{englishFrame:frame,exampleSentence:sentence,exampleTranslation:translation}} sentenceCharacterPresentation={sentencePresentation} />}
    {note && <div className="vocab-usage-note"><p className="vocab-eyebrow">Usage note</p><p>{convertSentenceCharacters(note, sentencePresentation)}</p></div>}
    {explanations.map((value) => <p key={value}>{convertSentenceCharacters(value, sentencePresentation)}</p>)}
  </>;
}
export function vocabularyMaterialInstruction(material: VocabularySessionJson | undefined): string {
  const instruction = object(material).instruction;
  if (typeof instruction !== 'string') return '';
  // Remove known input mechanics, while retaining authored context that is part of the cue.
  return instruction.replace(/(?:Give the Mandarin word\.|Fill the gap with the Mandarin expression\.|Fill it (?:into the sentence in|in with) Chinese characters\.|Write in Chinese characters\.)/g, '').trim();
}

/** Recognition tests Hanzi-to-sound: pronunciation is reveal material, never a pre-answer hint. */
export function vocabularyPresentationWord<T>(word:T,kind:'introduction'|'recognition'|'production'|'contrast',revealed:boolean):T|null {
  return kind==='recognition'||(kind!=='introduction'&&!revealed)?null:word;
}
export function renderVocabularyRecognitionAnswer(pinyin:string,meaning:string):ReactNode {
  return <><p><strong>{meaning}</strong></p><p>{pinyin}</p></>;
}
