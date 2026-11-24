import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { actionSchema, openJournal } from './journal.ts';
import { demoFriend, demoTutor } from './practice.ts';
import type { TurnContext } from './tutor.ts';

const demo = {
  mode: 'demo' as const,
  tutor: async (ctx: TurnContext) => demoTutor(ctx),
  friend: async (ctx: TurnContext) => demoFriend(ctx),
};
const capture = (text: string, context?: string) => ({ type: 'capture' as const, id: randomUUID(), text, context });

test('Home dispatches words, asks and reading drafts, and preserves the result on replay', async () => {
  const j = openJournal(':memory:', demo);
  try {
    const url = capture('https://example.org/reading');
    assert.deepEqual((await j.act(url)).captureResult, { id: url.id, kind: 'reading', url: url.text });
    assert.equal(j.get().reading.documents.some(doc => doc.sourceUrl === url.text), false);
    const word = capture('值得', '听朋友说的');
    const result = await j.act(word);
    assert.equal(result.captureResult?.kind, 'word');
    assert.equal(result.tutor[0]?.source, word.context);
    assert.equal(result.wordIntakes[0]?.context, word.context);
    const ask = capture('这本书值得看吗里的“值得”是什么意思');
    const answered = await j.act(ask);
    assert.equal(answered.captureResult?.kind, 'tutor');
    assert.equal(answered.tutor.at(-2)?.text, ask.text);
    assert.ok(answered.tutor.at(-1)?.text.includes('值得'));
    assert.equal(answered.wordIntakes.length, 1);
    assert.equal((await j.act(word)).wordIntakes.length, 1);
    assert.deepEqual((await j.act(url)).captureResult, { id: url.id, kind: 'reading', url: url.text });
    await assert.rejects(j.act({ ...url, text: 'different' }), /different request/);
  } finally { j.close(); }
});

test('a pasted sentence is retained through clarification, repeat clarification, and a grounded selection', async () => {
  const j = openJournal(':memory:', demo);
  try {
    const sentence = capture('今天我在阳台上放了一些鸟食。', '朋友写的');
    const response = await j.act(sentence);
    assert.equal(response.tutor.at(-1)?.captureQuestionId, sentence.id);
    assert.equal(response.wordIntakes.length, 0);
    const reply = { id: randomUUID(), type: 'tutor' as const, message: 'hmm', surface: 'home', source: '', captureQuestionId: sentence.id };
    const stillUnclear = await j.act(reply);
    assert.equal(stillUnclear.tutor.at(-1)?.captureQuestionId, reply.id);
    const save = { ...reply, id: randomUUID(), message: 'save 鸟食', captureQuestionId: reply.id };
    const resolved = await j.act(save);
    assert.equal(resolved.wordIntakes[0]?.text, '鸟食');
    assert.ok(resolved.wordIntakes[0]?.context?.includes(sentence.text));
    assert.ok(resolved.wordIntakes[0]?.context?.includes('朋友写的'));
    assert.equal((await j.act(save)).wordIntakes.length, 1);
    await assert.rejects(j.act({ ...save, id: randomUUID() }), /no longer waiting/);
  } finally { j.close(); }
});

test('keeping a sentence as a note uses the original text after repeated clarification', async () => {
  const j = openJournal(':memory:', demo);
  try {
    const a = capture('今天我在阳台上放了一些鸟食。', '朋友写的');
    await j.act(a);
    const reply = { type: 'tutor' as const, surface: 'home', source: '',
      captureQuestionId: a.id, id: randomUUID(), message: 'hmm' };
    await j.act(reply);
    const result = await j.act({ ...reply, captureQuestionId: reply.id, id: randomUUID(), message: 'keep it as a note' });
    assert.deepEqual(result.saved.map(item => [item.kind, item.title, item.source]), [['Note', a.text, a.context]]);
    assert.deepEqual(result.wordIntakes, []);
  } finally { j.close(); }
});

test('a learner can clarify a grammar question conversationally in the demo tutor', async () => {
  const j = openJournal(':memory:', demo);
  try {
    const sentence = capture('我昨天看了一部电影。');
    await j.act(sentence);
    const result = await j.act({ type: 'tutor', id: randomUUID(), surface: 'home', source: '',
      captureQuestionId: sentence.id, message: 'I want to know whether 部 is the right measure word for a movie.' });
    assert.match(result.tutor.at(-1)?.text ?? '', /部 is a measure word for films/);
    assert.equal(result.wordIntakes.length, 0);
  } finally { j.close(); }
});

test('an inferred target absent from the evidence produces a tutor question', async () => {
  const j = openJournal(':memory:', {
    ...demo, tutor: async () => ({ capture: { kind: 'word', target: '别人', intent: 'ask' } }),
  });
  try {
    const a = capture('有意思', '别人告诉我的');
    const result = await j.act(a);
    assert.equal(result.captureResult?.kind, 'tutor');
    assert.equal(result.tutor.at(-1)?.captureQuestionId, a.id);
    assert.equal(result.wordIntakes.length, 0);
    const second = await j.act({ type: 'tutor', id: randomUUID(), message: 'that one', surface: 'home',
      source: '', captureQuestionId: a.id });
    assert.equal(second.wordIntakes.length, 0);
    assert.ok(second.tutor.at(-1)?.captureQuestionId);
    assert.equal(actionSchema.safeParse(capture('   ')).success, false);
  } finally { j.close(); }
});
