// Run with npm run dev:frontend, then open /tests/browser/content-feedback.html.
// Real controller, HomePage, and retained card; all HTTP is intercepted here.
import { createRoot } from 'react-dom/client';
import { HomePage } from '../../src/pages/HomePage';
import { useStudySession, type StudySessionController } from '../../src/features/session/useStudySession';
import type { SessionPayload } from '../../src/services/api';
import '../../src/styles.css';
import '../../src/features/content-quality/styles.css';
import '../../src/features/session/session-desk.css';

if (new URLSearchParams(location.search).has('large-text')) {
  document.documentElement.style.fontSize = '125%';
}

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

type Rating = 'up' | 'down' | null;
let rating: Rating = null;
let saveFailure = false;
let delaySave = false;
let finishSave: (() => void) | null = null;
let evidence: { items: Array<{ sessionActionId: string; learnerRequestedReview?: boolean; attemptIds: string[] }> } | null = null;
let commits = 0;
let ratingWrites = 0;
let finishManagement: (() => void) | null = null;
window.fetch = async (input, init) => {
  const url = String(input);
  if (url.includes('/api/session-payload')) return Response.json(payload);
  if (url.endsWith('/meanings')) return Response.json([]);
  if (url.endsWith('/content-quality/encounters')) return Response.json({ contentKey: 'fixture-cue', rating });
  if (url.endsWith('/manage-study-action')) {
    await new Promise<void>((resolve) => { finishManagement = resolve; });
    return Response.json({});
  }
  if (url.endsWith('/content-quality/ratings')) {
    ratingWrites += 1;
    if (delaySave) await new Promise<void>((resolve) => { finishSave = resolve; });
    if (saveFailure) return Response.json({ error: 'fixture failure' }, { status: 500 });
    rating = JSON.parse(String(init?.body)).rating as Rating;
    return Response.json({ contentKey: 'fixture-cue', rating });
  }
  if (url.endsWith('/accepted-review-attempt-batch')) { commits += 1; return Response.json({}); }
  if (url.endsWith('/review-session-summaries')) return Response.json({});
  if (url.endsWith('/reflections')) {
    evidence = JSON.parse(String(init?.body));
    return Response.json({ code: 'no_qualifying_evidence' }, { status: 400 });
  }
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
const delay = () => new Promise<void>((resolve) => setTimeout(resolve, 30));
async function until(condition: () => boolean) {
  const deadline = Date.now() + 10000;
  while (!condition()) {
    if (failure) throw new Error(failure);
    if (Date.now() > deadline) throw new Error('Timed out waiting for session transition');
    await delay();
  }
}
function check(condition: boolean, message: string) { if (!condition) throw new Error(message); }
function voteButton(value: Exclude<Rating, null>) {
  return document.querySelector<HTMLButtonElement>(`.content-quality-vote[aria-label^="${value === 'down' ? 'Not helpful' : 'Helpful'}:"]`)!;
}
async function vote(value: Exclude<Rating, null>) {
  await until(() => Boolean(voteButton(value)) && !voteButton(value).disabled);
  voteButton(value).click();
  await delay();
  await until(() => !controller.homePageProps.contentRatingSaving && !voteButton(value).disabled);
}
let scenario = 0;
async function start() {
  rating = null; evidence = null; commits = 0; ratingWrites = 0; failure = null; saveFailure = false; delaySave = false;
  root.render(<Harness key={++scenario} />);
  await delay();
  controller.homePageProps.onStartSession();
  await until(() => controller.homePageProps.sessionStarted && Boolean(voteButton('down')) && !voteButton('down').disabled);
}
async function submitCorrect() {
  controller.homePageProps.productionHanziInputRef.current!.value = '即';
  controller.homePageProps.onSubmitProductionHanzi();
  await until(() => controller.homePageProps.productionAwaitingRating && controller.homePageProps.submittingRating === null);
}
async function finish(expected: boolean) {
  if (!controller.homePageProps.productionAwaitingRating) await submitCorrect();
  controller.homePageProps.onRate('good', { restoreUi: 'production-input' });
  await until(() => controller.homePageProps.sessionPhase === 'completed' && controller.homePageProps.submittingRating === null);
  controller.homePageProps.onEndSession();
  await until(() => controller.homePageProps.sessionFinalization.kind === 'finalized');
  await delay();
  check(commits === 1, 'Expected exactly one accepted attempt batch');
  check(Boolean(evidence) === expected, `Expected reflection request: ${expected}`);
  if (evidence) {
    check(evidence.items.length === 1, 'Requests must deduplicate');
    check(evidence.items[0]?.learnerRequestedReview === true, 'Expected learner request marker');
    check(evidence.items[0]?.attemptIds.length === 1, 'Expected durable attempt link');
  }
}
async function run() {
  await start();
  if (new URLSearchParams(location.search).has('preview')) {
    document.getElementById('result')!.textContent = 'Interactive preview: real study session with isolated fixture data.';
    return;
  }
  await vote('down');
  check(!controller.homePageProps.learnerRequestedReview, 'Implicit request must not select explicit toggle');
  await finish(true);

  await start(); await vote('down'); await vote('down'); await finish(false);
  await start(); await vote('down'); await vote('up'); await finish(false);
  await start();
  controller.homePageProps.onToggleLearnerRequestedReview(); await delay();
  await vote('down'); await vote('up');
  check(controller.homePageProps.learnerRequestedReview, 'Explicit request must survive rating change');
  await finish(true);

  await start(); await vote('down');
  controller.homePageProps.onToggleLearnerRequestedReview(); await delay();
  controller.homePageProps.onToggleLearnerRequestedReview(); await delay();
  await finish(true);

  await start(); saveFailure = true; await vote('down'); saveFailure = false; await finish(false);

  await start(); await submitCorrect(); delaySave = true; voteButton('down').click();
  await until(() => finishSave !== null);
  controller.homePageProps.onRate('good');
  controller.homePageProps.onEndSession();
  check(controller.homePageProps.sessionPhase === 'active', 'Pending save must fence departure');
  let navigationFinished = false;
  const navigation = controller.finishCompletedSessionIfLeaving().then(() => { navigationFinished = true; });
  await delay(); check(!navigationFinished, 'Navigation must wait for pending rating');
  finishSave!(); finishSave = null;
  await navigation;
  await until(() => !controller.homePageProps.contentRatingSaving);
  await finish(true);

  await start();
  controller.homePageProps.onManageStudyAction();
  await until(() => finishManagement !== null && controller.homePageProps.studyManagementSubmitting);
  check(voteButton('down').disabled, 'Pending management must disable feedback votes');
  voteButton('down').click();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: '[', bubbles: true }));
  await delay();
  check(ratingWrites === 0, 'Pending management must block feedback click and shortcut');
  finishManagement!(); finishManagement = null;
  await until(() => !controller.homePageProps.studyManagementSubmitting);

  await start();
  document.getElementById('result')!.textContent = 'PASS: implicit feedback, independent requests, clear/switch, failed save, durable links, deduplication, pending-save navigation, and management-first race.';
}
void run().catch((error: unknown) => {
  document.getElementById('result')!.textContent = `FAIL: ${String(error)}`;
  console.error(error);
});
