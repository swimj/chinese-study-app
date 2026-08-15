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

const createContrastClusterOperationV1 = objectSchema({
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

const createContrastClusterOperationV2 = objectSchema({
  ...createContrastClusterOperationV1.properties,
  version: enumSchema([2]),
  prompts: {
    ...createContrastClusterOperationV1.properties!.prompts,
    minItems: 4,
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

const productionCueDraftV2 = objectSchema({
  cueType: enumSchema([
    'definition_gloss',
    'minimal_context',
    'circumstance',
  ]),
  text: stringSchema,
  acceptedWordIds: {
    ...arraySchema(stringSchema),
    minItems: 1,
  },
});

const repairCueOperationV2Wire = objectSchema({
  kind: enumSchema(['repair_production_cue']),
  wordId: stringSchema,
  changes: {
    ...arraySchema({
      anyOf: [
        objectSchema({
          kind: enumSchema(['create']),
          cue: productionCueDraftV2,
        }),
        objectSchema({
          kind: enumSchema(['replace']),
          cueId: stringSchema,
          replacements: {
            ...arraySchema(productionCueDraftV2),
            minItems: 1,
          },
        }),
        objectSchema({
          kind: enumSchema(['deactivate']),
          cueId: stringSchema,
        }),
      ],
    }),
    minItems: 1,
  },
  sourceAttemptJudgments: arraySchema({
    anyOf: [
      objectSchema({
        kind: enumSchema(['accepted_answer_space_omission']),
        submittedWordId: stringSchema,
      }),
      objectSchema({
        kind: enumSchema(['misleading_or_overloaded_cue']),
      }),
    ],
  }),
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
    createContrastClusterOperationV1,
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

const operationSchemaV5Wire: JsonSchema = {
  anyOf: [
    suppressProductionOperation,
    createContrastClusterOperationV2,
    repairCueOperationV2Wire,
  ],
};

const proposalSchemaV5Wire = objectSchema({
  proposalGroupKey: nullableStringSchema,
  rationale: stringSchema,
  operation: operationSchemaV5Wire,
});

const itemResultSchemaV5Wire = objectSchema({
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
  proposals: arraySchema(proposalSchemaV5Wire),
  questions: arraySchema(objectSchema({
    question: stringSchema,
    reason: stringSchema,
  })),
  unhandledNeeds: arraySchema(objectSchema({
    description: stringSchema,
    whyRegisteredOperationsDoNotFit: stringSchema,
  })),
});

const itemResultSchemaV6Wire = objectSchema({
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
  learnerExplanation: stringSchema,
  proposals: arraySchema(proposalSchemaV5Wire),
  questions: arraySchema(objectSchema({
    question: stringSchema,
    reason: stringSchema,
  })),
});

export const sessionReflectionResultSchema: JsonSchema = objectSchema({
  schemaVersion: enumSchema(['session_reflection_result.v4']),
  itemResults: arraySchema(itemResultSchema),
}, 'One structured post-session reflection result.');

export const SESSION_REFLECTION_RESULT_SCHEMA_NAME = 'session_reflection_result_v4';

export const sessionReflectionResultV5WireSchema: JsonSchema = objectSchema({
  schemaVersion: enumSchema(['session_reflection_result.v5']),
  itemResults: arraySchema(itemResultSchemaV5Wire),
}, 'One structured post-session reflection result using model-authored V2 cue repairs.');

export const SESSION_REFLECTION_RESULT_V5_WIRE_SCHEMA_NAME = 'session_reflection_result_v5';

export const sessionReflectionResultV6WireSchema: JsonSchema = objectSchema({
  schemaVersion: enumSchema(['session_reflection_result.v6']),
  itemResults: arraySchema(itemResultSchemaV6Wire),
}, 'One structured post-session reflection result with one item-level teaching surface.');

export const SESSION_REFLECTION_RESULT_V6_WIRE_SCHEMA_NAME = 'session_reflection_result_v6';
