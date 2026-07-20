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

function enumSchema(values: string[], description?: string): JsonSchema {
  return { type: 'string', enum: values, ...(description === undefined ? {} : { description }) };
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
    // OpenAI strict structured outputs require every declared object property
    // to be listed in `required`. Represent an absent value as `null` or an
    // empty collection instead of omitting its key.
    required: Object.keys(properties),
    additionalProperties: false,
    ...(description === undefined ? {} : { description }),
  };
}

const cueRefSchema = objectSchema({
  cueId: nullableStringSchema,
  textAsShown: stringSchema,
});

const flagBadCueOperation = objectSchema({
  kind: enumSchema(['flag_bad_production_cue']),
  wordId: stringSchema,
  sourceCue: cueRefSchema,
  issues: arraySchema(enumSchema([
    'underdetermined',
    'misleading_gloss_overlap',
    'overloaded',
    'wrong_register_or_domain',
    'other',
  ])),
  note: stringSchema,
});

const suppressProductionOperation = objectSchema({
  kind: enumSchema(['suppress_definition_production']),
  wordId: stringSchema,
  reason: enumSchema([
    'recognition_only_is_better_fit',
    'answer_space_too_open',
    'low_value_for_learner',
    'other',
  ]),
  note: stringSchema,
});

const upsertContrastContentOperation = objectSchema({
  kind: enumSchema(['upsert_contrast_content']),
  destination: {
    anyOf: [
      objectSchema({
        mode: enumSchema(['create_cluster']),
        clusterId: { type: 'null' },
        title: stringSchema,
      }),
      objectSchema({
        mode: enumSchema(['extend_cluster']),
        clusterId: stringSchema,
        title: { type: 'null' },
      }),
    ],
  },
  clusterNote: nullableStringSchema,
  members: arraySchema(objectSchema({
    wordId: stringSchema,
    nuanceNote: nullableStringSchema,
  })),
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
  wordId: stringSchema,
  sourceCue: cueRefSchema,
  replacementCues: arraySchema(objectSchema({
    cueType: enumSchema([
      'definition_gloss',
      'cloze',
      'minimal_context',
      'register_or_domain_hint',
    ]),
    text: stringSchema,
  })),
  repairIntent: enumSchema([
    'narrow_to_learner_relevant_sense',
    'add_distinguishing_anchor',
    'add_contextual_triangulation',
    'split_overloaded_cue',
  ]),
});

const acceptAlternateOperation = objectSchema({
  kind: enumSchema(['accept_production_alternate']),
  cue: cueRefSchema,
  targetWordId: stringSchema,
  alternateWordId: stringSchema,
  acceptance: enumSchema(['fully_acceptable_for_cue', 'near_valid_creditworthy_answer']),
  subtletyNote: nullableStringSchema,
});

const operationSchema: JsonSchema = {
  anyOf: [
    flagBadCueOperation,
    suppressProductionOperation,
    upsertContrastContentOperation,
    repairCueOperation,
    acceptAlternateOperation,
  ],
};

const proposalSchema = objectSchema({
  proposalKey: stringSchema,
  proposalGroupKey: nullableStringSchema,
  handleVersion: { type: 'integer', enum: [1] },
  rationale: stringSchema,
  operation: operationSchema,
});

const itemResultSchema = objectSchema({
  itemId: stringSchema,
  uncertain: { type: 'boolean' },
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
    questionKey: stringSchema,
    question: stringSchema,
    reason: stringSchema,
  })),
  unhandledNeeds: arraySchema(objectSchema({
    needKey: stringSchema,
    description: stringSchema,
    whyExistingHandlesDoNotFit: stringSchema,
  })),
});

export const sessionReflectionResultSchema: JsonSchema = objectSchema({
  schemaVersion: enumSchema(['session_reflection_result.v2']),
  bundleSchemaVersion: enumSchema(['session_reflection_bundle.v0']),
  summary: nullableStringSchema,
  itemResults: arraySchema(itemResultSchema),
}, 'One structured post-session reflection result.');

export const SESSION_REFLECTION_RESULT_SCHEMA_NAME = 'session_reflection_result_v2';
