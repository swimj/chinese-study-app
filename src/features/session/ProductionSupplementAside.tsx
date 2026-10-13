import type { ProductionCueSupplementSnapshot } from '../../domain/study-actions';
import type { SentenceCharacterPresentation } from '../../domain/card-characters';
import { convertSentenceCharacters } from '../../domain/sentence-characters';

export function ProductionSupplementAside({
  supplement,
  sentenceCharacterPresentation,
}: {
  supplement: Pick<ProductionCueSupplementSnapshot, 'englishFrame' | 'exampleSentence' | 'exampleTranslation'>;
  sentenceCharacterPresentation: SentenceCharacterPresentation;
}) {
  const sentenceText = (text: string) => convertSentenceCharacters(text, sentenceCharacterPresentation);
  return (
    <div className="production-supplement production-supplement-aside">
      <p className="production-supplement-frame">{sentenceText(supplement.englishFrame)}</p>
      <p className="production-supplement-sentence">{`「${sentenceText(supplement.exampleSentence)}」`}</p>
      <p className="production-supplement-translation">{sentenceText(supplement.exampleTranslation)}</p>
    </div>
  );
}

