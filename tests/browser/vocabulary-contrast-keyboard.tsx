// Active study surface and controller with a private in-memory API.
// Press 9 then 0 to preview choices; Enter submits only the selected tenth word.
// ?count=3 verifies keys above the number of choices do nothing.
// ?pure=1 verifies that typing 诉求 fills the cloze with that accepted member, not 意见.
// ?production=1 also exposes an answer field to check reaction-note Escape priority.
import { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { VocabularyStudy } from '../../src/features/vocabulary-study/VocabularyStudy';
import { useVocabularyStudy } from '../../src/features/vocabulary-study/useVocabularyStudy';
import { projectVocabularySession, type VocabularySessionAction, type VocabularySessionInitialContext } from '../../src/domain/vocabulary-session';
import type { VocabularyStudy as Study } from '../../src/domain/vocabulary-study-api';
import '../../src/styles.css';
import '../../src/features/session/session-desk.css';

const count = new URLSearchParams(location.search).get('count') === '3' ? 3 : 10;
const pure = new URLSearchParams(location.search).has('pure');
const production = new URLSearchParams(location.search).has('production') || pure;
const choices = ['希望', '愿望', '盼望', '期待', '期望', '渴望', '向往', '憧憬', '诉求', '要求']
  .slice(0, count).map((hanzi, index) => ({ wordId: `word-${index + 1}`, hanzi }));
const correct = choices.at(-1)!;
const context: VocabularySessionInitialContext = { sessionId: 'contrast-keyboard', words: [{ wordId: correct.wordId, mode: 'practice', selectedSkill: 'production' }] };
const actions: VocabularySessionAction[] = [{
  protocolVersion: 1, actionId: 'presentation', clientActionId: 'presentation', sequence: 1, occurredAt: new Date().toISOString(),
  kind: 'presentation', payload: { encounterId: 'contrast', wordId: pure ? null : correct.wordId, snapshot: {
    ...(pure ? { schedulingScope: 'pure_cue' as const } : {}),
    kind: production ? 'production' : 'contrast', role: 'general', contentId: 'contrast', contentVersion: 1,
    body: { prompt: pure ? '居民向有关部门表达了自己的____。' : 'Choose the expression that means a requirement or demand.', material: { choices } },
    assessment: { acceptedAnswers: pure ? ['意见', '诉求'] : [correct.hanzi], criteria: { correctWordId: correct.wordId } },
  } },
}];
let submissions = 0;
let pureRevealPassed = false;
let selectedWordId: string | null = null;
function study(): Study {
  const projection = projectVocabularySession(context, actions);
  return { session: { sessionId: context.sessionId, status: 'active', context, actions, projection, completion: null },
    words: [{ wordId: correct.wordId, hanzi: correct.hanzi, traditional: null, pinyin: 'yāo qiú', meaning: 'requirement; demand' }],
    currentWordId: correct.wordId, currentEncounter: projection.encounters.at(-1)!, notice: null,
    controls: { canNext: true, canSkip: false, canEnough: false, canMore: false, canUndo: false,
      canFinishForNow: false, canFinishImmediately: false, canChangeMode: false } };
}
window.fetch = async (input, init) => {
  const url = String(input);
  if (url.endsWith('/completion/current')) return Response.json(null);
  if (url.endsWith('/sessions')) return Response.json(study());
  if (url.endsWith('/commands')) {
    const { command } = JSON.parse(String(init?.body)) as { command: { type: string; response: string; selectedWordId: string } };
    if (command.type !== 'response') throw new Error(`Unexpected command ${command.type}`);
    if (pure) {
      await new Promise(resolve => setTimeout(resolve, 300));
      pureRevealPassed = document.querySelector('.desk-cloze-answer')?.textContent === command.response;
    }
    submissions++;
    selectedWordId = command.selectedWordId;
    actions.push({ protocolVersion: 1, actionId: 'response', clientActionId: 'response', sequence: 2, occurredAt: new Date().toISOString(),
      kind: 'response', payload: { encounterId: 'contrast', response: command.response, selectedWordId,
        outcome: pure ? ['意见', '诉求'].includes(command.response) ? 'accepted' : 'rejected' : selectedWordId === correct.wordId ? 'accepted' : 'rejected' } });
    return Response.json(study());
  }
  throw new Error(`Unexpected request ${url}`);
};
function Fixture() {
  const controller = useVocabularyStudy();
  const begun = useRef(false);
  useEffect(() => { if (!begun.current) { begun.current = true; void controller.start(); } }, []);
  return <>
    <output id="contrast-result" data-submissions={submissions}>
      {pure && submissions ? `${pureRevealPassed ? 'PASS' : 'FAIL'}: immediate reveal matches accepted input` : submissions ? `${submissions === 1 && selectedWordId === correct.wordId ? 'PASS' : 'FAIL'}: submitted ${selectedWordId} once=${submissions === 1}` : 'No answer submitted'}
    </output>
    <div style={{ height: 'calc(100dvh - 2rem)' }}><VocabularyStudy controller={controller} /></div>
  </>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
