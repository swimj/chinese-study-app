import { createHash, randomUUID } from 'node:crypto';
import { link, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { JsonSchema } from '../../../src/domain/reflection-result-schema.ts';
import type { JsonValue } from '../../llm/types.ts';
import { isOutputTruncationFinishReason } from '../../llm/types.ts';
import { experimentOutputSchema, projectExperimentInput, validateExperimentOutput,
  type ExperimentInput, type ExperimentValidation } from './contracts.ts';

export type ExperimentSettings = {
  provider: string; model: string; reasoningEffort: string | null;
  maxOutputTokens: number; temperature: number | null;
};
export type ExperimentRequest = {
  schemaVersion: 1; id: string; createdAt: string; variant: string;
  inputProjectionVersion: 1; input: ExperimentInput;
  prompt: { name: string; version: string; text: string; sha256: string };
  userPrompt: string; inputSha256: string;
  outputSchema: JsonSchema; outputSchemaName: string;
  settings: ExperimentSettings;
};
export type ExperimentObservation = {
  origin: 'provider' | 'fixture' | 'manual_import';
  rawText: string;
  resolvedModel: string | null; providerRequestId: string | null; finishReason: string | null;
  usage: JsonValue | null; cost: JsonValue | null;
};
export type ExperimentResult = {
  schemaVersion: 1; requestId: string; recordedAt: string;
  status: 'completed' | 'invalid_output' | 'incomplete' | 'provider_failed';
  observation: ExperimentObservation | null;
  validation: ExperimentValidation | null;
  failureCode: 'provider_request_failed' | 'invalid_json' | null;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

function runDirectory(root: string, id: string): string {
  if (!uuid.test(id)) throw new Error('Expected a run UUID.');
  return path.join(root, id);
}

async function publishJson(file: string, value: unknown): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    await link(temporary, file);
  } finally {
    await unlink(temporary).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    });
  }
}

export async function prepareExperiment(root: string, options: {
  variant: string; input: ExperimentInput;
  prompt: { name: string; version: string; text: string }; settings: ExperimentSettings;
}): Promise<ExperimentRequest> {
  if (!options.variant.trim() || !options.prompt.name.trim() || !options.prompt.version.trim()
    || !options.prompt.text.trim() || !options.settings.model.trim() || !options.settings.provider.trim()
    || !Number.isSafeInteger(options.settings.maxOutputTokens) || options.settings.maxOutputTokens <= 0
    || (options.settings.temperature !== null && !Number.isFinite(options.settings.temperature))) {
    throw new Error('Expected named prompt/model settings and a positive token bound.');
  }
  const userPrompt = JSON.stringify(projectExperimentInput(options.input));
  // Capture input/settings before returning or awaiting any provider work.
  const request: ExperimentRequest = JSON.parse(JSON.stringify({
    schemaVersion: 1, id: randomUUID(), createdAt: new Date().toISOString(), variant: options.variant,
    inputProjectionVersion: 1, input: options.input,
    prompt: { ...options.prompt, sha256: hash(options.prompt.text) },
    userPrompt, inputSha256: hash(userPrompt), outputSchema: experimentOutputSchema(options.input),
    outputSchemaName: `vocabulary_experiment_${options.input.role}_v1`, settings: options.settings,
  })) as ExperimentRequest;
  await mkdir(root, { recursive: true, mode: 0o700 });
  const directory = runDirectory(root, request.id);
  await mkdir(directory, { mode: 0o700 });
  await publishJson(path.join(directory, 'request.json'), request);
  return request;
}

export async function readExperiment(root: string, id: string): Promise<ExperimentRequest> {
  const request = JSON.parse(await readFile(path.join(runDirectory(root, id), 'request.json'), 'utf8')) as ExperimentRequest;
  if (request.schemaVersion !== 1 || request.id !== id || hash(request.prompt.text) !== request.prompt.sha256
    || hash(request.userPrompt) !== request.inputSha256
    || JSON.stringify(projectExperimentInput(request.input)) !== request.userPrompt
    || JSON.stringify(experimentOutputSchema(request.input)) !== JSON.stringify(request.outputSchema)) {
    throw new Error('Experiment request identity or retained input is inconsistent.');
  }
  return request;
}

export async function recordExperimentResponse(root: string, id: string, observation: ExperimentObservation): Promise<ExperimentResult> {
  const request = await readExperiment(root, id);
  if (!['provider', 'fixture', 'manual_import'].includes(observation.origin)
    || typeof observation.rawText !== 'string') throw new Error('Expected an attributed raw output.');
  let validation: ExperimentValidation | null = null;
  let failureCode: ExperimentResult['failureCode'] = null;
  try { validation = validateExperimentOutput(request.input, JSON.parse(observation.rawText)); }
  catch { failureCode = 'invalid_json'; }
  const result: ExperimentResult = {
    schemaVersion: 1, requestId: id, recordedAt: new Date().toISOString(), observation,
    status: isOutputTruncationFinishReason(observation.finishReason) ? 'incomplete'
      : failureCode || validation?.structuralErrors.length ? 'invalid_output' : 'completed',
    validation, failureCode,
  };
  await publishJson(path.join(runDirectory(root, id), 'result.json'), result);
  return result;
}

/** Caller supplies transport; this module cannot read credentials or publish application content. */
export async function executeExperiment(root: string, options: Parameters<typeof prepareExperiment>[1],
  generate: (request: ExperimentRequest) => Promise<Omit<ExperimentObservation, 'origin'>>,
): Promise<{ request: ExperimentRequest; result: ExperimentResult }> {
  const request = await prepareExperiment(root, options);
  let observation: Omit<ExperimentObservation, 'origin'>;
  try { observation = await generate(request); }
  catch {
    // Provider exceptions can contain headers, credentials or response bodies. Keep them out of artifacts.
    const result: ExperimentResult = { schemaVersion: 1, requestId: request.id,
      recordedAt: new Date().toISOString(), status: 'provider_failed', observation: null,
      validation: null, failureCode: 'provider_request_failed' };
    await publishJson(path.join(runDirectory(root, request.id), 'result.json'), result);
    return { request, result };
  }
  return { request, result: await recordExperimentResponse(root, request.id, { ...observation, origin: 'provider' }) };
}

export async function recordExperimentReview(root: string, id: string, input: {
  author: string; scope: 'pool' | 'introduction' | 'exercise'; exerciseId: string | null;
  note: string; decision: 'keep_exploring' | 'promising' | 'revise' | 'reject';
}): Promise<string> {
  const request = await readExperiment(root, id);
  if (!input.author.trim() || !input.note.trim() || !['pool', 'introduction', 'exercise'].includes(input.scope)
    || !['keep_exploring', 'promising', 'revise', 'reject'].includes(input.decision)
    || (input.scope === 'exercise') !== (input.exerciseId !== null)) throw new Error('Expected a named review and valid scope.');
  if (input.exerciseId !== null) {
    const result = JSON.parse(await readFile(path.join(runDirectory(root, id), 'result.json'), 'utf8')) as ExperimentResult;
    if (!result.validation?.preview?.cards.some((card) => card.id === input.exerciseId)) throw new Error('Review names an unknown exercise.');
  }
  const reviewId = randomUUID();
  const directory = path.join(runDirectory(root, request.id), 'reviews');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await publishJson(path.join(directory, `${reviewId}.json`), {
    schemaVersion: 1, id: reviewId, requestId: id, recordedAt: new Date().toISOString(), ...input,
  });
  return reviewId;
}
