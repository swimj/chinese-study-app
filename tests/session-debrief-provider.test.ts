import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createSessionDebriefProvider, estimateDebriefCost, SessionDebriefProviderError } from '../server/session-debrief/provider.ts';
import { validateDebriefInventory, validateSessionDebriefResult, type SessionDebriefInput } from '../src/domain/session-debrief.ts';

const input: SessionDebriefInput = { schemaVersion: 'session_debrief_input.v1', sessionDate: '2026-10-06T01:00:00.000Z',
  interests: [], items: [{ ref: 'w1', word: '学问', pinyin: 'xué wèn' }] };
const result = { notes: [{ text: '学问 opens a connection.', refs: ['w1'], followUp: null }] };
function provider(text = JSON.stringify(result), finish = 'stop') {
  let request: Record<string, unknown> | null = null;
  return { get request() { return request; }, instance: createSessionDebriefProvider({ environment: { OPENAI_API_KEY: 'fake' },
    fetchImplementation: async (_url, options) => {
      request = JSON.parse(String(options?.body));
      return new Response(JSON.stringify({ id: 'response-1', model: 'gpt-6.1-sol', choices: [{ message: { content: text }, finish_reason: finish }],
        usage: { prompt_tokens: 1000, completion_tokens: 100, prompt_tokens_details: { cached_tokens: 200, cache_write_tokens: 100 }, completion_tokens_details: { reasoning_tokens: 25 } } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } });
    } }) };
}
test('approved v6 prompt is byte-identical and provider uses the pinned low arm and minimal inventory', async () => {
  const prompt = readFileSync(new URL('../server/session-debrief/prompts/debrief-v6.txt', import.meta.url));
  assert.equal(createHash('sha256').update(prompt).digest('hex'), '9dae8b2607ffea9dfd2ff5f060a166a9fee54733040c774161259dcf72317609');
  const stub = provider();
  const generated = await stub.instance.generate(input, 'attempt-1');
  assert.deepEqual(generated.result, result);
  const request = stub.request!;
  assert.equal(request.model, 'gpt-6.1-sol'); assert.equal(request.reasoning_effort, 'low'); assert.equal(request.max_completion_tokens, 4096);
  const messages = request.messages as Array<{ content: string }>;
  assert.equal(messages[0].content, prompt.toString());
  assert.deepEqual(JSON.parse(messages[1].content), { sessionDate: input.sessionDate, interests: [], items: input.items });
  assert.equal(generated.metadata.usage.cacheWriteInputTokens, 100);
  assert.equal(generated.metadata.usage.reasoningTokens, 25);
  assert.equal(generated.metadata.estimatedCostUsd, 0.00267);
});
test('price estimate charges cache writes once and rejects impossible categories or unavailable usage', () => {
  const usage = { inputTokens: 1000, cachedInputTokens: 200, cacheWriteInputTokens: 100, outputTokens: 100, reasoningTokens: 25, totalTokens: 1100 };
  assert.equal(estimateDebriefCost(usage), (700 * 2 + 200 * .1 + 100 * 2.5 + 100 * 10) / 1e6);
  assert.equal(estimateDebriefCost({ ...usage, cachedInputTokens: 1000 }), null);
  assert.equal(estimateDebriefCost({ ...usage, inputTokens: null }), null);
  assert.equal(estimateDebriefCost({ ...usage, inputTokens: 272001 }), null);
  assert.equal(estimateDebriefCost({ ...usage, outputTokens: -10 }), null);
  assert.equal(estimateDebriefCost({ ...usage, cacheWriteInputTokens: null }), (800 * 2 + 200 * .1 + 100 * 10) / 1e6);
});
test('empty results succeed; malformed, unknown refs and truncated results retain response usage in typed errors', async () => {
  assert.deepEqual((await provider('{"notes":[]}').instance.generate(input, 'empty')).result, { notes: [] });
  for (const [text, finish, code] of [
    ['not JSON', 'stop', 'invalid_json'], [JSON.stringify({ notes: [{ ...result.notes[0], refs: ['unknown'] }] }), 'stop', 'invalid_result'],
    [JSON.stringify(result), 'length', 'output_truncated'],
  ]) await assert.rejects(provider(text, finish).instance.generate(input, code), (error: unknown) => {
    assert.ok(error instanceof SessionDebriefProviderError); assert.equal(error.code, code); assert.equal(error.metadata?.responseId, 'response-1');
    assert.equal(error.metadata?.usage.inputTokens, 1000); return true;
  });
  await assert.rejects(createSessionDebriefProvider({ environment: {} }).generate(input, 'missing'), /not configured/);
});
test('inventory bounds and result references fail loudly without rewriting exact encounter strings', () => {
  const exact = [{ word: '  学问 / 学识  ', pinyin: 'xué wèn / xué shí' }];
  validateDebriefInventory([{ word: 'word with no pronunciation', pinyin: '' }]);
  // One cue can contain many frozen alternatives. Optional debrief metadata
  // must not prevent completion merely because that exact answer set is long.
  validateDebriefInventory([{ word: Array(80).fill('学问 / 学识').join(' / '), pinyin: '' }]);
  validateDebriefInventory([{ word: '学问', pinyin: 'xué wèn / '.repeat(50) }]);
  for (const count of [999, 1000]) validateDebriefInventory(Array(count).fill(exact[0]));
  validateDebriefInventory(exact); assert.equal(exact[0].word, '  学问 / 学识  ');
  for (const invalid of [null, [{ word: '学问', pinyin: null }], [{ word: '学问', pinyin: 'xué wèn', extra: 'ignored?' }], Array(1001).fill(exact[0])]) {
    assert.throws(() => validateDebriefInventory(invalid));
  }
  assert.throws(() => validateSessionDebriefResult({ notes: Array(4).fill(result.notes[0]) }, input));
  assert.throws(() => validateSessionDebriefResult({ notes: [{ ...result.notes[0], refs: ['w1', 'w1'] }] }, input));
});
