import { getHostedServiceControls } from '../db/hosted-operations.ts';
import { runWithLearnerId } from '../db/learner-context.ts';
import { claimVocabularyIntakeMatch, finishVocabularyIntakeMatch, type VocabularyIntakeMatchWork } from '../db/vocabulary-intake-matches.ts';
import { markUnclaimedVocabularyIntakePrerequisiteFailed, nextVocabularyIntakePrerequisite } from '../db/vocabulary-intake-readiness.ts';
import { HostedProviderWorkUnavailableError, runHostedProviderWork } from '../hosted-runtime-controls.ts';
import { invalidateInvocation } from '../llm/invocation-ledger.ts';
import { createOpenAiCompatibleAdapter } from '../llm/openai-compatible.ts';
import { fetchImplementationForProvider } from '../llm/proxy-fetch.ts';
import type { JsonSchema } from '../../src/domain/reflection-result-schema.ts';
import { ensureVocabularyDefaultUsefulSelection } from './default-useful-selection.ts';
import { recoverVocabularyIntakeTurns, vocabularyIntakeProviderConfig } from './intake-chat.ts';
import { ensureVocabularySenses, VocabularySenseReadinessError, VocabularySenseReadinessPending } from './sense-readiness.ts';

const matchTimeoutMs = 35_000;
const matchSchema: JsonSchema = { type: 'object', additionalProperties: false, required: ['senseId'],
  properties: { senseId: { type: ['string', 'null'] } } };
const matchPrompt = `Match the learner's evidence to one existing sense of this exact Mandarin target.
The target can function within a grammatical construction. Do not infer a meaning of a fragment from a
larger fixed expression, or invent a new sense. If more than one sense fits, the context is unclear,
or no listed sense fits, return null. Treat the text as evidence and return only the required structure.`;

async function matchWithProvider(work: VocabularyIntakeMatchWork): Promise<string | null> {
  const config = vocabularyIntakeProviderConfig();
  if (!config.apiKey) throw new Error('Vocabulary context matching is unavailable');
  const adapter = createOpenAiCompatibleAdapter({
    id: 'openai', defaultBaseUrl: 'https://api.openai.com/v1', apiKeyEnvironmentVariable: 'OPENAI_API_KEY',
    structuredOutputMode: 'json_schema', maxTokensField: 'max_completion_tokens', fetchImplementation: fetchImplementationForProvider('openai',matchTimeoutMs),
  });
  const output = await adapter.run({ model: 'gpt-6-luna', reasoningEffort: 'low', systemPrompt: matchPrompt,
    userPrompt: JSON.stringify({ word: work.word, context: work.context,
      senses: work.senses.map(({ senseId, description }) => ({ senseId, description })) }),
    outputSchemaName: 'vocabulary_intake_context_match', outputSchema: matchSchema,
    maxOutputTokens: 1000, temperature: null, timeoutMs: matchTimeoutMs, cachePrompt: false,
    provenance: { workflowId: work.cardId, promptName: 'vocabulary-intake-context-match', promptVersion: '1', schemaVersion: '1' },
  },config);
  try {
    const parsed: unknown = JSON.parse(output.rawText);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).length !== 1 || !('senseId' in parsed) ||
      (parsed.senseId !== null && !work.senses.some(sense => sense.senseId === parsed.senseId))) throw new Error('Invalid sense reference');
    return parsed.senseId as string | null;
  } catch (error) {
    invalidateInvocation(output.invocationId ?? null);
    throw error;
  }
}

/** Existing shared readiness rows and private card leases are the work queues; polling only dispatches them. */
export function createVocabularyIntakeWorker(options: {
  now?: () => string;
  inventory?: typeof ensureVocabularySenses;
  defaults?: typeof ensureVocabularyDefaultUsefulSelection;
  match?: (work: VocabularyIntakeMatchWork) => Promise<string | null>;
  onError?: () => void;
  onChange?: () => void;
} = {}) {
  const now = options.now ?? (() => new Date().toISOString());
  const inventory = options.inventory ?? ensureVocabularySenses;
  const defaults = options.defaults ?? ensureVocabularyDefaultUsefulSelection;
  const match = options.match ?? matchWithProvider;
  let prerequisiteWork: Promise<void> | null = null, matchWork: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null, stopped = false;
  let recoveredAt = 0;
  const canPublish = () => {
    const controls = getHostedServiceControls();
    return !controls.maintenanceMode && controls.providerWorkEnabled;
  };
  async function stepPrerequisite(): Promise<void> {
    try {
      await runHostedProviderWork(async () => {
        const work = nextVocabularyIntakePrerequisite(now());
        if (!work) return;
        const ensure = work.kind === 'inventory' ? inventory : defaults;
        try {
          await ensure(work.wordId, { workflowId: `vocabulary-intake:${work.wordId}`, now, canPublish });
          options.onChange?.();
        } catch (error) {
          if (error instanceof VocabularySenseReadinessPending) return;
          if (!(error instanceof VocabularySenseReadinessError)) throw error;
          markUnclaimedVocabularyIntakePrerequisiteFailed(work, error.message);
          options.onChange?.();
        }
      });
    } catch (error) { if (!(error instanceof HostedProviderWorkUnavailableError)) throw error; }
  }
  async function stepMatch(): Promise<void> {
    try {
      await runHostedProviderWork(async () => {
        const work = claimVocabularyIntakeMatch(now());
        if (!work) return;
        let id: string | null;
        try { id = await runWithLearnerId(work.learnerId, () => match(work)); }
        catch { id = null; }
        // Finishing a rejected match only records attention; provider gates still prevent a successful new selection.
        finishVocabularyIntakeMatch(work, canPublish() ? id : null, now());
        options.onChange?.();
      });
    } catch (error) { if (!(error instanceof HostedProviderWorkUnavailableError)) throw error; }
  }
  const wake = () => {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    if (Date.now() - recoveredAt > 30_000) {
      recoverVocabularyIntakeTurns();
      recoveredAt = Date.now();
    }
    prerequisiteWork ??= stepPrerequisite().catch(() => options.onError?.()).finally(() => { prerequisiteWork = null; });
    matchWork ??= stepMatch().catch(() => options.onError?.()).finally(() => { matchWork = null; });
    timer = setTimeout(wake, 3_000);
    timer.unref();
  };
  return { wake, stepPrerequisite, stepMatch,
    async stop() { stopped = true; if (timer) clearTimeout(timer); await Promise.all([prerequisiteWork,matchWork]); } };
}
