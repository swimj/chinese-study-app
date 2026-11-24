import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createActivity } from './activity.ts';

process.env.OPENAI_API_KEY = 'offline-test';
process.env.OPENAI_BASE_URL = 'http://127.0.0.1:1/v1';
process.env.OPENAI_AGENTS_DISABLE_TRACING = '1';
process.env.LOOKUP_FAST_PROVIDER = 'openrouter';
process.env.OPENROUTER_API_KEY = 'offline-router-test';

const { tutorTurn, friendTurn } = await import('./tutor.ts');
const { runReaderModel } = await import('./reader-model.ts');
const input = {
  trigger: 'ask', message: 'private request content', source: '', surface: 'home',
  saved: [], tutorHistory: [], chatHistory: [],
};

function fixture(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  return createActivity(db);
}
function completed(output, tokens) {
  return {
    id: 'r' + tokens, object: 'response', model: 'gpt-5.4-mini-2026-03-17', status: 'completed',
    output, usage: { input_tokens: tokens, output_tokens: 10, input_tokens_details: { cached_tokens: 3 } },
  };
}
function message(text) {
  return { type: 'message', role: 'assistant', id: 'm1', status: 'completed',
    content: [{ type: 'output_text', text, annotations: [] }] };
}
function trace(store) {
  return store.trace(store.report(24).actions[0].id).spans;
}

test('one retry and a recall round trip retain each HTTP attempt and the tool dependencies', async t => {
  const store = fixture(t);
  const responses = [
    Response.json({ error: { message: 'transient private detail' } }, { status: 429, headers: { 'retry-after-ms': '1' } }),
    Response.json(completed([{ type: 'function_call', call_id: 'call_fixture', id: 'f1', name: 'recall',
      arguments: JSON.stringify({ query: 'private lookup', from: 'saved' }), status: 'completed' }], 100)),
    Response.json(completed([message(JSON.stringify({ reply: 'private tutor reply', action: null }))], 240)),
  ];
  t.mock.method(globalThis, 'fetch', async () => {
    const response = responses.shift();
    assert.ok(response, 'unexpected provider request');
    return response;
  });
  await store.action('Ask', 'action-1', () => tutorTurn(input));
  const spans = trace(store);
  assert.deepEqual(spans.map(s => s.kind), ['run', 'model', 'model', 'tool', 'model']);
  const [run, retry, first, tool, second] = spans;
  assert.ok(spans.slice(1).every(s => s.parentId === run.id && s.finishedAt));
  assert.equal(retry.outcome, 'HTTP 429');
  assert.equal(retry.inputTokens, null);
  assert.equal(retry.costUsd, null);
  assert.equal(first.inputTokens, 100);
  assert.equal(first.model, 'gpt-5.4-mini-2026-03-17');
  assert.equal(second.inputTokens, 240);
  assert.equal(second.cachedTokens, 3);
  assert.deepEqual(first.dependsOn, [retry.id]);
  assert.deepEqual(tool.dependsOn, [first.id]);
  assert.equal(tool.reference, 'call_fixture');
  assert.deepEqual(second.dependsOn, [tool.id]);
  assert.doesNotMatch(JSON.stringify(spans), /private/);
});

test('SDK tool validation errors link the producing request to the recovery request', async t => {
  const store = fixture(t);
  // Exercise both the tool schema and the SDK's separate malformed JSON path.
  const args = ['{"query":"private lookup","from":"unknown"}', '{"query":'];
  for (const [index, invalidArgs] of args.entries()) {
    const callId = 'invalid_' + index;
    const responses = [
      completed([{ type: 'function_call', call_id: callId, id: 'f1', name: 'recall',
        arguments: invalidArgs, status: 'completed' }], 100),
      completed([message(JSON.stringify({ reply: 'Recovered', action: null }))], 240),
    ];
    const requests = [];
    const fetch = t.mock.method(globalThis, 'fetch', async (_url, init) => {
      requests.push(JSON.parse(init.body));
      return Response.json(responses.shift());
    });
    const answer = await store.action('Ask', callId, () => tutorTurn(input));
    fetch.mock.restore();
    assert.equal(answer.reply, 'Recovered');
    assert.ok(requests[1].input.some(item => item.type === 'function_call_output' && item.call_id === callId));
    const spans = trace(store);
    assert.deepEqual(spans.map(s => s.kind), ['run', 'model', 'tool', 'model']);
    const [run, first, tool, second] = spans;
    assert.equal(tool.parentId, run.id);
    assert.equal(tool.label, 'recall');
    assert.equal(tool.reference, callId);
    assert.equal(tool.outcome, 'Rejected before execution');
    assert.deepEqual(tool.dependsOn, [first.id]);
    assert.deepEqual(second.dependsOn, [tool.id]);
    assert.doesNotMatch(JSON.stringify(spans), /private/);
  }
});

test('a failed usage write cannot cause the SDK to retry a completed billable request', async t => {
  const store = fixture(t);
  store.db.exec("CREATE TRIGGER reject_usage BEFORE UPDATE OF costUsd ON activity_spans BEGIN SELECT RAISE(FAIL, 'broken meter'); END;");
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json(
    completed([message(JSON.stringify({ reply: 'Completed', action: null }))], 42),
  ));
  const answer = await store.action('Ask', 'meter-broken', () => tutorTurn(input));
  assert.equal(answer.reply, 'Completed');
  assert.equal(fetch.mock.callCount(), 1);
});

test('streamed chat displays deltas and meters its terminal response once', async t => {
  const store = fixture(t);
  const terminal = completed([message('你好。')], 50);
  const events = [
    { type: 'response.output_text.delta', delta: '你好。', item_id: 'm1', output_index: 0 },
    { type: 'response.completed', response: terminal },
  ];
  t.mock.method(globalThis, 'fetch', async () => new Response(
    events.map(event => 'data: ' + JSON.stringify(event) + '\n\n').join(''), { headers: { 'content-type': 'text/event-stream' } },
  ));
  const deltas = [];
  const answer = await store.action('Chat', 'chat-1', () => friendTurn(input, delta => deltas.push(delta)));
  assert.equal(answer, '你好。');
  assert.deepEqual(deltas, ['你好。']);
  const calls = store.report(24).calls;
  assert.equal(calls.length, 1);
  assert.equal(calls[0].inputTokens, 50);
  assert.equal(calls[0].outcome, 'ok');
});

test('reader records provider-reported cost even when the application rejects the answer', async t => {
  const store = fixture(t);
  t.mock.method(globalThis, 'fetch', async () => Response.json({
    model: 'reader-fixture', usage: { prompt_tokens: 35, completion_tokens: 4, cost: 0.002 },
    choices: [{ finish_reason: 'stop', message: { content: 'private invalid answer' } }],
  }));
  await assert.rejects(store.action('Lookup', 'tap-1', () => runReaderModel('fast', {
    prompt: 'private instructions', message: input.message,
    format: { name: 'reader_sense', strict: true, schema: {} }, parse: JSON.parse, maxTokens: 100,
  })));
  const [call] = store.report(24).calls;
  assert.equal(call.label, 'Sense selection');
  assert.equal(call.provider, 'openrouter');
  assert.equal(call.model, 'reader-fixture');
  assert.equal(call.inputTokens, 35);
  assert.equal(call.costUsd, 0.002);
  assert.equal(call.costSource, 'reported');
  assert.equal(call.outcome, 'Invalid response');
  assert.doesNotMatch(JSON.stringify(call), /private/);
});

test('failed and interrupted chat streams close their attempt, preserving any terminal usage', async t => {
  const store = fixture(t);
  const failed = { ...completed([], 22), status: 'failed', error: { code: 'server_error', message: 'fixture failure' } };
  const streams = [
    'data: ' + JSON.stringify({ type: 'response.failed', response: failed }) + '\n\n',
    'data: ' + JSON.stringify({ type: 'response.output_text.delta', item_id: 'm1', output_index: 0, delta: '你' }) + '\n\n',
  ];
  t.mock.method(globalThis, 'fetch', async () => new Response(streams.shift(), { headers: { 'content-type': 'text/event-stream' } }));
  for (const reference of ['failed', 'interrupted']) {
    await assert.rejects(store.action('Chat', reference, () => friendTurn(input, () => {})));
  }
  const [interrupted, terminal] = store.report(24).calls;
  assert.ok(interrupted.finishedAt && terminal.finishedAt);
  assert.equal(interrupted.inputTokens, null);
  assert.equal(interrupted.outcome, 'error');
  assert.equal(terminal.inputTokens, 22);
  assert.equal(terminal.outcome, 'failed');
});
