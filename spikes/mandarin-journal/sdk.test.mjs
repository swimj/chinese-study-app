import assert from 'node:assert/strict';
import test from 'node:test';
test('real SDK uses recall, validates the exercise contract and isolates casual chat', async () => {
  process.env.OPENAI_API_KEY = 'placeholder';
  process.env.OPENAI_BASE_URL = 'http://127.0.0.1:1/v1';
  process.env.OPENAI_AGENTS_DISABLE_TRACING = '1';
  const requests = [];
  let replies = [];
  const plain = (text) => ({
    type: 'message',
    role: 'assistant',
    status: 'completed',
    id: 'msg_1',
    content: [{ type: 'output_text', annotations: [], text }],
  });
  const structured = (output) => plain(JSON.stringify(output));
  globalThis.fetch = async (url, options) => {
    assert.match(String(url), /^http:\/\/127\.0\.0\.1:1\/v1\/responses$/);
    const req = JSON.parse(options.body);
    requests.push(req);
    assert.equal(req.store, false);
    const out = replies.shift();
    assert(out, 'unexpected model turn');
    return new Response(
      JSON.stringify({
        id: 'resp_' + requests.length,
        object: 'response',
        status: 'completed',
        output: [out],
        usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 },
      }),
      { headers: { 'content-type': 'application/json' } },
    );
  };
  const { tutorTurn, friendTurn } = await import('./tutor.ts');
  const input = {
    trigger: 'ask',
    message: 'fixture',
    surface: 'read',
    source: 'example',
    tutorHistory: [],
    chatHistory: [],
    saved: [],
    learning: [{ text: 'sample observation', source: 'from a page' }],
  };
  replies = [
    {
      type: 'function_call',
      call_id: 'call_1',
      id: 'fc_1',
      name: 'recall',
      arguments: JSON.stringify({ query: 'sample', from: 'learning' }),
      status: 'completed',
    },
    structured({ reply: 'One reply.', action: null }),
  ];
  assert.deepEqual(await tutorTurn(input), { reply: 'One reply.', action: null });
  assert.equal(requests[0].text.format.type, 'json_schema');
  assert.match(JSON.stringify(requests[1].input), /sample observation/);
  replies = [structured({ reply: '', action: null })];
  assert.deepEqual(await tutorTurn({ ...input, trigger: 'miss' }), { reply: '', action: null });
  replies = [
    structured({
      reply: 'Try this.',
      action: {
        kind: 'practice',
        title: 'Distinction',
        detail: 'Example.',
        exercise: {
          kind: 'choice',
          choices: ['词一', '词二'],
          prompt: '测试',
          answer: '词三',
          explanation: 'Example.',
        },
      },
    }),
  ];
  await assert.rejects(tutorTurn({ ...input, trigger: 'practice' }), /invalid contrast/);
  replies = [plain('嗯。')];
  assert.equal(await friendTurn(input), '嗯。');
  assert(!JSON.stringify(requests.at(-1)).includes('sample observation'));
  assert(!requests.at(-1).tools?.length);
});
