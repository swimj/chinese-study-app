import { randomUUID } from 'node:crypto';
import {
  listDueWordPreparation, beginWordPreparationAttempt, markWordPreparationReady,
  failWordPreparationAttempt, recoverExpiredWordPreparation, pauseUnavailableWordPreparation,
  type WordPreparationWork,
} from '../db/preparation-work.ts';
import { getHostedServiceControls } from '../db/hosted-operations.ts';
import { HostedProviderWorkUnavailableError, runHostedProviderWork } from '../hosted-runtime-controls.ts';
import { createSharedWordPreparation, WordPreparationProviderError } from './shared-preparation.ts';
import type { WordIntroductionProvider } from './provider.ts';

export function createWordPreparationWorker(options: {
  provider?: WordIntroductionProvider;
  now?: () => number;
  concurrency?: number;
  pollMs?: number;
  providerWork?: <T>(work: () => Promise<T>) => Promise<T>;
  controls?: () => { maintenanceMode: boolean; providerWorkEnabled: boolean };
  onError?: (error: unknown) => void;
} = {}) {
  const preparation = createSharedWordPreparation(options.provider);
  const now = options.now ?? Date.now;
  const isoNow = () => new Date(now()).toISOString();
  const concurrency = options.concurrency ?? 2;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 3) throw new Error('Preparation concurrency must be 1–3');
  const controls = options.controls ?? getHostedServiceControls;
  const providerWork = options.providerWork ?? runHostedProviderWork;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let draining: Promise<void> | null = null;
  let stepping: Promise<boolean> | null = null;
  let providerBackoffUntil = 0;
  const working = new Set<string>();
  function enabled() {
    const state = controls();
    return !stopped && preparation.isConfigured() && !state.maintenanceMode && state.providerWorkEnabled
      && now() >= providerBackoffUntil;
  }
  async function run(work: WordPreparationWork): Promise<boolean> {
    if (working.has(work.workId)) return false;
    working.add(work.workId);
    try {
      if (preparation.ready(work.wordId, work.stage)) {
        markWordPreparationReady(work.workId, isoNow());
        return true;
      }
      const source = preparation.source(work.wordId);
      if (work.stage !== 'bootstrap' && source === null) {
        pauseUnavailableWordPreparation(work.workId, 'Prepared bootstrap source is unavailable or withdrawn; operator disposition required.', isoNow());
        return true;
      }
      return await providerWork(async () => {
        if (!enabled()) return false;
        const token = randomUUID();
        const startedAt = isoNow();
        const expiresAt = new Date(now() + 5 * 60_000).toISOString();
        const claim = preparation.claim(work.wordId, work.stage, token, startedAt, expiresAt);
        if (claim === 'busy') return false;
        if (claim === 'ready') {
          pauseUnavailableWordPreparation(work.workId,
            'Previously prepared content is unavailable or withdrawn; operator disposition required.', isoNow());
          return true;
        }
        try {
          if (!beginWordPreparationAttempt(work.workId, token, work.stage === 'bootstrap' ? null : source?.id ?? null, startedAt, expiresAt)) return false;
          try {
            await preparation.generate(work.wordId, work.stage, token);
            markWordPreparationReady(work.workId, isoNow(), token);
          } catch (error) {
            failWordPreparationAttempt(work.workId, token,
              error instanceof Error ? error.message : 'Shared preparation failed.', isoNow());
            if (error instanceof WordPreparationProviderError && error.providerWide) providerBackoffUntil = now() + 60_000;
          }
          return true;
        } finally { preparation.release(work.wordId, work.stage, token); }
      });
    } catch (error) {
      if (error instanceof HostedProviderWorkUnavailableError) return false;
      throw error;
    } finally { working.delete(work.workId); }
  }
  async function runStep(): Promise<boolean> {
    recoverExpiredWordPreparation(isoNow());
    if (!enabled()) return false;
    const due = listDueWordPreparation(isoNow());
    // SQL excludes unfinished dependencies; withdrawn sources enter the batch once to become operator-visible.
    const runnable = due.filter((work) => !working.has(work.workId)).slice(0, concurrency);
    const results = await Promise.all(runnable.map(run));
    return results.some(Boolean);
  }
  function step(): Promise<boolean> {
    if (stepping) return stepping;
    stepping = runStep().finally(() => { stepping = null; });
    return stepping;
  }
  function drain(): Promise<void> {
    if (draining) return draining;
    draining = (async () => { while (!stopped && await step()) { /* Drain only currently due work. */ } })()
      .finally(() => { draining = null; });
    return draining;
  }
  function wake(): void {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = undefined;
    void drain().catch((error: unknown) => options.onError?.(error)).finally(() => {
      if (!stopped && timer === undefined) {
        timer = setTimeout(wake, options.pollMs ?? 5_000);
        timer.unref();
      }
    });
  }
  return {
    step, drain, wake,
    async stop(): Promise<void> {
      stopped = true;
      if (timer) clearTimeout(timer);
      await stepping;
      await draining;
    },
  };
}
