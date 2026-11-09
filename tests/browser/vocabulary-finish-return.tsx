// Production study controller, reducer and surface, with simulated HTTP transport.
// Default: a covered word, current open word, and an unstarted due word.
// ?last=1 omits the unstarted word; ?narrow=1 uses a 420px panel and 125% text.
import { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { VocabularyStudy } from '../../src/features/vocabulary-study/VocabularyStudy';
import { useVocabularyStudy } from '../../src/features/vocabulary-study/useVocabularyStudy';
import { projectVocabularySession, type VocabularySessionAction, type VocabularySessionInitialContext } from '../../src/domain/vocabulary-session';
import type { VocabularySessionCompletion } from '../../src/domain/vocabulary-session-api';
import type { VocabularyStudy as Study, VocabularyStudyCommand } from '../../src/domain/vocabulary-study-api';
import '../../src/styles.css';
import '../../src/features/session/session-desk.css';

const params = new URLSearchParams(location.search);
const words = [
  { wordId: 'a', hanzi: '甲', traditional: null, pinyin: 'jiǎ', meaning: 'first' },
  { wordId: 'b', hanzi: '乙', traditional: null, pinyin: 'yǐ', meaning: 'second' },
  ...params.has('last') ? [] : [{ wordId: 'c', hanzi: '丙', traditional: null, pinyin: 'bǐng', meaning: 'third' }],
];
const context: VocabularySessionInitialContext = { sessionId: 'finish-return', words: words.map(word => ({ wordId: word.wordId, mode: 'practice', selectedSkill: 'production' })) };
type Input = VocabularySessionAction extends infer A ? A extends VocabularySessionAction ? Pick<A, 'kind' | 'payload'> : never : never;
const actions: VocabularySessionAction[] = [];
const time = () => new Date().toISOString();
function append(input: Input, transitionId?: string) {
  const id = `action-${actions.length + 1}`;
  actions.push({ ...input, actionId: id, clientActionId: id, sequence: actions.length + 1, protocolVersion: 1, occurredAt: time(), transitionId });
}
function present(wordId: string) {
  const word = words.find(word => word.wordId === wordId)!;
  append({ kind: 'presentation', payload: { wordId, encounterId: `encounter-${actions.length}`, snapshot: {
    contentId: wordId, contentVersion: 1, kind: 'production', role: 'general', body: { prompt: word.meaning }, assessment: { acceptedAnswers: [word.hanzi] },
  } } });
}
present('a');
append({ kind: 'response', payload: { encounterId: 'encounter-0', response: '甲', outcome: 'accepted' } });
append({ kind: 'word_wrap', payload: { wordId: 'a', reason: 'policy' } });
present('b');
let completion: VocabularySessionCompletion | null = null;
let stageCalls = 0, cancelCalls = 0;
const commands: string[] = [];
function study(): Study {
  const projection = projectVocabularySession(context, actions);
  const currentEncounter = projection.encounters.filter(encounter => !encounter.presentationUndone).at(-1)!;
  const active = !completion || completion.status === 'cancelled';
  return { session: { sessionId: context.sessionId, context, actions, projection, completion,
    status: completion?.status === 'closed' ? 'closed' : active ? 'active' : 'finalizing' },
    words, currentEncounter, currentWordId: currentEncounter.wordId, notice: null,
    controls: { canNext: active, canSkip: active, canEnough: active, canMore: false, canUndo: active && projection.latestUndoableActionId !== null,
      canFinishForNow: active && projection.phase === 'active', canFinishImmediately: active && projection.phase === 'finishing', canChangeMode: false } };
}
window.fetch = async (input, init) => {
  const url = String(input);
  if (url.endsWith('/completion/current')) return Response.json(null);
  if (url.endsWith('/sessions')) return Response.json(study());
  if (url.endsWith('/words')) return Response.json({ words: [] });
  if (url.endsWith('/commands')) {
    const { command } = JSON.parse(String(init?.body)) as { command: VocabularyStudyCommand };
    commands.push(command.type);
    const current = study();
    switch (command.type) {
      case 'finishForNow': append({ kind: 'finish_for_now', payload: {} }); break;
      case 'finishImmediately': append({ kind: 'finish_immediately', payload: {} }); break;
      case 'resume': append({ kind: 'resume', payload: {} }); break;
      case 'undo': append({ kind: 'undo', payload: { undoesActionId: current.session.projection.latestUndoableActionId! } }); break;
      case 'response': {
        const transition = `response-${actions.length}`;
        const accepted = current.currentEncounter!.snapshot.assessment!.acceptedAnswers.includes(command.response ?? '');
        append({ kind: 'response', payload: { encounterId: current.currentEncounter!.encounterId, response: command.response, outcome: accepted ? 'accepted' : 'rejected' } }, transition);
        if (accepted) append({ kind: 'word_wrap', payload: { wordId: current.currentWordId!, reason: 'policy' } }, transition);
        break;
      }
      default: throw new Error(`Unsupported fixture command ${command.type}`);
    }
    return Response.json(study());
  }
  if (url.endsWith('/next')) {
    const projection = study().session.projection;
    const next = Object.values(projection.words).find(word => word.workStatus === 'open' || (projection.phase === 'active' && word.workStatus === 'not_started'));
    if (next) present(next.wordId);
    else append({ kind: 'finish_for_now', payload: {} });
    return Response.json(study());
  }
  if (url.endsWith('/completion/cancel')) {
    cancelCalls++; completion = { ...completion!, status: 'cancelled', canUndo: false }; return Response.json(completion);
  }
  if (url.endsWith('/completion/close')) {
    completion = { ...completion!, status: 'closed', canUndo: false, closedAt: time() }; return Response.json(completion);
  }
  if (url.endsWith('/completion')) {
    if (init?.method === 'POST') {
      stageCalls++;
      const now = time();
      completion = { sessionId: context.sessionId, completionId: `completion-${stageCalls}`, revisionNumber: stageCalls, throughSequence: actions.length,
        status: 'pending', stagedAt: now, closeAt: new Date(Date.now() + 15000).toISOString(), closedAt: null, report: study().session.projection,
        error: null, canUndo: true, serverNow: now, metadata: { source: 'client_visibility_and_focus', activeDurationMs: 1000 } };
    }
    return Response.json(completion);
  }
  if (url.endsWith(`/sessions/${context.sessionId}`)) return Response.json(study());
  throw new Error(`Unexpected fixture request ${url}`);
};
function Fixture() {
  const controller = useVocabularyStudy();
  const started = useRef(false);
  useEffect(() => { if (!started.current) { started.current = true; void controller.start(); } }, []);
  return <>
    {params.has('narrow') && <style>{':root{font-size:125%;}'}</style>}
    <output id="finish-evidence" style={{ display: 'block', overflowWrap: 'anywhere', fontSize: '.75rem' }}>{JSON.stringify({ phase: controller.study?.session.projection.phase, commands, stageCalls, cancelCalls,
      responses: controller.study?.session.actions.filter(action => action.kind === 'response').length })}</output>
    <div style={{ width: params.has('narrow') ? 420 : '100%', maxWidth: '100%', height: 'calc(100dvh - 3rem)', margin: '0 auto' }}>
      {controller.study ? <VocabularyStudy controller={controller} /> : <p>Home — reload to repeat</p>}
    </div>
  </>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
