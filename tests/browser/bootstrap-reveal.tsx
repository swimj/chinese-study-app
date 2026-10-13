// Run with npm run dev:frontend, then open /tests/browser/bootstrap-reveal.html.
// Query options: recognition, frozen, wide, enlarged. Default is a narrow definition production reveal.
// Real controller, HomePage, and completion screen; all HTTP is intercepted here.
import { createRoot } from 'react-dom/client';
import { HomePage } from '../../src/pages/HomePage';
import { useStudySession, type StudySessionController } from '../../src/features/session/useStudySession';
import type { SessionPayload } from '../../src/services/api';
import type { SessionCompletion, StageSessionCompletionRequest } from '../../src/domain/session-completion';
import '../../src/styles.css';
import '../../src/features/content-quality/styles.css';
import '../../src/features/session/session-desk.css';
import '../../src/features/session/session-completion.css';

import { selectBootstrapReveal } from '../../src/domain/word-content/reveal';
import type { WordContentDocument } from '../../src/domain/word-content/types';
const params = new URLSearchParams(window.location.search);
const recognition = params.has('recognition');
document.documentElement.style.fontSize = params.has('enlarged') ? '20px' : '16px';
document.getElementById('root')!.style.maxWidth = params.has('wide') ? '1080px' : '420px';
const content: WordContentDocument = {
  schemaVersion: 1, id: 'bootstrap-fixture', word: { wordId: 'namely', hanzi: '即', traditional: null, pinyin: 'jí' },
  uses: [
    { id: 'namely', label: 'Introducing a precise explanation or identifying exactly which person, place, or thing was meant', notes: [], exampleIds: ['one'] },
    { id: 'immediate', label: 'Taking action immediately after another event', notes: [], exampleIds: ['two'] },
  ],
  examples: [
    { id: 'one', text: '他出生于中国的首都，即北京，后来一直在那里生活和工作。', translation: 'He was born in the capital of China, namely Beijing, and later continued to live and work there.', pronunciation: null },
    { id: 'two', text: '收到通知后，他即出发。', translation: 'After receiving the notice, he departed immediately.', pronunciation: null },
  ],
};
const bootstrapReveal = selectBootstrapReveal(content, new Date('2026-10-14T00:00:00Z'));
const payload: SessionPayload = {
  buckets: {
    review: [{
      sessionActionId: 'review/namely/production', actionKind: recognition ? 'recognition' : 'production',
      wordContent: content, bootstrapReveal,
      targetWordId: 'namely', sampledSkillIds: ['production'], contentRef: null,
      intervalHours: 24, contrastSelection: null,
      production: recognition ? null : {
        taskId: 'namely-task', cueId: 'namely-cue', cueType: 'definition_gloss', bootstrapReveal,
        text: 'namely; that is; immediately',
        acceptedAnswers: [{ wordId: 'namely', hanzi: '即', traditional: null }],
        supplement: { supplementId: 'legacy', englishFrame: 'Old fixed supplement', exampleSentence: 'Old sentence', exampleTranslation: 'Old translation' },
      },
      word: {
        id: 'namely', hanzi: '即', traditional: null, pinyin: 'jí',
        meaning: 'namely', meanings: ['namely'], personalNotes: '', examples: [],
        status: 'review', priority: 100, createdAt: '2026-10-09T00:00:00Z',
        learningStreak: 0, lastLearningSuccessOn: null, lastLearningCoveredOn: null,
      },
    }],
    learning: [], unstudied: [],
  },
};

let completion: SessionCompletion | null = null;
let stageCount = 0;
let undoCount = 0;
window.fetch = async (input, init) => {
  const url = String(input);
  if (url.includes('/recovery-highlights')) return Response.json({ highlights: [] });
  if (url.endsWith('/api/session-completions/current')) return Response.json({ completion: null });
  const completionMatch = url.match(/\/api\/study-sessions\/([^/]+)\/completion(\/undo|\/close)?$/);
  if (completionMatch) {
    const [, sessionId, action] = completionMatch;
    if (!action && init?.method === 'POST') {
      const request = JSON.parse(String(init.body)) as StageSessionCompletionRequest;
      if (request.summary.activeDurationMs <= 0) throw new Error('Completion must retain actual study time before the finishing effect runs');
      stageCount++;
      completion = { sessionId, revisionId: request.revisionId, status: 'pending', canUndo: true,
        closeAt: new Date(Date.now() + 15000).toISOString(), serverNow: new Date().toISOString(),
        completedAt: request.summary.completedAt, report: { newWords: [], graduatedWords: [] }, error: null };
    } else if (action === '/undo') {
      if (!completion || completion.status !== 'pending') throw new Error('Undo requires pending completion');
      undoCount++;
      completion = { ...completion, status: 'cancelled', canUndo: false };
    } else if (action === '/close') {
      if (!completion) throw new Error('Close requires completion');
      completion = { ...completion, status: 'closed', canUndo: false };
    }
    return Response.json(completion);
  }
  if (url.includes('/api/session-payload')) return Response.json(payload);
  if (url.endsWith('/meanings')) return Response.json([]);
  if (url.endsWith('/content-quality/encounters')) return Response.json({ contentKey: 'fixture-cue', rating: null });
  throw new Error(`Unexpected request in isolated regression: ${url}`);
};

let controller: StudySessionController;
let failure: string | null = null;
function Harness() {
  controller = useStudySession({
    setError: (error) => { if (error) failure = error; },
    onSessionEnded: async () => {}, sessionSurfaceVisible: true,
  });
  return <HomePage {...controller.homePageProps} backendStatus={null}
    onSaveSessionSettings={async () => {}} onNudgeDiet={async () => {}} />;
}

const root = createRoot(document.getElementById('root')!);
root.render(<Harness />);
const delay = () => new Promise<void>((resolve) => setTimeout(resolve, 30));
async function until(condition: () => boolean) {
  const deadline = Date.now() + 10000;
  while (!condition()) {
    if (failure) throw new Error(failure);
    if (Date.now() > deadline) throw new Error('Timed out waiting for session transition');
    await delay();
  }
}
async function run() {
  await until(() => Boolean(controller));
  controller.homePageProps.onStartSession();
  await until(() => controller.homePageProps.sessionStarted);
  if (document.querySelector('.production-supplement-aside')) throw new Error('Bootstrap teaching leaked before reveal');
  if (recognition) controller.homePageProps.onRevealAnswer();
  else if (params.has('frozen')) controller.homePageProps.onNoClueProduction();
  else {
    controller.homePageProps.productionHanziInputRef.current!.value = '即';
    controller.homePageProps.onSubmitProductionHanzi();
  }
  await until(() => Boolean(document.querySelector('.production-supplement-aside')));
  const revealed = document.querySelector('.production-supplement-aside')!.textContent;
  if (!revealed?.includes(content.uses[0].label) || !revealed.includes(content.examples[0].translation)) throw new Error('Wrong bootstrap example');
  const reference = document.querySelector<HTMLDetailsElement>('.desk-reference');
  if (!reference || reference.open) throw new Error('Reference must start collapsed');
  if (document.body.textContent?.includes('Old fixed supplement')) throw new Error('Legacy supplement was not superseded');
  document.getElementById('result')!.textContent = `PASS: ${recognition ? 'recognition' : params.has('frozen') ? 'frozen production' : 'definition production'} frozen bootstrap reveal, collapsed reference, no legacy supplement. Ready for keyboard and visual inspection.`;
}
void run().catch((error: unknown) => {
  document.getElementById('result')!.textContent = `FAIL: ${String(error)}`;
  console.error(error);
});
