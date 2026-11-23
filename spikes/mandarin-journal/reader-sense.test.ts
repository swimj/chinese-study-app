import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createReaderCatalog } from './reader-catalog.ts';
import { selectReaderSense } from './reader-sense.ts';

const source = JSON.parse(readFileSync(new URL('./lookup-experiment/sense-catalog.sample.json', import.meta.url), 'utf8'));
const catalog = createReaderCatalog(source);
const occurrence = { text: '借的伞还没还。', start: 5, end: 6 };

test('catalog joins both readings by either written form and rejects duplicated identities', () => {
  assert.deepEqual(catalog.sensesFor('還'), catalog.sensesFor('还'));
  assert.equal(catalog.sensesFor('還').length, 3);
  assert.equal(catalog.sensesFor('missing').length, 0);
  assert.throws(() => createReaderCatalog([...source, source[0]]), /Duplicate reader word/);
  assert.throws(() => createReaderCatalog([...source, { ...source[0], wordId: 'other' }]), /Duplicate reader sense/);
});

test('reader selects a supplied sense, can abstain, and rejects invented references', async t => {
  const candidates = catalog.sensesFor('还');
  const direct = process.env.LOOKUP_FAST_PROVIDER === 'openai';
  const key = direct ? 'OPENAI_API_KEY' : 'OPENROUTER_API_KEY';
  const saved = process.env[key];
  process.env[key] = 'mock-reader-key';
  t.after(() => { if (saved === undefined) delete process.env[key]; else process.env[key] = saved; });
  let ref: string | null = '1';
  const transport = t.mock.method(globalThis, 'fetch', async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const request = JSON.parse(String(init?.body));
    const input = JSON.parse(direct ? request.input : request.messages[1].content);
    assert.deepEqual([input.before,input.focus,input.after], ['借的伞还没','还','。']);
    const content = JSON.stringify({ ref });
    return Response.json(direct ? { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: content }] }] } :
      { choices: [{ finish_reason: 'stop', message: { content } }] });
  });
  assert.equal(await selectReaderSense(occurrence, []), null);
  assert.equal(transport.mock.callCount(), 0);
  assert.equal(await selectReaderSense(occurrence,candidates), candidates[0]);
  ref = null;
  assert.equal(await selectReaderSense(occurrence,candidates), null);
  ref = '9';
  await assert.rejects(selectReaderSense(occurrence,candidates), /Unknown reader sense/);
});
