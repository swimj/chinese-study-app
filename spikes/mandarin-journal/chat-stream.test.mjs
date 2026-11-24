import assert from 'node:assert/strict';
import test from 'node:test';
import { readChatStream } from './public/chat-stream.js';

test('split UTF-8 and line boundaries preserve Mandarin while rendering before commit', async () => {
  let controller;
  const response = new Response(new ReadableStream({ start(stream) { controller = stream; } }));
  const encoder = new TextEncoder();
  const line = encoder.encode(JSON.stringify({ type: 'delta', text: '麻雀🐦' }) + '\n');
  const first = Promise.withResolvers();
  const state = { threads: [] };
  const result = readChatStream(response, first.resolve);
  for (const byte of line) controller.enqueue(Uint8Array.of(byte));
  assert.equal(await first.promise, '麻雀🐦');
  controller.enqueue(encoder.encode(JSON.stringify({ type: 'done', state }) + '\n'));
  assert.deepEqual(await result, state);
});

test('interrupted, failed and receipt-only turns have distinct outcomes', async () => {
  const delta = '{"type":"delta","text":"先"}\n';
  const seen = [];
  await assert.rejects(readChatStream(new Response(delta), text => seen.push(text)), /interrupted/);
  assert.deepEqual(seen, ['先']);
  const failure = new Response(delta + '{"type":"error","status":409,"error":"Conversation changed."}\n');
  await assert.rejects(readChatStream(failure, () => {}), { status: 409, message: 'Conversation changed.' });
  const replay = new Response('{"type":"done","state":{"threads":[]}}\n');
  assert.deepEqual(await readChatStream(replay, () => assert.fail('unexpected delta')), { threads: [] });
});
