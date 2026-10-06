import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createOpenAiCompatibleAdapter } from '../server/llm/openai-compatible.ts';
import { installModelInvocationLedger, invalidateInvocation } from '../server/llm/invocation-ledger.ts';
import { listModelInvocations } from '../server/db/model-invocations.ts';
import { ProviderTimeoutError, type ProviderRunRequest } from '../server/llm/types.ts';
let db: typeof import('../server/db.ts');
let directory: string;
let sql: DatabaseSync;
before(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'model-invocations-'));
  process.env.APP_MODE = 'study'; process.env.APP_AUTH_MODE = 'clerk'; process.env.APP_DATA_DIR = directory;
  db = await import('../server/db.ts');
  db.bootstrapLearner({ learnerId: 'ledger-a' });
  db.bootstrapLearner({ learnerId: 'ledger-b' });
  sql = new DatabaseSync(path.join(directory, 'app.db'));
  installModelInvocationLedger();
});
after(() => { sql?.close(); fs.rmSync(directory, { recursive: true, force: true }); });
const request: ProviderRunRequest = { model: 'gpt-5.6-luna', reasoningEffort: null,
  systemPrompt: 'Secret prompt', userPrompt: 'Private response', outputSchemaName: 'ledger_test',
  outputSchema: { type: 'object' }, maxOutputTokens: 10, temperature: null, timeoutMs: 500, cachePrompt: false };
function adapter(body: unknown, provider = 'openai') {
  return createOpenAiCompatibleAdapter({ id: provider, defaultBaseUrl: 'https://example.com',
    apiKeyEnvironmentVariable: 'KEY', structuredOutputMode: 'json_schema', maxTokensField: 'max_tokens',
    fetchImplementation: async () => new Response(JSON.stringify(body), { status: 200 }) });
}
const config = { apiKey: 'secret', baseUrl: null };
const response = { choices: [{ message: { content: '{}' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 1000, completion_tokens: 100, prompt_tokens_details: { cached_tokens: 500 } } };
test('records each attributed attempt, estimates cached input, prefers reported zero and keeps unknown spend', async () => {
  await db.runWithLearnerId('ledger-a', () => adapter(response).run(request, config));
  await db.runWithLearnerId('ledger-b', () => adapter({ ...response, usage: { cost: 0 } }, 'openrouter').run(request, config));
  await db.runWithLearnerId('ledger-b', () => adapter({ ...response, usage: {} }).run(request, config));
  const rows = listModelInvocations().rows;
  assert.equal(rows.length, 3);
  const estimate = rows.find((row) => row.learnerId === 'ledger-a')!;
  assert.equal(estimate.spendSource, 'estimated');
  assert.equal(estimate.spendUsd, 0.00023);
  assert.equal(estimate.invocationType, 'ledger_test');
  assert.ok(rows.some((row) => row.spendUsd === 0 && row.spendSource === 'reported'));
  assert.ok(rows.some((row) => row.spendUsd === null && row.spendSource === 'unknown'));
  assert.ok(rows.every((row) => row.status === 'completed'));
  assert.ok(!JSON.stringify(rows).includes('Secret prompt'));
});
test('missing learner prevents transport; malformed content still retains provider cost', async () => {
  await assert.rejects(() => adapter(response).run(request, config), /Learner context/);
  await assert.rejects(() => db.runWithLearnerId('ledger-a', () => adapter({ usage: { cost: 0.125 } }, 'openrouter').run(request, config)));
  const row = listModelInvocations().rows.find((item) => item.status === 'invalid_response')!;
  assert.equal(row.spendUsd, 0.125); assert.equal(row.spendSource, 'reported');
});
test('OpenAI cache writes replace ordinary input charges and debrief uses its model pricing', async () => {
  await db.runWithLearnerId('ledger-a', () => adapter({ ...response, usage: { prompt_tokens: 1000,
    completion_tokens: 100, prompt_tokens_details: { cached_tokens: 200, cache_write_tokens: 300 } } })
    .run({ ...request, model: 'gpt-6.1-sol' }, config));
  assert.equal(listModelInvocations().rows.find((row) => row.model === 'gpt-6.1-sol')!.spendUsd, 0.00277);
});
test('date filters are inclusive UTC and reject invalid dates or reversed ranges', () => {
  const id = listModelInvocations().rows[0]!.id;
  sql.prepare('UPDATE model_invocations SET timestamp = ? WHERE id = ?').run('2026-01-03T23:59:59.999Z', id);
  assert.equal(listModelInvocations({ from: '2026-01-03', to: '2026-01-03' }).rows.length, 1);
  assert.equal(listModelInvocations({ to: '2026-01-02' }).rows.length, 0);
  assert.throws(() => listModelInvocations({ from: '2026-02-30' }), /valid UTC/);
  assert.throws(() => listModelInvocations({ from: ['2026-01-01'] }), /valid UTC/);
  assert.throws(() => listModelInvocations({ from: '2026-02-01', to: '2026-01-01' }), /after/);
});


test('transport failure remains an attributed failed call with unknown spend', async () => {
  const failing = createOpenAiCompatibleAdapter({ id: 'openai', defaultBaseUrl: 'https://example.com',
    apiKeyEnvironmentVariable: 'KEY', structuredOutputMode: 'json_schema', maxTokensField: 'max_tokens',
    fetchImplementation: async () => { throw new Error('connection lost'); } });
  await assert.rejects(() => db.runWithLearnerId('ledger-b', () => failing.run({ ...request, outputSchemaName: 'network_failure' }, config)), /connection lost/);
  const row = listModelInvocations().rows.find((item) => item.invocationType === 'network_failure')!;
  assert.equal(row.learnerId, 'ledger-b');
  assert.equal(row.status, 'failed');
  assert.equal(row.spendUsd, null);
  assert.equal(row.spendSource, 'unknown');
});


test('monotonic latency is persisted and downstream invalidation preserves accounting and enforces ownership', async (t) => {
  let now = 100;
  t.mock.method(performance, 'now', () => { const value = now; now += 37; return value; });
  const result = await db.runWithLearnerId('ledger-a', () => adapter(response).run(request, config));
  const original = listModelInvocations().rows.find((row) => row.id === result.invocationId)!;
  assert.equal(original.latencyMs, 37);
  assert.throws(() => db.runWithLearnerId('ledger-b', () => invalidateInvocation(result.invocationId)), /does not belong/);
  assert.equal(listModelInvocations().rows.find((row) => row.id === result.invocationId)!.status, 'completed');
  db.runWithLearnerId('ledger-a', () => invalidateInvocation(result.invocationId));
  db.runWithLearnerId('ledger-a', () => invalidateInvocation(result.invocationId));
  const updated = listModelInvocations().rows.find((row) => row.id === result.invocationId)!;
  assert.deepEqual({ ...updated }, { ...original, status: 'invalid_response' });
  invalidateInvocation(undefined); invalidateInvocation(null);
});

function customAdapter(fetchImplementation: typeof fetch) {
  return createOpenAiCompatibleAdapter({ id: 'openai', defaultBaseUrl: 'https://example.com',
    apiKeyEnvironmentVariable: 'KEY', structuredOutputMode: 'json_schema', maxTokensField: 'max_tokens', fetchImplementation });
}

test('own deadline during fetch and response body records configured timeout exactly', async () => {
  // AbortSignal.timeout is unrefed; keep this isolated fake transport alive until the deadline.
  const keepAlive = setInterval(() => {}, 1000);
  try {
    for (const bodyTimeout of [false, true]) {
      const name = bodyTimeout ? 'body_timeout' : 'fetch_timeout';
      const transport = customAdapter(async (_url, options) => {
        const wait = () => new Promise<string>((_resolve, reject) => {
          options!.signal!.addEventListener('abort', () => reject(options!.signal!.reason), { once: true });
        });
        if (!bodyTimeout) { await wait(); throw new Error('unreachable'); }
        return { text: wait } as Response;
      });
      await assert.rejects(() => db.runWithLearnerId('ledger-a', () => transport.run({ ...request, timeoutMs: 10, outputSchemaName: name }, config)), ProviderTimeoutError);
      const row = listModelInvocations().rows.find((item) => item.invocationType === name)!;
      assert.equal(row.status, 'timed_out'); assert.equal(row.latencyMs, 10); assert.equal(row.spendUsd, null);
      assert.equal(new ProviderTimeoutError('openai', 10).name, 'TimeoutError');
    }
  } finally { clearInterval(keepAlive); }
});

test('wrapped transport deadline is timed out, unrelated AbortError remains failed, malformed JSON is invalid', async () => {
  const cases = [
    { name: 'upstream_deadline', error: new TypeError('fetch failed', { cause: Object.assign(new Error('deadline'), { code: 'UND_ERR_HEADERS_TIMEOUT' }) }), status: 'timed_out' },
    { name: 'unrelated_abort', error: new DOMException('cancelled', 'AbortError'), status: 'failed' },
  ];
  for (const item of cases) {
    await assert.rejects(() => db.runWithLearnerId('ledger-a', () => customAdapter(async () => { throw item.error; })
      .run({ ...request, outputSchemaName: item.name }, config)));
    const row = listModelInvocations().rows.find((row) => row.invocationType === item.name)!;
    assert.equal(row.status, item.status);
    if (item.status === 'timed_out') assert.equal(row.latencyMs, request.timeoutMs);
  }
  await assert.rejects(() => db.runWithLearnerId('ledger-a', () => customAdapter(async () => new Response('not json'))
    .run({ ...request, outputSchemaName: 'non_json' }, config)));
  const row = listModelInvocations().rows.find((item) => item.invocationType === 'non_json')!;
  assert.equal(row.status, 'invalid_response'); assert.equal(row.spendUsd, null); assert.ok(row.latencyMs! >= 0);
});
