import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { priceInvocationUsage } from '../llm/invocation-pricing.ts';
import type { ReflectionRunPricingBasis } from '../reflection/run-pricing.ts';

type PendingInvocation = {
  id: string; timestamp: string; status: string;
  usage_json: string | null; request_snapshot_json: string | null;
};
type Candidate = { id: string; timestamp: string; status: string; spendUsd: number; pricing: ReflectionRunPricingBasis };
type Skipped = { id: string; reason: 'missing_usage' | 'unsupported_request' | 'unpriceable_usage' };

function supportedRequest(encoded: string | null): boolean {
  if (encoded === null) return false;
  const request: unknown = JSON.parse(encoded);
  if (typeof request !== 'object' || request === null || Array.isArray(request)) return false;
  const body = request as Record<string, unknown>;
  return body.model === 'gpt-6-luna'
    && (body.service_tier === undefined || body.service_tier === 'auto' || body.service_tier === 'default')
    && (body.prompt_cache_retention === undefined || body.prompt_cache_retention === '30m');
}

/** Explicit operator repair: only unknown terminal direct-OpenAI GPT-6 Luna costs. */
export function previewLunaInvocationCostBackfill(database: DatabaseSync) {
  const rows = database.prepare(`SELECT id, timestamp, status, usage_json, request_snapshot_json
    FROM model_invocations WHERE provider = 'openai' AND model = 'gpt-6-luna'
      AND status != 'running' AND spend_source = 'unknown' AND spend_usd IS NULL AND pricing_json IS NULL
    ORDER BY id`).all() as PendingInvocation[];
  const candidates: Candidate[] = [];
  const skipped: Skipped[] = [];
  for (const row of rows) {
    if (row.usage_json === null) { skipped.push({ id: row.id, reason: 'missing_usage' }); continue; }
    if (!supportedRequest(row.request_snapshot_json)) {
      skipped.push({ id: row.id, reason: 'unsupported_request' }); continue;
    }
    const spend = priceInvocationUsage({ provider: 'openai', model: 'gpt-6-luna',
      usage: JSON.parse(row.usage_json), reportedAt: row.timestamp });
    if (spend.spendSource !== 'estimated' || spend.spendUsd === null || spend.pricing === null) {
      skipped.push({ id: row.id, reason: 'unpriceable_usage' }); continue;
    }
    candidates.push({ id: row.id, timestamp: row.timestamp, status: row.status,
      spendUsd: spend.spendUsd, pricing: spend.pricing });
  }
  // Bind confirmation to the exact saved evidence and resulting pricing, without printing payloads.
  const digest = createHash('sha256').update(JSON.stringify({ version: 1, rows, candidates, skipped })).digest('hex');
  return { model: 'gpt-6-luna' as const, digest, candidates, skipped,
    totalEstimatedCostUsd: candidates.reduce((sum, row) => sum + row.spendUsd, 0) };
}

export function backfillLunaInvocationCosts(database: DatabaseSync, input: { actorId: string; expectedPlanDigest: string }) {
  const actorId = input.actorId.trim();
  if (!actorId) throw new Error('Expected a non-empty operator actor id');
  if (!/^[a-f0-9]{64}$/.test(input.expectedPlanDigest)) throw new Error('Expected a preview plan digest');
  database.exec('BEGIN IMMEDIATE');
  try {
    const plan = previewLunaInvocationCostBackfill(database);
    if (plan.digest !== input.expectedPlanDigest) throw new Error('Backfill plan changed; preview again before applying');
    const recordedAt = new Date().toISOString();
    const update = database.prepare(`UPDATE model_invocations SET spend_usd = ?, spend_source = 'estimated', pricing_json = ?
      WHERE id = ? AND provider = 'openai' AND model = 'gpt-6-luna' AND status != 'running'
        AND spend_source = 'unknown' AND spend_usd IS NULL AND pricing_json IS NULL`);
    for (const candidate of plan.candidates) {
      const pricing = { ...candidate.pricing, backfill: { actorId, recordedAt, planDigest: plan.digest } };
      const result = update.run(candidate.spendUsd, JSON.stringify(pricing), candidate.id);
      if (result.changes !== 1) throw new Error('Backfill candidate changed inside transaction');
    }
    database.exec('COMMIT');
    return { ...plan, applied: plan.candidates.length, actorId, recordedAt };
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}
