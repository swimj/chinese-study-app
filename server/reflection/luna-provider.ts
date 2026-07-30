import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import {
  SESSION_REFLECTION_RESULT_SCHEMA_NAME,
  sessionReflectionResultSchema,
} from '../../src/domain/reflection-result-schema.js';
import {
  validateSessionReflectionResult,
  type SessionReflectionBundleV1,
  type SessionReflectionResultV4,
} from '../../src/domain/reflection.js';
import type { FetchImplementation } from '../llm/http.js';
import { validateJsonSchema } from '../llm/json-schema-validator.js';
import { createOpenAiCompatibleAdapter } from '../llm/openai-compatible.js';
import {
  isOutputTruncationFinishReason,
  type NormalizedTokenUsage,
} from '../llm/types.js';
import {
  describeReflectionProviderFailure,
  type ReflectionProviderDiagnosticSink,
} from './provider-diagnostics.ts';

export const LUNA_REFLECTION_MODEL_CONFIG = {
  id: 'gpt-5.6-luna-high',
  provider: 'openai',
  providerModel: 'gpt-5.6-luna',
  reasoningEffort: 'high',
  maxOutputTokens: 8_192,
  timeoutMs: 180_000,
} as const;
export const LUNA_REFLECTION_PROMPT_VERSION = 'reflection-v2' as const;

const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
const productionPromptUrl = new URL('./prompts/reflection-v2.md', import.meta.url);

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

  constructor(
    code: LunaReflectionFailureCode,
    issueCount = 0,
    clientRequestId: string | null = null,
  ) {
    super(failureMessages[code]);
    this.name = 'LunaReflectionProviderError';
    this.code = code;
    this.issueCount = issueCount;
    this.clientRequestId = clientRequestId;
  }
}

export type LunaReflectionSuccess = {
  result: SessionReflectionResultV4;
  metadata: {
    provider: 'openai';
    modelConfig: 'gpt-5.6-luna-high';
    providerModel: 'gpt-5.6-luna';
    promptVersion: 'reflection-v2';
    responseId: string | null;
    finishReason: string | null;
    usage: NormalizedTokenUsage;
  };
};

export type LunaReflectionProvider = {
  generate(bundle: SessionReflectionBundleV1): Promise<LunaReflectionSuccess>;
};

export type LunaReflectionProviderOptions = {
  fetchImplementation?: FetchImplementation;
  environment?: NodeJS.ProcessEnv;
  systemPrompt?: string;
  diagnosticSink?: ReflectionProviderDiagnosticSink;
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
  const environment = options.environment ?? process.env;
  const adapter = createOpenAiCompatibleAdapter({
    id: 'openai',
    defaultBaseUrl: DEFAULT_OPENAI_BASE_URL,
    apiKeyEnvironmentVariable: 'OPENAI_API_KEY',
    structuredOutputMode: 'json_schema',
    maxTokensField: 'max_completion_tokens',
    ...(options.fetchImplementation === undefined
      ? {}
      : { fetchImplementation: options.fetchImplementation }),
  });

  return {
    async generate(bundle: SessionReflectionBundleV1): Promise<LunaReflectionSuccess> {
      // Read credentials at call time so importing or constructing the service
      // never requires secrets and local configuration can be supplied later.
      const apiKey = configuredValue(environment.OPENAI_API_KEY);
      if (apiKey === null) throw new LunaReflectionProviderError('missing_config');
      const baseUrl = configuredValue(environment.OPENAI_BASE_URL);
      const systemPrompt = options.systemPrompt ?? await loadProductionPrompt();
      const clientRequestId = randomUUID();

      let providerResult;
      try {
        providerResult = await adapter.run({
          model: LUNA_REFLECTION_MODEL_CONFIG.providerModel,
          reasoningEffort: LUNA_REFLECTION_MODEL_CONFIG.reasoningEffort,
          systemPrompt,
          userPrompt: JSON.stringify(bundle),
          outputSchemaName: SESSION_REFLECTION_RESULT_SCHEMA_NAME,
          outputSchema: sessionReflectionResultSchema,
          maxOutputTokens: LUNA_REFLECTION_MODEL_CONFIG.maxOutputTokens,
          temperature: null,
          timeoutMs: LUNA_REFLECTION_MODEL_CONFIG.timeoutMs,
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
        throw new LunaReflectionProviderError('upstream_failure', 0, clientRequestId);
      }

      if (isOutputTruncationFinishReason(providerResult.finishReason)) {
        throw new LunaReflectionProviderError('output_truncated');
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(providerResult.rawText);
      } catch {
        throw new LunaReflectionProviderError('invalid_json');
      }

      const schemaErrors = validateJsonSchema(parsed, sessionReflectionResultSchema);
      if (schemaErrors.length > 0) {
        throw new LunaReflectionProviderError('schema_invalid', schemaErrors.length);
      }

      const contractErrors = validateSessionReflectionResult(parsed, bundle);
      if (contractErrors.length > 0) {
        throw new LunaReflectionProviderError('domain_contract_invalid', contractErrors.length);
      }

      return {
        result: parsed as SessionReflectionResultV4,
        metadata: {
          provider: 'openai',
          modelConfig: LUNA_REFLECTION_MODEL_CONFIG.id,
          providerModel: LUNA_REFLECTION_MODEL_CONFIG.providerModel,
          promptVersion: LUNA_REFLECTION_PROMPT_VERSION,
          responseId: providerResult.responseId,
          finishReason: providerResult.finishReason,
          usage: providerResult.usage,
        },
      };
    },
  };
}
