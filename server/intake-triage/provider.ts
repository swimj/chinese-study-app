import { readFile } from 'node:fs/promises';
import {
  intakeTriageProviderResponseSchema,
  translateIntakeTriageProviderResponse,
  validateIntakeTriageProviderResponse,
  type IntakeTriageAssessment,
  type IntakeTriageProviderRequest,
  type IntakeTriageProviderResponse,
} from '../../src/domain/intake-triage.ts';
import type { FetchImplementation } from '../llm/http.ts';
import { validateJsonSchema } from '../llm/json-schema-validator.ts';
import { createOpenAiCompatibleAdapter } from '../llm/openai-compatible.ts';
import { fetchImplementationForProvider } from '../llm/proxy-fetch.ts';
import {
  isOutputTruncationFinishReason,
  type NormalizedTokenUsage,
} from '../llm/types.ts';

export const INTAKE_TRIAGE_PROMPT_VERSION = 'intake-triage-v1' as const;
export const INTAKE_TRIAGE_MODEL_CONFIG = {
  provider: 'openai',
  modelConfig: 'gpt-5.6-luna-high',
  providerModel: 'gpt-5.6-luna',
  reasoningEffort: 'high',
  maxOutputTokens: 12_000,
  timeoutMs: 180_000,
  defaultBaseUrl: 'https://api.openai.com/v1',
  apiKeyEnvironmentVariable: 'OPENAI_API_KEY',
  baseUrlEnvironmentVariable: 'OPENAI_BASE_URL',
} as const;

export type IntakeTriageProviderFailureCode =
  | 'missing_config'
  | 'upstream_failure'
  | 'output_truncated'
  | 'invalid_json'
  | 'schema_invalid'
  | 'domain_contract_invalid';

const failureMessages: Record<IntakeTriageProviderFailureCode, string> = {
  missing_config: 'Intake advisor provider credentials are not configured.',
  upstream_failure: 'The intake advisor provider request failed.',
  output_truncated: 'The intake advisor provider stopped before completing its response.',
  invalid_json: 'The intake advisor provider returned invalid JSON.',
  schema_invalid: 'The intake advisor response did not match the required schema.',
  domain_contract_invalid: 'The intake advisor response violated the positional assessment contract.',
};

export type IntakeTriageRunMetadata = {
  provider: string;
  modelConfig: string;
  providerModel: string;
  promptVersion: string;
  clientRequestId: string;
  responseId: string | null;
  finishReason: string | null;
  usage: NormalizedTokenUsage;
};

export class IntakeTriageProviderError extends Error {
  readonly code: IntakeTriageProviderFailureCode;
  readonly metadata: IntakeTriageRunMetadata;

  constructor(code: IntakeTriageProviderFailureCode, metadata: IntakeTriageRunMetadata) {
    super(failureMessages[code]);
    this.name = 'IntakeTriageProviderError';
    this.code = code;
    this.metadata = metadata;
  }
}

export type IntakeTriageProvider = {
  generate(request: IntakeTriageProviderRequest, options: { clientRequestId: string }): Promise<{
    assessments: IntakeTriageAssessment[];
    metadata: IntakeTriageRunMetadata;
  }>;
};

const promptUrl = new URL('./prompts/intake-triage.md', import.meta.url);
let promptPromise: Promise<string> | null = null;

export function createIntakeTriageProvider(options: {
  fetchImplementation?: FetchImplementation;
  environment?: NodeJS.ProcessEnv;
  systemPrompt?: string;
} = {}): IntakeTriageProvider {
  const environment = options.environment ?? process.env;
  const adapter = createOpenAiCompatibleAdapter({
    id: INTAKE_TRIAGE_MODEL_CONFIG.provider,
    defaultBaseUrl: INTAKE_TRIAGE_MODEL_CONFIG.defaultBaseUrl,
    apiKeyEnvironmentVariable: INTAKE_TRIAGE_MODEL_CONFIG.apiKeyEnvironmentVariable,
    structuredOutputMode: 'json_schema',
    maxTokensField: 'max_completion_tokens',
    fetchImplementation: options.fetchImplementation
      ?? fetchImplementationForProvider(
        INTAKE_TRIAGE_MODEL_CONFIG.provider,
        INTAKE_TRIAGE_MODEL_CONFIG.timeoutMs,
      ),
  });

  return {
    async generate(request, runOptions) {
      const emptyRunMetadata = emptyMetadata(runOptions.clientRequestId);
      const apiKey = configuredValue(environment[INTAKE_TRIAGE_MODEL_CONFIG.apiKeyEnvironmentVariable]);
      if (apiKey === null) throw new IntakeTriageProviderError('missing_config', emptyRunMetadata);
      const baseUrl = configuredValue(environment[INTAKE_TRIAGE_MODEL_CONFIG.baseUrlEnvironmentVariable]);
      const systemPrompt = options.systemPrompt ?? await loadPrompt();
      let providerResult;
      try {
        providerResult = await adapter.run({
          model: INTAKE_TRIAGE_MODEL_CONFIG.providerModel,
          reasoningEffort: INTAKE_TRIAGE_MODEL_CONFIG.reasoningEffort,
          systemPrompt,
          userPrompt: JSON.stringify(request),
          outputSchemaName: 'intake_triage_assessments',
          outputSchema: intakeTriageProviderResponseSchema,
          maxOutputTokens: INTAKE_TRIAGE_MODEL_CONFIG.maxOutputTokens,
          temperature: null,
          timeoutMs: INTAKE_TRIAGE_MODEL_CONFIG.timeoutMs,
          cachePrompt: true,
          clientRequestId: runOptions.clientRequestId,
        }, { apiKey, baseUrl });
      } catch {
        throw new IntakeTriageProviderError('upstream_failure', emptyRunMetadata);
      }

      const metadata: IntakeTriageRunMetadata = {
        provider: INTAKE_TRIAGE_MODEL_CONFIG.provider,
        modelConfig: INTAKE_TRIAGE_MODEL_CONFIG.modelConfig,
        providerModel: providerResult.model,
        promptVersion: INTAKE_TRIAGE_PROMPT_VERSION,
        clientRequestId: runOptions.clientRequestId,
        responseId: providerResult.responseId,
        finishReason: providerResult.finishReason,
        usage: providerResult.usage,
      };
      if (isOutputTruncationFinishReason(providerResult.finishReason)) {
        throw new IntakeTriageProviderError('output_truncated', metadata);
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(providerResult.rawText);
      } catch {
        throw new IntakeTriageProviderError('invalid_json', metadata);
      }
      if (validateJsonSchema(parsed, intakeTriageProviderResponseSchema).length > 0) {
        throw new IntakeTriageProviderError('schema_invalid', metadata);
      }

      const response = parsed as IntakeTriageProviderResponse;
      if (validateIntakeTriageProviderResponse(response, request).length > 0) {
        throw new IntakeTriageProviderError('domain_contract_invalid', metadata);
      }
      return {
        assessments: translateIntakeTriageProviderResponse(response, request),
        metadata,
      };
    },
  };
}

function loadPrompt(): Promise<string> {
  promptPromise ??= readFile(promptUrl, 'utf8');
  return promptPromise;
}

function configuredValue(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function emptyMetadata(clientRequestId: string): IntakeTriageRunMetadata {
  return {
    provider: INTAKE_TRIAGE_MODEL_CONFIG.provider,
    modelConfig: INTAKE_TRIAGE_MODEL_CONFIG.modelConfig,
    providerModel: INTAKE_TRIAGE_MODEL_CONFIG.providerModel,
    promptVersion: INTAKE_TRIAGE_PROMPT_VERSION,
    clientRequestId,
    responseId: null,
    finishReason: null,
    usage: {
      inputTokens: null,
      cachedInputTokens: null,
      cacheWriteInputTokens: null,
      outputTokens: null,
      reasoningTokens: null,
      totalTokens: null,
    },
  };
}
