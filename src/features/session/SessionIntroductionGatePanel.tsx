import { WordIntroductionExperience } from '../word-introduction/WordIntroductionExperience';
import type { SessionIntroductionGate } from './useIntroductionGate';

export function SessionIntroductionGatePanel({ gate, onUndo }: { gate: SessionIntroductionGate; onUndo?: () => void }) {
  return <section className="panel" aria-label="New word introduction">
    {gate.status === 'introduction' ? <WordIntroductionExperience
      key={gate.key} wordId={gate.wordId} autoPrepare closeLabel="Continue with study cards"
      onClose={gate.dismiss} onCompleted={gate.complete ?? gate.dismiss}
    /> : <>
      <h2>New word introduction</h2>
      <p role="status">{gate.status === 'checking'
        ? 'Checking the introduction for this word…'
        : 'The introduction is unavailable. You can continue with the usual study cards.'}</p>
    </>}
    {onUndo && <button type="button" className="secondary-button" onClick={onUndo}>Undo last study action</button>}
    {gate.status !== 'introduction' && <button type="button" className="secondary-button" onClick={gate.dismiss}>Continue with study cards</button>}
  </section>;
}
