import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ChatProvider, ChatProviderRequest } from '../server/llm/chat-types.ts';
import { runChatToolLoop, type ChatLoopEvent } from '../server/chat/tool-loop.ts';

const config = { apiKey: 'secret', baseUrl: null };
const request: ChatProviderRequest = { model: 'fixture', messages: [{ role: 'user', content: '你好' }], tools: [],
  maxOutputTokens: 200, timeoutMs: 5000, reasoningEffort: null, provenance: {} };
const schema = { type: 'object', properties: { word: { type: 'string' } }, required: ['word'], additionalProperties: false };
function scripted(messages: Array<{ content: string; toolCalls: Array<{ id: string; name: string; arguments: string }> }>, seen: ChatProviderRequest[] = []): ChatProvider {
  return { async stream(input) {
    seen.push(structuredClone(input));
    const message = messages.shift(); assert.ok(message, 'unexpected provider iteration');
    return { message: { role: 'assistant', ...message }, invocationId: null, responseId: null, usage: null };
  } };
}
const call = (id: string, name: string, value: unknown) => ({ id, name, arguments: JSON.stringify(value) });
test('bounded loop carries tool results and validates before async card presentation', async () => {
  const events: ChatLoopEvent[] = [], seen: ChatProviderRequest[] = [];
  const messages = await runChatToolLoop({ provider: scripted([
    { content: '', toolCalls: [call('a', 'lookup', { word: '绵长' })] },
    { content: 'Here it is', toolCalls: [call('b', 'present', { word: '绵长' })] },
  ], seen), config, request,
  reads: [{ name: 'lookup', description: '', parameters: schema, execute: async () => ({ id: 'word1' }) }],
  output: { name: 'present', description: '', parameters: schema, present: async () => { await Promise.resolve(); return { state: 'added' }; } },
  onEvent: event => { events.push(event); } });
  assert.equal(seen.length, 2);
  assert.ok(seen.every(request => request.toolChoice === 'required'));
  assert.deepEqual(events.filter(event => event.kind === 'progress').map(event => event.stage), ['checking','looking_up','preparing_reply']);
  assert.deepEqual(messages.at(-1), { role: 'tool', toolCallId: 'b', content: '{"state":"added"}' });
  assert.deepEqual(seen[1]?.messages.at(-1), { role: 'tool', toolCallId: 'a', content: '{"id":"word1"}' });
  assert.deepEqual(events.at(-1), { kind: 'completion', result: { state: 'added' } });
});
test('unknown, malformed, mixed output, and repeated call IDs never perform card writes', async () => {
  for (const calls of [[call('x', 'missing', {})], [call('x', 'present', { wrong: true })],
    [call('x', 'present', { word: 'word' }), call('y', 'lookup', { word: 'word' })],
    [call('x', 'lookup', { word: 'word' }), call('x', 'lookup', { word: 'word' })]]) {
    await assert.rejects(runChatToolLoop({ provider: scripted([{ content: '', toolCalls: calls }]), config, request,
      reads: [{ name: 'lookup', description: '', parameters: schema, execute: async () => assert.fail('invalid batch executed') }],
      output: { name: 'present', description: '', parameters: schema, present: async () => assert.fail('invalid card presented') }, onEvent: () => undefined }));
  }
});
test('iteration limit terminates a read-only model loop', async () => {
  await assert.rejects(runChatToolLoop({ provider: scripted([{ content: '', toolCalls: [call('x', 'lookup', { word: 'word' })] }]), config, request,
    maxIterations: 1, reads: [{ name: 'lookup', description: '', parameters: schema, execute: async () => ({}) }],
    output: { name: 'present', description: '', parameters: schema, present: async () => ({}) }, onEvent: () => undefined }), /iteration limit/);
});

test('free-form prose cannot complete a turn or leak as learner text', async () => {
  const events: ChatLoopEvent[] = [];
  await assert.rejects(runChatToolLoop({ provider: { async stream(_request, _config, onText) {
    await onText('I added it.');
    return { invocationId:null,responseId:null,usage:null,message:{role:'assistant',content:'I added it.',toolCalls:[]} };
  } }, config, request, reads: [],
  output:{name:'complete_turn',description:'',parameters:schema,present:async()=>assert.fail('unvalidated write')},
  onEvent:event=>{events.push(event);}, }), /explicit completion/);
  assert.ok(!events.some(event=>event.kind==='completion'));
  assert.deepEqual(events.map(event=>event.kind),['progress','assistant']);
});
