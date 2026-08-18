import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import {
  SESSION_REFLECTION_RESULT_V6_WIRE_SCHEMA_NAME,
  sessionReflectionResultV6WireSchema,
} from '../../src/domain/reflection-result-schema.js';
import {
  normalizeSessionReflectionResultV6,
  stripLegacySourceAttemptIdsFromReflectionWire,
  validateSessionReflectionResultV6,
  type SessionReflectionBundleV2,
  type SessionReflectionBundleV3,
  type SessionReflectionResultV6,
  type SessionReflectionResultV6Wire,
} from '../../src/domain/reflection.js';
import type { FetchImplementation } from '../llm/http.js';
import { validateJsonSchemaIssues } from '../llm/json-schema-validator.js';
import { createOpenAiCompatibleAdapter } from '../llm/openai-compatible.js';
import { fetchImplementationForProvider } from '../llm/proxy-fetch.js';
import {
  isOutputTruncationFinishReason,
  type NormalizedTokenUsage,
} from '../llm/types.js';
import {
  describeReflectionProviderFailure,
  type ReflectionProviderDiagnosticSink,
} from './provider-diagnostics.ts';
import {
  boundRejectedOutput,
  schemaIssuesToDiagnostics,
  textIssuesToDiagnostics,
  type ReflectionGenerationDiagnostic,
} from './run-diagnostics.ts';

export const LUNA_REFLECTION_MODEL_CONFIG = {
  provider: 'openai',
  modelConfig: 'gpt-5.6-luna-high',
  providerModel: 'gpt-5.6-luna',
  reasoningEffort: 'high',
  maxOutputTokens: 50_000,
  timeoutMs: 180_000,
  promptVersion: 'reflection-v7',
  defaultBaseUrl: 'https://api.openai.com/v1',
  apiKeyEnvironmentVariable: 'OPENAI_API_KEY',
  structuredOutputMode: 'json_schema',
  maxTokensField: 'max_completion_tokens',
  baseUrlEnvironmentVariable: 'OPENAI_BASE_URL',
} as const;
export const LUNA_REFLECTION_PROMPT_VERSION = 'reflection-v7' as const;

const productionPromptUrl = new URL('./prompts/reflection.md', import.meta.url);

export type LunaReflectionFailureCode =
  | 'missing_config'
  | 'upstream_failure'
  | 'output_truncated'
  | 'invalid_json'
  | 'schema_invalid'
  | 'domain_contract_invalid';

const failureMessages: Record<LunaReflectionFailureCode, string> = {
  missing_config: 'Reflection provider credentials are not configured.',
  upstream_failure: 'The reflection provider request failed.',
  output_truncated: 'The reflection provider stopped before completing its response.',
  invalid_json: 'The reflection provider returned invalid JSON.',
  schema_invalid: 'The reflection provider response did not match the required schema.',
  domain_contract_invalid: 'The reflection provider response violated the reflection contract.',
};

export class LunaReflectionProviderError extends Error {
  readonly code: LunaReflectionFailureCode;
  readonly issueCount: number;
  readonly clientRequestId: string | null;
  readonly metadata: LunaReflectionRunMetadata | null;
  readonly diagnostic: ReflectionGenerationDiagnostic | null;

  constructor(
    code: LunaReflectionFailureCode,
    issueCount = 0,
    clientRequestId: string | null = null,
    metadata: LunaReflectionRunMetadata | null = null,
    diagnostic: ReflectionGenerationDiagnostic | null = null,
  ) {
    super(failureMessages[code]);
    this.name = 'LunaReflectionProviderError';
    this.code = code;
    this.issueCount = issueCount;
    this.clientRequestId = clientRequestId;
    this.metadata = metadata;
    // Keep rejected output available to the run logger without putting it in
    // serialized API errors or ordinary error logs.
    Object.defineProperty(this, 'diagnostic', {
      value: diagnostic ?? ((code === 'upstream_failure' || code === 'missing_config')
        ? {
            schemaVersion: 'reflection_generation_diagnostic.v1',
            phase: 'provider_transport',
            issues: [],
            rejectedOutput: null,
          }
        : null),
      enumerable: false,
    });
  }
}

export type LunaReflectionRunMetadata = {
  provider: string;
  modelConfig: string;
  providerModel: string;
  promptVersion: string;
  responseId: string | null;
  finishReason: string | null;
  usage: NormalizedTokenUsage;
};

export type LunaReflectionSuccess = {
  result: SessionReflectionResultV6;
  metadata: LunaReflectionRunMetadata;
};

export type LunaReflectionProvider = {
  generate(bundle: SessionReflectionBundleV2 | SessionReflectionBundleV3): Promise<LunaReflectionSuccess>;
};

export type LunaReflectionProviderOptions = {
  fetchImplementation?: FetchImplementation;
  environment?: NodeJS.ProcessEnv;
  systemPrompt?: string;
  diagnosticSink?: ReflectionProviderDiagnosticSink;
};

export type ReflectionProviderConfig = {
  provider: string;
  modelConfig: string;
  providerModel: string;
  reasoningEffort: 'high' | 'max';
  maxOutputTokens: number;
  timeoutMs: number;
  promptVersion: string;
  defaultBaseUrl: string;
  apiKeyEnvironmentVariable: string;
  structuredOutputMode: 'json_schema' | 'json_object';
  maxTokensField: 'max_completion_tokens' | 'max_tokens';
  baseUrlEnvironmentVariable?: string;
};

let productionPromptPromise: Promise<string> | null = null;

function loadProductionPrompt(): Promise<string> {
  productionPromptPromise ??= readFile(productionPromptUrl, 'utf8');
  return productionPromptPromise;
}

function configuredValue(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function createLunaReflectionProvider(
  options: LunaReflectionProviderOptions = {},
): LunaReflectionProvider {
  return createReflectionProvider(LUNA_REFLECTION_MODEL_CONFIG, options);
}

export function createReflectionProvider(
  config: ReflectionProviderConfig,
  options: LunaReflectionProviderOptions = {},
): LunaReflectionProvider {
  const environment = options.environment ?? process.env;
  const adapter = createOpenAiCompatibleAdapter({
    id: config.provider,
    defaultBaseUrl: config.defaultBaseUrl,
    apiKeyEnvironmentVariable: config.apiKeyEnvironmentVariable,
    structuredOutputMode: config.structuredOutputMode,
    maxTokensField: config.maxTokensField,
    // OpenAI defaults through the local HTTP CONNECT proxy (same path as the LLM spike).
    // Other providers use direct fetch. Callers may still inject a custom implementation.
    fetchImplementation: options.fetchImplementation
      ?? fetchImplementationForProvider(config.provider, config.timeoutMs),
  });

  return {
    async generate(bundle: SessionReflectionBundleV2 | SessionReflectionBundleV3): Promise<LunaReflectionSuccess> {
      // Read credentials at call time so importing or constructing the service
      // never requires secrets and local configuration can be supplied later.
      const apiKey = configuredValue(environment[config.apiKeyEnvironmentVariable]);
      if (apiKey === null) {
        throw new LunaReflectionProviderError(
          'missing_config', 0, null, runMetadataWithoutProviderResult(config),
        );
      }
      const baseUrl = config.baseUrlEnvironmentVariable === undefined
        ? null
        : configuredValue(environment[config.baseUrlEnvironmentVariable]);
      const systemPrompt = options.systemPrompt ?? await loadProductionPrompt();
      const clientRequestId = randomUUID();

      let providerResult;
      try {
        providerResult = await adapter.run({
          model: config.providerModel,
          reasoningEffort: config.reasoningEffort,
          systemPrompt,
          userPrompt: JSON.stringify(bundle),
          outputSchemaName: SESSION_REFLECTION_RESULT_V6_WIRE_SCHEMA_NAME,
          outputSchema: sessionReflectionResultV6WireSchema,
          maxOutputTokens: config.maxOutputTokens,
          temperature: null,
          timeoutMs: config.timeoutMs,
          cachePrompt: true,
          clientRequestId,
        }, {
          apiKey,
          baseUrl,
        });
      } catch (error) {
        options.diagnosticSink?.record(describeReflectionProviderFailure({
          sessionId: bundle.session.sessionId,
          clientRequestId,
          error,
        }));
        throw new LunaReflectionProviderError(
          'upstream_failure', 0, clientRequestId, runMetadataWithoutProviderResult(config),
        );
      }

      const metadata = runMetadataFromProviderResult(providerResult, config);
      if (isOutputTruncationFinishReason(providerResult.finishReason)) {
        throw new LunaReflectionProviderError(
          'output_truncated', 0, clientRequestId, metadata,
          diagnostic('truncation', [], providerResult.rawText),
        );
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(providerResult.rawText);
      } catch {
        throw new LunaReflectionProviderError(
          'invalid_json', 0, clientRequestId, metadata,
          diagnostic('json_parse', [], providerResult.rawText),
        );
      }

      const compatibleWire = stripLegacySourceAttemptIdsFromReflectionWire(parsed);
      const schemaIssues = validateJsonSchemaIssues(compatibleWire, sessionReflectionResultV6WireSchema);
      if (schemaIssues.length > 0) {
        throw new LunaReflectionProviderError(
          'schema_invalid', schemaIssues.length, clientRequestId, metadata,
          diagnostic('structural_schema', schemaIssuesToDiagnostics(schemaIssues), providerResult.rawText),
        );
      }

      const normalized = normalizeSessionReflectionResultV6(
        compatibleWire as SessionReflectionResultV6Wire,
        bundle,
      );
      const contractErrors = validateSessionReflectionResultV6(normalized, bundle);
      if (contractErrors.length > 0) {
        throw new LunaReflectionProviderError(
          'domain_contract_invalid', contractErrors.length, clientRequestId, metadata,
          diagnostic('domain_validation', textIssuesToDiagnostics(contractErrors), providerResult.rawText),
        );
      }

      return {
        result: normalized,
        metadata,
      };
    },
  };
}

function diagnostic(
  phase: ReflectionGenerationDiagnostic['phase'],
  issues: ReflectionGenerationDiagnostic['issues'],
  output: string,
): ReflectionGenerationDiagnostic {
  return {
    schemaVersion: 'reflection_generation_diagnostic.v1',
    phase,
    issues,
    rejectedOutput: boundRejectedOutput(output),
  };
}

function runMetadataFromProviderResult(input: {
  responseId: string | null;
  finishReason: string | null;
  usage: NormalizedTokenUsage;
}, config: ReflectionProviderConfig): LunaReflectionRunMetadata {
  return {
    provider: config.provider,
    modelConfig: config.modelConfig,
    providerModel: config.providerModel,
    promptVersion: config.promptVersion,
    responseId: input.responseId,
    finishReason: input.finishReason,
    usage: input.usage,
  };
}

function runMetadataWithoutProviderResult(
  config: ReflectionProviderConfig,
): LunaReflectionRunMetadata {
  return runMetadataFromProviderResult({
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
  }, config);
}
