import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import {
  setApiAuthenticationTokenProvider,
  submitDietIntake,
  submitDietIntakeAssessment,
} from '../src/services/api.ts';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  setApiAuthenticationTokenProvider(null);
});

describe('diet intake API client', () => {
  test('sends assessment answers only to the disclosed provider route', async () => {
    let request: { url: string; init: RequestInit | undefined } | null = null;
    globalThis.fetch = (async (input, init) => {
      request = { url: String(input), init };
      return new Response('{}', { status: 201 });
    }) as typeof globalThis.fetch;

    await submitDietIntakeAssessment({
      answers: [{ prompt: 'Background', answer: 'I have studied before.' }],
    });

    assert.ok(request);
    assert.match(request.url, /\/api\/diet\/intake\/assess$/);
    assert.equal(request.init?.method, 'POST');
    assert.deepEqual(JSON.parse(String(request.init?.body)), {
      answers: [{ prompt: 'Background', answer: 'I have studied before.' }],
      providerDisclosureAccepted: true,
    });
  });

  test('keeps manual and skip intake on the provider-free route', async () => {
    let request: { url: string; init: RequestInit | undefined } | null = null;
    globalThis.fetch = (async (input, init) => {
      request = { url: String(input), init };
      return new Response(null, { status: 204 });
    }) as typeof globalThis.fetch;

    await submitDietIntake({ answers: [], selfSelect: null });

    assert.ok(request);
    assert.match(request.url, /\/api\/diet\/intake$/);
    assert.deepEqual(JSON.parse(String(request.init?.body)), { answers: [], selfSelect: null });
  });
});
