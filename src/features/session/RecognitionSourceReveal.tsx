import { useState } from 'react';
import type { WordContentDocument } from '../../domain/word-content/types';
import type { SentenceCharacterPresentation } from '../../domain/card-characters';
import { ProductionSupplementAside } from './ProductionSupplementAside';

export function selectRecognitionUse(content: WordContentDocument, date: Date) {
  const day = Math.floor(date.getTime() / 86_400_000);
  if (!Number.isFinite(day) || content.uses.length === 0) {
    throw new Error('Recognition reveal requires a valid date and at least one source use.');
  }
  const index = ((day % content.uses.length) + content.uses.length) % content.uses.length;
  const use = content.uses[index];
  const example = content.examples.find((row) => row.id === use.exampleIds[0]);
  if (!example) throw new Error(`Recognition use ${use.id} has no linked example.`);
  return { englishFrame: use.label, exampleSentence: example.text, exampleTranslation: example.translation };
}

export function RecognitionSourceReveal({ content, sentenceCharacterPresentation }: {
  content: WordContentDocument;
  sentenceCharacterPresentation: SentenceCharacterPresentation;
}) {
  const [date] = useState(() => new Date());
  return <ProductionSupplementAside
    supplement={selectRecognitionUse(content, date)}
    sentenceCharacterPresentation={sentenceCharacterPresentation}
  />;
}
