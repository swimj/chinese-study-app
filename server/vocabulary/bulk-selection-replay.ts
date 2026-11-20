import { createHash } from 'node:crypto';
import type { RetainedBulkPrerequisite } from './bulk-repertoire.ts';
import type { JsonSchema } from '../../src/domain/reflection-result-schema.ts';
import { validateJsonSchema } from '../llm/json-schema-validator.ts';
import { isOutputTruncationFinishReason, type ProviderAdapter } from '../llm/types.ts';
import { createUsefulSelectionProvider, defaultUsefulSelectorInput, type UsefulSelectionProvider } from './default-useful-selection.ts';
import { VOCABULARY_SENSE_MODEL, VOCABULARY_SENSE_SERVICE } from './sense-readiness.ts';

// These are the two standalone selector prompts used by historical bulk runs.
const chatPromptHashes: Record<string, string> = {
  '6': 'b3d097da2dd3acb87fcc1480214b4738405078eba92589d970976fd44bd141fa',
  '7': '8678212c4a0c7c833247ddfdc11ed8e30175bf7254e6fa6795b56bbc804201e0',
};

const evaluatedPromptHash = 'c921642d51cb210d5ba3d023b0d3b1f1557a675e65243a67d584029e67b09e8b';
const clarifiedPromptHash = '0b3e963b3bb17eb0742331a2355817ce9897be2bffd0af541683d269f420e4a5';
const decisionsPromptHashes = new Map<string, string[]>([
  ['1', [evaluatedPromptHash, clarifiedPromptHash]],
  // The review branch briefly recorded this version before the first release.
  ['2', [clarifiedPromptHash]],
]);

/** Historical evidence replays its original editorial contract. New calls always use Decisions. */
export function bulkUsefulSelectionProvider(options: { environment: NodeJS.ProcessEnv; adapter: ProviderAdapter },
  retainedRequest?: RetainedBulkPrerequisite): UsefulSelectionProvider {
  if (!retainedRequest) return createUsefulSelectionProvider(options);
  const promptVersion = retainedRequest.provenance?.promptVersion ?? '';
  const prompt = retainedRequest.systemPrompt;
  const digest = createHash('sha256').update(prompt).digest('hex');
  if (retainedRequest.decisions) {
    if (retainedRequest.outputSchemaName !== 'vocabulary_default_useful_selection_v2' || !decisionsPromptHashes.get(promptVersion)?.includes(digest))
      throw new Error('Unrecognized retained Decisions prompt');
    return createUsefulSelectionProvider(options, { version: promptVersion, text: prompt });
  }
  if (retainedRequest.outputSchemaName !== 'vocabulary_default_useful_selection_v1'
    || chatPromptHashes[promptVersion] !== digest) {
    throw new Error('Unrecognized retained bulk selection contract');
  }
  return { isConfigured: () => true, async select(input, context) {
    const { wire, references } = defaultUsefulSelectorInput(input);
    const schema: JsonSchema = { type: 'object', additionalProperties: false, required: ['senseIds'],
      properties: { senseIds: { type: 'array', items: { type: 'string', enum: wire.senses.map(sense => sense.senseId) } } } };
    const result = await options.adapter.run({ model: VOCABULARY_SENSE_MODEL, reasoningEffort: 'high',
      systemPrompt: prompt, userPrompt: JSON.stringify(wire), outputSchemaName: 'vocabulary_default_useful_selection_v1',
      outputSchema: schema, maxOutputTokens: 4000, temperature: null, timeoutMs: 180_000, cachePrompt: true,
      invocationActor: { kind: 'service', serviceId: VOCABULARY_SENSE_SERVICE }, provenance: { workflowId: context.workflowId,
        attemptNumber: context.attemptNumber, stepName: 'default_useful_selection', promptName: 'vocabulary-default-useful-selection',
        promptVersion, schemaVersion: '1', inputProjectionVersion: 'canonical-inventory-local-senses-v3' } }, { apiKey: '', baseUrl: null });
    context.onInvocation(result.invocationId);
    if (isOutputTruncationFinishReason(result.finishReason)) throw new Error('Truncated retained selection response');
    const parsed: unknown = JSON.parse(result.rawText);
    if (validateJsonSchema(parsed, schema).length) throw new Error('Invalid retained selection response');
    const { senseIds } = parsed as { senseIds: string[] };
    if (new Set(senseIds).size !== senseIds.length) throw new Error('Duplicate retained selection');
    return { senseIds: senseIds.map(id => references.canonical(id)) };
  } };
}
