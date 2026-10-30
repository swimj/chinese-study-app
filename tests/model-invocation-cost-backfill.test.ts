import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { after, before, beforeEach, test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { backfillLunaInvocationCosts, previewLunaInvocationCostBackfill } from '../server/db/model-invocation-cost-backfill.ts';
import { priceInvocationUsage } from '../server/llm/invocation-pricing.ts';

let directory: string;
let sql: DatabaseSync;
before(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-cost-backfill-'));
  process.env.APP_MODE = 'study'; process.env.APP_AUTH_MODE = 'clerk'; process.env.APP_DATA_DIR = directory;
  await import('../server/db.ts');
  sql = new DatabaseSync(path.join(directory, 'app.db'));
});
beforeEach(() => { sql.exec('DELETE FROM model_invocations'); });
after(() => { sql?.close(); fs.rmSync(directory, { recursive: true, force: true }); });

const usage = { prompt_tokens: 1000, completion_tokens: 100,
  prompt_tokens_details: { cached_tokens: 200, cache_write_tokens: 300 },
  completion_tokens_details: { reasoning_tokens: 80 } };
const timestamp = '2026-10-30T02:52:36.441Z';
function insert(id: string, overrides: {
  provider?: string; model?: string; status?: string; usage?: unknown; request?: unknown;
  cost?: number; pricing?: unknown;
} = {}) {
  sql.prepare(`INSERT INTO model_invocations (id,timestamp,provider,model,invocation_type,actor_kind,actor_id,
    status,spend_source,spend_usd,pricing_json,usage_json,request_snapshot_json)
    VALUES (?,?,?,?,'sense_mapping','service','vocabulary-reflection',?,?,?,?,?,?)`)
    .run(id, timestamp, overrides.provider ?? 'openai', overrides.model ?? 'gpt-6-luna',
      overrides.status ?? 'completed', overrides.cost === undefined ? 'unknown' : 'reported', overrides.cost ?? null,
      overrides.pricing === undefined ? null : JSON.stringify(overrides.pricing),
      overrides.usage === null ? null : JSON.stringify(overrides.usage ?? usage),
      overrides.request === null ? null : JSON.stringify(overrides.request ?? { model: 'gpt-6-luna' }));
}
function rows() { return sql.prepare('SELECT * FROM model_invocations ORDER BY id').all(); }
function apply() { return backfillLunaInvocationCosts(sql, { actorId: 'jw', expectedPlanDigest: previewLunaInvocationCostBackfill(sql).digest }); }

test('preview is read-only; repair matches live pricing, retains evidence and records operator provenance', () => {
  insert('mapping');
  const original = rows()[0]!;
  const preview = previewLunaInvocationCostBackfill(sql);
  assert.equal(preview.candidates.length, 1);
  assert.deepEqual(rows()[0], original);
  assert.equal(preview.totalEstimatedCostUsd, 0.0001395);
  assert.equal(preview.candidates[0]!.spendUsd,
    priceInvocationUsage({ provider: 'openai', model: 'gpt-6-luna', usage, reportedAt: timestamp }).spendUsd);
  assert.equal(apply().applied, 1);
  const updated = rows()[0]!;
  const { spend_usd, spend_source, pricing_json, ...unchanged } = updated;
  const { spend_usd: _oldCost, spend_source: _oldSource, pricing_json: _oldPricing, ...oldEvidence } = original;
  assert.deepEqual(unchanged, oldEvidence);
  assert.equal(spend_usd, 0.0001395); assert.equal(spend_source, 'estimated');
  const pricing = JSON.parse(String(pricing_json));
  assert.equal(pricing.providerModel, 'gpt-6-luna');
  assert.equal(pricing.backfill.actorId, 'jw');
  assert.equal(pricing.backfill.planDigest, preview.digest);
  assert.equal(new Date(pricing.backfill.recordedAt).toISOString(), pricing.backfill.recordedAt);
  const repaired = rows();
  assert.equal(apply().applied, 0);
  assert.deepEqual(rows(), repaired);
});

test('preserves known and running costs; skips missing, malformed, unsupported and long-context usage', () => {
  insert('known-zero', { cost: 0 });
  insert('known-estimate', { cost: 0.5, pricing: { id: 'historical' } });
  sql.prepare("UPDATE model_invocations SET spend_source='estimated' WHERE id='known-estimate'").run();
  insert('running', { status: 'running' });
  insert('other-model', { model: 'gpt-5.6-luna' });
  insert('other-provider', { provider: 'openrouter' });
  insert('missing', { usage: null });
  insert('partial', { usage: { prompt_tokens: 1 } });
  insert('bad-count', { usage: { ...usage, prompt_tokens_details: { cached_tokens: -1 } } });
  insert('bad-details', { usage: { ...usage, prompt_tokens_details: 'invalid' } });
  insert('bad-cache-total', { usage: { ...usage, prompt_tokens_details: { cached_tokens: 900, cache_write_tokens: 300 } } });
  insert('long', { usage: { ...usage, prompt_tokens: 272001 } });
  insert('missing-request', { request: null });
  insert('fast', { request: { model: 'gpt-6-luna', service_tier: 'priority' } });
  insert('long-cache', { request: { model: 'gpt-6-luna', prompt_cache_retention: '12h' } });
  insert('existing-basis', { pricing: { id: 'retained' } });
  const original = rows();
  const plan = previewLunaInvocationCostBackfill(sql);
  assert.equal(plan.candidates.length, 0); assert.equal(plan.skipped.length, 9);
  assert.equal(apply().applied, 0);
  assert.deepEqual(rows(), original);
});

test('includes charged failed and invalid-response attempts, plus genuine zero-token responses', () => {
  insert('failed', { status: 'failed' });
  insert('invalid', { status: 'invalid_response' });
  insert('zero', { usage: { prompt_tokens: 0, completion_tokens: 0 } });
  assert.equal(apply().applied, 3);
  assert.equal(rows().find(row => row.id === 'failed')!.status, 'failed');
  assert.equal(rows().find(row => row.id === 'invalid')!.status, 'invalid_response');
  assert.equal(rows().find(row => row.id === 'zero')!.spend_usd, 0);
});

test('rejects stale confirmations and rolls back the whole repair on a write failure', () => {
  insert('a'); insert('b');
  const digest = previewLunaInvocationCostBackfill(sql).digest;
  sql.prepare('UPDATE model_invocations SET usage_json=? WHERE id=?').run(JSON.stringify({ ...usage, completion_tokens: 101 }), 'b');
  assert.throws(() => backfillLunaInvocationCosts(sql, { actorId: 'jw', expectedPlanDigest: digest }), /plan changed/);
  assert.ok(rows().every(row => row.spend_usd === null));
  sql.exec(`CREATE TRIGGER reject_backfill BEFORE UPDATE OF spend_usd ON model_invocations
    WHEN NEW.id='b' BEGIN SELECT RAISE(ABORT,'injected write failure'); END`);
  try {
    assert.throws(apply, /injected write failure/);
    assert.ok(rows().every(row => row.spend_usd === null && row.pricing_json === null));
  } finally { sql.exec('DROP TRIGGER reject_backfill'); }
});

function cli(args: string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', 'scripts/backfill-luna-invocation-costs.ts', ...args], { encoding: 'utf8' });
}
test('CLI previews without startup writes, requires exact confirmation, applies and can be rerun', () => {
  insert('cli');
  const original = rows();
  const preview = cli([`--data-dir=${directory}`]);
  assert.equal(preview.status, 0, preview.stderr);
  const plan = JSON.parse(preview.stdout);
  assert.equal(plan.candidates.length, 1); assert.deepEqual(rows(), original);
  assert.notEqual(cli([`--data-dir=${directory}`, '--apply=true']).status, 0);
  assert.deepEqual(rows(), original);
  const applied = cli([`--data-dir=${directory}`, '--apply=true', '--actor-id=jw', `--confirm-plan=${plan.digest}`]);
  assert.equal(applied.status, 0, applied.stderr); assert.equal(JSON.parse(applied.stdout).applied, 1);
  assert.equal(JSON.parse(cli([`--data-dir=${directory}`]).stdout).candidates.length, 0);
  const missing = path.join(directory, 'missing'); fs.mkdirSync(missing);
  assert.notEqual(cli([`--data-dir=${missing}`]).status, 0);
  assert.equal(fs.existsSync(path.join(missing, 'app.db')), false);
});
