import { randomUUID } from 'node:crypto';
import type { ModelInvocationRow } from '../../src/domain/model-invocations.ts';
import { getDb } from './connection.ts';
import { requireLearnerId } from './learner-context.ts';

export class ModelInvocationInputError extends Error {}

export function startModelInvocation(input: { provider: string; model: string; invocationType: string }): string {
  const learnerId = requireLearnerId();
  const id = randomUUID();
  getDb().prepare(`INSERT INTO model_invocations
    (id, timestamp, provider, model, invocation_type, learner_id, spend_source, status)
    VALUES (?, ?, ?, ?, ?, ?, 'unknown', 'running')`).run(
    id, new Date().toISOString(), input.provider, input.model, input.invocationType, learnerId,
  );
  return id;
}

export function recordModelInvocationSpend(id: string, input: {
  spendUsd: number | null; spendSource: ModelInvocationRow['spendSource']; pricing: unknown;
}): void {
  getDb().prepare(`UPDATE model_invocations SET spend_usd = ?, spend_source = ?, pricing_json = ?
    WHERE id = ? AND status = 'running'`).run(input.spendUsd, input.spendSource,
    input.pricing === null ? null : JSON.stringify(input.pricing), id);
}

export function finishModelInvocation(id: string, status: Exclude<ModelInvocationRow['status'], 'running'>, latencyMs: number): void {
  if (!Number.isFinite(latencyMs) || latencyMs < 0) throw new Error('Expected nonnegative invocation latency');
  getDb().prepare("UPDATE model_invocations SET status = ?, latency_ms = ? WHERE id = ? AND learner_id = ? AND status = 'running'")
    .run(status, latencyMs, id, requireLearnerId());
}

export function invalidateModelInvocation(id: string): void {
  const learnerId = requireLearnerId();
  const row = getDb().prepare('SELECT status FROM model_invocations WHERE id = ? AND learner_id = ?')
    .get(id, learnerId) as { status: ModelInvocationRow['status'] } | undefined;
  if (!row) throw new Error('Model invocation does not belong to current learner');
  if (row.status === 'invalid_response') return;
  if (row.status !== 'completed') throw new Error('Only completed model responses can be invalidated');
  getDb().prepare("UPDATE model_invocations SET status = 'invalid_response' WHERE id = ? AND learner_id = ? AND status = 'completed'")
    .run(id, learnerId);
}

function dateBound(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) {
    throw new ModelInvocationInputError(`Expected ${name} as a valid UTC YYYY-MM-DD date`);
  }
  return value;
}

/** Operator-only cross-learner read. Never exposes prompts, responses, or credentials. */
export function listModelInvocations(input: { from?: unknown; to?: unknown } = {}): { rows: ModelInvocationRow[] } {
  const from = dateBound(input.from, 'from');
  const to = dateBound(input.to, 'to');
  if (from && to && from > to) throw new ModelInvocationInputError('from must not be after to');
  const rows = getDb().prepare(`SELECT i.id, i.timestamp, i.provider, i.model,
      i.invocation_type AS invocationType, i.learner_id AS learnerId,
      l.display_name AS userDisplayName, i.spend_usd AS spendUsd,
      i.spend_source AS spendSource, i.status, i.latency_ms AS latencyMs
    FROM model_invocations i JOIN learners l ON l.learner_id = i.learner_id
    WHERE (? IS NULL OR i.timestamp >= ?) AND (? IS NULL OR i.timestamp <= ?)
    ORDER BY i.timestamp DESC, i.id DESC`).all(
    from ?? null, from ? `${from}T00:00:00.000Z` : null,
    to ?? null, to ? `${to}T23:59:59.999Z` : null,
  ) as ModelInvocationRow[];
  return { rows };
}
