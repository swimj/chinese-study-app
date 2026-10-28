import type { SentenceCharacterPresentation } from '../../domain/card-characters';
import { convertClozeParts } from '../../domain/sentence-characters';

import { clozePromptParts } from '../../domain/cloze-prompt';

export function ClozePrompt({ text, answer, contextAnswer, sentenceCharacterPresentation }: {
  text: string;
  answer: string | null;
  /** Supplies phrase context without revealing the answer in the rendered prompt. */
  contextAnswer?: string;
  sentenceCharacterPresentation?: SentenceCharacterPresentation;
}) {
  const sourceParts = clozePromptParts(text);
  const converted = sentenceCharacterPresentation
    ? convertClozeParts(sourceParts, answer, sentenceCharacterPresentation, contextAnswer)
    : { parts: sourceParts, answer };
  const { parts } = converted;
  answer = converted.answer;
  if (!answer || parts.length === 1) return <>{parts.join('____')}</>;
  return <>{parts.map((part, index) => <span key={index}>
    {index > 0 ? <mark className="desk-cloze-answer">{answer}</mark> : null}{part}
  </span>)}</>;
}
