import assert from 'node:assert/strict';
import { test } from 'node:test';
import { costForBulkResponse, costForBulkResult, createBulkDispatcher, rateLimitDurationMs, type BulkAttempt, type BulkResponse, type BulkStart } from '../scripts/lib/bulk-repertoire-dispatch.ts';
import type { ProviderRawResult, ProviderRunRequest } from '../server/llm/types.ts';

const request: ProviderRunRequest = { model: 'gpt-6-sol', reasoningEffort: 'high', systemPrompt: 'Generate', userPrompt: 'word',
  outputSchemaName: 'test', outputSchema: { type: 'object' }, maxOutputTokens: 30, temperature: null, timeoutMs: 5000, cachePrompt: true };
const config = { apiKey: 'test', baseUrl: null };
function response(headers: Record<string, string> = {}) { return new Response(JSON.stringify({ model: 'gpt-6-sol', id: 'result', choices: [{ message: { content: '{}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 30, total_tokens: 50 } }), { headers }); }
function result(model = 'gpt-6-sol'): ProviderRawResult { return { model, provider: 'openai', responseId: 'r', structuredOutputMode: 'json_schema', rawText: '{}', finishReason: 'stop', rawResponse: {},
  usage: { inputTokens: 1000, cachedInputTokens: 200, cacheWriteInputTokens: 100, outputTokens: 500, reasoningTokens: 300, totalTokens: 1500 } }; }

test('cost reports include exact model pricing and do not double-charge cache writes or reasoning', () => {
  assert.equal(costForBulkResult(result()).spendUsd, (700 * 2 + 200 * 0.2 + 100 * 2.5 + 500 * 10) / 1e6);
  assert.equal(costForBulkResult(result('gpt-6-astra')).spendUsd, (700 * 10 + 200 + 100 * 12.5 + 500 * 50) / 1e6);
  const terra = costForBulkResult(result('gpt-6.1-terra-2026-11-01'));
  assert.equal(terra.spendUsd, (700 + 200 * 0.05 + 100 * 1.25 + 500 * 5) / 1e6);
  assert.equal(terra.pricing?.model, 'gpt-6.1-terra'); assert.equal(terra.spendSource, 'estimated');
});
test('reported costs win; incomplete, malformed, long-context and unpriced usage remain unknown', () => {
  assert.deepEqual(costForBulkResult({ ...result(), reportedCostUsd: 0.04 }), { spendUsd: 0.04, spendSource: 'reported', pricing: null });
  assert.deepEqual(costForBulkResponse('gpt-6-sol', { usage: { cost: 0.04 } }), { spendUsd: 0.04, spendSource: 'reported', pricing: null });
  assert.deepEqual(costForBulkResponse('gpt-6-sol', { usage: { cost: 0, prompt_tokens: 'unavailable' } }), { spendUsd: 0, spendSource: 'reported', pricing: null });
  for (const cost of [-1, '0.04', Infinity, NaN]) assert.equal(costForBulkResponse('gpt-6-sol', { usage: { cost } }).spendSource, 'unknown');
  for (const usage of [{ ...result().usage, inputTokens: null }, { ...result().usage, cachedInputTokens: 999 },
    { ...result().usage, inputTokens: 272001 }, { ...result().usage, outputTokens: -1 }]) assert.equal(costForBulkResult({ ...result(), usage }).spendSource, 'unknown');
  assert.equal(costForBulkResult(result('gpt-other')).spendSource, 'unknown');
  assert.equal(costForBulkResult({ ...result(), rawResponse: { service_tier: 'priority' } }).spendSource, 'unknown');
});
test('parses provider reset durations without treating malformed data as an immediate reset', () => {
  assert.equal(rateLimitDurationMs('1m2.5s'), 62500); assert.equal(rateLimitDurationMs('200ms'), 200);
  assert.equal(rateLimitDurationMs('garbage'), null); assert.equal(rateLimitDurationMs('2s garbage'), null);
});
test('rolling concurrency refills a finished slot without waiting for slow siblings', async () => {
  const releases: Array<() => void> = [], started: string[] = [];
  const dispatcher = createBulkDispatcher({ concurrency: 2, fetchImplementation: async (_input, init) => {
    started.push(JSON.parse(String(init?.body)).messages[1].content);
    await new Promise<void>(resolve => releases.push(resolve)); return response();
  } });
  const tasks = ['a', 'b', 'c'].map(userPrompt => dispatcher.adapter.run({ ...request, userPrompt }, config));
  await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(started, ['a', 'b']);
  releases[1]!(); await tasks[1]; await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(started, ['a', 'b', 'c']); assert.equal(dispatcher.stats().active, 2);
  releases[0]!(); releases[2]!(); await Promise.all(tasks); assert.equal(dispatcher.stats().active, 0);
});
test('limit probing sends one initial request then opens the configured concurrency after its response', async () => {
  const releases: Array<() => void> = [], started: string[] = [];
  const dispatcher = createBulkDispatcher({ concurrency: 3, probeLimits: true, fetchImplementation: async (_input, init) => {
    started.push(JSON.parse(String(init?.body)).messages[1].content);
    await new Promise<void>(resolve => releases.push(resolve));
    return response({ 'x-ratelimit-remaining-requests': '100', 'x-ratelimit-reset-requests': '1m',
      'x-ratelimit-remaining-tokens': '100000', 'x-ratelimit-reset-tokens': '1m' });
  } });
  const tasks = ['probe', 'a', 'b', 'c', 'd'].map(userPrompt => dispatcher.adapter.run({ ...request, userPrompt }, config));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(started, ['probe']); assert.equal(dispatcher.stats().active, 1); assert.equal(dispatcher.stats().queued, 4);
  releases[0]!(); await tasks[0]; await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(started, ['probe', 'a', 'b', 'c']); assert.equal(dispatcher.stats().active, 3);
  releases[2]!(); await tasks[2]; await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(started, ['probe', 'a', 'b', 'c', 'd']); assert.equal(dispatcher.stats().active, 3);
  releases[1]!(); releases[3]!(); releases[4]!(); await Promise.all(tasks);
  assert.deepEqual(dispatcher.stats(), { active: 0, queued: 0, attempts: 5, retries: 0 });
});
test('request and token remaining headers delay subsequent calls until reset', async () => {
  for (const bucket of ['requests', 'tokens']) {
    const started: number[] = [];
    const dispatcher = createBulkDispatcher({ concurrency: 1, fetchImplementation: async () => {
      started.push(Date.now()); return response({ [`x-ratelimit-remaining-${bucket}`]: '0', [`x-ratelimit-reset-${bucket}`]: '25ms' });
    } });
    await Promise.all([dispatcher.adapter.run(request, config), dispatcher.adapter.run(request, config)]);
    assert.ok(started[1]! - started[0]! >= 20, bucket);
  }
});
test('429 retry is bounded and retains attempt status; network unknown outcome is never retried', async () => {
  const retained: BulkAttempt[] = []; let calls = 0;
  const dispatcher = createBulkDispatcher({ concurrency: 1, maxRetries: 1, random: () => 0,
    onAttempt: attempt => { retained.push(attempt); }, fetchImplementation: async () => ++calls === 1
      ? new Response('{}', { status: 429, headers: { 'retry-after': '0.01' } }) : response() });
  await dispatcher.adapter.run(request, config); assert.equal(calls, 2);
  assert.equal(retained[0]!.error?.httpStatus, 429); assert.ok(retained[1]!.result);
  assert.equal(dispatcher.stats().retries, 1);
  let networkCalls = 0;
  const broken = createBulkDispatcher({ fetchImplementation: async () => { networkCalls++; throw new Error('transport uncertain'); } });
  await assert.rejects(broken.adapter.run(request, config)); assert.equal(networkCalls, 1);
});
test('failure to persist a successful response never repeats the paid request', async () => {
  let calls = 0;
  const dispatcher = createBulkDispatcher({ fetchImplementation: async () => { calls++; return response(); }, onAttempt: () => { throw new Error('disk full'); } });
  await assert.rejects(dispatcher.adapter.run(request, config), /disk full/); assert.equal(calls, 1);
});
test('raw 200 refusal or malformed body is retained before parsing with known response status', async () => {
  for (const payload of ['not JSON', JSON.stringify({ model: 'gpt-6-sol', usage: { prompt_tokens: 10, completion_tokens: 20 }, choices: [] })]) {
    const responses: BulkResponse[] = [], attempts: BulkAttempt[] = [];
    const dispatcher = createBulkDispatcher({ fetchImplementation: async () => new Response(payload),
      onResponse: value => { responses.push(value); }, onAttempt: value => { attempts.push(value); } });
    await assert.rejects(dispatcher.adapter.run(request, config));
    assert.equal(responses.length, 1); assert.equal(responses[0]!.responseStatus, 200);
    assert.equal(attempts[0]!.error?.httpStatus, 200); assert.equal(attempts[0]!.error?.outcomeUnknown, false);
    if (payload === 'not JSON') assert.equal(responses[0]!.body, payload);
    else assert.equal(costForBulkResponse(request.model, responses[0]!.body).spendUsd, 220 / 1e6);
  }
});
test('raw response persistence failure never retries even a retryable HTTP response', async () => {
  for (const status of [200, 429, 503]) {
    let calls = 0; const attempts: BulkAttempt[] = [];
    const dispatcher = createBulkDispatcher({ fetchImplementation: async () => { calls++; return new Response('{}', { status }); },
      onResponse: () => { throw new Error('response archive unavailable'); }, onAttempt: attempt => { attempts.push(attempt); } });
    await assert.rejects(dispatcher.adapter.run(request, config), /response archive unavailable/); assert.equal(calls, 1);
    assert.equal(attempts[0]!.error?.outcomeUnknown, true, 'resume must not repeat an unarchived response');
  }
});
test('raw usage accounting rejects malformed token categories without requiring valid choices', () => {
  assert.equal(costForBulkResponse('gpt-6-astra', { usage: { prompt_tokens: 100, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 20 } } }).spendUsd, 3320 / 1e6);
  assert.equal(costForBulkResponse('gpt-6-sol', { usage: { prompt_tokens: 10, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 'bad' } } }).spendSource, 'unknown');
  assert.equal(costForBulkResponse('gpt-6-sol', 'not JSON').spendSource, 'unknown');
});
test('result accounting recovers adapter-omitted cache writes from raw usage and rejects malformed counts', () => {
  const base = result();
  const retained = { ...base, usage: { ...base.usage, cacheWriteInputTokens: null }, rawResponse: { usage: { prompt_tokens_details: { cache_write_tokens: 100 } } } };
  assert.deepEqual(costForBulkResult(retained), costForBulkResult(base));
  assert.equal(costForBulkResult({ ...retained, rawResponse: { usage: { prompt_tokens_details: { cache_write_tokens: '100' } } } }).spendSource, 'unknown');
  assert.equal(costForBulkResult({ ...retained, rawResponse: { usage: { prompt_tokens_details: { cache_write_tokens: -1 } } } }).spendSource, 'unknown');
});
test('each transport retry durably starts with a unique identity shared by response and completion', async () => {
  const starts: BulkStart[] = [], responses: BulkResponse[] = [], attempts: BulkAttempt[] = [];
  let calls = 0;
  const dispatcher = createBulkDispatcher({ random: () => 0, maxRetries: 1,
    onStart: start => { starts.push(start); }, onResponse: response => { responses.push(response); }, onAttempt: attempt => { attempts.push(attempt); },
    fetchImplementation: async () => { calls++; assert.equal(starts.length, calls); return calls === 1 ? new Response('{}', { status: 429 }) : response(); } });
  await dispatcher.adapter.run(request, config);
  assert.equal(starts.length, 2); assert.notEqual(starts[0]!.attemptId, starts[1]!.attemptId);
  assert.deepEqual(responses.map(item => item.attemptId), starts.map(item => item.attemptId));
  assert.deepEqual(attempts.map(item => item.attemptId), starts.map(item => item.attemptId));
  assert.deepEqual(responses.map(item => item.startedAt), starts.map(item => item.startedAt));
});
test('start persistence failure prevents transport and retry while releasing the concurrency slot', async () => {
  let starts = 0, calls = 0, completions = 0;
  const dispatcher = createBulkDispatcher({ concurrency: 1,
    onStart: () => { if (++starts === 1) throw new Error('start archive unavailable'); }, onAttempt: () => { completions++; },
    fetchImplementation: async () => { calls++; return response(); } });
  const failed = dispatcher.adapter.run(request, config), next = dispatcher.adapter.run({ ...request, userPrompt: 'second' }, config);
  await assert.rejects(failed, /start archive unavailable/); await next;
  assert.equal(starts, 2); assert.equal(calls, 1); assert.equal(completions, 1);
  assert.deepEqual(dispatcher.stats(), { active: 0, queued: 0, attempts: 1, retries: 0 });
});
