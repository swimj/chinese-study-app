import { getSessionPayload, inspectSessionPreparation, reconcileWordPreparationReserve } from '../db/persistence.ts';

/** One deadline for the entire session, never one deadline per word. Provider work is owned by the worker. */
export async function prepareSessionPayload(studyDayKey: string, options: {
  wake: () => void;
  budgetMs?: number;
  now?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
}) {
  const budget = options.budgetMs ?? 30_000;
  if (!Number.isFinite(budget) || budget < 0 || budget > 30_000) throw new Error('Invalid session preparation budget');
  const now = options.now ?? Date.now;
  const wait = options.wait ?? ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const deadline = now() + budget;
  reconcileWordPreparationReserve(studyDayKey);
  options.wake();
  while (inspectSessionPreparation(studyDayKey).pending && now() < deadline) {
    await wait(Math.min(250, Math.max(0, deadline - now())));
  }
  const payload = getSessionPayload(studyDayKey);
  return { ...payload, preparation: { pending: inspectSessionPreparation(studyDayKey).pending } };
}
