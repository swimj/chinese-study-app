// Run with npm run dev:frontend, then open /tests/browser/final-reinforcement.html.
// Real controller, HomePage, and completion screen; all HTTP is intercepted here.
import { createRoot } from 'react-dom/client';
import { HomePage } from '../../src/pages/HomePage';
import { useStudySession, type StudySessionController } from '../../src/features/session/useStudySession';
import type { SessionPayload } from '../../src/services/api';
import type { SessionCompletion, StageSessionCompletionRequest } from '../../src/domain/session-completion';
import '../../src/styles.css';
import '../../src/features/session/session-desk.css';
import '../../src/features/session/session-completion.css';

const payload: SessionPayload = {
  buckets: {
    review: [{
      sessionActionId: 'review/namely/production', actionKind: 'production',
      targetWordId: 'namely', sampledSkillIds: ['production'], contentRef: null,
      intervalHours: 24, contrastSelection: null,
      production: {
        taskId: 'namely-task', cueId: 'namely-cue', cueType: 'minimal_context',
        text: '"..., namely ...": 他出生于中国的首都，____北京。',
        acceptedAnswers: [{ wordId: 'namely', hanzi: '即', traditional: null }],
        supplement: null,
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
const interactive = new URLSearchParams(window.location.search).has('interactive');
const delay = () => new Promise<void>((resolve) => setTimeout(resolve, 30));
async function until(condition: () => boolean) {
  const deadline = Date.now() + 10000;
  while (!condition()) {
    if (failure) throw new Error(failure);
    if (Date.now() > deadline) throw new Error('Timed out waiting for session transition');
    await delay();
  }
}
function assertChips(count: number) {
  const group = document.querySelector('.desk-recall-progress');
  if (group?.getAttribute('aria-label') !== `Practice again: ${count} of 3`
    || group.querySelectorAll('.is-filled').length !== count) {
    throw new Error(`Expected ${count} filled boxes, saw ${group?.outerHTML}`);
  }
}
async function assertCompletion() {
  await until(() => controller.homePageProps.completionPanel?.completion?.status === 'pending');
  if (!document.querySelector('.session-completion') || document.querySelector('.desk-recall-progress')) {
    throw new Error('Final answer must immediately show the completion screen');
  }
  if (!document.body.textContent?.includes('Returning to Home in')
    || !document.body.textContent?.includes('Undo last action')) throw new Error('Missing acknowledged countdown or Undo');
}
async function submitCorrect() {
  // Submit via the actual input ref read by the production controller.
  controller.homePageProps.productionHanziInputRef.current!.value = '即';
  controller.homePageProps.onSubmitProductionHanzi();
  await until(() => controller.homePageProps.productionAwaitingRating
    && controller.homePageProps.submittingRating === null);
}
async function correct() {
  await submitCorrect();
  controller.homePageProps.onRate('good', { restoreUi: 'production-input' });
  await until(() => !controller.homePageProps.productionAwaitingRating
    && controller.homePageProps.submittingRating === null);
}

async function run() {
  await until(() => Boolean(controller));
  controller.homePageProps.onStartSession();
  await until(() => controller.homePageProps.sessionStarted);
  controller.homePageProps.onNoClueProduction();
  await until(() => controller.homePageProps.productionAwaitingNext
    && controller.homePageProps.submittingRating === null);
  controller.homePageProps.onContinueAfterAutoForgot();
  await until(() => !controller.homePageProps.productionAwaitingNext
    && controller.homePageProps.submittingRating === null);
  assertChips(0);
  await correct();
  assertChips(1);
  await correct();
  assertChips(2);
  if (interactive) {
    document.getElementById('result')!.textContent = 'Interactive demo: finish the last word to open the 15-second Undo window. Refresh to reset.';
    return;
  }
  await correct();
  if (controller.homePageProps.sessionPhase !== 'completed') throw new Error('Session did not complete');
  await assertCompletion();

  controller.homePageProps.onUndoLastRating();
  await until(() => controller.homePageProps.sessionPhase !== 'completed');
  assertChips(2);
  await submitCorrect();
  controller.homePageProps.onSkipReinforcement();
  await until(() => controller.homePageProps.sessionPhase === 'completed');
  await assertCompletion();
  controller.homePageProps.onUndoLastRating();
  await until(() => controller.homePageProps.sessionPhase !== 'completed');
  assertChips(2);
  await correct();
  await assertCompletion();
  if (stageCount !== 3 || undoCount !== 2) throw new Error(`Expected 3 staged completions and 2 cancellations; saw ${stageCount}/${undoCount}`);
  document.getElementById('result')!.textContent = 'PASS: final correct and skip open completion immediately; Undo restores 2; retry opens a fresh window.';
}
void run().catch((error: unknown) => {
  document.getElementById('result')!.textContent = `FAIL: ${String(error)}`;
  console.error(error);
});
