import type { JsonSchema } from '../../src/domain/reflection-result-schema.ts';
import { validateJsonSchema } from '../llm/json-schema-validator.ts';

/** Shared by runtime authoring and offline inventory comparisons. */
export const vocabularySenseInventorySchema: JsonSchema = {
  type: 'object', additionalProperties: false, required: ['senses'], properties: {
    senses: { type: 'array', minItems: 0, maxItems: 16, items: {
      type: 'object', additionalProperties: false, required: ['label', 'notes', 'defaultUseful'], properties: {
        label: { type: 'string' }, defaultUseful: { type: 'boolean' },
        notes: { type: 'array', maxItems: 8, items: { type: 'string' } },
      },
    } },
  },
};
export type VocabularySenseInventory = {
  senses: Array<{ label: string; notes: string[]; defaultUseful: boolean }>;
};
export function validateVocabularySenseInventory(value: unknown): VocabularySenseInventory {
  if (validateJsonSchema(value, vocabularySenseInventorySchema).length) throw new Error('Sense inventory failed validation');
  const inventory = value as VocabularySenseInventory;
  const labels = inventory.senses.map(sense => sense.label.trim().toLowerCase());
  if (labels.some(label => !label || label.length > 600) || new Set(labels).size !== labels.length
    || inventory.senses.some(sense => sense.notes.some(note => !note.trim() || note.length > 1600))) {
    throw new Error('Sense inventory contains blank or duplicate descriptions');
  }
  return inventory;
}
