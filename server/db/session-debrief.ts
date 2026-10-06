import { getDb } from './connection.ts';
import { requireLearnerId, runWithLearnerId } from './learner-context.ts';
import {
  validateDebriefInterests, validateDebriefInventory, validateSessionDebriefResult,
  MIN_SESSION_DEBRIEF_ITEMS,
  type SessionDebrief, type SessionDebriefInput, type SessionDebriefInventoryItem, type SessionDebriefResult,
} from '../../src/domain/session-debrief.ts';
import type { DebriefRunMetadata } from '../session-debrief/provider.ts';

export function getDebriefInterests(): string {
  const row = getDb().prepare(`SELECT value_json FROM learner_settings WHERE learner_id = ? AND setting_key = 'debrief_interests'`)
    .get(requireLearnerId()) as { value_json: string } | undefined;
  const value: unknown = row ? JSON.parse(row.value_json) : '';
  validateDebriefInterests(value);
  return value;
}

export function setDebriefInterests(value: unknown): { debriefInterests: string } {
  validateDebriefInterests(value);
  getDb().prepare(`INSERT INTO learner_settings (learner_id, setting_key, value_json, updated_at)
    VALUES (?, 'debrief_interests', ?, ?) ON CONFLICT(learner_id, setting_key) DO UPDATE SET
    value_json = excluded.value_json, updated_at = excluded.updated_at`)
    .run(requireLearnerId(), JSON.stringify(value), new Date().toISOString());
  return { debriefInterests: value };
}

/** Called within the durable summary transaction. First inventory wins on repeat finalization. */
export function enqueueSessionDebrief(sessionId: string, completedAt: string, inventory: SessionDebriefInventoryItem[]): void {
  validateDebriefInventory(inventory);
  const interests = getDebriefInterests();
  const input: SessionDebriefInput = {
    schemaVersion: 'session_debrief_input.v1', sessionDate: new Date(completedAt).toISOString(),
    interests: interests.trim() ? [interests] : [],
    items: inventory.map((item, index) => ({ ...item, ref: `w${index + 1}` })),
  };
  const generate = inventory.length >= MIN_SESSION_DEBRIEF_ITEMS;
  getDb().prepare(`INSERT INTO learner_session_debrief_jobs
    (learner_id, session_id, completed_at, exercise_count, input_json, status, result_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(learner_id, session_id) DO NOTHING`)
    .run(requireLearnerId(), sessionId, input.sessionDate, inventory.length, JSON.stringify(input),
      generate ? 'queued' : 'ready', generate ? null : '{"notes":[]}', new Date().toISOString());
}

/** Apply the current threshold to pending legacy jobs without touching ready results or attempts. */
function completeSmallSessionDebriefs(learnerId: string | null = null, sessionId: string | null = null,
  now = new Date().toISOString()): void {
  getDb().prepare(`UPDATE learner_session_debrief_jobs SET status = 'ready', result_json = '{"notes":[]}',
    last_error = NULL, updated_at = ? WHERE exercise_count < ? AND status IN ('queued', 'failed')
    AND (? IS NULL OR learner_id = ?) AND (? IS NULL OR session_id = ?)`)
    .run(now, MIN_SESSION_DEBRIEF_ITEMS, learnerId, learnerId, sessionId, sessionId);
}

type JobRow = {
  session_id: string; completed_at: string; exercise_count: number; input_json: string;
  status: SessionDebrief['status']; result_json: string | null; last_error: string | null; attempt_count: number;
};
function dto(row: JobRow): SessionDebrief {
  return { sessionId: row.session_id, completedAt: row.completed_at, exerciseCount: row.exercise_count,
    status: row.status, notes: row.result_json === null ? null : (JSON.parse(row.result_json) as SessionDebriefResult).notes,
    error: row.last_error, attemptCount: row.attempt_count };
}
export function getSessionDebrief(sessionId: string): SessionDebrief | null {
  const row = getDb().prepare(`SELECT * FROM learner_session_debrief_jobs WHERE learner_id = ? AND session_id = ?`)
    .get(requireLearnerId(), sessionId) as JobRow | undefined;
  return row ? dto(row) : null;
}
export function getLatestSessionDebrief(): SessionDebrief | null {
  const row = getDb().prepare(`SELECT * FROM learner_session_debrief_jobs WHERE learner_id = ? ORDER BY completed_at DESC, session_id DESC LIMIT 1`)
    .get(requireLearnerId()) as JobRow | undefined;
  return row ? dto(row) : null;
}
export class SessionDebriefNotFoundError extends Error {}
export class SessionDebriefRetryConflictError extends Error {}
export function retrySessionDebrief(sessionId: string): SessionDebrief {
  const job = getSessionDebrief(sessionId);
  if (!job) throw new SessionDebriefNotFoundError('Session debrief not found');
  if (job.status !== 'failed') throw new SessionDebriefRetryConflictError('Only failed debriefs can be retried');
  if (job.exerciseCount < MIN_SESSION_DEBRIEF_ITEMS) {
    completeSmallSessionDebriefs(requireLearnerId(), sessionId);
    return getSessionDebrief(sessionId)!;
  }
  getDb().prepare(`UPDATE learner_session_debrief_jobs SET status = 'queued', last_error = NULL, updated_at = ?
    WHERE learner_id = ? AND session_id = ? AND status = 'failed'`).run(new Date().toISOString(), requireLearnerId(), sessionId);
  return getSessionDebrief(sessionId)!;
}

/** Operational enumeration exposes only routing identities, never private evidence. */
export function listQueuedSessionDebriefs(): Array<{ learnerId: string; sessionId: string }> {
  completeSmallSessionDebriefs();
  return getDb().prepare(`SELECT jobs.learner_id AS learnerId, session_id AS sessionId FROM learner_session_debrief_jobs AS jobs
    JOIN learners ON learners.learner_id = jobs.learner_id WHERE status = 'queued' AND disabled_at IS NULL
    ORDER BY completed_at LIMIT 100`).all() as Array<{ learnerId: string; sessionId: string }>;
}
export function claimSessionDebrief(sessionId: string, token: string, startedAt: string, expiresAt: string): SessionDebriefInput | null {
  return transaction(() => {
    completeSmallSessionDebriefs(requireLearnerId(), sessionId, startedAt);
    const changed = getDb().prepare(`UPDATE learner_session_debrief_jobs SET status = 'running', active_token = ?, expires_at = ?,
      attempt_count = attempt_count + 1, updated_at = ? WHERE learner_id = ? AND session_id = ? AND status = 'queued'
      AND exercise_count >= ?`)
      .run(token, expiresAt, startedAt, requireLearnerId(), sessionId, MIN_SESSION_DEBRIEF_ITEMS).changes;
    if (changed !== 1) return null;
    getDb().prepare(`INSERT INTO learner_session_debrief_attempts
      (learner_id, attempt_id, session_id, started_at, provider, model, reasoning_effort, prompt_version)
      VALUES (?, ?, ?, ?, 'openai', 'gpt-6.1-sol', 'low', 'session-debrief-v6')`)
      .run(requireLearnerId(), token, sessionId, startedAt);
    const row = getDb().prepare(`SELECT input_json FROM learner_session_debrief_jobs WHERE learner_id = ? AND session_id = ?`)
      .get(requireLearnerId(), sessionId) as { input_json: string };
    return JSON.parse(row.input_json) as SessionDebriefInput;
  });
}
export function finishSessionDebrief(input: {
  sessionId: string; token: string; completedAt: string; durationMs: number;
  result: SessionDebriefResult | null; error: string | null; errorCode: string | null; metadata: DebriefRunMetadata | null;
}): boolean {
  return transaction(() => {
    const row = getDb().prepare(`SELECT input_json FROM learner_session_debrief_jobs WHERE learner_id = ? AND session_id = ?
      AND status = 'running' AND active_token = ?`).get(requireLearnerId(), input.sessionId, input.token) as { input_json: string } | undefined;
    if (!row) return false;
    if (input.result) validateSessionDebriefResult(input.result, JSON.parse(row.input_json) as SessionDebriefInput);
    getDb().prepare(`UPDATE learner_session_debrief_jobs SET status = ?, result_json = ?, active_token = NULL,
      expires_at = NULL, last_error = ?, updated_at = ? WHERE learner_id = ? AND session_id = ? AND active_token = ?`)
      .run(input.result ? 'ready' : 'failed', input.result ? JSON.stringify(input.result) : null, input.error,
        input.completedAt, requireLearnerId(), input.sessionId, input.token);
    const metadata = input.metadata;
    getDb().prepare(`UPDATE learner_session_debrief_attempts SET completed_at = ?, outcome = ?, error_code = ?,
      response_id = ?, finish_reason = ?, usage_json = ?, duration_ms = ?, pricing_json = ?, estimated_cost_usd = ?
      WHERE learner_id = ? AND attempt_id = ? AND outcome IS NULL`)
      .run(input.completedAt, input.result ? 'ready' : 'failed', input.errorCode, metadata?.responseId ?? null,
        metadata?.finishReason ?? null, metadata ? JSON.stringify(metadata.usage) : null, input.durationMs,
        metadata?.pricing ? JSON.stringify(metadata.pricing) : null, metadata?.estimatedCostUsd ?? null, requireLearnerId(), input.token);
    return true;
  });
}
export function recoverExpiredSessionDebriefs(now = new Date().toISOString()): void {
  const expired = getDb().prepare(`SELECT learner_id, session_id, active_token FROM learner_session_debrief_jobs
    WHERE status = 'running' AND expires_at <= ?`).all(now) as Array<{ learner_id: string; session_id: string; active_token: string }>;
  for (const row of expired) runWithLearnerId(row.learner_id, () => transaction(() => {
    const changed = getDb().prepare(`UPDATE learner_session_debrief_jobs SET status = 'failed', active_token = NULL,
      expires_at = NULL, last_error = 'Debrief generation was interrupted. You can retry.', updated_at = ?
      WHERE learner_id = ? AND session_id = ? AND status = 'running' AND active_token = ? AND expires_at <= ?`)
      .run(now, row.learner_id, row.session_id, row.active_token, now).changes;
    if (changed === 1) getDb().prepare(`UPDATE learner_session_debrief_attempts SET completed_at = ?, outcome = 'interrupted',
      error_code = 'interrupted', duration_ms = MAX(0, CAST((julianday(?) - julianday(started_at)) * 86400000 AS INTEGER))
      WHERE learner_id = ? AND attempt_id = ? AND outcome IS NULL`).run(now, now, row.learner_id, row.active_token);
  }));
  completeSmallSessionDebriefs(null, null, now);
}
function transaction<T>(work: () => T): T {
  getDb().exec('BEGIN IMMEDIATE');
  try { const result = work(); getDb().exec('COMMIT'); return result; }
  catch (error) { getDb().exec('ROLLBACK'); throw error; }
}
