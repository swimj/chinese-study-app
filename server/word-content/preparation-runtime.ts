import { config } from '../db/connection.ts';
import { runWithLearnerId } from '../db/learner-context.ts';
import { getHostedServiceControls } from '../db/hosted-operations.ts';
import { reconcileWordPreparationReserve } from '../db/persistence.ts';
import { listPendingWordReserveLearners } from '../db/word-reserve.ts';
import { createWordIntroductionProvider } from './provider.ts';
import { createWordPreparationWorker } from './preparation-worker.ts';

/** Durable requests survive restarts; only explicitly active learners grow a reserve. */
export function startWordPreparationRuntime() {
  const provider = createWordIntroductionProvider();
  const worker = createWordPreparationWorker({ provider, onError: () => console.error('Word preparation worker failed') });
  let stopped = false;
  const canPrepare = () => {
    const controls = getHostedServiceControls();
    return !stopped && config.studyProfile === 'mandarin' && provider.isConfigured()
      && !controls.maintenanceMode && controls.providerWorkEnabled;
  };
  function wake() {
    if (stopped || config.studyProfile !== 'mandarin') return;
    const controls = getHostedServiceControls();
    if (!controls.maintenanceMode) {
      for (const learnerId of listPendingWordReserveLearners()) {
        try { runWithLearnerId(learnerId, () => reconcileWordPreparationReserve()); }
        catch { console.error('Word reserve reconciliation failed'); }
      }
    }
    worker.wake();
  }
  const timer = setInterval(wake, 5_000);
  timer.unref();
  wake();
  return { wake, canPrepare, async stop() { stopped = true; clearInterval(timer); await worker.stop(); } };
}
