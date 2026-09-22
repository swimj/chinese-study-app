import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import {
  PURE_CUE_PROMOTION_RESULT_V1_WIRE_SCHEMA_NAME,
  pureCuePromotionResultV1WireSchema,
  SESSION_REFLECTION_RESULT_V7_WIRE_SCHEMA_NAME,
  sessionReflectionResultV7WireSchema,
  STAGED_REFLECTION_DIAGNOSIS_RESULT_V1_WIRE_SCHEMA_NAME,
  stagedReflectionDiagnosisResultV1WireSchema,
} from '../../src/domain/reflection-result-schema.js';
import {
  normalizeStagedReflectionDiagnosisResultV1,
  normalizeSessionReflectionResultV7,
  stripLegacySourceAttemptIdsFromReflectionWire,
  validateStagedReflectionDiagnosisResultV1,
  validateSessionReflectionResultV7,
  type SessionReflectionBundleV4,
  type SessionReflectionBundleV2,
  type SessionReflectionBundleV3,
  type CuratedReflectionBundleV1,
  type CuratedReflectionBundleV2,
  type CuratedReflectionDiagnosisBundleV2,
  type PureCuePromotionBundleV1,
  type PureCuePromotionResultV1Wire,
  type SessionReflectionResultV7,
  type SessionReflectionResultV7Wire,
  type StagedReflectionDiagnosisResultV1,
  type StagedReflectionDiagnosisResultV1Wire,
  validatePureCuePromotionResultV1,
} from '../../src/domain/reflection.js';
import type { FetchImplementation } from '../llm/http.js';
import { validateJsonSchemaIssues } from '../llm/json-schema-validator.js';
import { createOpenAiCompatibleAdapter } from '../llm/openai-compatible.js';
import { fetchImplementationForProvider } from '../llm/proxy-fetch.js';
import {
  isOutputTruncationFinishReason,
  PROVIDER_REQUEST_TIMEOUT_MS,
  type JsonValue,
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
import {
  PURE_CUE_PROMOTION_PROMPT_VERSION,
  STAGED_REFLECTION_DIAGNOSIS_PROMPT_VERSION,
} from '../../src/domain/reflection-contracts.ts';

export const LUNA_REFLECTION_MODEL_CONFIG = {
  provider: 'openai',
  modelConfig: 'gpt-5.6-luna-high',
  providerModel: 'gpt-5.6-luna',
  reasoningEffort: 'high',
  maxOutputTokens: 50_000,
  timeoutMs: PROVIDER_REQUEST_TIMEOUT_MS,
  promptVersion: 'reflection-v9',
  defaultBaseUrl: 'https://api.openai.com/v1',
  apiKeyEnvironmentVariable: 'OPENAI_API_KEY',
  structuredOutputMode: 'json_schema',
  maxTokensField: 'max_completion_tokens',
  baseUrlEnvironmentVariable: 'OPENAI_BASE_URL',
} as const;
export const LUNA_REFLECTION_PROMPT_VERSION = 'reflection-v9' as const;
export {
  PURE_CUE_PROMOTION_PROMPT_VERSION,
  STAGED_REFLECTION_DIAGNOSIS_PROMPT_VERSION,
} from '../../src/domain/reflection-contracts.ts';

const productionPromptUrl = new URL('./prompts/reflection.md', import.meta.url);
const diagnosisPromptUrl = new URL('./prompts/staged-diagnosis.md', import.meta.url);
const promotionPromptUrl = new URL('./prompts/pure-cue-promotion.md', import.meta.url);

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
  reportedCostUsd?: number;
};

export type LunaReflectionSuccess = {
  result: SessionReflectionResultV7;
  metadata: LunaReflectionRunMetadata;
};

export type LunaPureCuePromotionSuccess = {
  result: PureCuePromotionResultV1Wire;
  metadata: LunaReflectionRunMetadata;
};

export type LunaStagedDiagnosisSuccess = {
  result: StagedReflectionDiagnosisResultV1;
  metadata: LunaReflectionRunMetadata;
};

export type LunaReflectionProvider = {
  generate(
    bundle: SessionReflectionBundleV2 | SessionReflectionBundleV3 | SessionReflectionBundleV4 | CuratedReflectionBundleV1 | CuratedReflectionDiagnosisBundleV2,
    options?: { clientRequestId?: string },
  ): Promise<LunaReflectionSuccess>;
  generateDiagnosis(
    bundle: SessionReflectionBundleV4 | CuratedReflectionDiagnosisBundleV2,
    options?: { clientRequestId?: string },
  ): Promise<LunaStagedDiagnosisSuccess>;
  generatePromotion?(
    bundle: PureCuePromotionBundleV1,
    options?: { clientRequestId?: string },
  ): Promise<LunaPureCuePromotionSuccess>;
};

export type LunaReflectionProviderOptions = {
  fetchImplementation?: FetchImplementation;
  environment?: NodeJS.ProcessEnv;
  systemPrompt?: string;
  diagnosisSystemPrompt?: string;
  promotionSystemPrompt?: string;
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
  /** Transport-specific request fields for OpenAI-compatible providers. */
  additionalRequestBody?: Record<string, JsonValue>;
};

let productionPromptPromise: Promise<string> | null = null;
let diagnosisPromptPromise: Promise<string> | null = null;
let promotionPromptPromise: Promise<string> | null = null;

function loadProductionPrompt(): Promise<string> {
  productionPromptPromise ??= readFile(productionPromptUrl, 'utf8');
  return productionPromptPromise;
}

function loadDiagnosisPrompt(): Promise<string> {
  diagnosisPromptPromise ??= readFile(diagnosisPromptUrl, 'utf8');
  return diagnosisPromptPromise;
}

/** Keep durable evidence intact; the model needs content, not persistence identity. */
function diagnosisModelInput(bundle: SessionReflectionBundleV4 | CuratedReflectionDiagnosisBundleV2) {
  assertMandarinStagedInput('session' in bundle ? bundle.session.studyProfile : bundle.studyProfile);
  return {
    schemaVersion: bundle.schemaVersion,
    items: bundle.items.map((item) => ({
      itemId: item.itemId,
      source: item.source,
      sourceActionKind: item.sourceActionKind,
      targetWord: item.targetWord,
      servedCue: {
        cueType: item.servedCue.cueType,
        text: item.servedCue.text,
        supplement: item.servedCue.supplement === null ? null : {
          englishFrame: item.servedCue.supplement.englishFrame,
          exampleSentence: item.servedCue.supplement.exampleSentence,
          exampleTranslation: item.servedCue.supplement.exampleTranslation,
        },
      },
      rawResponse: item.rawResponse,
      responseKind: item.responseKind,
      submittedWord: item.submittedWord,
      ...(item.learnerRequestedReview ? { learnerRequestedReview: true } : {}),
      sessionNote: item.sessionNote,
      existingContent: {
        contrastClusters: item.existingContent.contrastClusters.map((cluster) => ({
          title: cluster.title,
          memberWordIds: cluster.memberWordIds,
          promptCount: cluster.promptCount,
          notes: cluster.notes,
        })),
      },
    })),
  };
}

function promotionModelInput(bundle: PureCuePromotionBundleV1) {
  assertMandarinStagedInput(bundle.studyProfile);
  const { studyProfile: _studyProfile, ...content } = bundle;
  return content;
}

function assertMandarinStagedInput(profile: string): void {
  if (profile !== 'mandarin') {
    throw new Error('Staged reflection currently supports Mandarin only.');
  }
}

function loadPromotionPrompt(): Promise<string> {
  promotionPromptPromise ??= readFile(promotionPromptUrl, 'utf8');
  return promotionPromptPromise;
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
    additionalRequestBody: config.additionalRequestBody,
    // OpenAI-compatible OpenRouter traffic follows OpenAI through the local
    // HTTP CONNECT proxy; other providers use direct fetch. Callers may still
    // inject a custom implementation.
    fetchImplementation: options.fetchImplementation
      ?? fetchImplementationForProvider(config.provider, config.timeoutMs),
  });

  async function generateReflection(
    bundle: SessionReflectionBundleV2 | SessionReflectionBundleV3 | SessionReflectionBundleV4 | CuratedReflectionBundleV1 | CuratedReflectionDiagnosisBundleV2,
    requestOptions: { clientRequestId?: string },
  ): Promise<LunaReflectionSuccess> {
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
      const clientRequestId = requestOptions.clientRequestId ?? randomUUID();

      let providerResult;
      try {
        providerResult = await adapter.run({
          model: config.providerModel,
          reasoningEffort: config.reasoningEffort,
          systemPrompt,
          userPrompt: JSON.stringify(bundle),
          outputSchemaName: SESSION_REFLECTION_RESULT_V7_WIRE_SCHEMA_NAME,
          outputSchema: sessionReflectionResultV7WireSchema,
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
          sessionId: 'session' in bundle ? bundle.session.sessionId : null,
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
      const schemaIssues = validateJsonSchemaIssues(compatibleWire, sessionReflectionResultV7WireSchema);
      if (schemaIssues.length > 0) {
        throw new LunaReflectionProviderError(
          'schema_invalid', schemaIssues.length, clientRequestId, metadata,
          diagnostic('structural_schema', schemaIssuesToDiagnostics(schemaIssues), providerResult.rawText),
        );
      }

      const normalized = normalizeSessionReflectionResultV7(
        compatibleWire as SessionReflectionResultV7Wire,
        bundle,
      );
      const contractErrors = validateSessionReflectionResultV7(normalized, bundle);
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
  }

  async function generateDiagnosis(
    bundle: SessionReflectionBundleV4 | CuratedReflectionDiagnosisBundleV2,
    requestOptions: { clientRequestId?: string } = {},
  ): Promise<LunaStagedDiagnosisSuccess> {
    const modelInput = diagnosisModelInput(bundle);
    const effectiveConfig: ReflectionProviderConfig = {
      ...config,
      promptVersion: STAGED_REFLECTION_DIAGNOSIS_PROMPT_VERSION,
    };
    const apiKey = configuredValue(environment[config.apiKeyEnvironmentVariable]);
    if (apiKey === null) {
      throw new LunaReflectionProviderError(
        'missing_config', 0, null, runMetadataWithoutProviderResult(effectiveConfig),
      );
    }
    const baseUrl = config.baseUrlEnvironmentVariable === undefined
      ? null
      : configuredValue(environment[config.baseUrlEnvironmentVariable]);
    const systemPrompt = options.diagnosisSystemPrompt ?? await loadDiagnosisPrompt();
    const clientRequestId = requestOptions.clientRequestId ?? randomUUID();

    let providerResult;
    try {
      providerResult = await adapter.run({
        model: config.providerModel,
        reasoningEffort: config.reasoningEffort,
        systemPrompt,
        userPrompt: JSON.stringify(modelInput),
        outputSchemaName: STAGED_REFLECTION_DIAGNOSIS_RESULT_V1_WIRE_SCHEMA_NAME,
        outputSchema: stagedReflectionDiagnosisResultV1WireSchema,
        maxOutputTokens: config.maxOutputTokens,
        temperature: null,
        timeoutMs: config.timeoutMs,
        cachePrompt: true,
        clientRequestId,
      }, { apiKey, baseUrl });
    } catch (error) {
      options.diagnosticSink?.record(describeReflectionProviderFailure({
        sessionId: 'session' in bundle ? bundle.session.sessionId : null,
        clientRequestId,
        error,
      }));
      throw new LunaReflectionProviderError(
        'upstream_failure', 0, clientRequestId, runMetadataWithoutProviderResult(effectiveConfig),
      );
    }

    const metadata = runMetadataFromProviderResult(providerResult, effectiveConfig);
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
    const schemaIssues = validateJsonSchemaIssues(
      parsed,
      stagedReflectionDiagnosisResultV1WireSchema,
    );
    if (schemaIssues.length > 0) {
      throw new LunaReflectionProviderError(
        'schema_invalid', schemaIssues.length, clientRequestId, metadata,
        diagnostic('structural_schema', schemaIssuesToDiagnostics(schemaIssues), providerResult.rawText),
      );
    }
    const wireResult = parsed as StagedReflectionDiagnosisResultV1Wire;
    const unknownItemErrors = wireResult.itemResults
      .filter((result) => !bundle.items.some((item) => item.itemId === result.itemId))
      .map((result) => `Unknown staged reflection item: ${result.itemId}`);
    if (unknownItemErrors.length > 0) {
      throw new LunaReflectionProviderError(
        'domain_contract_invalid', unknownItemErrors.length, clientRequestId, metadata,
        diagnostic('domain_validation', textIssuesToDiagnostics(unknownItemErrors), providerResult.rawText),
      );
    }
    const normalized = normalizeStagedReflectionDiagnosisResultV1(
      wireResult,
      bundle,
    );
    const contractErrors = validateStagedReflectionDiagnosisResultV1(normalized, bundle);
    if (contractErrors.length > 0) {
      throw new LunaReflectionProviderError(
        'domain_contract_invalid', contractErrors.length, clientRequestId, metadata,
        diagnostic('domain_validation', textIssuesToDiagnostics(contractErrors), providerResult.rawText),
      );
    }
    return { result: normalized, metadata };
  }

  async function generatePromotion(
    bundle: PureCuePromotionBundleV1,
    requestOptions: { clientRequestId?: string } = {},
  ): Promise<LunaPureCuePromotionSuccess> {
    const modelInput = promotionModelInput(bundle);
    const effectiveConfig: ReflectionProviderConfig = {
      ...config,
      promptVersion: PURE_CUE_PROMOTION_PROMPT_VERSION,
    };
    const apiKey = configuredValue(environment[config.apiKeyEnvironmentVariable]);
    if (apiKey === null) {
      throw new LunaReflectionProviderError(
        'missing_config', 0, null, runMetadataWithoutProviderResult(effectiveConfig),
      );
    }
    const baseUrl = config.baseUrlEnvironmentVariable === undefined
      ? null
      : configuredValue(environment[config.baseUrlEnvironmentVariable]);
    const systemPrompt = options.promotionSystemPrompt ?? await loadPromotionPrompt();
    const clientRequestId = requestOptions.clientRequestId ?? randomUUID();

    let providerResult;
    try {
      providerResult = await adapter.run({
        model: config.providerModel,
        reasoningEffort: config.reasoningEffort,
        systemPrompt,
        userPrompt: JSON.stringify(modelInput),
        outputSchemaName: PURE_CUE_PROMOTION_RESULT_V1_WIRE_SCHEMA_NAME,
        outputSchema: pureCuePromotionResultV1WireSchema,
        maxOutputTokens: config.maxOutputTokens,
        temperature: null,
        timeoutMs: config.timeoutMs,
        cachePrompt: true,
        clientRequestId,
      }, { apiKey, baseUrl });
    } catch (error) {
      options.diagnosticSink?.record(describeReflectionProviderFailure({
        sessionId: bundle.sourceSessionId,
        clientRequestId,
        error,
      }));
      throw new LunaReflectionProviderError(
        'upstream_failure', 0, clientRequestId, runMetadataWithoutProviderResult(effectiveConfig),
      );
    }

    const metadata = runMetadataFromProviderResult(providerResult, effectiveConfig);
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
    const schemaIssues = validateJsonSchemaIssues(parsed, pureCuePromotionResultV1WireSchema);
    if (schemaIssues.length > 0) {
      throw new LunaReflectionProviderError(
        'schema_invalid', schemaIssues.length, clientRequestId, metadata,
        diagnostic('structural_schema', schemaIssuesToDiagnostics(schemaIssues), providerResult.rawText),
      );
    }
    const contractErrors = validatePureCuePromotionResultV1(parsed, bundle);
    if (contractErrors.length > 0) {
      throw new LunaReflectionProviderError(
        'domain_contract_invalid', contractErrors.length, clientRequestId, metadata,
        diagnostic('domain_validation', textIssuesToDiagnostics(contractErrors), providerResult.rawText),
      );
    }
    return { result: parsed as PureCuePromotionResultV1Wire, metadata };
  }

  return {
    generate: (bundle, requestOptions = {}) => generateReflection(bundle, requestOptions),
    generateDiagnosis,
    generatePromotion,
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
  reportedCostUsd?: number;
}, config: ReflectionProviderConfig): LunaReflectionRunMetadata {
  return {
    provider: config.provider,
    modelConfig: config.modelConfig,
    providerModel: config.providerModel,
    promptVersion: config.promptVersion,
    responseId: input.responseId,
    finishReason: input.finishReason,
    usage: input.usage,
    ...(input.reportedCostUsd === undefined ? {} : { reportedCostUsd: input.reportedCostUsd }),
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
