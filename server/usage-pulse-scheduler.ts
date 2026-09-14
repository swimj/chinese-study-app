import { config as dbConfig } from './db/connection.ts';
import {
  ensureUsagePulseSnapshots,
  utcDayKey,
} from './db/usage-pulse.ts';

export type UsagePulseScheduler = {
  stop(): void;
};

export function startUsagePulseScheduler(options?: {
  now?: () => Date;
  dataDir?: string | null;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}): UsagePulseScheduler {
  const nowFn = options?.now ?? (() => new Date());
  const dataDir = options?.dataDir ?? dbConfig.dataDir;
  const setTimeoutFn = options?.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = options?.clearTimeoutFn ?? clearTimeout;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const runCatchUp = () => {
    ensureUsagePulseSnapshots({
      todayDayKey: utcDayKey(nowFn()),
      dataDir,
      now: nowFn(),
    });
  };

  const scheduleNext = () => {
    if (stopped) return;
    const delayMs = msUntilNextUtcMidnight(nowFn());
    timer = setTimeoutFn(() => {
      if (stopped) return;
      try {
        runCatchUp();
      } catch (error) {
        console.error('usage pulse daily snapshot failed', error);
      }
      scheduleNext();
    }, delayMs);
    if (typeof timer === 'object' && timer && 'unref' in timer) {
      timer.unref();
    }
  };

  try {
    runCatchUp();
  } catch (error) {
    console.error('usage pulse startup catch-up failed', error);
  }
  scheduleNext();

  return {
    stop() {
      stopped = true;
      if (timer !== null) clearTimeoutFn(timer);
      timer = null;
    },
  };
}

export function msUntilNextUtcMidnight(now: Date): number {
  const next = new Date(now.getTime());
  next.setUTCHours(24, 0, 0, 0);
  const delta = next.getTime() - now.getTime();
  return Math.max(delta, 1);
}
