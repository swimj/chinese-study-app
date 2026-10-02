import { WordIntroductionExperience } from '../word-introduction/WordIntroductionExperience';
import type { SessionIntroductionGate } from './useIntroductionGate';

export function SessionIntroductionGatePanel({ gate, onUndo }: { gate: SessionIntroductionGate; onUndo?: () => void }) {
  return <section className="panel" aria-label="New word introduction">
    <WordIntroductionExperience
      qualityEncounterId={gate.key}
      key={gate.key} wordId={gate.wordId} preloadedIntroduction={gate.preloadedIntroduction}
      onCompleted={gate.complete}
    />
    {onUndo && <button type="button" className="secondary-button" onClick={onUndo}>Undo last study action</button>}
  </section>;
}
