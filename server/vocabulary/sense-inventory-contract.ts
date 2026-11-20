import type { JsonSchema } from '../../src/domain/reflection-result-schema.ts';
import { validateJsonSchema } from '../llm/json-schema-validator.ts';

type InventorySense = { label: string; notes: string[] };
export type VocabularySenseInventory = { senses: InventorySense[] };
type LegacyVocabularySenseInventory = { senses: Array<InventorySense & { defaultUseful: boolean }> };

const label: JsonSchema = { type: 'string' };
const notes: JsonSchema = { type: 'array', maxItems: 8, items: { type: 'string' } };
function inventorySchema(item: JsonSchema): JsonSchema {
  return {
    type: 'object', additionalProperties: false, required: ['senses'], properties: {
      senses: { type: 'array', minItems: 0, maxItems: 16, items: item },
    },
  };
}

/** The current inventory contract describes each sense. Default teaching selection has its own provider. */
export const vocabularySenseInventorySchemaName = 'vocabulary_sense_inventory_v4';
export const vocabularySenseInventorySchema = inventorySchema({
  type: 'object', additionalProperties: false, required: ['label', 'notes'], properties: { label, notes },
});

/** Exact v3 request schema for validating and replaying historical combined inventories. */
export const legacyVocabularySenseInventorySchema = inventorySchema({
  type: 'object', additionalProperties: false, required: ['label', 'notes', 'defaultUseful'],
  properties: { label, defaultUseful: { type: 'boolean' }, notes },
});

function validateInventory<T extends VocabularySenseInventory>(value: unknown, schema: JsonSchema): T {
  if (validateJsonSchema(value, schema).length) throw new Error('Sense inventory failed validation');
  const inventory = value as T;
  const labels = inventory.senses.map(sense => sense.label.trim().toLowerCase());
  if (labels.some(label => !label || label.length > 600) || new Set(labels).size !== labels.length
    || inventory.senses.some(sense => sense.notes.some(note => !note.trim() || note.length > 1600))) {
    throw new Error('Sense inventory contains blank or duplicate descriptions');
  }
  return inventory;
}

export function validateVocabularySenseInventory(value: unknown): VocabularySenseInventory {
  return validateInventory(value, vocabularySenseInventorySchema);
}

export function validateLegacyVocabularySenseInventory(value: unknown): LegacyVocabularySenseInventory {
  return validateInventory(value, legacyVocabularySenseInventorySchema);
}
