import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { openReaderCatalog, type GrowthChoice } from './reader-catalog.ts';
import { judgeReaderGrowth, processReaderDecision, type GrowthDecision, type GrowthJudge } from './reader-growth.ts';

function journal(t: TestContext) {
  const folder = mkdtempSync(join(tmpdir(), 'journal-growth-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const db = join(folder, 'journal.sqlite');
  return { db, store: openReaderCatalog(db) };
}
function decision(form: string, marked: string, route = 'context'): GrowthDecision {
  const start = marked.indexOf('【');
  const text = marked.replace('【', '').replace('】', '');
  const end = marked.indexOf('】') - 1;
  assert.equal(text.slice(start, end), form);
  return { id: randomUUID(), input: { kind: 'tap', text, start, end: start + 1 }, feedback: null,
    result: { route, start, end, answer: { span: form, pinyin: 'pīnyīn', gloss: 'displayed answer' }, evidence: {} } };
}
const addGlance: GrowthChoice = { kind: 'add', pinyin: 'zhà yī kàn', label: 'at first glance', notes: [], reason: 'A recurrent expression.' };
const add: GrowthJudge = async () => addGlance;

test('a learned entry survives reopening, replay, and linking independent evidence', async t => {
  const { store, db } = journal(t);
  assert.equal(existsSync(db), false);
  assert.equal(existsSync(store.path), false);
  const first = decision('乍一看', '深蓝，【乍一看】像黑的。');
  assert.equal(await processReaderDecision(store, first, { judge: null }), null);
  assert.equal(store.needsDecision(first), true);
  const receipt = await processReaderDecision(store, first, { judge: add });
  assert.equal(receipt?.outcome, 'added');
  assert.ok(receipt.senseId);
  const reopened = openReaderCatalog(db);
  assert.deepEqual(reopened.snapshot().sensesFor('乍一看').map(s => s.senseId), [receipt.senseId]);
  assert.equal(store.needsDecision(first), false);
  assert.deepEqual(await processReaderDecision(reopened, first, { judge: null }), receipt);
  const quick = decision('乍一看', '她【乍一看】很面熟。', 'catalog');
  quick.result.evidence = { selectedSenseId: receipt.senseId };
  assert.equal((await processReaderDecision(store, quick, { judge: null }))?.instantMatch, true);
  const other = decision('乍一看', '她【乍一看】很面熟。', 'selector');
  other.result.evidence = { selectedSenseId: receipt.senseId };
  const link = await processReaderDecision(reopened, other, { judge: null });
  assert.equal(link?.outcome, 'linked');
  assert.equal(link?.senseId, receipt.senseId);
  first.feedback = { type: 'marked_wrong' };
  assert.equal(reopened.needsDecision(first), true);
  await processReaderDecision(store, first, { judge: null });
  assert.equal(reopened.snapshot().sensesFor('乍一看').length, 1);
  other.feedback = { type: 'marked_wrong' };
  await processReaderDecision(store, other, { judge: null });
  assert.equal(reopened.snapshot().forms.has('乍一看'), false);
  assert.equal(reopened.entries().find(w => w.forms.includes('乍一看'))?.senses.length, 1);
  assert.equal(reopened.receipts().length, 3);
});

test('a background writer rechecks the inventory on conflicting concurrent additions', async t => {
  const { store, db } = journal(t);
  const other = openReaderCatalog(db);
  const row = decision('泡沫', '用【泡沫】垫着。');
  const next = { ...row, id: randomUUID() };
  let attempts = 0;
  const judge: GrowthJudge = async (_row, candidates) => {
    ++attempts;
    const material = candidates.find(s => s.label === 'foam packaging material');
    if (material) return { kind: 'link', senseId: material.senseId, reason: 'Same padding material.' };
    return { kind: 'add', pinyin: 'pào mò', label: 'foam packaging material', notes: [], reason: 'Literal packaging material.' };
  };
  const [a, b] = await Promise.all([processReaderDecision(store, row, { judge }), processReaderDecision(other, next, { judge })]);
  assert.deepEqual([a?.outcome, b?.outcome], ['added', 'linked']);
  assert.equal(attempts, 3);
  assert.equal(a?.senseId, b?.senseId);
  const word = store.entries().find(entry => entry.forms.includes('泡沫'));
  assert.equal(word?.wordId, 'sample/泡沫/pàomò');
  assert.equal(word?.senses.length, 3);
  assert.equal(JSON.parse(readFileSync(store.path, 'utf8')).entries[0].senses.length, 1);
});

test('a revised boundary withdraws only support from the earlier lookup', async t => {
  const { store } = journal(t);
  const old = decision('乍一看', '我【乍一看】不出。');
  const first = await processReaderDecision(store, old, { judge: add });
  assert.ok(first?.senseId);
  const check = decision('乍', '我【乍】一看不出。');
  check.previousDecisionId = old.id;
  await processReaderDecision(store, check, { judge: async () => ({kind: 'occurrence', reason: 'The explanation applies only here.'}) });
  assert.equal(store.snapshot().sensesFor('乍一看').length, 0);
  assert.equal(store.receipt(old.id)?.flagged, false);
  assert.equal(store.receipt(check.id)?.previousDecisionId, old.id);
  assert.equal(store.snapshot().sensesFor('泡沫').length, 2);
  check.feedback = { type: 'marked_wrong' };
  await processReaderDecision(store, check, { judge: null });
  assert.equal(store.snapshot().sensesFor('乍一看')[0]?.senseId, first.senseId);
  assert.equal(store.receipt(old.id)?.flagged, false);
});

test('a failed judge, invalid link, or flag received in flight cannot publish a new sense', async t => {
  const { store } = journal(t);
  const row = decision('乍一看', '我【乍一看】不出。', 'dictionary');
  await assert.rejects(processReaderDecision(store, row, { judge: async () => { throw new Error('offline'); } }), /offline/);
  await assert.rejects(processReaderDecision(store, row, { judge: async () => ({
    kind: 'link', senseId: 'stand', reason: 'unrelated spelling',
  }) }), /unknown reader sense/);
  assert.equal(store.needsDecision(row), true);
  assert.equal(existsSync(store.path), false);
  let flagged = false;
  const receipt = await processReaderDecision(store, row, { isFlagged: () => flagged, judge: async () => {
    flagged = true;
    return addGlance;
  } });
  assert.equal(receipt?.flagged, true);
  assert.equal(receipt.senseId, null);
  assert.equal(store.snapshot().forms.has('乍一看'), false);
});

test('live judge sends exact occurrence and an OpenAI-compatible choice schema', async t => {
  const original = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'mock-reader-key';
  t.after(() => {
    if (original === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = original;
  });
  const row = decision('乍一看', '深蓝，【乍一看】像黑的。');
  let decisionOutput: GrowthChoice = addGlance;
  const transport = t.mock.method(globalThis, 'fetch', async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const request = JSON.parse(String(init?.body));
    const data = JSON.parse(request.input);
    assert.deepEqual([data.before, data.focus, data.after], ['深蓝，', '乍一看', '像黑的。']);
    assert.deepEqual(data.candidates, []);
    const alternatives = request.text.format.schema.properties.decision;
    assert.equal(alternatives.anyOf.length, 3);
    assert.equal(alternatives.oneOf, undefined);
    return Response.json({ status: 'completed', output: [{ type: 'message', content: [
      { type: 'output_text', text: JSON.stringify({ decision: decisionOutput }) },
    ] }] });
  });
  assert.deepEqual(await judgeReaderGrowth(row, []), addGlance);
  decisionOutput = { kind: 'link', senseId: 'invented', reason: 'Invalid reference.' };
  await assert.rejects(judgeReaderGrowth(row, []), /unsupplied sense/);
  assert.equal(transport.mock.callCount(), 2);
});
