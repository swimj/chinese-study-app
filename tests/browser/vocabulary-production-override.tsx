// Real study controller. A matching production form stays uncommitted until
// Next records acceptance or Forgot records the typed hanzi as a pronunciation miss.
import { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { VocabularyStudy } from '../../src/features/vocabulary-study/VocabularyStudy';
import { useVocabularyStudy } from '../../src/features/vocabulary-study/useVocabularyStudy';
import { gradeVocabularyRecallResponse, latestVocabularyUndoableActionId, projectVocabularySession, type VocabularySessionAction, type VocabularySessionInitialContext } from '../../src/domain/vocabulary-session';
import type { VocabularyStudy as Study, VocabularyStudyCommand } from '../../src/domain/vocabulary-study-api';
import '../../src/styles.css';
import '../../src/features/session/session-desk.css';

const context: VocabularySessionInitialContext = { sessionId: 'production-override', words: [{ wordId: 'word', mode: 'practice', selectedSkill: 'production' }] };
const actions: VocabularySessionAction[] = [];
const commands: unknown[] = [];
(window as unknown as { studyCommands: unknown[] }).studyCommands = commands;
type ActionPayload<T = VocabularySessionAction> = T extends VocabularySessionAction ? Pick<T, 'kind' | 'payload'> : never;
function append(action: ActionPayload) {
  const sequence = actions.length + 1;
  actions.push({ ...action, protocolVersion: 1, sequence, actionId: `action-${sequence}`, clientActionId: `client-${sequence}`, occurredAt: '2026-10-29T00:00:00.000Z' });
}
function productionSnapshot(encounterId: string) {
  return { kind: 'production' as const, role: 'general' as const, contentId: encounterId, contentVersion: 1, body: { prompt: 'A written character' }, assessment: { acceptedAnswers: ['字'] } };
}
append({ kind: 'presentation', payload: { encounterId: 'produce', wordId: 'word', snapshot: productionSnapshot('produce') } });
function study(): Study {
  const projection = projectVocabularySession(context, actions);
  return { session: { sessionId: 'production-override', status: 'active', context, actions, projection, completion: null },
    words: [{ wordId: 'word', hanzi: '字', traditional: null, pinyin: 'zì', meaning: 'character' }], currentWordId: 'word', currentEncounter: projection.encounters.filter((entry) => !entry.presentationUndone).at(-1) ?? null, notice: null,
    controls: { canNext: true, canSkip: true, canEnough: true, canMore: false, canUndo: projection.latestUndoableActionId !== null, canFinishForNow: true, canFinishImmediately: false, canChangeMode: false } };
}
function record(command: unknown) {
  commands.push(command);
  (window as unknown as { studyCommands: unknown[] }).studyCommands = commands;
  const node = document.getElementById('last-command');
  if (node) node.textContent = JSON.stringify(commands);
}
window.fetch = async (input, init) => {
  const url = String(input);
  if (url.endsWith('/completion/current')) return Response.json(null);
  if (url.endsWith('/sessions')) return Response.json(study());
  if (url.endsWith('/commands')) {
    const { command } = JSON.parse(String(init?.body)) as { command: VocabularyStudyCommand };
    record(command);
    if (command.type === 'response') {
      const encounter = study().currentEncounter;
      if (!encounter || encounter.snapshot.kind !== 'production') return Response.json({ error: 'No production exercise' }, { status: 400 });
      try {
        const outcome = gradeVocabularyRecallResponse({ kind: 'production', acceptedAnswers: encounter.snapshot.assessment?.acceptedAnswers ?? [], response: command.response, selfAssessment: command.selfAssessment });
        append({ kind: 'response', payload: { encounterId: encounter.encounterId, response: command.response, outcome, ...(command.selfAssessment ? { selfAssessment: command.selfAssessment } : {}) } });
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : 'Invalid response' }, { status: 400 });
      }
      return Response.json(study());
    }
    if (command.type === 'undo') {
      const target = latestVocabularyUndoableActionId(actions);
      if (!target) return Response.json({ error: 'Nothing to undo' }, { status: 400 });
      append({ kind: 'undo', payload: { undoesActionId: target } });
      return Response.json(study());
    }
    return Response.json({ error: `Unexpected command ${command.type}` }, { status: 400 });
  }
  if (url.endsWith('/next')) {
    record({ type: 'next' });
    const id = `next-${actions.length}`;
    append({ kind: 'presentation', payload: { encounterId: id, wordId: 'word', snapshot: { kind: 'recognition', role: 'general', contentId: id, contentVersion: 1, body: { prompt: 'Next card' }, assessment: { acceptedAnswers: ['字'] } } } });
    return Response.json(study());
  }
  return Response.json({ error: `Unexpected request ${url}` }, { status: 404 });
};
function Fixture() {
  const controller = useVocabularyStudy();
  const begun = useRef(false);
  useEffect(() => { if (!begun.current) { begun.current = true; void controller.start(); } }, []);
  return <>
    <output id="last-command" style={{ display: 'block', fontSize: '.7rem' }}>{JSON.stringify(commands)}</output>
    <div style={{ height: 'calc(100dvh - 2rem)' }}><VocabularyStudy controller={controller} /></div>
  </>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
