import type { SessionReflectionBundleV1, SessionReflectionResultV4 } from '../contracts.js';
import type {
  JsonValue,
  NormalizedTokenUsage,
  StructuredOutputMode,
} from '../../../server/llm/types.js';

export {
  isOutputTruncationFinishReason,
  ProviderHttpError,
} from '../../../server/llm/types.js';
export type {
  JsonPrimitive,
  JsonValue,
  NormalizedTokenUsage,
  ProviderAdapter,
  ProviderRawResult,
  ProviderRunConfig,
  ProviderRunRequest,
  StructuredOutputMode,
} from '../../../server/llm/types.js';

export type ReflectionRunStatus =
  | 'success'
  | 'provider_error'
  | 'output_truncated'
  | 'invalid_json'
  | 'schema_invalid'
  | 'contract_invalid';

export type ReflectionRunArtifactV0 = {
  schemaVersion: 'llm_provider_run.v0';
  runId: string;
  fixtureId: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  request: {
    provider: string;
    /** Stable runner configuration id, or the raw provider model for an ad-hoc run. */
    model: string;
    providerModel: string;
    reasoningEffort: string | null;
    systemPromptFile: string;
    systemPromptSha256: string;
    userPromptSha256: string;
    outputSchemaSha256: string;
    maxOutputTokens: number;
    temperature: number | null;
    timeoutMs: number;
    cachePrompt: boolean;
  };
  inputBundle: SessionReflectionBundleV1;
  response: {
    status: ReflectionRunStatus;
    responseId: string | null;
    providerModel: string | null;
    structuredOutputMode: StructuredOutputMode;
    finishReason: string | null;
    rawText: string | null;
    parsedResult: SessionReflectionResultV4 | null;
    usage: NormalizedTokenUsage | null;
    validationErrors: string[];
    providerError: string | null;
    rawProviderResponse: JsonValue | null;
  };
};
