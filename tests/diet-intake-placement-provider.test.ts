import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  DIET_INTAKE_PLACEMENT_REQUEST_VERSION,
  isDietIntakePlacementAnswers,
} from '../src/domain/diet-intake-placement.ts';
import {
  createDietIntakePlacementProvider,
  DietIntakePlacementProviderError,
  DIET_INTAKE_PLACEMENT_MODEL_CONFIG,
} from '../server/diet/intake-placement-provider.ts';

const request = {
  schemaVersion: DIET_INTAKE_PLACEMENT_REQUEST_VERSION,
  answers: [{ prompt: 'Background?', answer: 'I studied some Mandarin at university.' }],
} as const;

function providerResponse(content: string, finishReason = 'stop'): Response {
  return new Response(JSON.stringify({
    id: 'response-1', model: 'gpt-5.6-luna', choices: [{ message: { content }, finish_reason: finishReason }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('diet intake placement provider', () => {
  test('sends only bounded versioned answers and validates a structured placement', async () => {
    let body: Record<string, unknown> | null = null;
    const provider = createDietIntakePlacementProvider({
      environment: { OPENAI_API_KEY: 'test-key' }, systemPrompt: 'injected placement prompt',
      fetchImplementation: (async (_input, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return providerResponse(JSON.stringify({
          schemaVersion: 'diet_intake_placement_result.v1', nextLearningLevel: 3, rationale: 'Ready for elementary expansion.',
        }));
      }) as typeof globalThis.fetch,
    });
    const result = await provider.assess(request, { clientRequestId: 'request-1' });
    assert.equal(result.result.nextLearningLevel, 3);
    assert.equal(body?.model, 'gpt-5.6-luna');
    assert.equal(body?.reasoning_effort, 'high');
    assert.equal(JSON.stringify(body).includes('deck'), false);
    assert.equal(JSON.stringify(body).includes('learner'), false);
    assert.equal((body?.messages as Array<{ content: string }>)[0]?.content, 'injected placement prompt');
    assert.equal((body?.messages as Array<{ content: string }>)[1]?.content, JSON.stringify(request));
    assert.equal(DIET_INTAKE_PLACEMENT_MODEL_CONFIG.maxOutputTokens, 12_000);
  });

  test('rejects missing credentials, malformed output, and truncated output before any placement can be applied', async () => {
    let called = false;
    const missing = createDietIntakePlacementProvider({ environment: {}, fetchImplementation: (async () => { called = true; throw new Error('unexpected'); }) as typeof globalThis.fetch });
    await assert.rejects(missing.assess(request), (error: unknown) => error instanceof DietIntakePlacementProviderError && error.code === 'missing_config');
    assert.equal(called, false);
    for (const [content, finishReason, code] of [
      ['not json', 'stop', 'invalid_json'],
      [JSON.stringify({ schemaVersion: 'diet_intake_placement_result.v1', nextLearningLevel: 9, rationale: 'Bad.' }), 'stop', 'schema_invalid'],
      [JSON.stringify({ schemaVersion: 'diet_intake_placement_result.v1', nextLearningLevel: 2, rationale: 'Cut short.' }), 'length', 'output_truncated'],
    ] as const) {
      const provider = createDietIntakePlacementProvider({ environment: { OPENAI_API_KEY: 'test-key' }, fetchImplementation: (async () => providerResponse(content, finishReason)) as typeof globalThis.fetch });
      await assert.rejects(provider.assess(request), (error: unknown) => error instanceof DietIntakePlacementProviderError && error.code === code);
    }
  });

  test('enforces raw request bounds before provider input is built', () => {
    assert.equal(isDietIntakePlacementAnswers(request.answers), true);
    assert.equal(isDietIntakePlacementAnswers([{ prompt: 'p', answer: ` ${'x'.repeat(2_000)} ` }]), false);
    assert.equal(isDietIntakePlacementAnswers([]), false);
    assert.equal(isDietIntakePlacementAnswers([{ prompt: 'p', answer: 'a' }, { prompt: 'q', answer: 'b' }, { prompt: 'r', answer: 'c' }]), false);
  });
});
