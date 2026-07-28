/**
 * The provider-facing JSON Schema for the accepted reflection result contract.
 *
 * This lives with the shared domain contract so production generation and the
 * provider spike validate the same wire format.
 */
export type JsonSchema = {
  type?: string | string[];
  enum?: Array<string | number | boolean | null>;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchema;
  anyOf?: JsonSchema[];
  minItems?: number;
};

const stringSchema: JsonSchema = { type: 'string' };
const nullableStringSchema: JsonSchema = { type: ['string', 'null'] };

function enumSchema(values: Array<string | number>, description?: string): JsonSchema {
  const type = values.every((value) => typeof value === 'number' && Number.isInteger(value))
    ? 'integer'
    : 'string';
  return { type, enum: values, ...(description === undefined ? {} : { description }) };
}

function arraySchema(items: JsonSchema, description?: string): JsonSchema {
  return { type: 'array', items, ...(description === undefined ? {} : { description }) };
}

function objectSchema(
  properties: Record<string, JsonSchema>,
  description?: string,
): JsonSchema {
  return {
    type: 'object',
    properties,
    // OpenAI strict structured outputs require every declared property.
    // Nullable values and empty collections represent absence.
    required: Object.keys(properties),
    additionalProperties: false,
    ...(description === undefined ? {} : { description }),
  };
}

const suppressProductionOperation = objectSchema({
  kind: enumSchema(['suppress_definition_production']),
  version: enumSchema([1]),
  wordId: stringSchema,
});

const createContrastClusterOperation = objectSchema({
  kind: enumSchema(['create_contrast_cluster']),
  version: enumSchema([1]),
  title: stringSchema,
  clusterNote: nullableStringSchema,
  members: {
    ...arraySchema(objectSchema({
      wordId: stringSchema,
      nuanceNote: nullableStringSchema,
    })),
    minItems: 2,
  },
  prompts: {
    ...arraySchema(objectSchema({
      targetWordId: stringSchema,
      promptText: stringSchema,
      explanation: nullableStringSchema,
    })),
    minItems: 1,
  },
});

const repairCueOperation = objectSchema({
  kind: enumSchema(['repair_production_cue']),
  version: enumSchema([1]),
  wordId: stringSchema,
  proposedCues: {
    ...arraySchema(objectSchema({
      cueType: enumSchema([
        'definition_gloss',
        'cloze',
        'minimal_context',
        'register_or_domain_hint',
      ]),
      text: stringSchema,
    })),
    minItems: 1,
  },
  repairIntent: enumSchema([
    'narrow_to_learner_relevant_sense',
    'add_distinguishing_anchor',
    'add_contextual_triangulation',
    'split_overloaded_cue',
  ]),
});

const acceptAlternateOperation = objectSchema({
  kind: enumSchema(['accept_production_alternate']),
  version: enumSchema([1]),
  targetWordId: stringSchema,
  alternateWordId: stringSchema,
});

const operationSchema: JsonSchema = {
  anyOf: [
    suppressProductionOperation,
    createContrastClusterOperation,
    repairCueOperation,
    acceptAlternateOperation,
  ],
};

const proposalSchema = objectSchema({
  proposalGroupKey: nullableStringSchema,
  rationale: stringSchema,
  operation: operationSchema,
});

const itemResultSchema = objectSchema({
  itemId: stringSchema,
  diagnosisTags: arraySchema(enumSchema([
    'valid_or_near_valid_alternate',
    'cue_overlap_hides_usage_difference',
    'production_cue_overloaded',
    'form_or_sound_interference',
    'grammar_or_usage_role_interference',
    'ordinary_retrieval_noise',
    'persistent_confusion',
    'insufficient_evidence',
  ])),
  observation: stringSchema,
  learnerExplanation: nullableStringSchema,
  proposals: arraySchema(proposalSchema),
  questions: arraySchema(objectSchema({
    question: stringSchema,
    reason: stringSchema,
  })),
  unhandledNeeds: arraySchema(objectSchema({
    description: stringSchema,
    whyRegisteredOperationsDoNotFit: stringSchema,
  })),
});

export const sessionReflectionResultSchema: JsonSchema = objectSchema({
  schemaVersion: enumSchema(['session_reflection_result.v4']),
  itemResults: arraySchema(itemResultSchema),
}, 'One structured post-session reflection result.');

export const SESSION_REFLECTION_RESULT_SCHEMA_NAME = 'session_reflection_result_v4';
