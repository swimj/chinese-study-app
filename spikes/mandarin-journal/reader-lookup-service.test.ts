import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createLookupService } from './reader-lookup-service.ts';
import { LookupModelError, type Trace } from './reader-model.ts';
import type { LookupInput } from './reader-dictionary.ts';

const dictionaryPath = fileURLToPath(new URL('./lookup-experiment/reader-dictionary.sample.u8', import.meta.url));
const offline = { dictionaryPath, selectorEnabled: false, contextEnabled: false };
function target(kind: LookupInput['kind'], marked: string): LookupInput {
  const [before, focus, after] = marked.split(/[【】]/);
  return { kind, text: before + focus + after, start: before.length, end: before.length + focus.length };
}
const selectorTrace: Trace = { provider: 'openrouter', model: 'selector-test', request: {
  messages: [{ role: 'system', content: 'selector instructions' }],
}, raw: { usage: { prompt_tokens: 30, completion_tokens: 4, cost: 0.0001 } }, elapsedMs: 21 };
const contextTrace: Trace = { provider: 'openai', model: 'context-test', request: { instructions: 'context instructions' },
  raw: { usage: { input_tokens: 60, output_tokens: 15 } }, elapsedMs: 127 };

test('a single agreed sense uses a curated label, while a clear uncatalogued tool has its dictionary reminder', async () => {
  const reader = createLookupService(offline);
  const kiosk = await reader.lookup(target('tap', '河边有座报【刊】亭。'));
  assert.equal(kiosk.route, 'catalog');
  assert.deepEqual(kiosk.answer, { span: '报刊亭', pinyin: 'bàokāntíng', gloss: 'newsstand' });
  assert.equal(kiosk.evidence.selectedSenseId, 'stand');
  assert.deepEqual(kiosk.evidence.calls, []);
  const tool = await reader.lookup(target('tap', '箱里有螺【丝】刀。'));
  assert.equal(tool.route, 'dictionary');
  assert.equal(tool.answer?.gloss, 'screwdriver');
  assert.equal(tool.evidence.dictionarySha256.length, 64);
});

test('polyphony uses the pointed occurrence, stores the actual candidates and traces the decision', async () => {
  const input = target('selection', '借的伞还没【还】。');
  const reader = createLookupService({ ...offline, selectorEnabled: true,
    async select(occ, choices, handlers) {
      assert.equal(occ.start, input.start);
      handlers?.onTrace?.(selectorTrace);
      return choices.find(c => c.senseId === 'return') ?? null;
    },
  });
  const lookup = await reader.lookup(input);
  assert.equal(lookup.route, 'selector');
  assert.deepEqual(lookup.answer, { span: '还', pinyin: 'huán', gloss: 'give something back' });
  assert.equal(lookup.start, input.start);
  assert.equal(lookup.evidence.candidates.length, 3);
  assert.equal(lookup.evidence.selectedSenseId, 'return');
  const [call] = lookup.evidence.calls;
  assert.equal(call.promptSha256.length, 64);
  assert.equal(call.elapsedMs, 21);
  assert.equal(call.outcome, 'selected');
  assert.equal(call.costUsd, 0.0001);
  assert.ok(!('request' in call) && !('raw' in call));
});

test('abstention and provider failure each keep original context and lead to one strong call', async () => {
  const input = target('tap', '先还有两把，后来【还】剩一把。');
  for (const fails of [false, true]) {
    const reader = createLookupService({ ...offline, selectorEnabled: true, contextEnabled: true,
      async select(_occ, _choices, handlers) {
        if (fails) throw new LookupModelError('openrouter lookup returned HTTP 503', selectorTrace);
        handlers?.onTrace?.(selectorTrace);
        return null;
      },
      async context(arm, received) {
        assert.equal(arm, 'strong');
        assert.deepEqual(received, { ...input, kind: 'selection' });
        return { ...contextTrace, answer: { span: '还', pinyin: 'hái', gloss: 'still (remaining)', chunks: [] } };
      },
    });
    const answer = await reader.lookup(input);
    assert.equal(answer.route, 'context');
    assert.equal(answer.start, input.start);
    assert.equal(answer.end, input.end);
    assert.deepEqual(answer.evidence.calls.map(c => c.outcome), [fails ? 'error' : 'abstained', 'answered']);
    assert.equal(answer.evidence.selectedSenseId, null);
  }
});

test('unknown exact snippets preserve the deliberate selection in the strong path', async () => {
  const input = target('selection', '我们研【究生】命的起源。');
  const answer = await createLookupService({ ...offline, contextEnabled: true,
    async context(_arm, received) {
      assert.equal(received.kind, 'selection');
      return { ...contextTrace, answer: {
        span: '究生', pinyin: 'jiū shēng', gloss: 'The selection straddles 研究 and 生命.', chunks: [],
      } };
    },
  }).lookup(input);
  assert.equal(answer.route, 'context');
  assert.deepEqual([answer.start, answer.end], [input.start, input.end]);
});

test('offline and failed lookups distinguish curated occurrence fallback from uncovered text', async () => {
  const reader = createLookupService(offline);
  const source = { documentId: 'after-the-show', blockId: 'street' };
  const input = target('tap', '听着【听】着，也跟着唱了起来。');
  assert.equal((await reader.lookup(input)).answer, null);
  const authored = await reader.lookup(input, source);
  assert.equal(authored.route, 'authored');
  assert.equal(authored.answer?.span, '听着听着');
  const character = await reader.lookup(target('selection', '听着【听】着，也跟着唱了起来。'), source);
  assert.equal(character.answer?.span, '听');
  assert.equal(character.start, 2);
  const failed = await createLookupService({ ...offline, contextEnabled: true, async context() {
    throw new LookupModelError('openai lookup returned HTTP 429', contextTrace);
  } }).lookup(target('selection', '晚风吹过【树梢】。'));
  assert.equal(failed.route, 'unavailable');
  assert.equal(failed.evidence.calls[0].error, 'openai lookup returned HTTP 429');
});
