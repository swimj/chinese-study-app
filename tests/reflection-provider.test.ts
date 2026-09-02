import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  SESSION_REFLECTION_RESULT_V7_WIRE_SCHEMA_NAME,
  sessionReflectionResultV7WireSchema,
} from '../src/domain/reflection-result-schema.js';
import type {
  SessionReflectionBundleV2,
  SessionReflectionResultV7,
  SessionReflectionResultV7Wire,
} from '../src/domain/reflection.js';
import {
  createLunaReflectionProvider,
  createReflectionProvider,
  LUNA_REFLECTION_MODEL_CONFIG,
  LUNA_REFLECTION_PROMPT_VERSION,
  LunaReflectionProviderError,
} from '../server/reflection/luna-provider.js';
import { REFLECTION_MODEL_ARMS } from '../server/reflection/model-arms.ts';
import {
  createGlmReflectionProvider,
  GLM_REFLECTION_MODEL_CONFIG,
} from '../server/reflection/glm-provider.js';
import type { JsonValue } from '../server/llm/types.js';
import { validateJsonSchema } from '../server/llm/json-schema-validator.js';
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

const bundle: SessionReflectionBundleV2 = {
  schemaVersion: 'session_reflection_bundle.v2',
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
    sourceAttemptId: 'attempt-1',
    servedCue: {
      cueId: 'cue-1',
      cueType: 'definition_gloss',
      text: 'to know',
      acceptedWordIds: ['word-1'],
    },
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

const validWireResult: SessionReflectionResultV7Wire = {
  schemaVersion: 'session_reflection_result.v7',
  itemResults: [{
    itemId: 'item-1',
    diagnosisTags: ['valid_or_near_valid_alternate'],
    learnerExplanation: '认识 is also a natural answer to this exact broad cue, although its uses are not identical to 知道 in every context.',
    proposals: [{
      proposalGroupKey: null,
      rationale: 'Admit the resolved alternate while preserving the exact cue evidence.',
      operation: {
        kind: 'repair_production_cue',
        wordId: 'word-1',
        changes: [{
          kind: 'replace',
          cueId: 'cue-1',
          replacements: [{
            cueType: 'definition_gloss',
            text: 'to know',
            acceptedWordIds: ['word-1', 'word-2'],
          }],
        }],
        sourceAttemptJudgments: [{
          kind: 'accepted_answer_space_omission',
          submittedWordId: 'word-2',
        }],
      },
    }],
    questions: [],
  }],
};

const validCanonicalResult: SessionReflectionResultV7 = {
  ...validWireResult,
  itemResults: validWireResult.itemResults.map((itemResult) => ({
    ...itemResult,
    proposals: itemResult.proposals.map((proposal) => ({
      ...proposal,
      operation: proposal.operation.kind === 'repair_production_cue'
        ? {
              ...proposal.operation,
              version: 2,
              taskId: `production-task:${proposal.operation.wordId}:default_production`,
              sourceAttemptJudgments: proposal.operation.sourceAttemptJudgments.map((judgment) => ({
                ...judgment,
                sourceAttemptId: 'attempt-1',
              })),
          }
        : proposal.operation,
    })),
  })),
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
  test('uses Z.AI JSON-object transport for GLM-5.3 high', async () => {
    const capture: CapturedRequest[] = [];
    const provider = createGlmReflectionProvider({
      environment: { ZAI_API_KEY: 'unit-test-zai-secret' },
      systemPrompt: 'Production reflection system prompt.',
      fetchImplementation: capturingFetch(responseEnvelope(JSON.stringify(validWireResult)), capture),
    });

    const generated = await provider.generate(bundle);

    const request = capture[0]!;
    assert.equal(request.url, 'https://api.z.ai/api/paas/v4/chat/completions');
    assert.equal(request.headers.get('authorization'), 'Bearer unit-test-zai-secret');
    assert.equal(request.body.model, 'glm-5.3');
    assert.equal(request.body.reasoning_effort, 'high');
    assert.equal(request.body.max_tokens, 50_000);
    assert.deepEqual(request.body.response_format, { type: 'json_object' });
    assert.equal(generated.metadata.provider, 'zai');
    assert.equal(generated.metadata.modelConfig, 'glm-5.3-high');
    assert.equal(GLM_REFLECTION_MODEL_CONFIG.timeoutMs, 900_000);
  });

  test('sends the exact model, reasoning, auth, prompt, and strict V7 wire schema request', async () => {
    const capture: CapturedRequest[] = [];
    const provider = createLunaReflectionProvider({
      environment: {
        OPENAI_API_KEY: 'unit-test-secret',
        OPENAI_BASE_URL: 'https://openai.example.test/custom/v1/',
      },
      systemPrompt: 'Production reflection system prompt.',
      fetchImplementation: capturingFetch(
        responseEnvelope(JSON.stringify(validWireResult), {
          transportDebug: 'must-not-be-returned',
        }),
        capture,
      ),
    });

    const generated = await provider.generate(bundle, { clientRequestId: 'reflection-run-123' });

    assert.equal(capture.length, 1);
    const request = capture[0]!;
    assert.equal(request.url, 'https://openai.example.test/custom/v1/chat/completions');
    assert.equal(request.url.includes('7897'), false);
    assert.equal(request.headers.get('authorization'), 'Bearer unit-test-secret');
    assert.equal(request.headers.get('x-client-request-id'), 'reflection-run-123');
    assert.deepEqual(request.body.messages, [
      { role: 'system', content: 'Production reflection system prompt.' },
      { role: 'user', content: JSON.stringify(bundle) },
    ]);
    assert.equal(request.body.model, 'gpt-5.6-luna');
    assert.equal(request.body.reasoning_effort, 'high');
    assert.equal(request.body.max_completion_tokens, 50_000);
    assert.equal(Object.hasOwn(request.body, 'temperature'), false);
    assert.deepEqual(request.body.response_format, {
      type: 'json_schema',
      json_schema: {
        name: SESSION_REFLECTION_RESULT_V7_WIRE_SCHEMA_NAME,
        strict: true,
        schema: sessionReflectionResultV7WireSchema,
      },
    });
    assert.ok(request.signal instanceof AbortSignal);
    assert.equal(LUNA_REFLECTION_MODEL_CONFIG.modelConfig, 'gpt-5.6-luna-high');
    assert.equal(LUNA_REFLECTION_MODEL_CONFIG.providerModel, 'gpt-5.6-luna');
    const wireOperation = validWireResult.itemResults[0]!.proposals[0]!.operation;
    const canonicalOperation = generated.result.itemResults[0]!.proposals[0]!.operation;
    assert.equal(wireOperation.kind, 'repair_production_cue');
    assert.equal(Object.hasOwn(wireOperation, 'version'), false);
    assert.equal(Object.hasOwn(wireOperation, 'taskId'), false);
    assert.equal(Object.hasOwn(wireOperation.sourceAttemptJudgments[0]!, 'sourceAttemptId'), false);
    assert.equal(canonicalOperation.kind, 'repair_production_cue');
    assert.equal(canonicalOperation.version, 2);
    assert.equal(canonicalOperation.taskId, 'production-task:word-1:default_production');
    assert.equal(canonicalOperation.sourceAttemptJudgments[0]?.sourceAttemptId, 'attempt-1');
    assert.deepEqual(generated.result, validCanonicalResult);
    assert.deepEqual(generated.metadata, {
      provider: 'openai',
      modelConfig: 'gpt-5.6-luna-high',
      providerModel: 'gpt-5.6-luna',
      promptVersion: 'reflection-v8',
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
    assert.equal(LUNA_REFLECTION_PROMPT_VERSION, 'reflection-v8');
    const serialized = JSON.stringify(generated);
    assert.equal(serialized.includes('unit-test-secret'), false);
    assert.equal(serialized.includes('transportDebug'), false);
    assert.equal(serialized.includes('must-not-be-returned'), false);
  });

  test('pins the Claude arm to Anthropic native schema output', async () => {
    const capture: CapturedRequest[] = [];
    const arm = REFLECTION_MODEL_ARMS.find((candidate) => (
      candidate.choice === 'openrouter:claude-sonnet-5'
    ));
    assert.ok(arm?.config);
    const provider = createReflectionProvider(arm.config, {
      environment: { OPENROUTER_API_KEY: 'unit-test-openrouter-secret' },
      systemPrompt: 'Production reflection system prompt.',
      fetchImplementation: capturingFetch(responseEnvelope(JSON.stringify(validWireResult)), capture),
    });

    await provider.generate(bundle);

    const request = capture[0]!;
    assert.equal(request.url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.deepEqual(request.body.response_format, {
      type: 'json_schema',
      json_schema: {
        name: SESSION_REFLECTION_RESULT_V7_WIRE_SCHEMA_NAME,
        strict: true,
        schema: sessionReflectionResultV7WireSchema,
      },
    });
    assert.deepEqual(request.body.provider, {
      order: ['anthropic'],
      allow_fallbacks: false,
      require_parameters: true,
    });
  });

  test('retains a non-negative provider-reported request cost', async () => {
    const provider = createLunaReflectionProvider({
      environment: { OPENAI_API_KEY: 'unit-test-secret' },
      systemPrompt: 'prompt',
      fetchImplementation: capturingFetch(responseEnvelope(JSON.stringify(validWireResult), {
        usage: {
          prompt_tokens: 100,
          completion_tokens: 40,
          total_tokens: 140,
          cost: 0.000082824,
        },
      }), []),
    });

    const generated = await provider.generate(bundle);
    assert.equal(generated.metadata.reportedCostUsd, 0.000082824);
  });

  test('accepts legacy source attempt ids but canonicalizes them from evidence', async () => {
    const legacy = structuredClone(validWireResult) as unknown as {
      itemResults: Array<{ proposals: Array<{ operation: { sourceAttemptJudgments: Array<Record<string, string>> } }> }>;
    };
    legacy.itemResults[0]!.proposals[0]!.operation.sourceAttemptJudgments[0]!.sourceAttemptId = 'attempt-typo';
    const provider = createLunaReflectionProvider({
      environment: { OPENAI_API_KEY: 'secret' },
      systemPrompt: 'prompt',
      fetchImplementation: capturingFetch(responseEnvelope(JSON.stringify(legacy)), []),
    });

    const generated = await provider.generate(bundle);
    const operation = generated.result.itemResults[0]!.proposals[0]!.operation;
    assert.equal(operation.kind, 'repair_production_cue');
    if (operation.kind === 'repair_production_cue') {
      assert.equal(operation.sourceAttemptJudgments[0]?.sourceAttemptId, 'attempt-1');
    }
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
        '{"schemaVersion":"session_reflection_result.v7"',
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
      promptVersion: 'reflection-v8',
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
          schemaVersion: 'session_reflection_result.v7',
        }),
        code: 'schema_invalid',
        hasIssues: true,
      },
      {
        content: JSON.stringify({
          ...validWireResult,
          itemResults: [{ ...validWireResult.itemResults[0]!, itemId: 'unknown-item' }],
        }),
        code: 'domain_contract_invalid',
        hasIssues: true,
      },
    ];

    for (const testCase of cases) {
      if (testCase.code === 'domain_contract_invalid') {
        assert.deepEqual(
          validateJsonSchema(JSON.parse(testCase.content), sessionReflectionResultV7WireSchema),
          [],
        );
      }
      const provider = createLunaReflectionProvider({
        environment: { OPENAI_API_KEY: 'secret' },
        systemPrompt: 'prompt',
        fetchImplementation: capturingFetch(responseEnvelope(testCase.content), []),
      });
      const error = await expectProviderError(provider.generate(bundle), testCase.code);
      assert.equal(error.issueCount > 0, testCase.hasIssues);
      assert.equal(JSON.stringify(error).includes(testCase.content), false);
      if (testCase.code === 'schema_invalid') {
        assert.match(error.clientRequestId ?? '', /^[0-9a-f-]{36}$/);
        assert.equal(error.diagnostic?.phase, 'structural_schema');
        assert.ok(error.diagnostic?.issues.some((issue) => issue.path === '$.itemResults'));
      }
      if (testCase.code === 'domain_contract_invalid') {
        assert.equal(error.diagnostic?.phase, 'domain_validation');
        assert.ok(error.diagnostic?.issues.some((issue) => issue.path.includes('itemResults')));
      }
    }
  });

  test('bounds rejected output without hiding dogfood context', async () => {
    const provider = createLunaReflectionProvider({
      environment: { OPENAI_API_KEY: 'secret' },
      systemPrompt: 'prompt',
      fetchImplementation: capturingFetch(
        responseEnvelope(JSON.stringify({
          schemaVersion: 'session_reflection_result.v4',
          apiKey: 'sk-secret-value-123456789',
          rejected: 'x'.repeat(10_000),
        })),
        [],
      ),
    });
    const error = await expectProviderError(provider.generate(bundle), 'schema_invalid');
    assert.equal(error.diagnostic?.rejectedOutput?.includes('sk-secret-value-123456789'), true);
    assert.ok((error.diagnostic?.rejectedOutput?.length ?? 0) <= 4_020);
    assert.match(error.diagnostic?.rejectedOutput ?? '', /truncated/);
  });

  test('loads the fixed active production prompt when no prompt is injected', async () => {
    const capture: CapturedRequest[] = [];
    const provider = createLunaReflectionProvider({
      environment: { OPENAI_API_KEY: 'secret' },
      fetchImplementation: capturingFetch(
        responseEnvelope(JSON.stringify(validWireResult)),
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
      /^# Post-Session Reflection\n\nYou are a careful language-learning reflection assistant\./,
    );
    assert.match(systemContent as string, /`servedCue` is the singular immutable cue snapshot/);
    assert.match(systemContent as string, /`responseKind: no_clue` contains no comparison word/);
    assert.match(systemContent as string, /## Learner feedback and proposal rationales/);
    assert.match(systemContent as string, /## Realizing future content/);
    assert.match(systemContent as string, /## Final consistency check/);
    assert.equal((systemContent as string).includes('`activate`'), false);
    assert.equal((systemContent as string).includes('productionTask'), false);
  });
});
