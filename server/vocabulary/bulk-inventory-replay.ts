import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { VocabularySense } from '../../src/domain/vocabulary-content.ts';
import { isOutputTruncationFinishReason, type ProviderAdapter } from '../llm/types.ts';
import { modelLexicalWord } from './model-lexical-word.ts';
import { legacyVocabularySenseInventorySchema, validateLegacyVocabularySenseInventory, validateVocabularySenseInventory, type VocabularySenseInventory } from './sense-inventory-contract.ts';
import { createVocabularySenseProvider, VOCABULARY_SENSE_MODEL, VOCABULARY_SENSE_SERVICE, type VocabularySenseProvider } from './sense-readiness.ts';
import type { RetainedBulkPrerequisite } from './bulk-repertoire.ts';

const combinedPromptHashes: Record<string, string> = {
  '7': '5b89079bfce03bf95fdfaee5dae211457205be3fa4edece98e1f5d80694c1495',
  '8': '1ed63131e8f5ea247d8366342905553175ae369ba79b1b14f59451d94357bce5',
};

/** Recover the two responsibilities of an already paid combined response. */
export function bulkInventoryOutput(value: unknown, combined: boolean) {
  if (!combined) return { inventory: validateVocabularySenseInventory(value), selectedLabels: null };
  const legacy = validateLegacyVocabularySenseInventory(value);
  return { inventory: { senses: legacy.senses.map(({ defaultUseful: _, ...description }) => description) },
    selectedLabels: legacy.senses.filter(sense => sense.defaultUseful).map(sense => sense.label) };
}

/** The off-host selector runs before persistent identities and timestamps exist.
 * Replay binds canonical IDs by exact description and keeps the original evidence order. */
export function bulkGeneratedSenses(wordId: string, inventory: VocabularySenseInventory, published?: VocabularySense[]) {
  if (published && published.length !== inventory.senses.length) throw new Error('Published inventory size differs from retained inventory');
  return inventory.senses.map((entry, index) => {
    const description = { ...entry, source: { kind: 'sense_inventory' } };
    const senseId = published
      ? published.find(sense => sense.version === 1 && isDeepStrictEqual(sense.description, description))?.senseId
      : `bulk-sense-${index + 1}`;
    if (!senseId) throw new Error('Published sense differs from retained inventory');
    return { senseId, wordId, version: 1, status: 'active' as const, description, createdAt: '', updatedAt: '' };
  });
}

export function bulkInventoryProvider(options: { environment: NodeJS.ProcessEnv; adapter: ProviderAdapter },
  retained?: RetainedBulkPrerequisite): VocabularySenseProvider {
  if (!retained) return createVocabularySenseProvider(options);
  const version = retained.provenance?.promptVersion ?? '';
  const digest = createHash('sha256').update(retained.systemPrompt).digest('hex');
  if (retained.outputSchemaName === 'vocabulary_sense_inventory_v4') {
    if (version !== '9' || digest !== '037e2efae2a7f6bbceea42fa337d3edadbcfa15bf428604524793d2aebe1f568')
      throw new Error('Unrecognized retained inventory prompt');
    return createVocabularySenseProvider(options, { version, text: retained.systemPrompt });
  }
  if (retained.outputSchemaName !== 'vocabulary_sense_inventory_v3' || combinedPromptHashes[version] !== digest) {
    throw new Error('Unrecognized retained combined inventory prompt');
  }
  return { isConfigured: () => true, async generate(word, context) {
    const result = await options.adapter.run({ model: VOCABULARY_SENSE_MODEL, reasoningEffort: 'high', systemPrompt: retained.systemPrompt,
      userPrompt: JSON.stringify({ word: modelLexicalWord(word) }), outputSchemaName: 'vocabulary_sense_inventory_v3',
      outputSchema: legacyVocabularySenseInventorySchema, maxOutputTokens: 8000, temperature: null, timeoutMs: 180_000, cachePrompt: true,
      invocationActor: { kind: 'service', serviceId: VOCABULARY_SENSE_SERVICE },
      provenance: { workflowId: context.workflowId, attemptNumber: context.attemptNumber, stepName: 'sense_inventory',
        promptName: 'vocabulary-sense-inventory', promptVersion: version, schemaVersion: '3', inputProjectionVersion: 'simplified-lexical-evidence-v3' } },
      { apiKey: '', baseUrl: null });
    context.onInvocation(result.invocationId);
    if (isOutputTruncationFinishReason(result.finishReason)) throw new Error('Truncated retained inventory');
    return bulkInventoryOutput(JSON.parse(result.rawText), true).inventory;
  } };
}
