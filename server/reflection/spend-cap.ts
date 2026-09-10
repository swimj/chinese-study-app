import { LUNA_REFLECTION_MODEL_CHOICE, type ReflectionModelChoice } from './model-arms.ts';

/**
 * Provisional beta guardrail, not a billing product. Estimates come from
 * persisted run pricing, not provider invoices. Null estimates count as zero.
 */
export const DAILY_REFLECTION_SPEND_CAP_USD = 0.5;

export type ReflectionSpendCap = {
  lunaOnly: boolean;
  spentUsd: number;
  capUsd: number;
  dayKey: string;
  resetsAt: string;
};

export class ReflectionSpendCapError extends Error {
  readonly resetsAt: string;
  readonly allowedModel: ReflectionModelChoice;

  constructor(resetsAt: string) {
    super(`Daily reflection spend cap reached. Only Luna is available until ${resetsAt}.`);
    this.name = 'ReflectionSpendCapError';
    this.resetsAt = resetsAt;
    this.allowedModel = LUNA_REFLECTION_MODEL_CHOICE;
  }
}

export function utcDayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function utcDayRange(dayKey: string): { start: string; end: string } {
  const start = `${dayKey}T00:00:00.000Z`;
  const startMs = Date.parse(start);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey) || Number.isNaN(startMs) || new Date(startMs).toISOString() !== start) {
    throw new Error(`Expected YYYY-MM-DD UTC day key, received ${dayKey}`);
  }
  const end = new Date(startMs);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end: end.toISOString() };
}

export function buildReflectionSpendCap(spentUsd: number, now: Date): ReflectionSpendCap {
  if (!Number.isFinite(spentUsd) || spentUsd < 0) {
    throw new Error('Reflection spend must be a non-negative finite number.');
  }
  const dayKey = utcDayKey(now);
  const { end: resetsAt } = utcDayRange(dayKey);
  const capUsd = DAILY_REFLECTION_SPEND_CAP_USD;
  return {
    lunaOnly: spentUsd > capUsd,
    spentUsd,
    capUsd,
    dayKey,
    resetsAt,
  };
}

export function assertReflectionModelAllowedUnderSpendCap(
  choice: ReflectionModelChoice,
  spendCap: ReflectionSpendCap,
): void {
  if (spendCap.lunaOnly && choice !== LUNA_REFLECTION_MODEL_CHOICE) {
    throw new ReflectionSpendCapError(spendCap.resetsAt);
  }
}
