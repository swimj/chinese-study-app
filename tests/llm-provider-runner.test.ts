import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { allProviderFixtures } from '../spikes/llm-provider/fixtures/index.js';
import { getModelTarget, modelTargets } from '../spikes/llm-provider/runner/model-registry.js';
import { estimateRunCost } from '../spikes/llm-provider/pricing.js';
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
import { validateRunArtifactAgainstCurrentContract } from '../spikes/llm-provider/viewer/current-validation.js';
import {
  buildViewerIndex,
  defaultViewerStaticDirectory,
  findRunArtifact,
  trashRunArtifact,
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
    reasoningEffort: null,
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

  test('requires empty collections instead of omitted questions and unhandled needs', () => {
    const fixture = allProviderFixtures.find((item) => item.fixtureId === 'ex02-to');
    assert.ok(fixture?.referenceResult);
    const result = structuredClone(fixture.referenceResult);
    delete (result.itemResults[0] as { questions?: unknown }).questions;
    delete (result.itemResults[0] as { unhandledNeeds?: unknown }).unhandledNeeds;
    const errors = validateJsonSchema(result, sessionReflectionResultSchema).join('\n');
    assert.match(errors, /questions: required property is missing/);
    assert.match(errors, /unhandledNeeds: required property is missing/);
  });

  test('requires a null summary instead of omitting the provisional session summary', () => {
    const fixture = allProviderFixtures.find((item) => item.fixtureId === 'ex02-to');
    assert.ok(fixture?.referenceResult);
    const result = structuredClone(fixture.referenceResult);
    delete result.summary;
    assert.match(
      validateJsonSchema(result, sessionReflectionResultSchema).join('\n'),
      /summary: required property is missing/,
    );
  });

  test('allows null, empty, and nonempty provisional session summaries', () => {
    const fixture = allProviderFixtures.find((item) => item.fixtureId === 'ex02-to');
    assert.ok(fixture?.referenceResult);
    for (const summary of [null, '', 'Optional context that viewers may ignore.']) {
      const result = structuredClone(fixture.referenceResult);
      result.summary = summary;
      assert.deepEqual(validateJsonSchema(result, sessionReflectionResultSchema), []);
      assert.deepEqual(validateResultAgainstBundle(result, fixture.inputBundle), []);
    }
  });

  test('restricts contrast content to prompt-backed word ids from its corresponding input item', () => {
    const fixture = allProviderFixtures.find((item) => item.fixtureId === 'ex08-xiyiweichang-and-xiguan');
    assert.ok(fixture?.referenceResult);
    const referenceResult = structuredClone(fixture.referenceResult);
    const operation = referenceResult.itemResults[0]!.proposals[0]!.operation;
    assert.equal(operation.kind, 'upsert_contrast_content');
    if (operation.kind !== 'upsert_contrast_content') throw new Error('Expected contrast content operation');

    const unknownWordResult = structuredClone(referenceResult);
    const unknownWordOperation = unknownWordResult.itemResults[0]!.proposals[0]!.operation;
    assert.equal(unknownWordOperation.kind, 'upsert_contrast_content');
    if (unknownWordOperation.kind !== 'upsert_contrast_content') throw new Error('Expected contrast content operation');
    unknownWordOperation.members[1]!.wordId = 'invented-word-id';
    assert.deepEqual(validateJsonSchema(unknownWordResult, sessionReflectionResultSchema), []);
    assert.match(
      validateResultAgainstBundle(unknownWordResult, fixture.inputBundle).join('\n'),
      /word id invented-word-id is not present in item ex08-item/,
    );

    const duplicateWordResult = structuredClone(referenceResult);
    const duplicateWordOperation = duplicateWordResult.itemResults[0]!.proposals[0]!.operation;
    assert.equal(duplicateWordOperation.kind, 'upsert_contrast_content');
    if (duplicateWordOperation.kind !== 'upsert_contrast_content') throw new Error('Expected contrast content operation');
    duplicateWordOperation.members[1]!.wordId = duplicateWordOperation.members[0]!.wordId;
    assert.match(
      validateResultAgainstBundle(duplicateWordResult, fixture.inputBundle).join('\n'),
      /at least two distinct words are required/,
    );

    const emptyPromptsResult = structuredClone(referenceResult);
    const emptyPromptsOperation = emptyPromptsResult.itemResults[0]!.proposals[0]!.operation;
    assert.equal(emptyPromptsOperation.kind, 'upsert_contrast_content');
    if (emptyPromptsOperation.kind !== 'upsert_contrast_content') throw new Error('Expected contrast content operation');
    emptyPromptsOperation.prompts = [];
    assert.match(validateJsonSchema(emptyPromptsResult, sessionReflectionResultSchema).join('\n'), /expected at least 1 item/);
    assert.match(validateResultAgainstBundle(emptyPromptsResult, fixture.inputBundle).join('\n'), /at least one prompt is required/);

    const otherFixture = allProviderFixtures.find((item) => item.fixtureId === 'ex02-to');
    assert.ok(otherFixture?.referenceResult);
    const crossItemBundle = structuredClone(fixture.inputBundle);
    crossItemBundle.items.push(structuredClone(otherFixture.inputBundle.items[0]!));
    const crossItemResult = structuredClone(referenceResult);
    crossItemResult.itemResults.push(structuredClone(otherFixture.referenceResult.itemResults[0]!));
    const crossItemOperation = crossItemResult.itemResults[0]!.proposals[0]!.operation;
    assert.equal(crossItemOperation.kind, 'upsert_contrast_content');
    if (crossItemOperation.kind !== 'upsert_contrast_content') throw new Error('Expected contrast content operation');
    crossItemOperation.members[1]!.wordId = 'ex02-submitted';
    assert.match(
      validateResultAgainstBundle(crossItemResult, crossItemBundle).join('\n'),
      /word id ex02-submitted is not present in item ex08-item/,
    );
  });

  test('does not accept model-emitted evidence citation fields in V2 results', () => {
    const fixture = allProviderFixtures[0];
    assert.ok(fixture?.referenceResult);
    const withItemEvidence = structuredClone(fixture.referenceResult) as unknown as {
      itemResults: Array<Record<string, unknown>>;
    };
    withItemEvidence.itemResults[0]!.evidence = [];
    assert.match(validateJsonSchema(withItemEvidence, sessionReflectionResultSchema).join('\n'), /unknown property/);
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

  test('reports provider output truncation before JSON or schema validation', async () => {
    const fixture = allProviderFixtures[0]!;
    const adapter: ProviderAdapter = {
      id: 'fake-provider',
      defaultBaseUrl: 'https://example.invalid',
      apiKeyEnvironmentVariable: 'FAKE_KEY',
      structuredOutputMode: 'json_object',
      async run() {
        return {
          provider: 'fake-provider',
          model: 'fake-truncated',
          responseId: 'truncated-response',
          structuredOutputMode: 'json_object',
          rawText: '{"schemaVersion":"session_reflection_result.v2"',
          finishReason: 'length',
          usage: {
            inputTokens: 100,
            cachedInputTokens: 0,
            cacheWriteInputTokens: null,
            outputTokens: 4_096,
            reasoningTokens: null,
            totalTokens: 4_196,
          },
          rawResponse: { id: 'truncated-response' },
        };
      },
    };

    const artifact = await runFixture({
      adapter,
      fixture,
      model: 'fake-truncated',
      apiKey: 'secret',
      baseUrl: null,
      systemPrompt: 'Return a structured reflection.',
      systemPromptFile: '/tmp/prompt.md',
      maxOutputTokens: 4_096,
      temperature: null,
      timeoutMs: 10_000,
      cachePrompt: true,
    });

    assert.equal(artifact.response.status, 'output_truncated');
    assert.match(artifact.response.validationErrors[0] ?? '', /finish reason: length/);
    assert.equal(artifact.response.parsedResult, null);
  });
});

describe('LLM provider model batch and viewer', () => {
  test('estimates registered model cost from normalized input, cached input, and output usage', () => {
    assert.deepEqual(estimateRunCost('gpt-5.4-mini', {
      inputTokens: 1_000_000,
      cachedInputTokens: 400_000,
      cacheWriteInputTokens: null,
      outputTokens: 200_000,
      reasoningTokens: null,
      totalTokens: 1_200_000,
    }), {
      usd: 1.38,
      pricing: { inputPerMillionUsd: 0.75, cachedInputPerMillionUsd: 0.075, cacheWriteInputPerMillionUsd: 0.9375, outputPerMillionUsd: 4.5 },
    });
    assert.equal(estimateRunCost('unknown-model', null), null);
  });

  test('registers the shortlisted model configurations with their reasoning levels', () => {
    assert.deepEqual(modelTargets.map((target) => target.id), [
      'gpt-5.6-terra-high',
      'gpt-5.6-terra-xhigh',
      'gpt-5.6-luna-high',
      'gpt-5.6-luna-xhigh',
      'gpt-5.4-mini-high',
      'gpt-5.4-mini-xhigh',
      'glm-5.2-high',
      'glm-5.2-max',
    ]);
    assert.deepEqual(getModelTarget('glm-5.2-max'), { id: 'glm-5.2-max', provider: 'zai', model: 'glm-5.2', reasoningEffort: 'max' });
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
      { id: 'first-model', provider: 'fake', model: 'first-snapshot', reasoningEffort: 'high' },
      { id: 'second-model', provider: 'fake', model: 'second-snapshot', reasoningEffort: 'max' },
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
      assert.deepEqual(scan.artifacts.map((entry) => entry.index.requestedModel).sort(), ['first-model', 'second-model']);
      assert.equal(JSON.stringify(entries).includes('secret'), false);
      assert.equal(entries[0]?.artifact.request.model, 'first-model');
      assert.equal(entries[0]?.artifact.request.providerModel, 'first-snapshot');
      assert.equal(entries[0]?.artifact.request.reasoningEffort, 'high');
    } finally {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  test('builds a recursive artifact index with fixture guidance, safe trashing, run details, and viewer assets', async () => {
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
      const currentValidation = validateRunArtifactAgainstCurrentContract(artifact);
      assert.equal(artifact.response.status, 'success');
      assert.equal(currentValidation.status, 'success');
      assert.deepEqual(currentValidation.validationErrors, []);

      const staleContractArtifact = structuredClone(artifact);
      staleContractArtifact.response.rawText = staleContractArtifact.response.rawText!.replace(
        'session_reflection_result.v2',
        'session_reflection_result.v0',
      );
      const staleCurrentValidation = validateRunArtifactAgainstCurrentContract(staleContractArtifact);
      assert.equal(staleContractArtifact.response.status, 'success');
      assert.equal(staleCurrentValidation.status, 'schema_invalid');
      assert.match(staleCurrentValidation.validationErrors.join('\n'), /schemaVersion/);

      const index = buildViewerIndex(temporaryDirectory) as {
        runs: Array<{
          runId: string;
          requestedModel: string;
          relativePath: string;
          status: string;
          currentValidation: { status: string; validationErrors: string[] };
          estimatedCost: unknown;
        }>;
        fixtures: Array<{ fixtureId: string; evaluation: { requiredJudgments: string[] } }>;
        warnings: Array<{ relativePath: string }>;
      };
      assert.equal(index.runs.length, 1);
      assert.equal(index.runs[0]?.requestedModel, 'fake-model');
      assert.equal(index.runs[0]?.relativePath, 'old-comparison/runs/run.json');
      assert.equal(index.runs[0]?.status, 'success');
      assert.equal(index.runs[0]?.currentValidation.status, 'success');
      assert.deepEqual(index.runs[0]?.currentValidation.validationErrors, []);
      assert.equal(index.runs[0]?.estimatedCost, null);
      assert.equal(index.fixtures.find((item) => item.fixtureId === fixture.fixtureId)?.evaluation.requiredJudgments.length, fixture.evaluation.requiredJudgments.length);
      assert.deepEqual(index.warnings.map((warning) => warning.relativePath), ['broken.json']);

      assert.equal((findRunArtifact(temporaryDirectory, artifact.runId) as { runId: string }).runId, artifact.runId);
      assert.equal(findRunArtifact(temporaryDirectory, 'missing'), null);

      const duplicatePath = path.join(temporaryDirectory, 'duplicate.json');
      fs.writeFileSync(duplicatePath, JSON.stringify(artifact));
      const ambiguousTrash = trashRunArtifact(temporaryDirectory, artifact.runId);
      assert.equal(ambiguousTrash.status, 'ambiguous');
      if (ambiguousTrash.status !== 'ambiguous') throw new Error('Expected duplicate run ids to be ambiguous.');
      assert.deepEqual(
        [...ambiguousTrash.relativePaths].sort(),
        ['duplicate.json', 'old-comparison/runs/run.json'],
      );
      assert.equal(fs.existsSync(duplicatePath), true);
      fs.unlinkSync(duplicatePath);

      const trashed = trashRunArtifact(temporaryDirectory, artifact.runId);
      assert.equal(trashed.status, 'trashed');
      if (trashed.status !== 'trashed') throw new Error('Expected the artifact to be trashed.');
      assert.equal(trashed.relativePath, 'old-comparison/runs/run.json');
      assert.match(trashed.trashRelativePath, /^\.trash\//);
      assert.equal(fs.existsSync(path.join(temporaryDirectory, trashed.trashRelativePath)), true);
      assert.equal(findRunArtifact(temporaryDirectory, artifact.runId), null);
      assert.deepEqual(trashRunArtifact(temporaryDirectory, artifact.runId), { status: 'not_found' });
      assert.equal(scanRunArtifacts(temporaryDirectory).artifacts.length, 0);

      assert.match(fs.readFileSync(path.join(defaultViewerStaticDirectory, 'index.html'), 'utf8'), /Reflection Run Explorer/);
      assert.match(fs.readFileSync(path.join(defaultViewerStaticDirectory, 'app.js'), 'utf8'), /systemPromptSha256/);
      assert.match(fs.readFileSync(path.join(defaultViewerStaticDirectory, 'app.js'), 'utf8'), /currentValidation/);
      assert.match(fs.readFileSync(path.join(defaultViewerStaticDirectory, 'app.js'), 'utf8'), /data-delete-run-id/);
    } finally {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });
});

describe('LLM provider adapters', () => {
  test('OpenAI sends strict JSON Schema, requested reasoning effort, and normalizes usage', async () => {
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

    const request = providerRequest();
    request.reasoningEffort = 'high';
    const result = await adapter.run(request, { apiKey: 'secret', baseUrl: null });
    assert.equal(captured[0]?.url, 'https://openai.example/v1/chat/completions');
    assert.equal(captured[0]?.headers.get('authorization'), 'Bearer secret');
    assert.equal(captured[0]?.body.max_completion_tokens, 4_096);
    assert.equal(captured[0]?.body.reasoning_effort, 'high');
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
    assert.match(messages, /session_reflection_result\.v2/);
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
