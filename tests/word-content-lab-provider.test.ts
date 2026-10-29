import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { validateJsonSchema } from '../server/llm/json-schema-validator.ts';
import { createIntroductionLabProvider, INTRO_LAB_MODEL } from '../server/word-content-lab/provider.ts';
import type { JsonSchema } from '../src/domain/reflection-result-schema.ts';
import { wordContentFixtures } from './fixtures/word-content.ts';

const content = wordContentFixtures[0]!.content;

function teachingResult() {
  return { beats: [
    { id: 'scene', parts: [{ kind: 'text', text: 'A friend is visiting your apartment.' }] },
    { id: 'sentence', parts: [{ kind: 'example', exampleId: 'property', field: 'sentence' }] },
    { id: 'translation', parts: [{ kind: 'example', exampleId: 'property', field: 'translation' }] },
  ] };
}

function providerResponse(result: string, finishReason = 'stop'): Response {
  return new Response(JSON.stringify({
    id: 'intro-response-1',
    model: INTRO_LAB_MODEL,
    choices: [{ message: { content: result }, finish_reason: finishReason }],
    usage: { prompt_tokens: 20, completion_tokens: 30, total_tokens: 50 },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('introduction lab provider teaching transport', () => {
  test('sends exact word content and accepts a beats-only teaching result', async () => {
    let requestBody: Record<string, unknown> | null = null;
    const provider = createIntroductionLabProvider({
      environment: { OPENAI_API_KEY: 'test-key' },
      fetchImplementation: (async (_input, init) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return providerResponse(JSON.stringify(teachingResult()));
      }) as typeof globalThis.fetch,
    });
    assert.equal(provider.isConfigured(), true);
    assert.deepEqual(await provider.generateTeaching(content), teachingResult());
    assert.equal(requestBody?.model, INTRO_LAB_MODEL);
    assert.equal(requestBody?.reasoning_effort, 'high');
    const messages = requestBody?.messages as Array<{ role: string; content: string }>;
    assert.equal(messages[1]?.content, JSON.stringify(content));
    assert.match(messages[0]?.content ?? '', /adult-to-adult|adult learner/i);
    assert.doesNotMatch(messages[0]?.content ?? '', /rehearsal|cloze/i);
    const format = requestBody?.response_format as {
      json_schema: { name: string; strict: boolean; schema: JsonSchema };
    };
    assert.equal(format.json_schema.name, 'intro_lab_teaching_v2');
    assert.equal(format.json_schema.strict, true);
    assert.deepEqual(validateJsonSchema(teachingResult(), format.json_schema.schema), []);
    assert.ok(validateJsonSchema({...teachingResult(),rehearsals:[]}, format.json_schema.schema).length > 0);
  });

  test('rejects malformed, combined-package, and truncated teaching outputs', async () => {
    for (const [result, finishReason, expected] of [
      ['not json', 'stop', /invalid JSON/],
      [JSON.stringify({ beats: [], rehearsals: [] }), 'stop', /invalid structure/],
      [JSON.stringify({...teachingResult(),rehearsals:[]}), 'stop', /invalid structure/],
      [JSON.stringify(teachingResult()), 'length', /truncated/],
    ] as const) {
      const provider = createIntroductionLabProvider({
        environment: { OPENAI_API_KEY: 'test-key' },
        fetchImplementation: (async () => providerResponse(result, finishReason)) as typeof globalThis.fetch,
      });
      await assert.rejects(provider.generateTeaching(content), expected);
    }
  });
});

test('practice receives reduced input and its own schema, prompt, generation key and invocation identity', async () => {
  let body: Record<string, unknown> = {};
  const output = { rehearsals: [{ id: 'phrase', stimulus: { kind: 'phrase_cloze', frame: 'File a report.', text: '提前____。' } }] };
  const provider = createIntroductionLabProvider({ environment: { OPENAI_API_KEY: 'test' }, fetchImplementation: (async (_url, init) => {
    body = JSON.parse(String(init?.body)); return providerResponse(JSON.stringify(output));
  }) as typeof fetch });
  assert.deepEqual(await provider.generatePractice(content), output);
  const messages = body.messages as {role:string;content:string}[];
  const input = JSON.parse(messages[1].content);
  assert.equal('examples' in input, false);
  assert.deepEqual(input.word, content.word);
  assert.deepEqual(input.uses, content.uses.map(({exampleIds, ...use}) => use));
  const format = body.response_format as {json_schema:{name:string;schema:JsonSchema}};
  assert.equal(format.json_schema.name, 'intro_lab_practice_v1');
  assert.deepEqual(validateJsonSchema(output, format.json_schema.schema), []);
  assert.notEqual(await provider.generationKey('teaching'), await provider.generationKey('practice'));
  assert.equal(await provider.generationKey('practice'), await provider.generationKey('practice'));
});
