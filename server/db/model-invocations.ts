import { createHash, randomUUID } from 'node:crypto';
import type { ModelInvocationRow, ModelInvocationProvenance } from '../../src/domain/model-invocations.ts';
import { getDb } from './connection.ts';
import { requireLearnerId } from './learner-context.ts';

export class ModelInvocationInputError extends Error {}

export type { ModelInvocationProvenance } from '../../src/domain/model-invocations.ts';
export type ModelInvocationStart = {
  provider: string; model: string; invocationType: string; provenance?: ModelInvocationProvenance;
};
type Owner = { kind: 'learner' | 'service'; id: string };
type Spend = { spendUsd: number | null; spendSource: ModelInvocationRow['spendSource']; pricing: unknown };
type Status = Exclude<ModelInvocationRow['status'], 'running'>;

/** Snapshots accept provider payloads, never transport configuration or credentials. */
function snapshot(value: unknown, transportEnvelope = false): string | null {
  if (value === undefined || value === null) return null;
  // Inspect only the transport envelope. A schema/property or authored lesson may
  // legitimately discuss credentials; arbitrary nested data is not configuration.
  if (transportEnvelope && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).some(key => /^(authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|credentials?|headers)$/i.test(key))) {
    throw new ModelInvocationInputError('Credentials and transport headers cannot be retained in model snapshots');
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new ModelInvocationInputError('Expected JSON snapshot');
  return encoded;
}
function start(input: ModelInvocationStart, owner: Owner, requester: string | null): string {
  if (!owner.id.trim() || !input.provider.trim() || !input.model.trim() || !input.invocationType.trim()) {
    throw new ModelInvocationInputError('Expected invocation identity and attribution');
  }
  const p = input.provenance ?? {};
  if (p.attemptNumber !== undefined && (!Number.isSafeInteger(p.attemptNumber) || p.attemptNumber < 1)) {
    throw new ModelInvocationInputError('Expected a positive invocation attempt number');
  }
  const promptHash = p.promptTemplate === undefined ? p.promptHash ?? null
    : createHash('sha256').update(p.promptTemplate).digest('hex');
  if (p.promptTemplate !== undefined && p.promptHash !== undefined && p.promptHash !== promptHash) {
    throw new ModelInvocationInputError('Prompt hash does not match the retained template');
  }
  const id = randomUUID();
  getDb().prepare(`INSERT INTO model_invocations
    (id, timestamp, provider, model, invocation_type, learner_id, spend_source, status,
     actor_kind, actor_id, requesting_learner_id, workflow_id, step_name, attempt_number,
     prompt_name, prompt_version, prompt_hash, prompt_template, schema_name, schema_version,
     schema_json, input_projection_version, settings_json, request_snapshot_json, resolved_model, provider_request_id)
    VALUES (?, ?, ?, ?, ?, ?, 'unknown', 'running', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, new Date().toISOString(), input.provider, input.model, input.invocationType,
      owner.kind === 'learner' ? owner.id : null, owner.kind, owner.id, requester,
      p.workflowId ?? null, p.stepName ?? null, p.attemptNumber ?? null,
      p.promptName ?? null, p.promptVersion ?? null, promptHash, p.promptTemplate ?? null,
      p.schemaName ?? null, p.schemaVersion ?? null, snapshot(p.schema), p.inputProjectionVersion ?? null,
      snapshot(p.settings, true), snapshot(p.requestSnapshot, true), p.resolvedModel ?? null, p.providerRequestId ?? null);
  return id;
}
export function startModelInvocation(input: ModelInvocationStart): string {
  const learnerId = requireLearnerId();
  return start(input, { kind: 'learner', id: learnerId }, learnerId);
}
export function startServiceModelInvocation(input: ModelInvocationStart & { serviceId: string; requestingLearnerId?: string }): string {
  return start(input, { kind: 'service', id: input.serviceId }, input.requestingLearnerId ?? null);
}
function owned(id: string, owner: Owner): { status: ModelInvocationRow['status'] } {
  const row = getDb().prepare('SELECT status FROM model_invocations WHERE id = ? AND actor_kind = ? AND actor_id = ?')
    .get(id, owner.kind, owner.id) as { status: ModelInvocationRow['status'] } | undefined;
  if (!row) throw new Error(`Model invocation does not belong to current ${owner.kind}`);
  return row;
}
const learnerOwner = (): Owner => ({ kind: 'learner', id: requireLearnerId() });
function spend(id: string, owner: Owner, input: Spend): void {
  owned(id, owner);
  getDb().prepare(`UPDATE model_invocations SET spend_usd = ?, spend_source = ?, pricing_json = ?
    WHERE id = ? AND status = 'running'`).run(input.spendUsd, input.spendSource, snapshot(input.pricing), id);
}
export function recordModelInvocationSpend(id: string, input: Spend): void { spend(id, learnerOwner(), input); }
export function recordServiceModelInvocationSpend(id: string, serviceId: string, input: Spend): void { spend(id, { kind: 'service', id: serviceId }, input); }
function finish(id: string, owner: Owner, status: Status, latencyMs: number): void {
  if (!Number.isFinite(latencyMs) || latencyMs < 0) throw new Error('Expected nonnegative invocation latency');
  owned(id, owner);
  getDb().prepare("UPDATE model_invocations SET status = ?, latency_ms = ?, finished_at = ? WHERE id = ? AND status = 'running'")
    .run(status, latencyMs, new Date().toISOString(), id);
}
export function finishModelInvocation(id: string, status: Status, latencyMs: number): void { finish(id, learnerOwner(), status, latencyMs); }
export function finishServiceModelInvocation(id: string, serviceId: string, status: Status, latencyMs: number): void { finish(id, { kind: 'service', id: serviceId }, status, latencyMs); }
function invalidate(id: string, owner: Owner): void {
  const row = owned(id, owner);
  if (row.status === 'invalid_response') return;
  if (row.status !== 'completed') throw new Error('Only completed model responses can be invalidated');
  getDb().prepare("UPDATE model_invocations SET status = 'invalid_response' WHERE id = ? AND status = 'completed'").run(id);
}
export function invalidateModelInvocation(id: string): void { invalidate(id, learnerOwner()); }
export function invalidateServiceModelInvocation(id: string, serviceId: string): void { invalidate(id, { kind: 'service', id: serviceId }); }
function responseSnapshot(id: string, owner: Owner, response: unknown): void {
  owned(id, owner);
  const encoded = snapshot(response);
  const row = getDb().prepare('SELECT response_snapshot_json FROM model_invocations WHERE id = ?').get(id) as { response_snapshot_json: string | null };
  if (row.response_snapshot_json !== null && row.response_snapshot_json !== encoded) {
    throw new Error('Model invocation response snapshot is immutable');
  }
  const payload = typeof response === 'object' && response !== null && !Array.isArray(response)
    ? response as Record<string, unknown> : {};
  getDb().prepare(`UPDATE model_invocations SET response_snapshot_json = ?, usage_json = ?,
    resolved_model = COALESCE(resolved_model, ?), provider_request_id = COALESCE(provider_request_id, ?) WHERE id = ?`)
    .run(encoded, snapshot(payload.usage), typeof payload.model === 'string' ? payload.model : null,
      typeof payload.id === 'string' ? payload.id : null, id);
}
export function recordModelInvocationResponseSnapshot(id: string, response: unknown): void { responseSnapshot(id, learnerOwner(), response); }
export function recordServiceModelInvocationResponseSnapshot(id: string, serviceId: string, response: unknown): void { responseSnapshot(id, { kind: 'service', id: serviceId }, response); }

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
      i.actor_kind AS actorKind, i.actor_id AS actorId, i.requesting_learner_id AS requestingLearnerId,
      l.display_name AS userDisplayName, i.spend_usd AS spendUsd,
      i.spend_source AS spendSource, i.status, i.latency_ms AS latencyMs
    FROM model_invocations i LEFT JOIN learners l ON l.learner_id = i.learner_id
    WHERE (? IS NULL OR i.timestamp >= ?) AND (? IS NULL OR i.timestamp <= ?)
    ORDER BY i.timestamp DESC, i.id DESC`).all(
    from ?? null, from ? `${from}T00:00:00.000Z` : null,
    to ?? null, to ? `${to}T23:59:59.999Z` : null,
  ) as ModelInvocationRow[];
  return { rows };
}
