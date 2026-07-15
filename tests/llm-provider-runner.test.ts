import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { allProviderFixtures } from '../spikes/llm-provider/fixtures/index.js';
import { getModelTarget, modelTargets } from '../spikes/llm-provider/runner/model-registry.js';
import { createAnthropicAdapter } from '../spikes/llm-provider/runner/providers/anthropic.js';
import { createGeminiAdapter } from '../spikes/llm-provider/runner/providers/gemini.js';
import { getProviderAdapter } from '../spikes/llm-provider/runner/providers/index.js';
import { createOpenAiCompatibleAdapter } from '../spikes/llm-provider/runner/providers/openai-compatible.js';
import {
  SESSION_REFLECTION_RESULT_SCHEMA_NAME,
  sessionReflectionResultSchema,
} from '../spikes/llm-provider/runner/result-schema.js';
import { validateResultAgainstBundle } from '../spikes/llm-provider/runner/result-validator.js';
import { runBatch } from '../spikes/llm-provider/runner/run-batch.js';
import { renderFixtureUserPrompt, runFixture } from '../spikes/llm-provider/runner/run-fixture.js';
import { validateJsonSchema } from '../spikes/llm-provider/runner/schema-validator.js';
import type { JsonValue, ProviderAdapter, ProviderRunRequest } from '../spikes/llm-provider/runner/types.js';
import { scanRunArtifacts } from '../spikes/llm-provider/viewer/artifact-index.js';
import {
  buildViewerIndex,
  defaultViewerStaticDirectory,
  findRunArtifact,
} from '../spikes/llm-provider/viewer/server.js';

type CapturedRequest = {
  url: string;
  headers: Headers;
  body: Record<string, JsonValue>;
};

function mockFetch(responseBody: JsonValue, capture: CapturedRequest[]): typeof globalThis.fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const requestBody = JSON.parse(String(init?.body)) as Record<string, JsonValue>;
    capture.push({
      url: String(input),
      headers: new Headers(init?.headers),
      body: requestBody,
    });
    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof globalThis.fetch;
}

function providerRequest(): ProviderRunRequest {
  return {
    model: 'test-model',
    systemPrompt: 'System instructions that require a JSON response.',
    userPrompt: '{"fixture":"input"}',
    outputSchemaName: SESSION_REFLECTION_RESULT_SCHEMA_NAME,
    outputSchema: sessionReflectionResultSchema,
    maxOutputTokens: 4_096,
    temperature: null,
    timeoutMs: 10_000,
    cachePrompt: true,
  };
}

describe('LLM provider result schema', () => {
  test('accepts every ready fixture reference result and its bundle references', () => {
    for (const fixture of allProviderFixtures) {
      assert.equal(fixture.readiness, 'ready');
      assert.notEqual(fixture.referenceResult, null);
      const referenceResult = fixture.referenceResult!;
      assert.deepEqual(validateJsonSchema(referenceResult, sessionReflectionResultSchema), [], fixture.fixtureId);
      assert.deepEqual(validateResultAgainstBundle(referenceResult, fixture.inputBundle), [], fixture.fixtureId);
    }
  });

  test('rejects unknown output properties and malformed handle payloads', () => {
    const fixture = allProviderFixtures.find((item) => item.fixtureId === 'ex02-to');
    assert.ok(fixture?.referenceResult);
    const withUnknownProperty = structuredClone(fixture.referenceResult) as unknown as Record<string, unknown>;
    withUnknownProperty.extra = true;
    assert.match(validateJsonSchema(withUnknownProperty, sessionReflectionResultSchema).join('\n'), /unknown property/);

    const malformed = structuredClone(fixture.referenceResult);
    malformed.itemResults[0]!.proposals[0]!.operation = {
      kind: 'suppress_definition_production',
      wordId: 'word',
      reason: 'not-a-real-reason',
      note: '',
    } as never;
    assert.notEqual(validateJsonSchema(malformed, sessionReflectionResultSchema).length, 0);
  });
});

describe('LLM provider fixture run', () => {
  test('sends only the input bundle as the provider user payload', () => {
    const fixture = allProviderFixtures[0]!;
    assert.equal(renderFixtureUserPrompt(fixture), JSON.stringify(fixture.inputBundle));
    assert.equal(renderFixtureUserPrompt(fixture).includes('requiredJudgments'), false);
    assert.equal(renderFixtureUserPrompt(fixture).includes('referenceResult'), false);
  });

  test('records a validated successful run without exposing adapter credentials', async () => {
    const fixture = allProviderFixtures[0]!;
    assert.ok(fixture.referenceResult);
    const adapter: ProviderAdapter = {
      id: 'fake-provider',
      defaultBaseUrl: 'https://example.invalid',
      apiKeyEnvironmentVariable: 'FAKE_KEY',
      structuredOutputMode: 'json_schema',
      async run() {
        return {
          provider: 'fake-provider',
          model: 'fake-snapshot',
          responseId: 'fake-response',
          structuredOutputMode: 'json_schema',
          rawText: JSON.stringify(fixture.referenceResult),
          finishReason: 'stop',
          usage: {
            inputTokens: 100,
            cachedInputTokens: 80,
            cacheWriteInputTokens: null,
            outputTokens: 20,
            reasoningTokens: null,
            totalTokens: 120,
          },
          rawResponse: { id: 'fake-response' },
        };
      },
    };

    const artifact = await runFixture({
      adapter,
      fixture,
      model: 'fake-alias',
      apiKey: 'must-not-appear',
      baseUrl: null,
      systemPrompt: 'Return a structured reflection.',
      systemPromptFile: '/tmp/prompt.md',
      maxOutputTokens: 4_096,
      temperature: null,
      timeoutMs: 10_000,
      cachePrompt: true,
    });

    assert.equal(artifact.response.status, 'success');
    assert.equal(artifact.response.providerModel, 'fake-snapshot');
    assert.equal(JSON.stringify(artifact).includes('must-not-appear'), false);
  });
});

describe('LLM provider model batch and viewer', () => {
  test('registers the requested OpenAI and ZAI model ids without extra disambiguation', () => {
    assert.deepEqual(modelTargets.map((target) => target.id), [
      'gpt-5.6-terra',
      'gpt-5.6-luna',
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.4-nano',
      'glm-5.2',
      'glm-5',
      'glm-4.7',
      'glm-4.7-flashx',
      'glm-4.7-flash',
    ]);
    assert.deepEqual(getModelTarget('glm-5'), { id: 'glm-5', provider: 'zai', model: 'glm-5' });
    assert.equal(getProviderAdapter('zai').defaultBaseUrl, 'https://api.z.ai/api/paas/v4');
  });

  test('writes ordered independent artifacts for later selection without generating a report', async () => {
    const fixture = allProviderFixtures[0]!;
    assert.ok(fixture.referenceResult);
    const calls: string[] = [];
    const adapter: ProviderAdapter = {
      id: 'fake',
      defaultBaseUrl: 'https://example.invalid',
      apiKeyEnvironmentVariable: 'FAKE_KEY',
      structuredOutputMode: 'json_schema',
      async run(request) {
        calls.push(request.model);
        return {
          provider: 'fake',
          model: request.model,
          responseId: `response-${request.model}`,
          structuredOutputMode: 'json_schema',
          rawText: JSON.stringify(fixture.referenceResult),
          finishReason: 'stop',
          usage: {
            inputTokens: 100,
            cachedInputTokens: 80,
            cacheWriteInputTokens: null,
            outputTokens: 20,
            reasoningTokens: 5,
            totalTokens: 120,
          },
          rawResponse: { model: request.model },
        };
      },
    };
    const targets = [
      { id: 'first-model', provider: 'fake', model: 'first-snapshot' },
      { id: 'second-model', provider: 'fake', model: 'second-snapshot' },
    ];
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-batch-'));
    try {
      const entries = await runBatch({
        fixture,
        targets,
        apiKeysByProvider: new Map([['fake', 'secret']]),
        systemPrompt: 'Return a reflection.',
        systemPromptFile: '/tmp/reflection-v0.md',
        outputDirectory: temporaryDirectory,
        maxOutputTokens: 4_096,
        temperature: null,
        timeoutMs: 10_000,
        cachePrompt: true,
        getAdapter: () => adapter,
      });

      assert.deepEqual(calls, ['first-snapshot', 'second-snapshot']);
      assert.equal(entries.length, 2);
      assert.equal(entries.every((entry) => fs.existsSync(entry.artifactPath)), true);
      assert.equal(entries.every((entry) => path.dirname(entry.artifactPath) === path.join(temporaryDirectory, 'runs')), true);
      assert.equal(fs.existsSync(path.join(temporaryDirectory, 'comparisons')), false);
      const scan = scanRunArtifacts(temporaryDirectory);
      assert.deepEqual(scan.artifacts.map((entry) => entry.index.requestedModel).sort(), ['first-snapshot', 'second-snapshot']);
      assert.equal(JSON.stringify(entries).includes('secret'), false);
    } finally {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  test('builds a recursive read-only artifact index with fixture guidance, run details, and viewer assets', async () => {
    const fixture = allProviderFixtures[0]!;
    assert.ok(fixture.referenceResult);
    const adapter: ProviderAdapter = {
      id: 'fake',
      defaultBaseUrl: 'https://example.invalid',
      apiKeyEnvironmentVariable: 'FAKE_KEY',
      structuredOutputMode: 'json_schema',
      async run() {
        return {
          provider: 'fake',
          model: 'fake-snapshot',
          responseId: 'response-viewer',
          structuredOutputMode: 'json_schema',
          rawText: JSON.stringify(fixture.referenceResult),
          finishReason: 'stop',
          usage: {
            inputTokens: 100,
            cachedInputTokens: 80,
            cacheWriteInputTokens: null,
            outputTokens: 20,
            reasoningTokens: 5,
            totalTokens: 120,
          },
          rawResponse: { id: 'response-viewer' },
        };
      },
    };
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-viewer-'));
    const artifact = await runFixture({
      adapter,
      fixture,
      model: 'fake-model',
      apiKey: 'secret',
      baseUrl: null,
      systemPrompt: 'Return a reflection.',
      systemPromptFile: '/tmp/reflection-v1.md',
      maxOutputTokens: 4_096,
      temperature: null,
      timeoutMs: 10_000,
      cachePrompt: true,
    });
    const nestedDirectory = path.join(temporaryDirectory, 'old-comparison', 'runs');
    fs.mkdirSync(nestedDirectory, { recursive: true });
    fs.writeFileSync(path.join(nestedDirectory, 'run.json'), JSON.stringify(artifact));
    fs.writeFileSync(path.join(temporaryDirectory, 'broken.json'), '{');

    try {
      const index = buildViewerIndex(temporaryDirectory) as {
        runs: Array<{ runId: string; requestedModel: string; relativePath: string }>;
        fixtures: Array<{ fixtureId: string; evaluation: { requiredJudgments: string[] } }>;
        warnings: Array<{ relativePath: string }>;
      };
      assert.equal(index.runs.length, 1);
      assert.equal(index.runs[0]?.requestedModel, 'fake-model');
      assert.equal(index.runs[0]?.relativePath, 'old-comparison/runs/run.json');
      assert.equal(index.fixtures.find((item) => item.fixtureId === fixture.fixtureId)?.evaluation.requiredJudgments.length, fixture.evaluation.requiredJudgments.length);
      assert.deepEqual(index.warnings.map((warning) => warning.relativePath), ['broken.json']);

      assert.equal((findRunArtifact(temporaryDirectory, artifact.runId) as { runId: string }).runId, artifact.runId);
      assert.equal(findRunArtifact(temporaryDirectory, 'missing'), null);
      assert.match(fs.readFileSync(path.join(defaultViewerStaticDirectory, 'index.html'), 'utf8'), /Reflection Run Explorer/);
      assert.match(fs.readFileSync(path.join(defaultViewerStaticDirectory, 'app.js'), 'utf8'), /systemPromptSha256/);
    } finally {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });
});

describe('LLM provider adapters', () => {
  test('OpenAI sends strict JSON Schema and normalizes cached and reasoning usage', async () => {
    const captured: CapturedRequest[] = [];
    const adapter = createOpenAiCompatibleAdapter({
      id: 'openai-test',
      defaultBaseUrl: 'https://openai.example/v1',
      apiKeyEnvironmentVariable: 'OPENAI_API_KEY',
      structuredOutputMode: 'json_schema',
      maxTokensField: 'max_completion_tokens',
      fetchImplementation: mockFetch({
        id: 'response-1',
        model: 'model-snapshot',
        choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }],
        usage: {
          prompt_tokens: 100,
          prompt_tokens_details: { cached_tokens: 80 },
          completion_tokens: 25,
          completion_tokens_details: { reasoning_tokens: 10 },
          total_tokens: 125,
        },
      }, captured),
    });

    const result = await adapter.run(providerRequest(), { apiKey: 'secret', baseUrl: null });
    assert.equal(captured[0]?.url, 'https://openai.example/v1/chat/completions');
    assert.equal(captured[0]?.headers.get('authorization'), 'Bearer secret');
    assert.equal(captured[0]?.body.max_completion_tokens, 4_096);
    assert.deepEqual(captured[0]?.body.response_format, {
      type: 'json_schema',
      json_schema: {
        name: SESSION_REFLECTION_RESULT_SCHEMA_NAME,
        strict: true,
        schema: sessionReflectionResultSchema,
      },
    });
    assert.equal(result.usage.cachedInputTokens, 80);
    assert.equal(result.usage.reasoningTokens, 10);
  });

  test('DeepSeek-compatible mode requests a JSON object and reads cache-hit usage', async () => {
    const captured: CapturedRequest[] = [];
    const adapter = createOpenAiCompatibleAdapter({
      id: 'deepseek-test',
      defaultBaseUrl: 'https://deepseek.example',
      apiKeyEnvironmentVariable: 'DEEPSEEK_API_KEY',
      structuredOutputMode: 'json_object',
      maxTokensField: 'max_tokens',
      fetchImplementation: mockFetch({
        id: 'response-2',
        model: 'deepseek-snapshot',
        choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }],
        usage: {
          prompt_tokens: 100,
          prompt_cache_hit_tokens: 75,
          prompt_cache_miss_tokens: 25,
          completion_tokens: 15,
          total_tokens: 115,
        },
      }, captured),
    });

    const result = await adapter.run(providerRequest(), { apiKey: 'secret', baseUrl: null });
    assert.equal(captured[0]?.body.max_tokens, 4_096);
    assert.deepEqual(captured[0]?.body.response_format, { type: 'json_object' });
    const messages = JSON.stringify(captured[0]?.body.messages);
    assert.match(messages, /System instructions that require a JSON response/);
    assert.match(messages, /Return exactly one JSON object matching the following JSON Schema/);
    assert.match(messages, /session_reflection_result\.v0/);
    assert.equal(result.structuredOutputMode, 'json_object');
    assert.equal(result.usage.cachedInputTokens, 75);
  });

  test('Anthropic uses native structured output and an explicit system-prompt cache breakpoint', async () => {
    const captured: CapturedRequest[] = [];
    const adapter = createAnthropicAdapter(mockFetch({
      id: 'message-1',
      model: 'claude-snapshot',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '{"ok":true}' }],
      usage: {
        input_tokens: 20,
        cache_creation_input_tokens: 100,
        cache_read_input_tokens: 0,
        output_tokens: 10,
      },
    }, captured));

    const result = await adapter.run(providerRequest(), { apiKey: 'secret', baseUrl: null });
    assert.equal(captured[0]?.url, 'https://api.anthropic.com/v1/messages');
    assert.equal(captured[0]?.headers.get('x-api-key'), 'secret');
    assert.deepEqual(captured[0]?.body.system, [{
      type: 'text',
      text: providerRequest().systemPrompt,
      cache_control: { type: 'ephemeral' },
    }]);
    assert.deepEqual(captured[0]?.body.output_config, {
      format: { type: 'json_schema', schema: sessionReflectionResultSchema },
    });
    assert.equal(result.usage.cacheWriteInputTokens, 100);
    assert.equal(result.usage.totalTokens, 130);
  });

  test('Gemini uses the Interactions API and normalizes thought and cached tokens', async () => {
    const captured: CapturedRequest[] = [];
    const adapter = createGeminiAdapter(mockFetch({
      id: 'interaction-1',
      model: 'gemini-snapshot',
      status: 'completed',
      steps: [{ type: 'model_output', content: [{ type: 'text', text: '{"ok":true}' }] }],
      usage: {
        total_input_tokens: 120,
        total_cached_tokens: 90,
        total_output_tokens: 30,
        total_thought_tokens: 20,
        total_tokens: 170,
      },
    }, captured));

    const result = await adapter.run(providerRequest(), { apiKey: 'secret', baseUrl: null });
    assert.equal(captured[0]?.url, 'https://generativelanguage.googleapis.com/v1beta/interactions');
    assert.equal(captured[0]?.headers.get('x-goog-api-key'), 'secret');
    assert.equal(captured[0]?.body.system_instruction, providerRequest().systemPrompt);
    assert.deepEqual(captured[0]?.body.response_format, {
      type: 'text',
      mime_type: 'application/json',
      schema: sessionReflectionResultSchema,
    });
    assert.equal(result.usage.cachedInputTokens, 90);
    assert.equal(result.usage.reasoningTokens, 20);
  });
});
