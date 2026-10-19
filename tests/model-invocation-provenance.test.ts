import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createOpenAiCompatibleAdapter } from '../server/llm/openai-compatible.ts';
import { getDb } from '../server/db/connection.ts';
import { runWithLearnerId } from '../server/db/learner-context.ts';
import {
  startModelInvocation, startServiceModelInvocation, recordModelInvocationSpend,
  recordServiceModelInvocationSpend, finishModelInvocation, finishServiceModelInvocation,
  invalidateModelInvocation, invalidateServiceModelInvocation,
  recordServiceModelInvocationResponseSnapshot, listModelInvocations,
} from '../server/db/model-invocations.ts';
import {
  installModelInvocationLedger, beginServiceInvocation, recordServiceInvocationResponse, concludeServiceInvocation,
} from '../server/llm/invocation-ledger.ts';

let directory: string;
before(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'model-provenance-'));
  process.env.APP_MODE = 'study'; process.env.APP_AUTH_MODE = 'clerk'; process.env.APP_DATA_DIR = directory;
  const db = await import('../server/db.ts');
  db.bootstrapLearner({ learnerId: 'provenance-a' }); db.bootstrapLearner({ learnerId: 'provenance-b' });
  installModelInvocationLedger();
});
after(() => { getDb().close(); fs.rmSync(directory, { recursive: true, force: true }); });
const input = { provider: 'openai', model: 'gpt-5.6-luna', invocationType: 'test-provenance' };
const spend = { spendUsd: 0.1, spendSource: 'reported' as const, pricing: { rate: 'retained' } };
const learner = <T>(work: () => T) => runWithLearnerId('provenance-a', work);

test('rebuild retains old rows, accounting, status, and dependent foreign keys with unknown provenance', () => {
  const sql = new DatabaseSync(':memory:');
  try {
    sql.exec(`PRAGMA foreign_keys=ON; CREATE TABLE learners(learner_id TEXT PRIMARY KEY);
      INSERT INTO learners VALUES ('old'); CREATE TABLE word_preparation_work(id TEXT);`);
    sql.exec(fs.readFileSync(new URL('../server/db/migrations/0025_model_invocations.sql', import.meta.url), 'utf8'));
    sql.exec(fs.readFileSync(new URL('../server/db/migrations/0026_model_invocation_outcomes.sql', import.meta.url), 'utf8'));
    sql.exec(`INSERT INTO model_invocations VALUES ('legacy','2026-10-01','provider','model','call','old',0.2,'reported','completed','{"rate":2}',37);
      CREATE TABLE child(invocation_id TEXT REFERENCES model_invocations(id)); INSERT INTO child VALUES ('legacy');`);
    const original = { ...sql.prepare('SELECT * FROM model_invocations').get() };
    sql.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE');
    sql.exec(fs.readFileSync(new URL('../server/db/migrations/0038_model_provenance.sql', import.meta.url), 'utf8'));
    assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(), []);
    sql.exec('COMMIT; PRAGMA foreign_keys=ON');
    const migrated = sql.prepare('SELECT * FROM model_invocations').get()!;
    for (const [key, value] of Object.entries(original)) assert.equal(migrated[key], value);
    assert.equal(migrated.actor_kind, 'learner'); assert.equal(migrated.actor_id, 'old');
    assert.equal(migrated.prompt_template, null); assert.equal(migrated.request_snapshot_json, null);
    assert.equal(migrated.finished_at, null); assert.equal(migrated.usage_json, null);
    assert.equal(sql.prepare('SELECT invocation_id FROM child').get()!.invocation_id, 'legacy');
  } finally { sql.close(); }
});

test('service invocation retains exact snapshots and real attribution without learner ownership', () => {
  const invocation = { ...input, serviceId: 'vocabulary-author', requestingLearnerId: 'provenance-a', provenance: {
    workflowId: 'job-1', stepName: 'author', attemptNumber: 2,
    promptName: 'author', promptVersion: '1', promptTemplate: 'Exact template',
    schemaName: 'exercise', schemaVersion: '1', schema: { type: 'object' },
    settings: { reasoning: 'high', maxTokens: 100 }, inputProjectionVersion: '1',
    requestSnapshot: { prompt: 'Exact projected input' },
  } };
  const id = beginServiceInvocation(invocation)!;
  const response = { id: 'provider-request-1', model: 'resolved-model', choices: [], usage: { cost: 0, prompt_tokens: 100, completion_tokens: 10 } };
  recordServiceInvocationResponse(id, invocation.serviceId, invocation, response);
  recordServiceInvocationResponse(id, invocation.serviceId, invocation, response);
  concludeServiceInvocation(id, invocation.serviceId, 'completed', 12);
  concludeServiceInvocation(id, invocation.serviceId, 'completed', 999);
  const row = getDb().prepare('SELECT * FROM model_invocations WHERE id=?').get(id)!;
  assert.equal(row.learner_id, null); assert.equal(row.actor_kind, 'service'); assert.equal(row.actor_id, invocation.serviceId);
  assert.equal(row.requesting_learner_id, 'provenance-a'); assert.equal(row.attempt_number, 2);
  assert.equal(row.prompt_template, 'Exact template'); assert.match(String(row.prompt_hash), /^[a-f0-9]{64}$/);
  assert.deepEqual(JSON.parse(String(row.request_snapshot_json)), invocation.provenance.requestSnapshot);
  assert.deepEqual(JSON.parse(String(row.response_snapshot_json)), response);
  assert.deepEqual(JSON.parse(String(row.usage_json)), response.usage);
  assert.equal(row.resolved_model, response.model); assert.equal(row.provider_request_id, response.id);
  assert.equal(row.latency_ms, 12); assert.ok(row.finished_at);
  const listed = listModelInvocations().rows.find(row => row.id === id)!;
  assert.equal(listed.userDisplayName, null); assert.equal(listed.actorKind, 'service');
  assert.ok(!JSON.stringify(listed).includes('Exact template'));
  assert.throws(() => recordServiceModelInvocationResponseSnapshot(id, invocation.serviceId, {}), /immutable/);
  invalidateServiceModelInvocation(id, invocation.serviceId); invalidateServiceModelInvocation(id, invocation.serviceId);
});

test('learner and service mutations reject missing or different ownership and preserve valid accounting', () => {
  const id = learner(() => startModelInvocation(input));
  const service = startServiceModelInvocation({ ...input, serviceId: 'worker' });
  assert.throws(() => startModelInvocation(input), /Learner context/);
  assert.throws(() => finishModelInvocation(id, 'completed', 1), /Learner context/);
  assert.throws(() => recordModelInvocationSpend(id, spend), /Learner context/);
  for (const target of [id, service]) {
    assert.throws(() => runWithLearnerId('provenance-b', () => recordModelInvocationSpend(target, spend)), /does not belong/);
    assert.throws(() => runWithLearnerId('provenance-b', () => finishModelInvocation(target, 'completed', 1)), /does not belong/);
    assert.throws(() => runWithLearnerId('provenance-b', () => invalidateModelInvocation(target)), /does not belong/);
  }
  assert.throws(() => recordServiceModelInvocationSpend(id, 'worker', spend), /does not belong/);
  assert.throws(() => finishServiceModelInvocation(service, 'other-worker', 'completed', 1), /does not belong/);
  learner(() => { recordModelInvocationSpend(id, spend); finishModelInvocation(id, 'completed', 10); });
  learner(() => recordModelInvocationSpend(id, { ...spend, spendUsd: 9 }));
  assert.equal(getDb().prepare('SELECT spend_usd FROM model_invocations WHERE id=?').get(id)!.spend_usd, 0.1);
});

test('credential-bearing snapshots fail before insertion and physical retries get distinct IDs', () => {
  const count = () => Number(getDb().prepare('SELECT count(*) n FROM model_invocations').get()!.n);
  const before = count();
  assert.throws(() => startServiceModelInvocation({ ...input, serviceId: 'worker', provenance: {
    requestSnapshot: { headers: { authorization: 'secret' } },
  } }), /Credentials/);
  assert.equal(count(), before);
  assert.throws(() => startServiceModelInvocation({ ...input, serviceId: 'worker', provenance: { attemptNumber: 0 } }), /positive/);
  const first = startServiceModelInvocation({ ...input, serviceId: 'worker', provenance: { workflowId: 'retry', attemptNumber: 1 } });
  const second = startServiceModelInvocation({ ...input, serviceId: 'worker', provenance: { workflowId: 'retry', attemptNumber: 2 } });
  assert.notEqual(first, second);
});

test('common transport automatically retains reconstructable inputs without credentials and permits authored data keys', async () => {
  const adapter = createOpenAiCompatibleAdapter({ id: 'openai', defaultBaseUrl: 'https://provider.example',
    apiKeyEnvironmentVariable: 'KEY', structuredOutputMode: 'json_schema', maxTokensField: 'max_tokens',
    fetchImplementation: async () => new Response(JSON.stringify({ id: 'response-1', model: 'resolved',
      choices: [{ message: { content: '{"password":"a vocabulary meaning"}' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 }),
  });
  const result = await learner(() => adapter.run({ model: input.model, systemPrompt: 'Exact system prompt',
    userPrompt: '{"password":"authored lesson"}', outputSchemaName: 'test-output',
    outputSchema: { type: 'object', properties: { password: { type: 'string' } } },
    maxOutputTokens: 10, temperature: null, timeoutMs: 100, cachePrompt: false, reasoningEffort: null,
    provenance: { promptName: 'test', promptVersion: '2', workflowId: 'transport-job', stepName: 'generate' },
  }, { apiKey: 'credential-never-retained', baseUrl: null }));
  const row = getDb().prepare('SELECT * FROM model_invocations WHERE id=?').get(result.invocationId!)!;
  assert.equal(row.prompt_template, 'Exact system prompt'); assert.equal(row.prompt_name, 'test');
  assert.equal(row.prompt_version, '2'); assert.equal(row.workflow_id, 'transport-job');
  const request = JSON.parse(String(row.request_snapshot_json));
  assert.equal(request.messages[0].content, 'Exact system prompt');
  assert.equal(request.messages[1].content, '{"password":"authored lesson"}');
  assert.equal(JSON.parse(String(row.schema_json)).properties.password.type, 'string');
  assert.ok(!JSON.stringify(row).includes('credential-never-retained'));
  assert.ok(String(row.response_snapshot_json).includes('vocabulary meaning'));
  assert.throws(() => learner(() => startModelInvocation({ ...input, provenance: { promptTemplate: 'one', promptHash: 'wrong' } })), /does not match/);
});

test('common transport uses explicit service attribution while missing learner still fails', async () => {
  let requests = 0;
  const adapter = createOpenAiCompatibleAdapter({ id: 'openai', defaultBaseUrl: 'https://provider.example',
    apiKeyEnvironmentVariable: 'KEY', structuredOutputMode: 'json_schema', maxTokensField: 'max_tokens',
    fetchImplementation: async () => { requests += 1; return new Response(JSON.stringify({ id: 'service-response',
      choices: [{ message: { content: '{}' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 2 } }), { status: 200 }); },
  });
  const request = { model: input.model, systemPrompt: 'service template', userPrompt: 'service input',
    outputSchemaName: 'service-output', outputSchema: { type: 'object' }, maxOutputTokens: 10,
    temperature: null, timeoutMs: 100, cachePrompt: false, reasoningEffort: null };
  await assert.rejects(() => adapter.run(request, { apiKey: 'service-secret', baseUrl: null }), /Learner context/);
  assert.equal(requests, 0);
  const result = await adapter.run({ ...request, invocationActor: { kind: 'service', serviceId: 'author-worker',
    requestingLearnerId: 'provenance-a' } }, { apiKey: 'service-secret', baseUrl: null });
  assert.equal(requests, 1);
  const row = getDb().prepare('SELECT * FROM model_invocations WHERE id=?').get(result.invocationId!)!;
  assert.equal(row.actor_kind, 'service'); assert.equal(row.actor_id, 'author-worker'); assert.equal(row.learner_id, null);
  assert.equal(row.requesting_learner_id, 'provenance-a'); assert.equal(row.status, 'completed');
  assert.ok(row.spend_usd !== null); assert.ok(row.response_snapshot_json); assert.ok(row.request_snapshot_json);
  assert.ok(!JSON.stringify(row).includes('service-secret'));
  assert.ok(!String(row.request_snapshot_json).includes('invocationActor'));
});
