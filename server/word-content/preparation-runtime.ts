import { setImmediate as yieldToRequests } from 'node:timers/promises';
import { config } from '../db/connection.ts';
import { runWithLearnerId } from '../db/learner-context.ts';
import { getHostedServiceControls } from '../db/hosted-operations.ts';
import { reconcileVocabularyPreparationReserve } from '../vocabulary/preparation-reserve.ts';
import { listPendingWordReserveLearners, listWordReserveAuditLearners, requestWordReserveReconciliation, deferWordReserveAudit } from '../db/word-reserve.ts';
import { createWordIntroductionProvider } from './provider.ts';
import { createWordPreparationWorker } from './preparation-worker.ts';

export const RESERVE_AUDIT_INTERVAL_MS = 5 * 60_000;
const BATCH_SIZE = 5;
/** Durable mutation requests plus bounded periodic audits recover independently of session visits. */
export function startWordPreparationRuntime(options:{reconcile?:typeof reconcileVocabularyPreparationReserve}={}) {
  const provider = createWordIntroductionProvider();
  const worker = createWordPreparationWorker({ provider, onError: () => console.error('Word preparation worker failed') });
  let stopped = false;
  let maintenance:Promise<void>|null=null;
  const canPrepare = () => {
    const controls = getHostedServiceControls();
    return !stopped && config.studyProfile === 'mandarin' && provider.isConfigured()
      && !controls.maintenanceMode && controls.providerWorkEnabled;
  };
  async function maintain():Promise<void> {
    // Even explicit wakes return before the first synchronous SQLite maintenance pass.
    await yieldToRequests();
    if(stopped||getHostedServiceControls().maintenanceMode)return;
    const now=new Date().toISOString();
    const learners=[...new Set([...listPendingWordReserveLearners(BATCH_SIZE),
      ...listWordReserveAuditLearners(new Date(Date.parse(now)-RESERVE_AUDIT_INTERVAL_MS).toISOString(),BATCH_SIZE)])];
    for(const learnerId of learners) {
      if(stopped||getHostedServiceControls().maintenanceMode)break;
      try { runWithLearnerId(learnerId,()=>(options.reconcile??reconcileVocabularyPreparationReserve)()); }
      catch(error) {
        // Durable retry rotates a failed learner behind older demand; do not spin within this batch.
        runWithLearnerId(learnerId,()=>{const retryAt=new Date().toISOString();requestWordReserveReconciliation(retryAt);deferWordReserveAudit(retryAt);});
        console.error('Word reserve reconciliation failed',error instanceof Error?error.name:'unknown');
      }
      await yieldToRequests();
    }
  }
  function wake() {
    if (stopped || config.studyProfile !== 'mandarin') return;
    if(!maintenance)maintenance=maintain().catch(()=>console.error('Word reserve maintenance failed')).finally(()=>{maintenance=null;});
    worker.wake();
  }
  const timer = setInterval(wake, 30_000);
  timer.unref();
  wake();
  return { wake, canPrepare, async stop() { stopped = true; clearInterval(timer); await Promise.all([worker.stop(),maintenance]); } };
}
