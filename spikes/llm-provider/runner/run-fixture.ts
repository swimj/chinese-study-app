import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ReflectionProviderFixtureV0, SessionReflectionResultV4 } from '../contracts.js';
import { sessionReflectionResultSchema, SESSION_REFLECTION_RESULT_SCHEMA_NAME } from './result-schema.js';
import { validateResultAgainstBundle } from './result-validator.js';
import { validateJsonSchema } from './schema-validator.js';
import { isOutputTruncationFinishReason } from './types.js';
import type {
  ProviderAdapter,
  ReflectionRunArtifactV0,
  ReflectionRunStatus,
} from './types.js';

export type RunFixtureOptions = {
  adapter: ProviderAdapter;
  fixture: ReflectionProviderFixtureV0;
  model: string;
  modelConfigId?: string;
  reasoningEffort?: string | null;
  apiKey: string;
  baseUrl: string | null;
  systemPrompt: string;
  systemPromptFile: string;
  maxOutputTokens: number;
  temperature: number | null;
  timeoutMs: number;
  cachePrompt: boolean;
};

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function renderFixtureUserPrompt(fixture: ReflectionProviderFixtureV0): string {
  return JSON.stringify(fixture.inputBundle);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runFixture(options: RunFixtureOptions): Promise<ReflectionRunArtifactV0> {
  const runId = randomUUID();
  const startedAt = new Date();
  const userPrompt = renderFixtureUserPrompt(options.fixture);
  const schemaJson = JSON.stringify(sessionReflectionResultSchema);

  let status: ReflectionRunStatus = 'provider_error';
  let responseId: string | null = null;
  let providerModel: string | null = null;
  let finishReason: string | null = null;
  let rawText: string | null = null;
  let parsedResult: SessionReflectionResultV4 | null = null;
  let usage: ReflectionRunArtifactV0['response']['usage'] = null;
  let validationErrors: string[] = [];
  let providerError: string | null = null;
  let rawProviderResponse: ReflectionRunArtifactV0['response']['rawProviderResponse'] = null;

  try {
    const providerResult = await options.adapter.run({
      model: options.model,
      reasoningEffort: options.reasoningEffort ?? null,
      systemPrompt: options.systemPrompt,
      userPrompt,
      outputSchemaName: SESSION_REFLECTION_RESULT_SCHEMA_NAME,
      outputSchema: sessionReflectionResultSchema,
      maxOutputTokens: options.maxOutputTokens,
      temperature: options.temperature,
      timeoutMs: options.timeoutMs,
      cachePrompt: options.cachePrompt,
    }, {
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
    });

    responseId = providerResult.responseId;
    providerModel = providerResult.model;
    finishReason = providerResult.finishReason;
    rawText = providerResult.rawText;
    usage = providerResult.usage;
    rawProviderResponse = providerResult.rawResponse;

    if (isOutputTruncationFinishReason(providerResult.finishReason)) {
      status = 'output_truncated';
      validationErrors = [
        `Provider stopped before completing the output (finish reason: ${providerResult.finishReason}).`,
      ];
    } else {
      let parsed: unknown;
      try {
        parsed = JSON.parse(providerResult.rawText);
      } catch (error) {
        status = 'invalid_json';
        validationErrors = [`Response is not valid JSON: ${errorMessage(error)}`];
        parsed = null;
      }

      if (status !== 'invalid_json') {
        validationErrors = validateJsonSchema(parsed, sessionReflectionResultSchema);
        if (validationErrors.length > 0) {
          status = 'schema_invalid';
        } else {
          parsedResult = parsed as SessionReflectionResultV4;
          validationErrors = validateResultAgainstBundle(parsedResult, options.fixture.inputBundle);
          status = validationErrors.length === 0 ? 'success' : 'contract_invalid';
        }
      }
    }
  } catch (error) {
    status = 'provider_error';
    providerError = errorMessage(error);
  }

  const completedAt = new Date();
  return {
    schemaVersion: 'llm_provider_run.v0',
    runId,
    fixtureId: options.fixture.fixtureId,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
    request: {
      provider: options.adapter.id,
      model: options.modelConfigId ?? options.model,
      providerModel: options.model,
      reasoningEffort: options.reasoningEffort ?? null,
      systemPromptFile: options.systemPromptFile,
      systemPromptSha256: sha256(options.systemPrompt),
      userPromptSha256: sha256(userPrompt),
      outputSchemaSha256: sha256(schemaJson),
      maxOutputTokens: options.maxOutputTokens,
      temperature: options.temperature,
      timeoutMs: options.timeoutMs,
      cachePrompt: options.cachePrompt,
    },
    inputBundle: options.fixture.inputBundle,
    response: {
      status,
      responseId,
      providerModel,
      structuredOutputMode: options.adapter.structuredOutputMode,
      finishReason,
      rawText,
      parsedResult,
      usage,
      validationErrors,
      providerError,
      rawProviderResponse,
    },
  };
}

function safeSegment(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9._-]+/g, '-').replaceAll(/^-+|-+$/g, '');
}

export function writeRunArtifact(artifact: ReflectionRunArtifactV0, outputDirectory: string): string {
  fs.mkdirSync(outputDirectory, { recursive: true });
  const timestamp = artifact.startedAt.replaceAll(/[:.]/g, '-');
  const filename = [
    timestamp,
    safeSegment(artifact.request.provider),
    safeSegment(artifact.request.model),
    safeSegment(artifact.fixtureId),
    safeSegment(artifact.runId),
  ].join('__');
  const outputPath = path.join(outputDirectory, `${filename}.json`);
  fs.writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, { flag: 'wx' });
  return outputPath;
}
