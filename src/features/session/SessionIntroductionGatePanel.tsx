import { WordIntroductionExperience } from '../word-introduction/WordIntroductionExperience';
import type { CharacterPresentation, SentenceCharacterPresentation } from '../../domain/card-characters';
import type { SessionIntroductionGate } from './useIntroductionGate';

export function SessionIntroductionGatePanel({
  gate, onUndo, characterPresentation, sentenceCharacterPresentation,
}: {
  gate: SessionIntroductionGate;
  onUndo?: () => void;
  characterPresentation?: CharacterPresentation;
  sentenceCharacterPresentation?: SentenceCharacterPresentation;
}) {
  return <section className="panel" aria-label="New word introduction">
    <WordIntroductionExperience
      qualityEncounterId={gate.key}
      characterPresentation={characterPresentation}
      sentenceCharacterPresentation={sentenceCharacterPresentation}
      key={gate.key} wordId={gate.wordId} preloadedIntroduction={gate.preloadedIntroduction}
      onCompleted={gate.complete}
    />
    {onUndo && <button type="button" className="secondary-button" onClick={onUndo}>Undo last study action</button>}
  </section>;
}
