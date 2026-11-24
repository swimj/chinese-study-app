import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createActivity } from './activity.ts';
import { createReaderCatalog } from './reader-catalog.ts';
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

test('abstention and provider failure each keep original context and lead to one strong call', async t => {
  const input = target('tap', '先还有两把，后来【还】剩一把。');
  for (const fails of [false, true]) {
    const reader = createLookupService({ ...offline, selectorEnabled: true, contextEnabled: true,
      async select(_occ, _choices, handlers) {
        if (fails) throw new LookupModelError('openrouter lookup returned HTTP 503', selectorTrace);
        handlers?.onTrace?.(selectorTrace);
        return null;
      },
      async context(arm, received, suggestion) {
        assert.equal(arm, 'strong');
        assert.deepEqual(received, input);
        assert.equal(suggestion, '还');
        return { ...contextTrace, answer: { span: '还', pinyin: 'hái', gloss: 'still (remaining)', chunks: [] } };
      },
    });
    const activity = createActivity(new DatabaseSync(':memory:'));
    t.after(() => activity.db.close());
    const answer = await activity.action('Reader lookup', 'tap', () => reader.lookup(input));
    const [selector, fallback] = activity.trace(activity.report(1).actions[0].id)!.spans;
    assert.equal(selector.outcome, fails ? 'error' : 'Abstained');
    assert.deepEqual(fallback.dependsOn, [selector.id]);
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

test('a second look bypasses quick answers and reanchors a different span to the same tap', async () => {
  const input = target('tap', '报刊亭里有一份【报】刊。');
  let receivedSuggestion: string | undefined;
  const reader = createLookupService({ ...offline, selectorEnabled: true, contextEnabled: true,
    async select() { assert.fail('A second look cannot use the fast selector'); },
    async context(_arm, received, suggestion) {
      assert.deepEqual(received, input);
      receivedSuggestion = suggestion;
      return { ...contextTrace, answer: { span: '报刊', pinyin: 'bàokān', gloss: 'publication', chunks: [] } };
    },
  });
  // The quick decision's span can differ from the current lexer's proposal.
  const result = await reader.lookup(input, undefined, { checkInContext: true, suggestedSpan: { start: input.start, end: input.end } });
  assert.equal(receivedSuggestion, '报');
  assert.equal(result.evidence.localSpan?.form, '报刊');
  assert.equal(result.evidence.contextSuggestion?.form, '报');
  assert.equal(result.route, 'context');
  assert.equal(result.start, input.start);
  assert.equal(result.end, input.end + 1);
  assert.deepEqual(result.evidence.calls.map(c => c.stage), ['context']);
});

test('a strong model can revise an agreed tap boundary after the selector abstains', async () => {
  const input = target('tap', '这是一种泡【沫】材料。');
  const reader = createLookupService({ ...offline, selectorEnabled: true, contextEnabled: true,
    async select(_occ, _choices, handlers) {
      handlers?.onTrace?.(selectorTrace);
      return null;
    },
    async context(_arm, received, suggestion) {
      assert.deepEqual(received, input);
      assert.equal(suggestion, '泡沫');
      return { ...contextTrace, answer: { span: '泡沫材料', pinyin: 'pàomò cáiliào', gloss: 'foam material', chunks: [] } };
    },
  });
  const result = await reader.lookup(input);
  assert.equal(result.answer?.span, '泡沫材料');
  assert.equal(result.start, input.start - 1);
  assert.equal(result.end, input.end + 2);
});

test('rechecks preserve deliberate selections and never substitute an authored example on failure', async () => {
  const input = target('selection', '听着【听】着，也跟着唱了起来。');
  const source = { documentId: 'after-the-show', blockId: 'street' };
  const reader = createLookupService({ ...offline, contextEnabled: true,
    async context(_arm, received, suggestion) {
      assert.deepEqual(received, input);
      assert.equal(suggestion, undefined);
      throw new LookupModelError('openai lookup returned HTTP 503', contextTrace);
    },
  });
  const result = await reader.lookup(input, source, { checkInContext: true });
  assert.equal(result.route, 'unavailable');
  assert.equal(result.answer, null);
  assert.deepEqual(result.evidence.steps, ['check-in-context', 'context-error']);
  const offlineResult = await createLookupService(offline).lookup(input, source, { checkInContext: true });
  assert.equal(offlineResult.route, 'unavailable');
  assert.deepEqual(offlineResult.evidence.steps, ['check-in-context', 'context-offline']);
});

test('fresh catalog-only forms join tap segmentation and exact selection without inventing a dictionary gloss', async () => {
  let catalog = createReaderCatalog([]);
  const reader = createLookupService({ ...offline, catalogSnapshot: () => catalog, selectorEnabled: true,
    async select(_occ, choices, handlers) {
      handlers?.onTrace?.(selectorTrace);
      return choices[0];
    },
  });
  const tap = target('tap', '深蓝，【乍】一看像黑的。');
  const before = await reader.lookup(tap);
  assert.equal(before.route, 'unavailable');
  catalog = createReaderCatalog([{ wordId: 'expression', forms: ['乍一看'], pinyin: 'zhà yī kàn',
    senses: [{ senseId: 'glance', label: 'at first glance' }] }]);
  for (const gesture of [tap, target('selection', '深蓝，【乍一看】像黑的。')]) {
    const result = await reader.lookup(gesture);
    assert.equal(result.route, 'selector');
    assert.equal(result.answer?.span, '乍一看');
    assert.equal(result.evidence.selectedSenseId, 'glance');
    assert.equal(result.evidence.localReason, 'catalog-form');
    assert.notEqual(result.evidence.catalogSha256, before.evidence.catalogSha256);
  }
});
