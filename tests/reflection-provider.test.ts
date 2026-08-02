import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  SESSION_REFLECTION_RESULT_SCHEMA_NAME,
  sessionReflectionResultSchema,
} from '../src/domain/reflection-result-schema.js';
import type {
  SessionReflectionBundleV1,
  SessionReflectionResultV4,
} from '../src/domain/reflection.js';
import {
  createLunaReflectionProvider,
  LUNA_REFLECTION_MODEL_CONFIG,
  LUNA_REFLECTION_PROMPT_VERSION,
  LunaReflectionProviderError,
} from '../server/reflection/luna-provider.js';
import type { JsonValue } from '../server/llm/types.js';
import {
  describeReflectionProviderFailure,
  type ReflectionProviderDiagnostic,
} from '../server/reflection/provider-diagnostics.ts';

type CapturedRequest = {
  url: string;
  headers: Headers;
  body: Record<string, JsonValue>;
  signal: AbortSignal | null;
};

const bundle: SessionReflectionBundleV1 = {
  schemaVersion: 'session_reflection_bundle.v1',
  generatedAt: '2026-07-29T10:00:00.000Z',
  session: {
    sessionId: 'session-1',
    startedAt: '2026-07-29T09:55:00.000Z',
    endedAt: '2026-07-29T10:00:00.000Z',
    studyProfile: 'mandarin',
  },
  items: [{
    itemId: 'item-1',
    source: 'production_mistake',
    sourceActionKind: 'production',
    sessionActionId: 'action-1',
    occurredAt: '2026-07-29T09:58:00.000Z',
    targetWord: {
      wordId: 'word-1',
      hanzi: '知道',
      pinyin: 'zhīdào',
      meanings: ['to know'],
    },
    sessionNote: null,
    existingContent: {
      contrastClusters: [],
      knownAcceptedAlternates: [],
    },
    cuesAsShown: [{
      cueId: 'cue-1',
      cueType: 'definition_gloss',
      displayOrder: 0,
      text: 'to know',
      displayedMeanings: ['to know'],
    }],
    rawResponse: '认识',
    submittedWord: {
      wordId: 'word-2',
      hanzi: '认识',
      pinyin: 'rènshi',
      meanings: ['to know; to recognize'],
    },
    responseKind: 'matched_known_word',
  }],
};

const validResult: SessionReflectionResultV4 = {
  schemaVersion: 'session_reflection_result.v4',
  itemResults: [{
    itemId: 'item-1',
    diagnosisTags: ['ordinary_retrieval_noise'],
    observation: 'One near-meaning response does not yet support a durable change.',
    learnerExplanation: null,
    proposals: [],
    questions: [],
    unhandledNeeds: [],
  }],
};

function responseEnvelope(
  content: string,
  overrides: Record<string, JsonValue> = {},
): JsonValue {
  return {
    id: 'response-1',
    model: 'gpt-5.6-luna-2026-07-01',
    choices: [{
      finish_reason: 'stop',
      message: { content },
    }],
    usage: {
      prompt_tokens: 100,
      completion_tokens: 40,
      total_tokens: 140,
      completion_tokens_details: { reasoning_tokens: 10 },
    },
    ...overrides,
  };
}

function capturingFetch(
  responseBody: JsonValue,
  capture: CapturedRequest[],
  status = 200,
  responseHeaders: Record<string, string> = {},
): typeof globalThis.fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    capture.push({
      url: String(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)) as Record<string, JsonValue>,
      signal: init?.signal ?? null,
    });
    return new Response(JSON.stringify(responseBody), {
      status,
      headers: { 'content-type': 'application/json', ...responseHeaders },
    });
  }) as typeof globalThis.fetch;
}

async function expectProviderError(
  promise: Promise<unknown>,
  code: LunaReflectionProviderError['code'],
): Promise<LunaReflectionProviderError> {
  try {
    await promise;
    assert.fail(`Expected ${code}`);
  } catch (error) {
    assert.ok(error instanceof LunaReflectionProviderError);
    assert.equal(error.code, code);
    return error;
  }
}

describe('production Luna reflection provider', () => {
  test('sends the exact model, reasoning, auth, prompt, and strict V4 schema request', async () => {
    const capture: CapturedRequest[] = [];
    const provider = createLunaReflectionProvider({
      environment: {
        OPENAI_API_KEY: 'unit-test-secret',
        OPENAI_BASE_URL: 'https://openai.example.test/custom/v1/',
      },
      systemPrompt: 'Production reflection system prompt.',
      fetchImplementation: capturingFetch(
        responseEnvelope(JSON.stringify(validResult), {
          transportDebug: 'must-not-be-returned',
        }),
        capture,
      ),
    });

    const generated = await provider.generate(bundle);

    assert.equal(capture.length, 1);
    const request = capture[0]!;
    assert.equal(request.url, 'https://openai.example.test/custom/v1/chat/completions');
    assert.equal(request.url.includes('7897'), false);
    assert.equal(request.headers.get('authorization'), 'Bearer unit-test-secret');
    assert.deepEqual(request.body.messages, [
      { role: 'system', content: 'Production reflection system prompt.' },
      { role: 'user', content: JSON.stringify(bundle) },
    ]);
    assert.equal(request.body.model, 'gpt-5.6-luna');
    assert.equal(request.body.reasoning_effort, 'high');
    assert.equal(request.body.max_completion_tokens, 8_192);
    assert.equal(Object.hasOwn(request.body, 'temperature'), false);
    assert.deepEqual(request.body.response_format, {
      type: 'json_schema',
      json_schema: {
        name: SESSION_REFLECTION_RESULT_SCHEMA_NAME,
        strict: true,
        schema: sessionReflectionResultSchema,
      },
    });
    assert.ok(request.signal instanceof AbortSignal);
    assert.deepEqual(LUNA_REFLECTION_MODEL_CONFIG, {
      id: 'gpt-5.6-luna-high',
      provider: 'openai',
      providerModel: 'gpt-5.6-luna',
      reasoningEffort: 'high',
      maxOutputTokens: 8_192,
      timeoutMs: 180_000,
    });
    assert.deepEqual(generated.result, validResult);
    assert.deepEqual(generated.metadata, {
      provider: 'openai',
      modelConfig: 'gpt-5.6-luna-high',
      providerModel: 'gpt-5.6-luna',
      promptVersion: 'reflection-v2',
      responseId: 'response-1',
      finishReason: 'stop',
      usage: {
        inputTokens: 100,
        cachedInputTokens: null,
        cacheWriteInputTokens: null,
        outputTokens: 40,
        reasoningTokens: 10,
        totalTokens: 140,
      },
    });
    assert.equal(LUNA_REFLECTION_PROMPT_VERSION, 'reflection-v2');
    const serialized = JSON.stringify(generated);
    assert.equal(serialized.includes('unit-test-secret'), false);
    assert.equal(serialized.includes('transportDebug'), false);
    assert.equal(serialized.includes('must-not-be-returned'), false);
  });

  test('loads credentials lazily and classifies missing configuration before fetch', async () => {
    let fetchCalled = false;
    const provider = createLunaReflectionProvider({
      environment: {},
      systemPrompt: 'prompt',
      fetchImplementation: (async () => {
        fetchCalled = true;
        throw new Error('should not be called');
      }) as typeof globalThis.fetch,
    });

    const error = await expectProviderError(provider.generate(bundle), 'missing_config');
    assert.equal(fetchCalled, false);
    assert.equal(error.message, 'Reflection provider credentials are not configured.');
  });

  test('sanitizes upstream failures without exposing credentials or response bodies', async () => {
    const diagnostics: ReflectionProviderDiagnostic[] = [];
    const provider = createLunaReflectionProvider({
      environment: { OPENAI_API_KEY: 'super-secret-value' },
      systemPrompt: 'prompt',
      fetchImplementation: capturingFetch(
        { error: 'raw-upstream-private-response super-secret-value' },
        [],
        500,
        { 'x-request-id': 'req_safe_123', 'openai-processing-ms': '42' },
      ),
      diagnosticSink: { record: (diagnostic) => diagnostics.push(diagnostic) },
    });

    const error = await expectProviderError(provider.generate(bundle), 'upstream_failure');
    const exposed = `${error.message}\n${JSON.stringify(error)}`;
    assert.equal(exposed.includes('super-secret-value'), false);
    assert.equal(exposed.includes('raw-upstream-private-response'), false);
    assert.equal(error.issueCount, 0);
    assert.ok(error.clientRequestId);
    assert.deepEqual(diagnostics, [{
      at: diagnostics[0]?.at,
      sessionId: 'session-1',
      clientRequestId: error.clientRequestId,
      failureKind: 'http',
      errorName: 'ProviderHttpError',
      errorCode: null,
      cause: null,
      http: {
        status: 500,
        requestId: 'req_safe_123',
        processingMs: '42',
      },
    }]);
    const serializedDiagnostic = JSON.stringify(diagnostics);
    assert.equal(serializedDiagnostic.includes('super-secret-value'), false);
    assert.equal(serializedDiagnostic.includes('raw-upstream-private-response'), false);
  });

  test('records transport error categories and codes without messages or stacks', () => {
    const cause = Object.assign(new Error('private cause detail'), { code: 'ECONNRESET' });
    const transportError = Object.assign(new Error('private transport detail', { cause }), {
      code: 'UND_ERR_SOCKET',
    });
    const diagnostic = describeReflectionProviderFailure({
      sessionId: 'session-1',
      clientRequestId: 'client-request-1',
      error: transportError,
      at: '2026-07-30T10:00:00.000Z',
    });

    assert.deepEqual(diagnostic, {
      at: '2026-07-30T10:00:00.000Z',
      sessionId: 'session-1',
      clientRequestId: 'client-request-1',
      failureKind: 'transport',
      errorName: 'Error',
      errorCode: 'UND_ERR_SOCKET',
      cause: { name: 'Error', code: 'ECONNRESET' },
      http: null,
    });
    const serializedDiagnostic = JSON.stringify(diagnostic);
    assert.equal(serializedDiagnostic.includes('private transport detail'), false);
    assert.equal(serializedDiagnostic.includes('private cause detail'), false);
  });

  test('classifies truncation before attempting to parse the partial body', async () => {
    const provider = createLunaReflectionProvider({
      environment: { OPENAI_API_KEY: 'secret' },
      systemPrompt: 'prompt',
      fetchImplementation: capturingFetch(responseEnvelope(
        '{"schemaVersion":"session_reflection_result.v4"',
        {
          choices: [{
            finish_reason: 'length',
            message: { content: '{"private":"partial-response"' },
          }],
        },
      ), []),
    });

    const error = await expectProviderError(provider.generate(bundle), 'output_truncated');
    assert.equal(JSON.stringify(error).includes('partial-response'), false);
    assert.deepEqual(error.metadata, {
      provider: 'openai',
      modelConfig: 'gpt-5.6-luna-high',
      providerModel: 'gpt-5.6-luna',
      promptVersion: 'reflection-v2',
      responseId: 'response-1',
      finishReason: 'length',
      usage: {
        inputTokens: 100,
        cachedInputTokens: null,
        cacheWriteInputTokens: null,
        outputTokens: 40,
        reasoningTokens: 10,
        totalTokens: 140,
      },
    });
  });

  test('distinguishes invalid JSON, schema failures, and domain-contract failures', async () => {
    const cases: Array<{
      content: string;
      code: LunaReflectionProviderError['code'];
      hasIssues: boolean;
    }> = [
      { content: '{not-json', code: 'invalid_json', hasIssues: false },
      {
        content: JSON.stringify({
          schemaVersion: 'session_reflection_result.v4',
        }),
        code: 'schema_invalid',
        hasIssues: true,
      },
      {
        content: JSON.stringify({
          ...validResult,
          itemResults: [{ ...validResult.itemResults[0]!, itemId: 'unknown-item' }],
        }),
        code: 'domain_contract_invalid',
        hasIssues: true,
      },
    ];

    for (const testCase of cases) {
      const provider = createLunaReflectionProvider({
        environment: { OPENAI_API_KEY: 'secret' },
        systemPrompt: 'prompt',
        fetchImplementation: capturingFetch(responseEnvelope(testCase.content), []),
      });
      const error = await expectProviderError(provider.generate(bundle), testCase.code);
      assert.equal(error.issueCount > 0, testCase.hasIssues);
      assert.equal(JSON.stringify(error).includes(testCase.content), false);
    }
  });

  test('loads the promoted production V2 prompt when no prompt is injected', async () => {
    const capture: CapturedRequest[] = [];
    const provider = createLunaReflectionProvider({
      environment: { OPENAI_API_KEY: 'secret' },
      fetchImplementation: capturingFetch(
        responseEnvelope(JSON.stringify(validResult)),
        capture,
      ),
    });

    await provider.generate(bundle);

    const messages = capture[0]?.body.messages;
    assert.ok(Array.isArray(messages));
    const systemMessage = messages[0];
    const systemContent = typeof systemMessage === 'object'
      && systemMessage !== null
      && !Array.isArray(systemMessage)
      ? systemMessage.content
      : null;
    assert.equal(typeof systemContent, 'string');
    assert.match(
      systemContent as string,
      /^# Post-Session Reflection V2\n\nYou are a careful Mandarin-learning reflection assistant\./,
    );
  });
});
