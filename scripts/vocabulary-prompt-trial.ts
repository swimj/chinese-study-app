import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createOpenAiCompatibleAdapter } from '../server/llm/openai-compatible.ts';
import { fetchImplementationForProvider } from '../server/llm/proxy-fetch.ts';
import type { JsonValue } from '../server/llm/types.ts';
import { estimateInitialReflectionRunCost } from '../server/reflection/run-pricing.ts';
import { executeExperiment } from '../server/word-content-lab/vocabulary-experiments/archive.ts';
import type { ExperimentInput } from '../server/word-content-lab/vocabulary-experiments/contracts.ts';
import { wordContentFixtures } from '../src/features/introduction-lab/samples.ts';

const { values } = parseArgs({ options: {
  archive: { type: 'string' }, samples: { type: 'string' }, 'input-directory': { type: 'string' },
  role: { type: 'string', default: 'general_exercises' }, prompt: { type: 'string' },
  variant: { type: 'string' }, model: { type: 'string', default: 'gpt-5.6-luna' },
  reasoning: { type: 'string', default: 'high' }, 'max-output-tokens': { type: 'string', default: '12000' },
  'allow-provider-calls': { type: 'boolean', default: false },
} });
function required(value: string | undefined, flag: string): string {
  if (!value?.trim()) throw new Error(`Expected --${flag}.`);
  return value;
}
async function main(): Promise<void> {
  if (!values['allow-provider-calls']) throw new Error('Live runner requires --allow-provider-calls; offline preparation uses vocabulary-prompt-experiment.ts.');
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured.');
  const root = path.resolve(required(values.archive, 'archive'));
  const variant = required(values.variant, 'variant');
  if (!/^[a-zA-Z0-9_-]+$/.test(variant)) throw new Error('Variant must be a simple file-safe name.');
  const samples = required(values.samples, 'samples').split(',');
  if (samples.length > 8 || new Set(samples).size !== samples.length) throw new Error('Select at most eight distinct sample words per explicit batch.');
  const role = values.role;
  if (role !== 'general_exercises' && role !== 'teaching_exercises') throw new Error('Live trial currently supports teaching or general exercises.');
  const promptText = await readFile(required(values.prompt, 'prompt'), 'utf8');
  const timeoutMs = 180_000;
  const adapter = createOpenAiCompatibleAdapter({ id: 'openai', defaultBaseUrl: 'https://api.openai.com/v1',
    apiKeyEnvironmentVariable: 'OPENAI_API_KEY', structuredOutputMode: 'json_schema', maxTokensField: 'max_completion_tokens',
    fetchImplementation: fetchImplementationForProvider('openai', timeoutMs) });
  const indexPath = path.join(root, `${variant}-index.json`);
  await mkdir(root, { recursive: true, mode: 0o700 });
  // Reserve the manifest before any spending; a repeated command cannot silently repeat a batch.
  await writeFile(indexPath, JSON.stringify({ variant, status: 'running', samples, startedAt: new Date().toISOString() }, null, 2), { flag: 'wx', mode: 0o600 });
  const runs: Array<{ sample: string; id: string; status: string; latencyMs: number; exerciseCount: number | null }> = [];
  for (const sample of samples) {
    const fixture = wordContentFixtures.find(({ content }) => content.word.hanzi === sample);
    if (!fixture) throw new Error(`No retained sample for ${sample}.`);
    const input: ExperimentInput = values['input-directory']
      ? JSON.parse(await readFile(path.join(values['input-directory'], `${sample}.json`), 'utf8')) as ExperimentInput
      : role === 'teaching_exercises'
      ? { role, content: fixture.content, introduction: fixture.teaching } : { role, content: fixture.content };
    if (input.role !== role) throw new Error('Retained input role differs from batch role.');
    const startedAt = Date.now();
    const { request, result } = await executeExperiment(root, { variant, input,
      prompt: { name: role, version: variant, text: promptText },
      settings: { provider: 'openai', model: values.model, reasoningEffort: values.reasoning,
        maxOutputTokens: Number(values['max-output-tokens']), temperature: null },
    }, async (request) => {
      let response;
      try {
        response = await adapter.run({ model: request.settings.model, reasoningEffort: request.settings.reasoningEffort,
          systemPrompt: request.prompt.text, userPrompt: request.userPrompt,
          outputSchemaName: request.outputSchemaName, outputSchema: request.outputSchema,
          maxOutputTokens: request.settings.maxOutputTokens, temperature: request.settings.temperature,
          timeoutMs, cachePrompt: true, clientRequestId: request.id },
        { apiKey, baseUrl: process.env.OPENAI_BASE_URL?.trim() || null });
      } catch (error) {
        // Never print provider message/body/headers: they may contain sensitive data.
        console.error(JSON.stringify({ sample, providerFailure: error instanceof Error ? error.name : 'unknown',
          status: typeof error === 'object' && error !== null && 'status' in error ? error.status : null }));
        throw error;
      }
      const estimate = estimateInitialReflectionRunCost({ provider: 'openai', providerModel: request.settings.model,
        usage: response.usage, reportedAt: new Date().toISOString() });
      // Local synthetic outputs only; retain exact provider body without headers or credentials.
      await writeFile(path.join(root, request.id, 'provider-response.json'), JSON.stringify({
        schemaVersion: 1, timeoutMs, cachePrompt: true, response: response.rawResponse,
      }, null, 2), { flag: 'wx', mode: 0o600 });
      return { rawText: response.rawText, resolvedModel: response.model, providerRequestId: response.responseId,
        finishReason: response.finishReason, usage: response.usage as unknown as JsonValue,
        cost: estimate as unknown as JsonValue | null };
    });
    const entry = { sample, id: request.id, status: result.status, latencyMs: Date.now() - startedAt,
      exerciseCount: result.validation?.preview?.cards.length ?? null };
    runs.push(entry);
    // This mutable batch index is convenience bookkeeping; each request/result remains immutable.
    await writeFile(indexPath, JSON.stringify({ variant, status: 'running', runs, samples }, null, 2), { mode: 0o600 });
    console.log(JSON.stringify(entry));
    if (result.status === 'provider_failed') break;
  }
  await writeFile(indexPath, JSON.stringify({ variant, status: runs.length === samples.length ? 'finished' : 'stopped_after_failure',
    runs, samples, finishedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : 'Trial failed.'); process.exitCode = 1; });
