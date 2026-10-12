// Manual walkthrough against a fresh prepare:ui-fixtures database. Unlike the
// isolated browser regressions, this uses real HTTP and writes real local study
// events. The explicit ?prepare=1 flag and backend guard prevent accidental use.
import { createRoot } from 'react-dom/client';
import { HomePage } from '../../src/pages/HomePage';
import { useStudySession, type StudySessionController } from '../../src/features/session/useStudySession';
import { fetchStatus, openWordIntroduction, completeWordIntroduction } from '../../src/services/api';
import '../../src/styles.css';
import '../../src/features/content-quality/styles.css';
import '../../src/features/word-introduction/styles.css';
import '../../src/features/session/session-desk.css';
import '../../src/features/session/session-completion.css';

let controller: StudySessionController;
let failure: string | null = null;
const result = document.getElementById('result')!;
const delay = (ms = 100) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function until(condition: () => boolean) {
  const end = Date.now() + 20000;
  while (!condition()) {
    if (failure) throw new Error(failure);
    if (Date.now() > end) throw new Error('Timed out preparing the mixed session');
    await delay();
  }
}

async function run() {
  const query = new URLSearchParams(location.search);
  if (!query.has('prepare')) {
    throw new Error('Open with ?prepare=1 to authorize completing the local annotation session.');
  }
  const status = await fetchStatus();
  if (status.mode !== 'dev' || !/\/data\/ui-fixtures\/[^/]+$/.test(status.dataDir)) {
    throw new Error('This walkthrough requires a disposable data/ui-fixtures backend in dev mode.');
  }
  function Harness() {
    controller = useStudySession({ setError: message => { if (message) failure = message; },
      onSessionEnded: async () => {}, sessionSurfaceVisible: true,
      studyIntroductionOrder: 'first' });
    return <HomePage {...controller.homePageProps} backendStatus={status}
      onSaveSessionSettings={async () => {}} onNudgeDiet={async () => {}} />;
  }
  createRoot(document.getElementById('root')!).render(<Harness />);
  await until(() => Boolean(controller));
  controller.homePageProps.onStartSession();
  await until(() => controller.homePageProps.sessionStarted);
  let steps = 0;
  while (controller.homePageProps.sessionPhase !== 'completed') {
    if (++steps > 300) throw new Error('Mixed-session preparation exceeded its action limit');
    const p = controller.homePageProps;
    result.textContent = `Preparing the real mixed session: ${p.reviewedCount} answers completed…`;
    if (p.introductionGate) {
      const gate = p.introductionGate;
      const packageId = gate.preloadedIntroduction.selectedPackageId;
      if (!packageId) throw new Error('Fixture introduction has no prepared package');
      await openWordIntroduction(gate.wordId, packageId);
      await completeWordIntroduction(gate.wordId, packageId);
      gate.complete();
      await until(() => controller.homePageProps.introductionGate?.key !== gate.key);
    } else if (p.productionAwaitingSupplement) {
      p.onContinueAfterProductionSupplement();
    } else if (p.productionAwaitingNext || p.pureCueAwaitingNext) {
      throw new Error('A fixture answer was rejected; stop rather than silently skip it.');
    } else if (p.contrastAwaitingNext) {
      throw new Error('A fixture contrast answer was rejected.');
    } else if (p.activeItem?.actionKind === 'contrast_selection') {
      const choice = p.activeItem.contrastSelection;
      if (!choice) throw new Error('Missing contrast snapshot');
      p.onSelectContrastChoice(choice.promptTargetWordId);
      await until(() => controller.homePageProps.contrastAwaitingRating);
      controller.homePageProps.onRate('good', { restoreUi: 'revealed' });
    } else if (p.isProductionItem || p.activePureCue) {
      const answer = p.activePureCue?.snapshot.acceptedAnswers[0]?.hanzi
        ?? p.activeWord?.hanzi;
      const input = p.productionHanziInputRef.current;
      if (!answer || !input) throw new Error('Missing fixture production answer/input');
      input.value = answer;
      p.onSubmitProductionHanzi();
      await until(() => controller.homePageProps.productionAwaitingRating
        || controller.homePageProps.productionAwaitingNext || controller.homePageProps.pureCueAwaitingNext);
      if (!controller.homePageProps.productionAwaitingRating) throw new Error('Fixture production answer rejected');
      controller.homePageProps.onRate('good', { restoreUi: 'production-input' });
    } else if (p.activeItem) {
      p.onRevealAnswer();
      await delay();
      controller.homePageProps.onRate('good', { restoreUi: 'revealed' });
    } else {
      throw new Error('No active exercise while preparing the mixed session');
    }
    await delay(650); // Allow the real desk transition and deferred commit to finish.
    await until(() => controller.homePageProps.submittingRating === null);
  }
  controller.homePageProps.completionPanel!.onKeepOpen();
  await until(() => controller.homePageProps.completionPanel?.completion?.status === 'pending');
  const report = controller.homePageProps.completionPanel!.completion!.report;
  if (!report.newWords.length || !report.graduatedWords.length) {
    throw new Error('Expected new-word and graduation outcomes from a fresh mixed annotation fixture');
  }
  controller.homePageProps.onUndoLastRating();
  await until(() => controller.homePageProps.sessionPhase !== 'completed');
  result.textContent = `Ready: real mixed session, ${report.newWords.length} new words and ${report.graduatedWords.length} graduation. Finish the last action yourself to open Session Summary. Reload does not reset this database.`;
}
void run().catch((error: unknown) => { result.textContent = `Preparation stopped: ${String(error)}`; console.error(error); });
