import { createHash } from 'node:crypto';
import type { VocabularySense, VocabularySenseCatalog, VocabularyContent } from '../../src/domain/vocabulary-content.ts';
import type { VocabularyWordSenseCoverage } from '../../src/domain/vocabulary-sense-coverage.ts';
import { createVocabularySenseProvider, type VocabularySenseLexicalWord } from './sense-readiness.ts';
import { createUsefulSelectionProvider } from './default-useful-selection.ts';
import { validateVocabularySenseInventory } from './sense-inventory-contract.ts';
import { canonicalExerciseSource } from './canonical-exercise-source.ts';
import { generalExerciseInvocation, normalizeGeneralExerciseReferences, validateGeneralExerciseOutput, type GeneralExerciseSource } from './general-exercise-authoring.ts';
import { isOutputTruncationFinishReason, type ProviderAdapter, type ProviderRawResult, type ProviderRunRequest } from '../llm/types.ts';
import { parseResponse } from '../llm/openai-compatible.ts';
import { costForBulkResult } from '../llm/bulk-repertoire-pricing.ts';

export const BULK_REPERTOIRE_VERSION = 1;
export type BulkWordSnapshot = {
  word: VocabularySenseLexicalWord; catalog: VocabularySenseCatalog; senses: VocabularySense[];
  coverage: VocabularyWordSenseCoverage; hasBootstrap: boolean; fallbacks: VocabularyContent[];
};
export type BulkCall = {
  request: ProviderRunRequest; result: ProviderRawResult; startedAt: string; finishedAt: string; latencyMs: number;
  cost?: ReturnType<typeof costForBulkResult>;
};
export type BulkWordResult = {
  version: 1; snapshot: BulkWordSnapshot; snapshotHash: string; model: string; reasoningEffort: string;
  calls: BulkCall[]; source: GeneralExerciseSource | null;
  status: 'ready' | 'empty_inventory' | 'empty_selection' | 'empty_repertoire';
};
export const bulkHash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Derivation is reproducible from the retained provider responses; it never writes a database. */
export async function generateBulkWord(snapshot: BulkWordSnapshot, options: {
  model: string; reasoningEffort: string; adapter: ProviderAdapter; apiKey: string; baseUrl: string | null;
  workflowId: string; onCall?: (call: BulkCall) => Promise<void>;
}): Promise<BulkWordResult> {
  const calls: BulkCall[] = [];
  const adapter: ProviderAdapter = { ...options.adapter, async run(input, config) {
    const request: ProviderRunRequest = { ...input, model: options.model, reasoningEffort: options.reasoningEffort,
      timeoutMs: 900_000, provenance: { ...input.provenance, workflowId: options.workflowId } };
    const startedAt = new Date().toISOString(), start = performance.now();
    const result = await options.adapter.run(request, config);
    const call = { request, result, startedAt, finishedAt: new Date().toISOString(), latencyMs: performance.now() - start, cost: costForBulkResult(result) };
    calls.push(call);
    await options.onCall?.(call); // Persist the raw output before parsing or downstream work.
    return result;
  } };
  const environment = { OPENAI_API_KEY: options.apiKey, OPENAI_BASE_URL: options.baseUrl ?? '' };
  let senses = snapshot.senses.filter(sense => sense.status === 'active');
  let selected = snapshot.coverage.defaultUsefulSenseIds;
  const result = (status: BulkWordResult['status'], source: GeneralExerciseSource | null = null): BulkWordResult => ({
    version: BULK_REPERTOIRE_VERSION, snapshot, snapshotHash: bulkHash(snapshot), model: options.model,
    reasoningEffort: options.reasoningEffort, calls, source, status,
  });
  if (snapshot.catalog.establishedAt === null) {
    if (snapshot.senses.length || snapshot.hasBootstrap) throw new Error('Partial inventory requires operator review');
    const inventory = validateVocabularySenseInventory(await createVocabularySenseProvider({ environment, adapter }).generate(snapshot.word,
      { workflowId: options.workflowId, attemptNumber: 1, onInvocation() {} }));
    senses = inventory.senses.map(({ defaultUseful: _defaultUseful, ...description }, index) => ({
      senseId: `bulk-sense-${index + 1}`, wordId: snapshot.word.wordId, version: 1, status: 'active',
      description: { ...description, source: { kind: 'sense_inventory' } }, createdAt: '', updatedAt: '',
    }));
    if (selected === null) selected = senses.filter((_sense, index) => inventory.senses[index]!.defaultUseful).map(sense => sense.senseId);
  }
  if (!senses.length) return result('empty_inventory');
  if (selected === null) {
    const selection = await createUsefulSelectionProvider({ environment, adapter }).select({ word: snapshot.word, senses },
      { workflowId: options.workflowId, attemptNumber: 1, onInvocation() {} }) as { senseIds: string[] };
    selected = selection.senseIds;
  }
  const included = senses.filter(sense => selected!.includes(sense.senseId));
  if (!included.length) return result('empty_selection');
  const { meanings: _meanings, ...word } = snapshot.word;
  const source = canonicalExerciseSource(word, included);
  const { promptName, promptVersion, schemaVersion, inputProjectionVersion, ...invocation } = generalExerciseInvocation(source);
  const response = await adapter.run({ ...invocation, model: options.model, reasoningEffort: options.reasoningEffort,
    maxOutputTokens: 24_000, temperature: null, timeoutMs: 900_000, cachePrompt: true,
    provenance: { workflowId: options.workflowId, attemptNumber: 1, stepName: 'general_exercises',
      promptName, promptVersion, schemaVersion, inputProjectionVersion } }, { apiKey: options.apiKey, baseUrl: options.baseUrl });
  if (isOutputTruncationFinishReason(response.finishReason)) throw new Error('Truncated repertoire output');
  const output = validateGeneralExerciseOutput(source, normalizeGeneralExerciseReferences(source, JSON.parse(response.rawText)));
  return result(output.exercises.length ? 'ready' : 'empty_repertoire', source);
}

/** Replay through the same prompt builders/validators, including prerequisite selection. No provider calls. */
export async function verifyBulkWord(value: BulkWordResult): Promise<BulkWordResult> {
  if (value.version !== 1 || value.snapshotHash !== bulkHash(value.snapshot)) throw new Error('Invalid bulk snapshot digest');
  let index = 0;
  const replay: ProviderAdapter = { id: 'openai', defaultBaseUrl: '', apiKeyEnvironmentVariable: '', structuredOutputMode: 'json_schema',
    async run(request) {
      const call = value.calls[index++];
      if (!call || bulkHash(request) !== bulkHash(call.request)) throw new Error('Retained request no longer matches the generation contract');
      const parsed = parseResponse('openai', 'json_schema', call.result.rawResponse);
      if (parsed.rawText !== call.result.rawText || bulkHash(parsed.usage) !== bulkHash(call.result.usage)
        || parsed.model !== call.result.model || parsed.finishReason !== call.result.finishReason)
        throw new Error('Retained provider response disagrees with its projections');
      if(call.cost&&bulkHash(call.cost)!==bulkHash(costForBulkResult(parsed)))throw new Error('Retained cost disagrees with provider usage and pinned pricing');
      return { ...parsed, invocationId: null };
    } };
  const verified = await generateBulkWord(value.snapshot, { model: value.model, reasoningEffort: value.reasoningEffort,
    adapter: replay, apiKey: 'replay', baseUrl: null, workflowId: value.calls[0]?.request.provenance?.workflowId ?? '' });
  if (index !== value.calls.length || verified.status !== value.status || bulkHash(verified.source) !== bulkHash(value.source))
    throw new Error('Retained output does not reproduce its result');
  return verified;
}
