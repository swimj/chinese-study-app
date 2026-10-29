import type { SessionStudyItem } from '../../domain/study-actions';
import type { SentenceCharacterPresentation } from '../../domain/card-characters';
import { convertSentenceCharacters, sentenceCharacterLanguage } from '../../domain/sentence-characters';

/** The same source usage reference appears on recognition and practice reveals. */
export function WordSourceExamples({ content, sentenceCharacterPresentation }: {
  content: NonNullable<SessionStudyItem['wordContent']>;
  sentenceCharacterPresentation: SentenceCharacterPresentation;
}) {
  const text = (value: string) => convertSentenceCharacters(value, sentenceCharacterPresentation);
  return <div className="stack word-source-examples">{content.uses.map((use) => {
    const example = content.examples.find((row) => row.id === use.exampleIds[0]);
    return <div key={use.id}>
      <strong>{text(use.label)}</strong>
      {example && <><p lang={sentenceCharacterLanguage(sentenceCharacterPresentation)}>{text(example.text)}</p><p>{text(example.translation)}</p></>}
    </div>;
  })}</div>;
}
