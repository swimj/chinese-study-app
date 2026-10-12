import { recoverSessionReflectionDispatchRuns } from '../db/reflections.ts';
import { randomUUID } from 'node:crypto';
import { getDb } from '../db/connection.ts';
import { closeDueSessionCompletions } from '../db/session-completion.ts';
import { assertLearnerExists } from '../db/identity.ts';
import { runWithLearnerId } from '../db/learner-context.ts';
import { getHostedServiceControls } from '../db/hosted-operations.ts';
import { createInitialReflectionGenerationService, type InitialReflectionGenerationService } from '../reflection/generation.ts';
import { ReflectionEvidenceError } from '../reflection/evidence.ts';
import { HostedProviderWorkUnavailableError, runHostedProviderWork } from '../hosted-runtime-controls.ts';

const REFLECTION_DISPATCH_LEASE_MS = 30 * 60_000;
export function createSessionCompletionWorker(options: {
  reflectionService?: Pick<InitialReflectionGenerationService, 'generate'>;
  now?: () => number; pollMs?: number;
  controls?: () => { maintenanceMode: boolean; providerWorkEnabled: boolean };
  providerWork?: <T>(work: () => Promise<T>) => Promise<T>;
  wakeDebriefs?: () => void; onError?: (error: unknown) => void;
} = {}) {
  const reflection = options.reflectionService ?? createInitialReflectionGenerationService();
  const controls = options.controls ?? getHostedServiceControls;
  const providerWork = options.providerWork ?? runHostedProviderWork;
  const now = options.now ?? Date.now;
  let stopped = false; let timer: ReturnType<typeof setTimeout> | undefined; let running: Promise<boolean> | null = null;
  async function stepOnce(): Promise<boolean> {
    if (stopped || controls().maintenanceMode) return false;
    const timestamp = new Date(now()).toISOString();
    const closed = closeDueSessionCompletions(timestamp);
    if (closed > 0) options.wakeDebriefs?.();
    // Recover starts as failed, with exact retained evidence and the existing explicit retry path.
    const expired = getDb().prepare(`SELECT learner_id, session_id, active_token FROM learner_session_reflection_dispatches
      WHERE status = 'running' AND expires_at <= ?`).all(timestamp) as Array<{ learner_id: string; session_id: string; active_token: string }>;
    for (const dispatch of expired) runWithLearnerId(dispatch.learner_id, () => {
      getDb().exec('BEGIN IMMEDIATE');
      try {
        const outcome = recoverSessionReflectionDispatchRuns(dispatch.session_id, timestamp);
        getDb().prepare(`UPDATE learner_session_reflection_dispatches SET status = ?, active_token = NULL,
          expires_at = NULL, last_error = ? WHERE learner_id = ? AND session_id = ? AND active_token = ?`)
          .run(outcome === 'not_started' ? 'queued' : outcome,
            outcome === 'failed' ? 'Feedback was interrupted. Retry its failed run from Feedback.' : null,
            dispatch.learner_id, dispatch.session_id, dispatch.active_token);
        getDb().exec('COMMIT');
      } catch (error) { getDb().exec('ROLLBACK'); throw error; }
    });
    if (!controls().providerWorkEnabled) return closed > 0;
    const work = getDb().prepare(`SELECT dispatch.learner_id, dispatch.session_id, dispatch.evidence_json FROM learner_session_reflection_dispatches AS dispatch
      JOIN learners ON learners.learner_id = dispatch.learner_id
      WHERE dispatch.status = 'queued' AND learners.disabled_at IS NULL ORDER BY dispatch.rowid LIMIT 1`).get() as { learner_id: string; session_id: string; evidence_json: string } | undefined;
    if (!work) return closed > 0;
    try {
      return await runWithLearnerId(work.learner_id, () => providerWork(async () => {
        assertLearnerExists(work.learner_id);
        if (stopped || controls().maintenanceMode || !controls().providerWorkEnabled) return false;
        const token = randomUUID();
        const claimed = getDb().prepare(`UPDATE learner_session_reflection_dispatches SET status = 'running', active_token = ?, expires_at = ?
          WHERE learner_id = ? AND session_id = ? AND status = 'queued'`)
          .run(token, new Date(now() + REFLECTION_DISPATCH_LEASE_MS).toISOString(), work.learner_id, work.session_id);
        if (claimed.changes !== 1) return false;
        try {
          const result = await reflection.generate(work.session_id, JSON.parse(work.evidence_json));
          getDb().prepare(`UPDATE learner_session_reflection_dispatches SET status = 'succeeded', result_json = ?,
            active_token = NULL, expires_at = NULL, last_error = NULL
            WHERE learner_id = ? AND session_id = ? AND active_token = ?`)
            .run(JSON.stringify(result), work.learner_id, work.session_id, token);
        } catch (error) {
          const skipped = error instanceof ReflectionEvidenceError && error.code === 'no_qualifying_evidence';
          getDb().prepare(`UPDATE learner_session_reflection_dispatches SET status = ?, active_token = NULL,
            expires_at = NULL, last_error = ? WHERE learner_id = ? AND session_id = ? AND active_token = ?`)
            .run(skipped ? 'skipped' : 'failed', skipped ? null : 'Feedback could not finish. Retry its failed run from Feedback.', work.learner_id, work.session_id, token);
        }
        return true;
      }));
    } catch (error) {
      if (error instanceof HostedProviderWorkUnavailableError) return closed > 0;
      throw error;
    }
  }
  function step(): Promise<boolean> {
    if (running) return running;
    running = stepOnce().finally(() => { running = null; }); return running;
  }
  function wake(): void {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    // Closure gets its own cadence even while an earlier reflection call is running.
    timer = setTimeout(wake, options.pollMs ?? 500); timer.unref();
    if (!controls().maintenanceMode) {
      try { if (closeDueSessionCompletions(new Date(now()).toISOString()) > 0) options.wakeDebriefs?.(); }
      catch (error) { options.onError?.(error); }
    }
    void step().catch((error: unknown) => options.onError?.(error));
  }
  return { step, wake, async stop() { stopped = true; if (timer) clearTimeout(timer); await running; } };
}
