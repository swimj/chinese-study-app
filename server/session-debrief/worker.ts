import { randomUUID } from 'node:crypto';
import { config } from '../db/connection.ts';
import { assertLearnerExists } from '../db/identity.ts';
import { runWithLearnerId } from '../db/learner-context.ts';
import { getHostedServiceControls } from '../db/hosted-operations.ts';
import { claimSessionDebrief, finishSessionDebrief, listQueuedSessionDebriefs, recoverExpiredSessionDebriefs } from '../db/session-debrief.ts';
import { HostedProviderWorkUnavailableError, runHostedProviderWork } from '../hosted-runtime-controls.ts';
import { createSessionDebriefProvider, DEBRIEF_TIMEOUT_MS, SessionDebriefProviderError, type SessionDebriefProvider } from './provider.ts';

export function createSessionDebriefWorker(options: {
  provider?: SessionDebriefProvider; now?: () => number; pollMs?: number;
  controls?: () => { maintenanceMode: boolean; providerWorkEnabled: boolean };
  providerWork?: <T>(work: () => Promise<T>) => Promise<T>;
  onError?: (error: unknown) => void;
} = {}) {
  const provider = options.provider ?? createSessionDebriefProvider();
  const now = options.now ?? Date.now;
  const controls = options.controls ?? getHostedServiceControls;
  const providerWork = options.providerWork ?? runHostedProviderWork;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<boolean> | null = null;
  const enabled = () => { const state = controls(); return !stopped && config.studyProfile === 'mandarin' && !state.maintenanceMode && state.providerWorkEnabled; };
  async function stepOnce(): Promise<boolean> {
    if (stopped) return false;
    recoverExpiredSessionDebriefs(new Date(now()).toISOString());
    if (!enabled()) return false;
    const work = listQueuedSessionDebriefs()[0];
    if (!work) return false;
    try {
      return await runWithLearnerId(work.learnerId, () => providerWork(async () => {
        if (!enabled()) return false;
        assertLearnerExists(work.learnerId);
        const token = randomUUID();
        const startedMs = now();
        const input = claimSessionDebrief(work.sessionId, token, new Date(startedMs).toISOString(),
          new Date(startedMs + DEBRIEF_TIMEOUT_MS + 60_000).toISOString());
        if (!input) return false;
        try {
          const generated = await provider.generate(input, token);
          finishSessionDebrief({ sessionId: work.sessionId, token, completedAt: new Date(now()).toISOString(),
            durationMs: Math.max(0, now() - startedMs), result: generated.result, error: null, errorCode: null, metadata: generated.metadata });
        } catch (error) {
          finishSessionDebrief({ sessionId: work.sessionId, token, completedAt: new Date(now()).toISOString(),
            durationMs: Math.max(0, now() - startedMs), result: null,
            error: error instanceof SessionDebriefProviderError ? error.message : 'Debrief generation could not finish. You can retry.',
            errorCode: error instanceof SessionDebriefProviderError ? error.code : 'generation_failed',
            metadata: error instanceof SessionDebriefProviderError ? error.metadata : null });
        }
        return true;
      }));
    } catch (error) {
      if (error instanceof HostedProviderWorkUnavailableError) return false;
      throw error;
    }
  }
  function step(): Promise<boolean> {
    if (running) return running;
    running = stepOnce().finally(() => { running = null; });
    return running;
  }
  function wake(): void {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = undefined;
    void step().catch((error: unknown) => options.onError?.(error)).finally(() => {
      if (!stopped && timer === undefined) { timer = setTimeout(wake, options.pollMs ?? 5_000); timer.unref(); }
    });
  }
  return { step, wake, async stop() { stopped = true; if (timer) clearTimeout(timer); await running; } };
}
export function startSessionDebriefRuntime() {
  const worker = createSessionDebriefWorker({ onError: () => console.error('Session debrief worker failed') });
  worker.wake();
  return worker;
}
