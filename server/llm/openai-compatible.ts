import { ProviderTimeoutError, ProviderInvalidResponseError } from './types.ts';
import { beginInvocation, recordInvocationResponse, concludeInvocation,
  beginServiceInvocation, recordServiceInvocationResponse, concludeServiceInvocation } from './invocation-ledger.ts';
import type {
  JsonValue,
  ProviderAdapter,
  ProviderRawResult,
  ProviderRunConfig,
  ProviderRunRequest,
  StructuredOutputMode,
} from './types.js';
import {
  asArray,
  asRecord,
  joinUrl,
  numberOrNull,
  postJson,
  stringOrNull,
  type FetchImplementation,
} from './http.js';

export type OpenAiCompatibleOptions = {
  id: string;
  defaultBaseUrl: string;
  apiKeyEnvironmentVariable: string;
  structuredOutputMode: StructuredOutputMode;
  maxTokensField: 'max_completion_tokens' | 'max_tokens';
  fetchImplementation?: FetchImplementation;
  /** Transport-specific fields, for example OpenRouter's pinned provider policy. */
  additionalRequestBody?: Record<string, JsonValue>;
};

export function requestBody(
  request: ProviderRunRequest,
  mode: StructuredOutputMode,
  maxTokensField: OpenAiCompatibleOptions['maxTokensField'],
  additionalRequestBody: Record<string, JsonValue> | undefined,
): Record<string, JsonValue> {
  if (request.decisions) {
    return {
      model: request.model,
      input: [
        { role: 'developer', content: request.systemPrompt },
        { role: 'user', content: [{ type: 'input_json', data: JSON.parse(request.userPrompt) as JsonValue }] },
      ],
      questions: request.decisions.questions,
    };
  }
  const systemPrompt = mode === 'json_schema'
    ? request.systemPrompt
    : [
        request.systemPrompt,
        '',
        'Return exactly one JSON object matching the following JSON Schema. Do not add prose or Markdown outside the object.',
        JSON.stringify(request.outputSchema),
      ].join('\n');
  const body: Record<string, JsonValue> = {
    model: request.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: request.userPrompt },
    ],
    [maxTokensField]: request.maxOutputTokens,
    response_format: mode === 'json_schema'
      ? {
          type: 'json_schema',
          json_schema: {
            name: request.outputSchemaName,
            strict: true,
            schema: request.outputSchema as JsonValue,
          },
        }
      : { type: 'json_object' },
  };
  if (request.temperature !== null) body.temperature = request.temperature;
  if (request.reasoningEffort !== null) body.reasoning_effort = request.reasoningEffort;
  return { ...body, ...additionalRequestBody };
}

export function openAiRequestPath(request: ProviderRunRequest): '/decisions' | '/chat/completions' {
  return request.decisions ? '/decisions' : '/chat/completions';
}

export function openAiInvocation(provider: string, request: ProviderRunRequest, body: JsonValue) {
  const settings = request.decisions
    ? { api: 'decisions', threshold: request.decisions.threshold, timeoutMs: request.timeoutMs }
    : { reasoningEffort: request.reasoningEffort, maxOutputTokens: request.maxOutputTokens,
        temperature: request.temperature, timeoutMs: request.timeoutMs, cachePrompt: request.cachePrompt };
  return { provider, model: request.model, invocationType: request.outputSchemaName,
    provenance: { ...request.provenance, promptTemplate: request.systemPrompt,
      schemaName: request.outputSchemaName, schema: request.outputSchema, settings, requestSnapshot: body } };
}

export function parseResponseForRequest(
  provider: string, mode: StructuredOutputMode, request: ProviderRunRequest, rawResponse: JsonValue,
): ProviderRawResult {
  if (!request.decisions) return parseResponse(provider, mode, rawResponse);
  const root = asRecord(rawResponse, 'Decisions response');
  const answers = asArray(root.answers, 'Decisions answers');
  const { questions, threshold } = request.decisions;
  if (answers.length !== questions.length) throw new Error('Decisions response has the wrong number of answers');
  const selected: string[] = [];
  for (const [index, question] of questions.entries()) {
    const answer = asRecord(answers[index]!, 'Decisions answer');
    const probability = numberOrNull(answer.probability);
    // Answers are ordered. An absent, refused, or malformed answer invalidates the entire selection.
    if (answer.type !== 'predicate' || answer.name !== question.name || probability === null || probability < 0 || probability > 1) {
      throw new Error(`Invalid Decisions answer for ${question.name}`);
    }
    if (probability >= threshold) selected.push(question.name);
  }
  const usage = root.usage === undefined ? {} : asRecord(root.usage, 'Decisions usage');
  const input = usage.input_tokens_details === undefined ? {} : asRecord(usage.input_tokens_details, 'Decisions input token details');
  const output = usage.output_tokens_details === undefined ? {} : asRecord(usage.output_tokens_details, 'Decisions output token details');
  return {
    provider, model: stringOrNull(root.model) ?? 'unknown', responseId: stringOrNull(root.id),
    structuredOutputMode: 'predicates', rawText: JSON.stringify(selected), finishReason: null, rawResponse,
    usage: {
      inputTokens: numberOrNull(usage.input_tokens), cachedInputTokens: numberOrNull(input.cached_tokens),
      cacheWriteInputTokens: numberOrNull(input.cache_write_tokens), outputTokens: numberOrNull(usage.output_tokens),
      reasoningTokens: numberOrNull(output.reasoning_tokens), totalTokens: numberOrNull(usage.total_tokens),
    },
  };
}

export function parseResponse(
  provider: string,
  mode: StructuredOutputMode,
  rawResponse: JsonValue,
): ProviderRawResult {
  const root = asRecord(rawResponse, `${provider} response`);
  const firstChoice = asRecord(
    asArray(root.choices, `${provider} response.choices`)[0],
    `${provider} response.choices[0]`,
  );
  const message = asRecord(firstChoice.message, `${provider} response.choices[0].message`);
  const rawText = stringOrNull(message.content);
  if (rawText === null) {
    const refusal = stringOrNull(message.refusal);
    if (refusal !== null) throw new Error(`${provider} refused the request: ${refusal}`);
    throw new Error(`${provider} response did not contain text content.`);
  }

  const usage = root.usage === undefined ? {} : asRecord(root.usage, `${provider} response.usage`);
  const promptDetails = usage.prompt_tokens_details === undefined
    ? {}
    : asRecord(usage.prompt_tokens_details, `${provider} response.usage.prompt_tokens_details`);
  const completionDetails = usage.completion_tokens_details === undefined
    ? {}
    : asRecord(usage.completion_tokens_details, `${provider} response.usage.completion_tokens_details`);
  const reportedCostUsd = numberOrNull(usage.cost);

  return {
    provider,
    model: stringOrNull(root.model) ?? 'unknown',
    responseId: stringOrNull(root.id),
    structuredOutputMode: mode,
    rawText,
    finishReason: stringOrNull(firstChoice.finish_reason),
    usage: {
      inputTokens: numberOrNull(usage.prompt_tokens),
      cachedInputTokens: numberOrNull(usage.prompt_cache_hit_tokens)
        ?? numberOrNull(promptDetails.cached_tokens),
      cacheWriteInputTokens: null,
      outputTokens: numberOrNull(usage.completion_tokens),
      reasoningTokens: numberOrNull(completionDetails.reasoning_tokens),
      totalTokens: numberOrNull(usage.total_tokens),
    },
    ...(reportedCostUsd !== null && reportedCostUsd >= 0 ? { reportedCostUsd } : {}),
    rawResponse,
  };
}

export function createOpenAiCompatibleAdapter(
  options: OpenAiCompatibleOptions,
): ProviderAdapter {
  const fetchImplementation = options.fetchImplementation ?? globalThis.fetch;
  return {
    id: options.id,
    defaultBaseUrl: options.defaultBaseUrl,
    apiKeyEnvironmentVariable: options.apiKeyEnvironmentVariable,
    structuredOutputMode: options.structuredOutputMode,
    async run(
      request: ProviderRunRequest,
      config: ProviderRunConfig,
    ): Promise<ProviderRawResult> {
      // Retain the exact body independently of transport configuration. Headers,
      // credentials and endpoint configuration never enter the ledger snapshot.
      const body = requestBody(request, options.structuredOutputMode, options.maxTokensField, options.additionalRequestBody);
      const invocation = openAiInvocation(options.id, request, body);

      const service = request.invocationActor;
      const invocationId = service === undefined ? beginInvocation(invocation)
        : beginServiceInvocation({ ...invocation, serviceId: service.serviceId, requestingLearnerId: service.requestingLearnerId });
      const conclude = (status: 'completed' | 'failed' | 'timed_out' | 'invalid_response', latency: number) => service === undefined
        ? concludeInvocation(invocationId, status, latency)
        : concludeServiceInvocation(invocationId, service.serviceId, status, latency);
      const startedAt = performance.now();
      let transportLatencyMs: number | null = null;
      try {
        config.onInvocationStarted?.(invocationId);
        const rawResponse = await postJson(
          options.id,
          fetchImplementation,
          joinUrl(config.baseUrl ?? options.defaultBaseUrl, openAiRequestPath(request)),
          {
            authorization: `Bearer ${config.apiKey}`,
            ...(request.clientRequestId ? { 'x-client-request-id': request.clientRequestId } : {}),
          },
          body,
          request.timeoutMs,
        );
        transportLatencyMs = performance.now() - startedAt;
        if (service === undefined) recordInvocationResponse(invocationId, invocation, rawResponse);
        else recordServiceInvocationResponse(invocationId, service.serviceId, invocation, rawResponse);
        let result: ProviderRawResult;
        try {
          result = parseResponseForRequest(options.id, options.structuredOutputMode, request, rawResponse);
        } catch (error) {
          throw new ProviderInvalidResponseError(error instanceof Error ? error.message : 'Invalid provider response');
        }
        conclude('completed', transportLatencyMs);
        return { ...result, invocationId };
      } catch (error) {
        const status = error instanceof ProviderTimeoutError ? 'timed_out'
          : error instanceof ProviderInvalidResponseError ? 'invalid_response' : 'failed';
        conclude(status, error instanceof ProviderTimeoutError ? request.timeoutMs : transportLatencyMs ?? performance.now() - startedAt);
        throw error;
      }
    },
  };
}
