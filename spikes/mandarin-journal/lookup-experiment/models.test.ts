import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { LookupModelError, lookupPrompt, modelIds, runModel, type LookupInput } from './models.ts';

const tap: LookupInput = { kind: 'tap', text: '快走，后来他走进了车站。', start: 6, end: 7 };
const selection: LookupInput = { ...tap, kind: 'selection', end: 9 };
const answer = { span: '走进', pinyin: 'zǒujìn', gloss: 'walk into', chunks: [] };
function responseFor(answerText: string) {
  return { status: 'completed', output: [{ type: 'reasoning' }, {
    type: 'message', content: [{ type: 'output_text', text: answerText }],
  }] };
}

function withProvider(t: TestContext, body: unknown, status = 200) {
  const secret = 'dummy-lookup-key-for-tests';
  for (const name of ['OPENAI_API_KEY', 'OPENROUTER_API_KEY']) {
    const previous = process.env[name];
    process.env[name] = secret;
    t.after(() => { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; });
  }
  return t.mock.method(globalThis, 'fetch', async () => Response.json(body, { status }));
}

test('the contextual lookup marks the occurrence and retains reproducible, credential-free evidence', async (t) => {
  const raw = responseFor(JSON.stringify(answer));
  const fetch = withProvider(t, raw);
  const result = await runModel('strong', tap, '走');
  assert.deepEqual(result.answer, answer);
  assert.deepEqual(result.raw, raw);
  assert.equal(result.model, modelIds.strong);
  assert.equal(result.provider, 'openai');
  assert.ok(result.elapsedMs >= 0);
  const [url, init] = fetch.mock.calls[0].arguments;
  assert.equal(url, 'https://api.openai.com/v1/responses');
  assert.deepEqual(JSON.parse(String(init?.body)), result.request);
  assert.equal(result.request.instructions, lookupPrompt);
  assert.deepEqual(JSON.parse(String(result.request.input)), {
    kind: 'tap', before: '快走，后来他', focus: '走', after: '进了车站。', suggestedSpan: '走',
  });
  assert.doesNotMatch(JSON.stringify(result), /dummy-lookup-key/);
});

test('fast arm accepts its configured provider and keeps exact selected text with optional internal groups', async (t) => {
  const expected = { ...answer, span: '走进了', chunks: ['走进', '了'] };
  const output = JSON.stringify(expected);
  const direct = process.env.LOOKUP_FAST_PROVIDER === 'openai';
  const raw = direct ? responseFor(output) : { choices: [{ finish_reason: 'stop', message: { content: output } }] };
  const fetch = withProvider(t, raw);
  const result = await runModel('fast', selection);
  assert.deepEqual(result.answer, expected);
  assert.equal(result.model, modelIds.fast);
  assert.equal(result.provider, direct ? 'openai' : 'openrouter');
  assert.equal(fetch.mock.callCount(), 1);
  if (!direct) {
    assert.equal(fetch.mock.calls[0].arguments[0], 'https://openrouter.ai/api/v1/chat/completions');
    assert.deepEqual(result.request.provider, { sort: 'latency', require_parameters: true });
    const messages = result.request.messages as { role: string; content: string }[];
    assert.equal(messages[0].content, lookupPrompt);
    assert.equal(JSON.parse(messages[1].content).focus, '走进了');
  }
});

test('rejects an unattached dictionary hit, an edited selection, and non-partitioning chunks', async (t) => {
  for (const [input, invalid, reason] of [
    [tap, { ...answer, span: '快走' }, 'pointed occurrence'],
    [selection, answer, 'selected span'],
    [tap, { ...answer, chunks: ['进', '走'] }, 'reconstruct'],
    [tap, { ...answer, pinyin: ' ' }, 'empty'],
  ] as const) {
    const raw = responseFor(JSON.stringify(invalid));
    const fetch = withProvider(t, raw);
    await assert.rejects(runModel('strong', input), (error: unknown) => {
      assert.ok(error instanceof LookupModelError);
      assert.match(error.message, new RegExp(reason));
      assert.deepEqual(error.raw, raw);
      return true;
    });
    fetch.mock.restore();
  }
});

test('incomplete, refused, and malformed responses retain evidence and prompt no retry', async (t) => {
  for (const raw of [
    { ...responseFor(JSON.stringify(answer)), status: 'incomplete' },
    { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'declined' }] }] },
    responseFor('invalid data'),
  ]) {
    const fetch = withProvider(t, raw);
    await assert.rejects(runModel('strong', tap), (error: unknown) => {
      assert.ok(error instanceof LookupModelError);
      assert.deepEqual(error.raw, raw);
      return true;
    });
    assert.equal(fetch.mock.callCount(), 1);
    fetch.mock.restore();
  }
});

test('rejects split surrogate pairs before transport and accepts whole supplementary-plane characters', async (t) => {
  const input: LookupInput = { kind: 'tap', text: '读𠮷字', start: 1, end: 2 };
  const fetch = withProvider(t, responseFor(JSON.stringify({ ...answer, span: '𠮷' })));
  await assert.rejects(runModel('strong', input), /exactly one/);
  assert.equal(fetch.mock.callCount(), 0);
  assert.equal((await runModel('strong', { ...input, end: 3 })).answer.span, '𠮷');
});

test('provider errors keep the failed request and redact an echoed credential', async (t) => {
  const fetch = withProvider(t, { error: 'Invalid key: dummy-lookup-key-for-tests' }, 401);
  await assert.rejects(runModel('strong', tap), (error: unknown) => {
    assert.ok(error instanceof LookupModelError);
    assert.match(error.message, /HTTP 401/);
    assert.deepEqual(error.raw, { error: 'Invalid key: [redacted]' });
    assert.equal(error.request.instructions, lookupPrompt);
    return true;
  });
  assert.equal(fetch.mock.callCount(), 1);
});
