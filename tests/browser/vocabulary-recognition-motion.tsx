// Real controller + study surface; no production data. Reveal, then Correct/Forgot.
// ?retry=1 fails the first save; Retry save must retain the same departure.
// ?covered=1 enables general production / Try another way after the rating.
// ?reduced=1 forces reduced motion and verifies no departure/tuck ghosts.
// ?narrow=1 uses a 420px panel at 125% text; open Covered in this session for the tray.
// ?slow=1 holds Correct's successor while checking the underlying paper stays opaque.
// ?production=1&save-delay=1 starts on a production card with a delayed answer save.
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { VocabularyStudy } from '../../src/features/vocabulary-study/VocabularyStudy';
import { useVocabularyStudy } from '../../src/features/vocabulary-study/useVocabularyStudy';
import { projectVocabularySession, type VocabularySessionAction, type VocabularySessionInitialContext } from '../../src/domain/vocabulary-session';
import type { VocabularyStudy as Study } from '../../src/domain/vocabulary-study-api';
import '../../src/styles.css';
import '../../src/features/session/session-desk.css';

const query = new URLSearchParams(location.search);
const covered = query.has('covered');
const narrow = query.has('narrow');
if (query.has('reduced')) {
  const nativeMatchMedia = window.matchMedia.bind(window);
  window.matchMedia = (media) => {
    const result = nativeMatchMedia(media);
    if (media === '(prefers-reduced-motion: reduce)') Object.defineProperty(result, 'matches', { value: true });
    return result;
  };
}
const context: VocabularySessionInitialContext = { sessionId: 'motion', words: covered ? [{ wordId: 'word', mode: 'practice', selectedSkill: 'recognition' }] : [{ wordId: 'word', mode: 'unstudied', teachingRequirements: {
  introductionContentId: 'intro', requiredExerciseContentIds: [], minimumRecognitionResponses: 3, minimumProductionResponses: 3,
} }] };
context.words.push({ wordId: 'covered-word', mode: 'practice', selectedSkill: 'recognition' });
const actions: VocabularySessionAction[] = [];
type ActionPayload<T = VocabularySessionAction> = T extends VocabularySessionAction ? Pick<T, 'kind' | 'payload'> : never;
function append(action: ActionPayload) {
  const sequence = actions.length + 1;
  actions.push({ ...action, protocolVersion: 1, sequence, actionId: `action-${sequence}`, clientActionId: `client-${sequence}`, occurredAt: new Date().toISOString() });
}
append({ kind: 'presentation', payload: { encounterId: 'covered-recognition', wordId: 'covered-word', snapshot: { kind: 'recognition', role: 'general', contentId: 'covered-recognition', contentVersion: 1, body: { prompt: '鼓舞' }, assessment: { acceptedAnswers: ['鼓舞'] } } } });
append({ kind: 'response', payload: { encounterId: 'covered-recognition', response: null, outcome: 'accepted', selfAssessment: 'accepted' } });
append({ kind: 'word_wrap', payload: { wordId: 'covered-word', reason: 'policy' } });
if (!covered) append({ kind: 'presentation', payload: { encounterId: 'intro', wordId: 'word', snapshot: { kind: 'introduction', role: 'teaching', contentId: 'intro', contentVersion: 1, body: { prompt: '字' }, assessment: null } } });
append({ kind: 'presentation', payload: { encounterId: 'recognition', wordId: 'word', snapshot: { kind: 'recognition', role: covered ? 'general' : 'teaching', contentId: 'recognition', contentVersion: 1, body: { prompt: '字' }, assessment: { acceptedAnswers: ['字'] } } } });
if (query.has('production')) append({ kind: 'presentation', payload: { encounterId: 'production', wordId: 'word', snapshot: { kind: 'production', role: 'teaching', contentId: 'production', contentVersion: 1, body: { prompt: 'A written character' }, assessment: { acceptedAnswers: ['字'] } } } });
function study(): Study {
  const projection = projectVocabularySession(context, actions);
  return { session: { sessionId: 'motion', status: 'active', context, actions, projection, completion: null },
    words: [{ wordId: 'word', hanzi: '字', traditional: null, pinyin: 'zì', meaning: 'character' }, { wordId: 'covered-word', hanzi: '鼓舞', traditional: null, pinyin: 'gǔ wǔ', meaning: 'encourage' }], currentWordId: 'word', currentEncounter: projection.encounters.at(-1)!, notice: null,
    controls: { canNext: true, canSkip: true, canEnough: true, canMore: false, canUndo: true, canFinishForNow: true, canFinishImmediately: false, canChangeMode: true } };
}
let failed = false;
let result = 'Reveal and rate the word';
let anotherResult = 'Try another way has not run';
let paperResult = 'Paper handoff has not run';
let requeueCalls = 0;
let requeueInput: string | null = null;
let requeueEncounter: string | null = null;
let requeueGhost = false;
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
window.fetch = async (input, init) => {
  const url = String(input);
  if (url.endsWith('/completion/current')) return Response.json(null);
  if (url.endsWith('/sessions')) return Response.json(study());
  if (url.endsWith('/commands')) {
    const { command } = JSON.parse(String(init?.body)) as { command: { type: string; wordId?: string; response?: string | null; selfAssessment?: 'accepted' | 'rejected' } };
    if (command.type === 'requeue') {
      if (command.wordId !== 'covered-word') throw new Error('Expected covered fixture word');
      requeueCalls++;
      requeueInput = document.querySelector<HTMLInputElement>('.vocab-input-wrap input')?.value ?? '';
      requeueEncounter = study().currentEncounter!.encounterId;
      requeueGhost = reducedMotion() ? !document.querySelector('.desk-tuck, .desk-departure')
        : Boolean(document.querySelector('.desk-tuck') && !document.querySelector('.desk-departure'));
      append({ kind: 'word_more', payload: { wordId: command.wordId } });
      return Response.json(study());
    }
    if (query.has('retry') && !failed) { failed = true; return Response.json({ error: 'Fixture save failure' }, { status: 503 }); }
    if (command.type !== 'response') throw new Error(`Unexpected command ${command.type}`);
    if (query.has('save-delay')) await new Promise(resolve => setTimeout(resolve, 1500));
    append({ kind: 'response', payload: { encounterId: study().currentEncounter!.encounterId, response: command.response ?? null,
      outcome: command.selfAssessment ?? (command.response === '字' ? 'accepted' : 'rejected'),
      ...(command.selfAssessment ? { selfAssessment: command.selfAssessment } : {}) } });
    if (covered && command.selfAssessment === 'accepted') append({ kind: 'word_wrap', payload: { wordId: 'word', reason: 'policy' } });
    return Response.json(study());
  }
  if (url.endsWith('/next')) {
    if (query.has('slow') && document.querySelector('.desk-stack.is-departing') && !reducedMotion()) {
      await new Promise(resolve => setTimeout(resolve, 300));
      const paper = document.querySelector<HTMLElement>('.desk-stack .vocab-paper');
      const contents = paper?.querySelector<HTMLElement>('.vocab-card-main');
      const session = document.querySelector<HTMLElement>('.vocab-layout-session > .vocab-session');
      const opaque = paper && getComputedStyle(paper).visibility === 'visible'
        && getComputedStyle(paper).backgroundColor !== 'rgba(0, 0, 0, 0)';
      const hiddenContents = contents && getComputedStyle(contents).visibility === 'hidden';
      const horizontal = session && getComputedStyle(session).overflowX;
      paperResult = `${opaque && hiddenContents && horizontal === 'hidden' ? 'PASS' : 'FAIL'}: waiting paper opaque=${Boolean(opaque)}, outgoing contents hidden=${Boolean(hiddenContents)}, horizontal overflow=${horizontal}`;
    }
    const options = JSON.parse(String(init?.body)) as { another?: boolean };
    if (options.another) {
      const current = study().currentEncounter!;
      const hasTuck = Boolean(document.querySelector('.desk-tuck'));
      const hasDeparture = Boolean(document.querySelector('.desk-departure'));
      anotherResult = (reducedMotion() ? !hasTuck && !hasDeparture : hasTuck && !hasDeparture) ? `PASS: Try another way ${reducedMotion() ? 'advances with zero ghosts' : 'tucks behind'}` : `FAIL: another tuck=${hasTuck} departure=${hasDeparture}`;
      append({ kind: 'exercise_skip', payload: { encounterId: current.encounterId } });
      append({ kind: 'exercise_exclude', payload: { encounterId: current.encounterId } });
      const id = `production-alternative-${actions.length}`;
      append({ kind: 'presentation', payload: { encounterId: id, wordId: 'word', snapshot: { kind: 'production', role: 'general', contentId: id, contentVersion: 1, body: { prompt: 'The written symbols used to record language' }, assessment: { acceptedAnswers: ['字'] } } } });
      return Response.json(study());
    }
    const accepted = study().currentEncounter!.effectiveResponses.at(-1)!.payload.outcome === 'accepted';
    const ghost = document.querySelector(accepted ? '.desk-departure' : '.desk-tuck');
    const projected = ghost?.querySelectorAll('.desk-chips .is-filled').length;
    const isReducedMotion = reducedMotion();
    const lastFrame = (ghost?.getAnimations()[0]?.effect as KeyframeEffect | undefined)?.getKeyframes().at(-1);
    const left = String(lastFrame?.transform).startsWith('translate(-');
    const directionCorrect = accepted ? left === !covered : ghost?.classList.contains('desk-tuck');
    const nextResult = (isReducedMotion ? !document.querySelector('.desk-tuck, .desk-departure') : ghost && projected === (accepted && !covered ? 1 : 0) && directionCorrect) ? `PASS: saved rating, ${isReducedMotion ? 'zero ghosts' : 'animated departure'}, then next encounter` : `FAIL: ghost=${Boolean(ghost)} recall=${projected} left=${left}`;
    if (covered && accepted) append({ kind: 'word_more', payload: { wordId: 'word' } });
    append({ kind: 'presentation', payload: { encounterId: 'production', wordId: 'word', snapshot: { kind: 'production', role: covered ? 'general' : 'teaching', contentId: 'production', contentVersion: 1, body: { prompt: 'A written character' }, assessment: { acceptedAnswers: ['字'] } } } });
    const successor = study();
    result = nextResult;
    return Response.json(successor);
  }
  throw new Error(`Unexpected request ${url}`);
};
function Fixture() {
  const controller = useVocabularyStudy();
  const begun = useRef(false);
  useEffect(() => { if (!begun.current) { begun.current = true; void controller.start(); } }, []);
  const [sidebarResult, setSidebarResult] = useState('Shuffle the covered word after typing an answer');
  const verifiedRequeues = useRef(0);
  useEffect(() => {
    if (!requeueCalls || requeueCalls === verifiedRequeues.current || controller.busy) return;
    verifiedRequeues.current = requeueCalls;
    const inputPreserved = controller.input === requeueInput;
    const encounterPreserved = controller.study?.currentEncounter?.encounterId === requeueEncounter;
    setSidebarResult(`${requeueCalls === 1 && inputPreserved && encounterPreserved && requeueGhost ? 'PASS' : 'FAIL'}: sidebar requeue calls=${requeueCalls}; input preserved=${inputPreserved}; encounter preserved=${encounterPreserved}; ${reducedMotion() ? 'zero ghosts' : 'tuck'}=${requeueGhost}`);
  }, [controller.busy, controller.input, controller.study]);
  return <>
    {narrow && <style>{':root { font-size: 125%; }'}</style>}
    <div style={{ fontSize: '.7rem', lineHeight: 1.4 }}>
      <output id="motion-result" data-result={result} style={{ display: 'block' }}>{result}</output>
      <output id="another-result" style={{ display: 'block' }}>{anotherResult}</output>
      <output id="paper-result" style={{ display: 'block' }}>{paperResult}</output>
      <output id="sidebar-result" data-requeue-calls={requeueCalls} style={{ display: 'block' }}>{sidebarResult}</output>
    </div>
    <div style={{ width: narrow ? 420 : '100%', maxWidth: '100%', height: 'calc(100dvh - 6rem)', margin: '0 auto' }}>
      <VocabularyStudy controller={controller} />
    </div>
  </>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
