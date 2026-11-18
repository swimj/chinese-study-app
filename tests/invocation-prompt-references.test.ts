import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { encodeInvocationPrompts, decodeInvocationPrompts } from '../server/db/invocation-prompt-references.ts';

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
function roundTrip(template: string | null, request: string | null) {
  const encoded = encodeInvocationPrompts(template, request);
  const actual = decodeInvocationPrompts(encoded.templateHash, encoded.requestJson, encoded.referencesJson, hash => encoded.blobs.get(hash)!);
  assert.deepEqual(actual, { promptTemplate: template, requestJson: request });
  return encoded;
}

test('compatible requests share one exact template blob across schema variants', () => {
  const template = '词🀄\n"words"\t\0';
  const schema = { type: 'object', properties: { word: { enum: ['甲', '乙'] } } };
  const addon = '\n\nReturn exactly one JSON object matching the following JSON Schema. Do not add prose or Markdown outside the object.\n' + JSON.stringify(schema);
  const request = (appendix: string) => ({ messages: [{ role: 'system', content: template + appendix },
    { role: 'user', content: 'sensitive learner input' }], response_format: appendix ? { type: 'json_object' } : { type: 'json_schema', schema } });
  for (const appendix of ['', addon]) {
    const body = request(appendix);
    const encoded = roundTrip(template, JSON.stringify(body));
    assert.deepEqual([...encoded.blobs], [[sha(template), template]]);
    assert.deepEqual(JSON.parse(encoded.requestJson!), { ...body, messages: [{ role: 'system', content: appendix ? JSON.stringify(schema) : '' }, body.messages[1]] });
  }
});

test('Responses instructions, system and developer items are archived while learner, assistant and tool data remain exact', () => {
  const opaque = { version: 1, hashes: [sha('archive')] };
  const input = [
    { role: 'system', content: 'chat rubric' }, { role: 'developer', content: [
      { type: 'input_text', text: 'another rubric' }, { type: 'text', text: 'chat rubric' }, { type: 'input_image', image_url: 'image' },
    ] },
    { role: 'user', content: JSON.stringify(opaque) }, { role: 'assistant', content: [{ type: 'output_text', text: 'private response' }] },
    { type: 'function_call_output', call_id: 'call', output: 'private tool output' },
  ];
  const body = { instructions: 'chat rubric', input, tools: [{ description: 'tool schema', parameters: opaque }], metadata: opaque };
  const encoded = roundTrip(null, JSON.stringify(body));
  assert.equal(encoded.templateHash, null);
  assert.deepEqual([...encoded.blobs.values()], ['chat rubric', 'another rubric']);
  const stored = JSON.parse(encoded.requestJson!);
  assert.equal(stored.instructions, '');
  assert.equal(stored.input[0].content, '');
  assert.deepEqual(stored.input[1].content.map((part: { text?: string }) => part.text), ['', '', undefined]);
  assert.deepEqual(stored.input.slice(2), input.slice(2));
  assert.deepEqual(stored.tools, body.tools);
  assert.deepEqual(stored.metadata, opaque);
});

test('standalone and empty templates, requests of unknown shape, and arbitrary user data remain distinguishable', () => {
  assert.deepEqual([...roundTrip('standalone', null).blobs.values()], ['standalone']);
  assert.deepEqual([...roundTrip(null, null).blobs], []);
  assert.equal(roundTrip('', null).templateHash, sha(''));
  const empty = roundTrip(null, '{"messages":[{"role":"system","content":""}]}');
  assert.deepEqual([...empty.blobs.values()], ['']);
  const independent = roundTrip('standalone', '{"messages":[{"role":"system","content":"different rendered prompt"}]}');
  assert.deepEqual([...independent.blobs.values()], ['standalone', 'different rendered prompt']);
  assert.equal(roundTrip('separate', '{ "prompt": "custom" }').referencesJson, null);
  assert.equal(roundTrip(null, '  [{ "role": "system", "content":"not an API request" }] ').referencesJson, null);
});

test('invalid or lossy persisted formats fail before returning a different literal request', () => {
  const json = '{"messages":[{"role":"system","content":"capture"}]}';
  const encoded = roundTrip('capture', json);
  assert.throws(() => encodeInvocationPrompts(null, ' ' + json), /noncanonical/);
  assert.throws(() => encodeInvocationPrompts(null, '{"instructions":"first","instructions":"second"}'), /noncanonical/);
  assert.throws(() => encodeInvocationPrompts('\uD800', null), /Unicode/);
  const read = (hash: string) => encoded.blobs.get(hash)!;
  assert.throws(() => decodeInvocationPrompts(encoded.templateHash, encoded.requestJson, encoded.referencesJson, () => 'wrong'), /corrupted/);
  assert.throws(() => decodeInvocationPrompts(null, '{}', encoded.referencesJson, read), /Unused/);
  assert.throws(() => decodeInvocationPrompts(null, encoded.requestJson, '{"version":2,"hashes":[]}', read), /references/);
  assert.throws(() => decodeInvocationPrompts(null, '{"messages":[{"role":"system","content":""},{"role":"developer","content":""}]}', encoded.referencesJson, read), /Missing/);
});

test('invalid schema suffix indices are rejected', () => {
  const request = '{"messages":[{"role":"system","content":""}]}';
  for (const indices of [[-1], [1], [0, 0], ['0']]) {
    assert.throws(() => decodeInvocationPrompts(null, request,
      JSON.stringify({ version: 1, hashes: [sha('x')], schemaSuffixAt: indices }), () => 'x'), /schema suffix/);
  }
});
