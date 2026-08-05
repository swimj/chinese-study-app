export type StudyProfileV0 = 'mandarin' | 'french';

export type ReflectionWordSnapshotV1 = {
  wordId: string;
  hanzi: string;
  pinyin: string;
  meanings: string[];
};

export type ReflectionCueSnapshotV0 = {
  cueId: string | null;
  cueType: 'definition_gloss' | 'cloze' | 'minimal_context' | 'other';
  displayOrder: number;
  text: string;
  displayedMeanings: string[];
};

export type ReflectionServedCueSnapshotV1 = {
  cueId: string | null;
  cueType: ProductionCueTypeV0;
  text: string;
  acceptedWordIds: string[];
};

export type ReflectionExistingContentV0 = {
  contrastClusters: Array<{
    clusterId: string;
    title: string | null;
    memberWordIds: string[];
    promptCount: number;
    notes: string[];
  }>;
  knownAcceptedAlternates: Array<{
    cueId: string | null;
    acceptedWordIds: string[];
    note: string | null;
  }>;
};

type ReflectionItemBaseV1 = {
  itemId: string;
  sessionActionId: string | null;
  occurredAt: string | null;
  targetWord: ReflectionWordSnapshotV1 | null;
  sessionNote: string | null;
  existingContent: ReflectionExistingContentV0;
};

export type ProductionMistakeReflectionItemV1 = ReflectionItemBaseV1 & {
  source: 'production_mistake';
  sourceActionKind: 'production';
  targetWord: ReflectionWordSnapshotV1;
  cuesAsShown: ReflectionCueSnapshotV0[];
  rawResponse: string | null;
  submittedWord: ReflectionWordSnapshotV1 | null;
  responseKind: 'matched_known_word' | 'no_clue' | 'unmatched_text';
};

export type SessionNoteReflectionItemV1 = ReflectionItemBaseV1 & {
  source: 'session_note';
  sourceActionKind: 'recognition' | 'production' | 'contrast_selection' | null;
  cuesAsShown: ReflectionCueSnapshotV0[];
  relatedWords: ReflectionWordSnapshotV1[];
  linkedAttemptId: string | null;
};

export type ContrastSelectionReflectionItemV1 = ReflectionItemBaseV1 & {
  source: 'contrast_selection';
  sourceActionKind: 'contrast_selection';
  targetWord: ReflectionWordSnapshotV1;
  promptAsShown: {
    promptId: string;
    promptText: string;
    explanationShown: string | null;
    choiceWords: ReflectionWordSnapshotV1[];
    promptTargetWordId: string;
  };
  reflectionSignal: 'clear_now' | 'still_shaky' | 'want_more_practice' | null;
};

export type ReflectionInputItemV1 =
  | ProductionMistakeReflectionItemV1
  | SessionNoteReflectionItemV1
  | ContrastSelectionReflectionItemV1;

export type SessionReflectionBundleV1 = {
  schemaVersion: 'session_reflection_bundle.v1';
  generatedAt: string;
  session: {
    sessionId: string;
    startedAt: string | null;
    endedAt: string | null;
    studyProfile: StudyProfileV0;
  };
  items: ReflectionInputItemV1[];
};

export type ProductionMistakeReflectionItemV2 = Omit<
  ProductionMistakeReflectionItemV1,
  'cuesAsShown' | 'responseKind'
> & {
  sourceAttemptId: string;
  servedCue: ReflectionServedCueSnapshotV1;
  responseKind: ProductionMistakeReflectionItemV1['responseKind'];
};

export type ReflectionInputItemV2 = ProductionMistakeReflectionItemV2;

export type SessionReflectionBundleV2 = {
  schemaVersion: 'session_reflection_bundle.v2';
  generatedAt: string;
  session: SessionReflectionBundleV1['session'];
  items: ReflectionInputItemV2[];
};

export type SessionReflectionBundle = SessionReflectionBundleV1 | SessionReflectionBundleV2;

export type ReflectionDiagnosisTagV1 =
  | 'valid_or_near_valid_alternate'
  | 'cue_overlap_hides_usage_difference'
  | 'production_cue_overloaded'
  | 'form_or_sound_interference'
  | 'grammar_or_usage_role_interference'
  | 'ordinary_retrieval_noise'
  | 'persistent_confusion'
  | 'insufficient_evidence';

export type SuppressDefinitionProductionOperationV1 = {
  kind: 'suppress_definition_production';
  version: 1;
  wordId: string;
};

export type CreateContrastClusterOperationV1 = {
  kind: 'create_contrast_cluster';
  version: 1;
  title: string;
  clusterNote: string | null;
  members: Array<{
    wordId: string;
    nuanceNote: string | null;
  }>;
  prompts: Array<{
    targetWordId: string;
    promptText: string;
    explanation: string | null;
  }>;
};

export type RepairProductionCueOperationV1 = {
  kind: 'repair_production_cue';
  version: 1;
  wordId: string;
  proposedCues: Array<{
    cueType:
      | 'definition_gloss'
      | 'cloze'
      | 'minimal_context'
      | 'register_or_domain_hint';
    text: string;
  }>;
  repairIntent:
    | 'narrow_to_learner_relevant_sense'
    | 'add_distinguishing_anchor'
    | 'add_contextual_triangulation'
    | 'split_overloaded_cue';
};

export type ProductionCueTypeV0 =
  | 'definition_gloss'
  | 'minimal_context'
  | 'circumstance';

export type ProductionCueDraftV2 = {
  cueType: ProductionCueTypeV0;
  text: string;
  acceptedWordIds: string[];
};

export type ProductionCueChangeV2 =
  | {
      kind: 'create';
      cue: ProductionCueDraftV2;
    }
  | {
      kind: 'replace';
      cueId: string;
      replacements: ProductionCueDraftV2[];
    }
  | {
      kind: 'deactivate';
      cueId: string;
    };

export type CueEvidenceJudgmentV2 =
  | {
      kind: 'accepted_answer_space_omission';
      sourceAttemptId: string;
      submittedWordId: string;
    }
  | {
      kind: 'misleading_or_overloaded_cue';
      sourceAttemptId: string;
    };

export type RepairProductionCueOperationV2 = {
  kind: 'repair_production_cue';
  version: 2;
  wordId: string;
  taskId: string;
  changes: ProductionCueChangeV2[];
  sourceAttemptJudgments: CueEvidenceJudgmentV2[];
};

export type RepairProductionCueOperationV2Wire = Omit<
  RepairProductionCueOperationV2,
  'version' | 'taskId'
>;

export type AcceptProductionAlternateOperationV1 = {
  kind: 'accept_production_alternate';
  version: 1;
  targetWordId: string;
  alternateWordId: string;
};

export type ReflectionOperation =
  | SuppressDefinitionProductionOperationV1
  | CreateContrastClusterOperationV1
  | RepairProductionCueOperationV1
  | RepairProductionCueOperationV2
  | AcceptProductionAlternateOperationV1;

export type ReflectionOperationV5Wire =
  | SuppressDefinitionProductionOperationV1
  | CreateContrastClusterOperationV1
  | RepairProductionCueOperationV2Wire;

export type ReflectionProposalV1 = {
  proposalGroupKey: string | null;
  rationale: string;
  operation: ReflectionOperation;
};

export type ReflectionClarifyingQuestionV1 = {
  question: string;
  reason: string;
};

export type ReflectionUnhandledNeedV1 = {
  description: string;
  whyRegisteredOperationsDoNotFit: string;
};

export type ReflectionItemResultV1 = {
  itemId: string;
  diagnosisTags: ReflectionDiagnosisTagV1[];
  observation: string;
  learnerExplanation: string | null;
  proposals: ReflectionProposalV1[];
  questions: ReflectionClarifyingQuestionV1[];
  unhandledNeeds: ReflectionUnhandledNeedV1[];
};

export type SessionReflectionResultV4 = {
  schemaVersion: 'session_reflection_result.v4';
  itemResults: ReflectionItemResultV1[];
};

export type ReflectionProposalV5Wire = Omit<ReflectionProposalV1, 'operation'> & {
  operation: ReflectionOperationV5Wire;
};

export type ReflectionItemResultV5Wire = Omit<ReflectionItemResultV1, 'proposals'> & {
  proposals: ReflectionProposalV5Wire[];
};

export type SessionReflectionResultV5Wire = {
  schemaVersion: 'session_reflection_result.v5';
  itemResults: ReflectionItemResultV5Wire[];
};

export type SessionReflectionResultV5 = {
  schemaVersion: 'session_reflection_result.v5';
  itemResults: ReflectionItemResultV1[];
};

export type SessionReflectionResult = SessionReflectionResultV4 | SessionReflectionResultV5;

export type EffectRef = {
  type: string;
  id: string;
};

export type ProductionCueEffectRef =
  | { type: 'production_cue'; id: string }
  | { type: 'production_cue_lifecycle_event'; id: string }
  | { type: 'production_cue_evidence_judgment'; id: string };

export type ProposalSupersession = {
  source: 'competing_proposal' | 'user_replacement' | 'external_state';
  actor: 'user' | 'system';
  reason: string;
  replacementProposalId: string | null;
  replacementInvocationId: string | null;
  satisfyingEffectRefs: EffectRef[];
};

export type ProposalReviewDisposition =
  | { kind: 'pending' }
  | { kind: 'deferred' }
  | {
      kind: 'accepted';
      acceptanceMode: 'exact' | 'revised';
      acceptedInvocationId: string;
    }
  | {
      kind: 'dismissed';
      reason: string | null;
    }
  | {
      kind: 'superseded';
      supersession: ProposalSupersession;
    };

export type ProposalReviewStatus = {
  proposalId: string;
  updatedAt: string;
  disposition: ProposalReviewDisposition;
};

export type OperationInvocation = {
  invocationId: string;
  createdAt: string;
  origin:
    | { kind: 'proposal_acceptance'; proposalId: string }
    | { kind: 'user_replacement'; supersededProposalId: string }
    | { kind: 'manual' };
  operation: ReflectionOperation;
};

export type OperationApplicationState =
  | {
      kind: 'unsupported';
      reason: string;
    }
  | {
      kind: 'pending';
    }
  | {
      kind: 'applied';
      appliedAt: string;
      effectRefs: EffectRef[];
    }
  | {
      kind: 'failed';
      error: string;
    }
  | {
      kind: 'stale';
      reason: string;
    }
  | {
      kind: 'already_satisfied';
      satisfyingEffectRefs: EffectRef[];
    }
  | {
      kind: 'authorization_withdrawn';
    };

export type OperationApplicationStatus = {
  invocationId: string;
  updatedAt: string;
  state: OperationApplicationState;
};

export type ReviewProposalRequest =
  | { action: 'defer' }
  | { action: 'dismiss'; reason: string | null }
  | { action: 'accept'; operation: ReflectionOperation };

export type ReflectionOperationRegistration = {
  kind: ReflectionOperation['kind'];
  version: 1 | 2;
  editorAvailable: true;
  applySupport: 'supported' | 'unsupported';
};

export const REFLECTION_OPERATION_REGISTRY = [
  {
    kind: 'suppress_definition_production',
    version: 1,
    editorAvailable: true,
    applySupport: 'supported',
  },
  {
    kind: 'create_contrast_cluster',
    version: 1,
    editorAvailable: true,
    applySupport: 'supported',
  },
  {
    kind: 'repair_production_cue',
    version: 1,
    editorAvailable: true,
    applySupport: 'unsupported',
  },
  {
    kind: 'repair_production_cue',
    version: 2,
    editorAvailable: true,
    applySupport: 'supported',
  },
  {
    kind: 'accept_production_alternate',
    version: 1,
    editorAvailable: true,
    applySupport: 'unsupported',
  },
] as const satisfies readonly ReflectionOperationRegistration[];

export function getReflectionOperationRegistration(
  kind: string,
  version: number,
): ReflectionOperationRegistration | null {
  return REFLECTION_OPERATION_REGISTRY.find(
    (registration) => registration.kind === kind && registration.version === version,
  ) ?? null;
}

type UnknownRecord = Record<string, unknown>;

export type ReflectionOperationValidationOptions = {
  allowedWordIds?: ReadonlySet<string>;
  evidenceItemId?: string;
  path?: string;
};

const diagnosisTags = new Set<ReflectionDiagnosisTagV1>([
  'valid_or_near_valid_alternate',
  'cue_overlap_hides_usage_difference',
  'production_cue_overloaded',
  'form_or_sound_interference',
  'grammar_or_usage_role_interference',
  'ordinary_retrieval_noise',
  'persistent_confusion',
  'insufficient_evidence',
]);

const cueTypes = new Set([
  'definition_gloss',
  'cloze',
  'minimal_context',
  'register_or_domain_hint',
]);

const productionCueTypesV0 = new Set<ProductionCueTypeV0>([
  'definition_gloss',
  'minimal_context',
  'circumstance',
]);

const productionCueChangeKindsV2 = new Set<ProductionCueChangeV2['kind']>([
  'create',
  'replace',
  'deactivate',
]);

const cueEvidenceJudgmentKindsV2 = new Set<CueEvidenceJudgmentV2['kind']>([
  'accepted_answer_space_omission',
  'misleading_or_overloaded_cue',
]);

const repairIntents = new Set([
  'narrow_to_learner_relevant_sense',
  'add_distinguishing_anchor',
  'add_contextual_triangulation',
  'split_overloaded_cue',
]);

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateObjectFields(
  value: unknown,
  fields: readonly string[],
  path: string,
): string[] {
  if (!isRecord(value)) return [`${path}: expected object`];
  const errors: string[] = [];
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) errors.push(`${path}.${field}: required property is missing`);
  }
  for (const field of Object.keys(value)) {
    if (!fields.includes(field)) errors.push(`${path}.${field}: unknown property`);
  }
  return errors;
}

function validateString(value: unknown, path: string, nonEmpty = false): string[] {
  if (typeof value !== 'string') return [`${path}: expected string`];
  if (nonEmpty && value.trim().length === 0) return [`${path}: must not be empty`];
  return [];
}

function validateNullableString(value: unknown, path: string): string[] {
  return value === null ? [] : validateString(value, path);
}

function validateWordReference(
  value: unknown,
  path: string,
  options: ReflectionOperationValidationOptions,
): string[] {
  const errors = validateString(value, path, true);
  if (errors.length > 0 || options.allowedWordIds === undefined) return errors;
  const wordId = value as string;
  if (options.allowedWordIds.has(wordId)) return errors;
  const detail = options.evidenceItemId === undefined
    ? 'is not known and visible'
    : `is not present in item ${options.evidenceItemId}`;
  errors.push(`${path}: word id ${wordId} ${detail}`);
  return errors;
}

export function reflectionOperationWordReferences(operation: ReflectionOperation): string[] {
  switch (operation.kind) {
    case 'suppress_definition_production':
      return [operation.wordId];
    case 'repair_production_cue':
      if (operation.version === 1) return [operation.wordId];
      return [
        operation.wordId,
        ...operation.changes.flatMap((change) => {
          switch (change.kind) {
            case 'create':
              return change.cue.acceptedWordIds;
            case 'replace':
              return change.replacements.flatMap((cue) => cue.acceptedWordIds);
            case 'deactivate':
              return [];
          }
        }),
        ...operation.sourceAttemptJudgments.flatMap((judgment) => (
          judgment.kind === 'accepted_answer_space_omission'
            ? [judgment.submittedWordId]
            : []
        )),
      ];
    case 'create_contrast_cluster':
      return operation.members.map((member) => member.wordId);
    case 'accept_production_alternate':
      return [operation.targetWordId, operation.alternateWordId];
  }
}

export function validateReflectionOperation(
  value: unknown,
  options: ReflectionOperationValidationOptions = {},
): string[] {
  const path = options.path ?? '$';
  if (!isRecord(value)) return [`${path}: expected object`];
  const kind = value.kind;
  const version = value.version;
  if (typeof kind !== 'string') return [`${path}.kind: expected string`];
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    return [`${path}.version: expected integer`];
  }
  if (getReflectionOperationRegistration(kind, version) === null) {
    return [`${path}: unknown operation kind/version ${kind}@${version}`];
  }

  const errors: string[] = [];
  switch (kind) {
    case 'suppress_definition_production': {
      errors.push(...validateObjectFields(value, ['kind', 'version', 'wordId'], path));
      errors.push(...validateWordReference(value.wordId, `${path}.wordId`, options));
      break;
    }
    case 'create_contrast_cluster': {
      errors.push(...validateObjectFields(
        value,
        ['kind', 'version', 'title', 'clusterNote', 'members', 'prompts'],
        path,
      ));
      errors.push(...validateString(value.title, `${path}.title`, true));
      errors.push(...validateNullableString(value.clusterNote, `${path}.clusterNote`));

      if (!Array.isArray(value.members)) {
        errors.push(`${path}.members: expected array`);
      } else {
        const memberIds: string[] = [];
        for (const [index, member] of value.members.entries()) {
          const memberPath = `${path}.members[${index}]`;
          errors.push(...validateObjectFields(member, ['wordId', 'nuanceNote'], memberPath));
          if (!isRecord(member)) continue;
          errors.push(...validateWordReference(member.wordId, `${memberPath}.wordId`, options));
          errors.push(...validateNullableString(member.nuanceNote, `${memberPath}.nuanceNote`));
          if (typeof member.wordId === 'string') memberIds.push(member.wordId);
        }
        if (new Set(memberIds).size < 2) {
          errors.push(`${path}.members: at least two distinct words are required`);
        }
        if (new Set(memberIds).size !== memberIds.length) {
          errors.push(`${path}.members: duplicate word id`);
        }
      }

      if (!Array.isArray(value.prompts)) {
        errors.push(`${path}.prompts: expected array`);
      } else {
        if (value.prompts.length === 0) {
          errors.push(`${path}.prompts: at least one prompt is required`);
        }
        const memberIds = new Set(
          Array.isArray(value.members)
            ? value.members.flatMap((member) => (
              isRecord(member) && typeof member.wordId === 'string' ? [member.wordId] : []
            ))
            : [],
        );
        const promptKeys = new Set<string>();
        for (const [index, prompt] of value.prompts.entries()) {
          const promptPath = `${path}.prompts[${index}]`;
          errors.push(...validateObjectFields(
            prompt,
            ['targetWordId', 'promptText', 'explanation'],
            promptPath,
          ));
          if (!isRecord(prompt)) continue;
          errors.push(...validateWordReference(
            prompt.targetWordId,
            `${promptPath}.targetWordId`,
            options,
          ));
          errors.push(...validateString(prompt.promptText, `${promptPath}.promptText`, true));
          errors.push(...validateNullableString(prompt.explanation, `${promptPath}.explanation`));
          if (typeof prompt.targetWordId === 'string' && !memberIds.has(prompt.targetWordId)) {
            errors.push(`${path}.prompts: every target must be a member`);
          }
          if (typeof prompt.targetWordId === 'string' && typeof prompt.promptText === 'string') {
            const promptKey = `${prompt.targetWordId}\u0000${prompt.promptText.trim()}`;
            if (promptKeys.has(promptKey)) {
              errors.push(`${path}.prompts: duplicate prompt`);
            }
            promptKeys.add(promptKey);
          }
        }
      }
      break;
    }
    case 'repair_production_cue': {
      if (version === 2) {
        errors.push(...validateRepairProductionCueOperationV2(value, options));
        break;
      }
      errors.push(...validateObjectFields(
        value,
        ['kind', 'version', 'wordId', 'proposedCues', 'repairIntent'],
        path,
      ));
      errors.push(...validateWordReference(value.wordId, `${path}.wordId`, options));
      if (!Array.isArray(value.proposedCues)) {
        errors.push(`${path}.proposedCues: expected array`);
      } else {
        if (value.proposedCues.length === 0) {
          errors.push(`${path}.proposedCues: at least one replacement is required`);
        }
        for (const [index, cue] of value.proposedCues.entries()) {
          const cuePath = `${path}.proposedCues[${index}]`;
          errors.push(...validateObjectFields(cue, ['cueType', 'text'], cuePath));
          if (!isRecord(cue)) continue;
          if (typeof cue.cueType !== 'string' || !cueTypes.has(cue.cueType)) {
            errors.push(`${cuePath}.cueType: value is not in the allowed enum`);
          }
          errors.push(...validateString(cue.text, `${cuePath}.text`, true));
        }
      }
      if (typeof value.repairIntent !== 'string' || !repairIntents.has(value.repairIntent)) {
        errors.push(`${path}.repairIntent: value is not in the allowed enum`);
      }
      break;
    }
    case 'accept_production_alternate': {
      errors.push(...validateObjectFields(
        value,
        ['kind', 'version', 'targetWordId', 'alternateWordId'],
        path,
      ));
      errors.push(...validateWordReference(value.targetWordId, `${path}.targetWordId`, options));
      errors.push(...validateWordReference(value.alternateWordId, `${path}.alternateWordId`, options));
      if (
        typeof value.targetWordId === 'string'
        && value.targetWordId === value.alternateWordId
      ) {
        errors.push(`${path}: target and alternate words must be distinct`);
      }
      break;
    }
  }
  return errors;
}

function validateProductionCueDraftV2(
  value: unknown,
  path: string,
  anchorWordId: unknown,
  options: ReflectionOperationValidationOptions,
): string[] {
  const errors = validateObjectFields(value, ['cueType', 'text', 'acceptedWordIds'], path);
  if (!isRecord(value)) return errors;
  if (
    typeof value.cueType !== 'string'
    || !productionCueTypesV0.has(value.cueType as ProductionCueTypeV0)
  ) {
    errors.push(`${path}.cueType: value is not in the allowed enum`);
  }
  errors.push(...validateString(value.text, `${path}.text`, true));
  if (!Array.isArray(value.acceptedWordIds)) {
    errors.push(`${path}.acceptedWordIds: expected array`);
    return errors;
  }
  if (value.acceptedWordIds.length === 0) {
    errors.push(`${path}.acceptedWordIds: at least one word is required`);
  }
  const acceptedWordIds: string[] = [];
  for (const [index, acceptedWordId] of value.acceptedWordIds.entries()) {
    errors.push(...validateWordReference(
      acceptedWordId,
      `${path}.acceptedWordIds[${index}]`,
      options,
    ));
    if (typeof acceptedWordId === 'string') acceptedWordIds.push(acceptedWordId);
  }
  if (new Set(acceptedWordIds).size !== acceptedWordIds.length) {
    errors.push(`${path}.acceptedWordIds: duplicate word id`);
  }
  if (typeof anchorWordId === 'string' && !acceptedWordIds.includes(anchorWordId)) {
    errors.push(`${path}.acceptedWordIds: must include anchor word ${anchorWordId}`);
  }
  return errors;
}

function validateRepairProductionCueOperationV2(
  value: UnknownRecord,
  options: ReflectionOperationValidationOptions,
): string[] {
  const path = options.path ?? '$';
  const errors = validateObjectFields(
    value,
    ['kind', 'version', 'wordId', 'taskId', 'changes', 'sourceAttemptJudgments'],
    path,
  );
  errors.push(...validateWordReference(value.wordId, `${path}.wordId`, options));
  errors.push(...validateString(value.taskId, `${path}.taskId`, true));

  const changedCueIds: string[] = [];
  const authoredAcceptedWordIds = new Set<string>();
  if (!Array.isArray(value.changes)) {
    errors.push(`${path}.changes: expected array`);
  } else {
    if (value.changes.length === 0) {
      errors.push(`${path}.changes: at least one cue change is required`);
    }
    for (const [index, change] of value.changes.entries()) {
      const changePath = `${path}.changes[${index}]`;
      if (!isRecord(change)) {
        errors.push(`${changePath}: expected object`);
        continue;
      }
      if (
        typeof change.kind !== 'string'
        || !productionCueChangeKindsV2.has(change.kind as ProductionCueChangeV2['kind'])
      ) {
        errors.push(`${changePath}.kind: value is not in the allowed enum`);
        continue;
      }
      switch (change.kind) {
        case 'create': {
          errors.push(...validateObjectFields(change, ['kind', 'cue'], changePath));
          errors.push(...validateProductionCueDraftV2(
            change.cue,
            `${changePath}.cue`,
            value.wordId,
            options,
          ));
          if (isRecord(change.cue) && Array.isArray(change.cue.acceptedWordIds)) {
            for (const wordId of change.cue.acceptedWordIds) {
              if (typeof wordId === 'string') authoredAcceptedWordIds.add(wordId);
            }
          }
          break;
        }
        case 'replace': {
          errors.push(...validateObjectFields(
            change,
            ['kind', 'cueId', 'replacements'],
            changePath,
          ));
          errors.push(...validateString(change.cueId, `${changePath}.cueId`, true));
          if (typeof change.cueId === 'string') changedCueIds.push(change.cueId);
          if (!Array.isArray(change.replacements)) {
            errors.push(`${changePath}.replacements: expected array`);
          } else {
            if (change.replacements.length === 0) {
              errors.push(`${changePath}.replacements: at least one replacement is required`);
            }
            for (const [replacementIndex, replacement] of change.replacements.entries()) {
              errors.push(...validateProductionCueDraftV2(
                replacement,
                `${changePath}.replacements[${replacementIndex}]`,
                value.wordId,
                options,
              ));
              if (isRecord(replacement) && Array.isArray(replacement.acceptedWordIds)) {
                for (const wordId of replacement.acceptedWordIds) {
                  if (typeof wordId === 'string') authoredAcceptedWordIds.add(wordId);
                }
              }
            }
          }
          break;
        }
        case 'deactivate': {
          errors.push(...validateObjectFields(change, ['kind', 'cueId'], changePath));
          errors.push(...validateString(change.cueId, `${changePath}.cueId`, true));
          if (typeof change.cueId === 'string') changedCueIds.push(change.cueId);
          break;
        }
      }
    }
  }
  if (new Set(changedCueIds).size !== changedCueIds.length) {
    errors.push(`${path}.changes: a cue id may be referenced by only one change`);
  }

  if (!Array.isArray(value.sourceAttemptJudgments)) {
    errors.push(`${path}.sourceAttemptJudgments: expected array`);
  } else {
    const judgmentKeys = new Set<string>();
    for (const [index, judgment] of value.sourceAttemptJudgments.entries()) {
      const judgmentPath = `${path}.sourceAttemptJudgments[${index}]`;
      if (!isRecord(judgment)) {
        errors.push(`${judgmentPath}: expected object`);
        continue;
      }
      if (
        typeof judgment.kind !== 'string'
        || !cueEvidenceJudgmentKindsV2.has(judgment.kind as CueEvidenceJudgmentV2['kind'])
      ) {
        errors.push(`${judgmentPath}.kind: value is not in the allowed enum`);
        continue;
      }
      const judgmentKey = `${judgment.kind}\u0000${String(judgment.sourceAttemptId)}`;
      if (judgmentKeys.has(judgmentKey)) {
        errors.push(`${path}.sourceAttemptJudgments: duplicate judgment`);
      }
      judgmentKeys.add(judgmentKey);
      switch (judgment.kind) {
        case 'accepted_answer_space_omission':
          errors.push(...validateObjectFields(
            judgment,
            ['kind', 'sourceAttemptId', 'submittedWordId'],
            judgmentPath,
          ));
          errors.push(...validateString(
            judgment.sourceAttemptId,
            `${judgmentPath}.sourceAttemptId`,
            true,
          ));
          errors.push(...validateWordReference(
            judgment.submittedWordId,
            `${judgmentPath}.submittedWordId`,
            options,
          ));
          if (
            typeof judgment.submittedWordId === 'string'
            && !authoredAcceptedWordIds.has(judgment.submittedWordId)
          ) {
            errors.push(
              `${judgmentPath}.submittedWordId: must be admitted by a created or replacement cue`,
            );
          }
          break;
        case 'misleading_or_overloaded_cue':
          errors.push(...validateObjectFields(
            judgment,
            ['kind', 'sourceAttemptId'],
            judgmentPath,
          ));
          errors.push(...validateString(
            judgment.sourceAttemptId,
            `${judgmentPath}.sourceAttemptId`,
            true,
          ));
          break;
      }
    }
  }
  return errors;
}

function visibleWordIds(item: ReflectionInputItemV1 | ReflectionInputItemV2): Set<string> {
  const ids = new Set<string>();
  if (item.targetWord !== null) ids.add(item.targetWord.wordId);
  if (item.source === 'production_mistake' && item.submittedWord !== null) {
    ids.add(item.submittedWord.wordId);
  }
  if (item.source === 'session_note') {
    for (const relatedWord of item.relatedWords) ids.add(relatedWord.wordId);
  }
  if (item.source === 'contrast_selection') {
    for (const choiceWord of item.promptAsShown.choiceWords) ids.add(choiceWord.wordId);
  }
  if ('servedCue' in item) {
    for (const acceptedWordId of item.servedCue.acceptedWordIds) ids.add(acceptedWordId);
  }
  return ids;
}

export function validateSessionReflectionResult(
  value: unknown,
  bundle: SessionReflectionBundleV1,
): string[] {
  return validateSessionReflectionResultVersion(
    value,
    bundle,
    'session_reflection_result.v4',
  );
}

export function validateSessionReflectionResultV5(
  value: unknown,
  bundle: SessionReflectionBundleV2,
): string[] {
  return validateSessionReflectionResultVersion(
    value,
    bundle,
    'session_reflection_result.v5',
  );
}

function validateSessionReflectionResultVersion(
  value: unknown,
  bundle: SessionReflectionBundle,
  schemaVersion: SessionReflectionResult['schemaVersion'],
): string[] {
  const errors = validateObjectFields(
    value,
    ['schemaVersion', 'itemResults'],
    '$',
  );
  if (!isRecord(value)) return errors;
  if (value.schemaVersion !== schemaVersion) {
    errors.push(`$.schemaVersion: expected ${schemaVersion}`);
  }
  if (!Array.isArray(value.itemResults)) {
    errors.push('$.itemResults: expected array');
    return errors;
  }

  const inputItemIds = bundle.items.map((item) => item.itemId);
  const resultItemIds = value.itemResults.flatMap((item) => (
    isRecord(item) && typeof item.itemId === 'string' ? [item.itemId] : []
  ));
  if (new Set(resultItemIds).size !== resultItemIds.length) {
    errors.push('$.itemResults: duplicate itemId');
  }
  if (
    inputItemIds.length !== resultItemIds.length
    || !inputItemIds.every((itemId) => resultItemIds.includes(itemId))
  ) {
    errors.push('$.itemResults: every input item must appear exactly once and no unknown item is allowed');
  }

  const inputItemsById = new Map(bundle.items.map((item) => [item.itemId, item]));
  for (const [itemIndex, itemResult] of value.itemResults.entries()) {
    const itemPath = `$.itemResults[${itemIndex}]`;
    errors.push(...validateObjectFields(
      itemResult,
      [
        'itemId',
        'diagnosisTags',
        'observation',
        'learnerExplanation',
        'proposals',
        'questions',
        'unhandledNeeds',
      ],
      itemPath,
    ));
    if (!isRecord(itemResult)) continue;
    errors.push(...validateString(itemResult.itemId, `${itemPath}.itemId`, true));
    errors.push(...validateString(itemResult.observation, `${itemPath}.observation`, true));
    errors.push(...validateNullableString(
      itemResult.learnerExplanation,
      `${itemPath}.learnerExplanation`,
    ));

    if (!Array.isArray(itemResult.diagnosisTags)) {
      errors.push(`${itemPath}.diagnosisTags: expected array`);
    } else {
      const tags = itemResult.diagnosisTags.filter(
        (tag): tag is ReflectionDiagnosisTagV1 => typeof tag === 'string' && diagnosisTags.has(tag as ReflectionDiagnosisTagV1),
      );
      if (tags.length !== itemResult.diagnosisTags.length) {
        errors.push(`${itemPath}.diagnosisTags: value is not in the allowed enum`);
      }
      if (new Set(tags).size !== tags.length) {
        errors.push(`${itemPath}.diagnosisTags: duplicate tag`);
      }
    }

    const itemId = typeof itemResult.itemId === 'string' ? itemResult.itemId : null;
    const inputItem = itemId === null ? undefined : inputItemsById.get(itemId);
    if (!Array.isArray(itemResult.proposals)) {
      errors.push(`${itemPath}.proposals: expected array`);
    } else {
      for (const [proposalIndex, proposal] of itemResult.proposals.entries()) {
        const proposalPath = `${itemPath}.proposals[${proposalIndex}]`;
        errors.push(...validateObjectFields(
          proposal,
          ['proposalGroupKey', 'rationale', 'operation'],
          proposalPath,
        ));
        if (!isRecord(proposal)) continue;
        errors.push(...validateNullableString(proposal.proposalGroupKey, `${proposalPath}.proposalGroupKey`));
        errors.push(...validateString(proposal.rationale, `${proposalPath}.rationale`, true));
        errors.push(...validateReflectionOperation(proposal.operation, {
          allowedWordIds: inputItem === undefined ? undefined : visibleWordIds(inputItem),
          evidenceItemId: inputItem?.itemId,
          path: `${proposalPath}.operation`,
        }));
        if (
          schemaVersion === 'session_reflection_result.v5'
          && inputItem !== undefined
          && 'servedCue' in inputItem
        ) {
          errors.push(...validateReflectionOperationEvidenceContext(
            proposal.operation,
            inputItem,
            `${proposalPath}.operation`,
          ));
        }
      }
    }

    if (!Array.isArray(itemResult.questions)) {
      errors.push(`${itemPath}.questions: expected array`);
    } else {
      for (const [questionIndex, question] of itemResult.questions.entries()) {
        const questionPath = `${itemPath}.questions[${questionIndex}]`;
        errors.push(...validateObjectFields(question, ['question', 'reason'], questionPath));
        if (!isRecord(question)) continue;
        errors.push(...validateString(question.question, `${questionPath}.question`, true));
        errors.push(...validateString(question.reason, `${questionPath}.reason`, true));
      }
    }

    if (!Array.isArray(itemResult.unhandledNeeds)) {
      errors.push(`${itemPath}.unhandledNeeds: expected array`);
    } else {
      for (const [needIndex, need] of itemResult.unhandledNeeds.entries()) {
        const needPath = `${itemPath}.unhandledNeeds[${needIndex}]`;
        errors.push(...validateObjectFields(
          need,
          ['description', 'whyRegisteredOperationsDoNotFit'],
          needPath,
        ));
        if (!isRecord(need)) continue;
        errors.push(...validateString(need.description, `${needPath}.description`, true));
        errors.push(...validateString(
          need.whyRegisteredOperationsDoNotFit,
          `${needPath}.whyRegisteredOperationsDoNotFit`,
          true,
        ));
      }
    }
  }
  return errors;
}

export function validateReflectionOperationEvidenceContext(
  value: unknown,
  item: ProductionMistakeReflectionItemV2,
  path: string,
): string[] {
  if (!isRecord(value) || value.kind !== 'repair_production_cue' || value.version !== 2) {
    return [];
  }
  const errors: string[] = [];
  if (value.wordId !== item.targetWord.wordId) {
    errors.push(`${path}.wordId: must match the evidence target word`);
  }
  if (value.taskId !== `production-task:${item.targetWord.wordId}:default_production`) {
    errors.push(`${path}.taskId: must match the target word's default production task`);
  }
  const servedCueId = item.servedCue.cueId;
  if (Array.isArray(value.changes)) {
    for (const [index, change] of value.changes.entries()) {
      if (isRecord(change) && change.kind === 'create' && servedCueId !== null) {
        errors.push(`${path}.changes[${index}]: create is allowed only for fallback evidence`);
      }
      if (
        isRecord(change)
        && change.kind !== 'create'
        && typeof change.cueId === 'string'
        && change.cueId !== servedCueId
      ) {
        errors.push(`${path}.changes[${index}].cueId: must match the exact served cue`);
      }
    }
  }
  const servedCue = item.servedCue;
  if (Array.isArray(value.sourceAttemptJudgments)) {
    for (const [index, judgment] of value.sourceAttemptJudgments.entries()) {
      if (!isRecord(judgment)) continue;
      const judgmentPath = `${path}.sourceAttemptJudgments[${index}]`;
      if (judgment.sourceAttemptId !== item.sourceAttemptId) {
        errors.push(`${judgmentPath}.sourceAttemptId: must match the evidence source attempt`);
      }
      if (
        judgment.kind === 'accepted_answer_space_omission'
        && judgment.submittedWordId !== item.submittedWord?.wordId
      ) {
        errors.push(`${judgmentPath}.submittedWordId: must match the resolved submitted word`);
      }
      if (
        (judgment.kind === 'accepted_answer_space_omission'
          || judgment.kind === 'misleading_or_overloaded_cue')
        && !hasExactServedCueRepair(value.changes, servedCue.cueId, judgment.submittedWordId)
      ) {
        errors.push(`${judgmentPath}: must repair the exact served cue contract`);
      }
    }
  }
  return errors;
}

function hasExactServedCueRepair(
  changes: unknown,
  servedCueId: string | null,
  submittedWordId: unknown,
): boolean {
  if (!Array.isArray(changes)) return false;
  if (submittedWordId === undefined) {
    return changes.some((change) => (
      isRecord(change)
      && (
        (servedCueId === null && change.kind === 'create' && isRecord(change.cue))
        || (
          servedCueId !== null
          && change.cueId === servedCueId
          && (
            (change.kind === 'replace' && Array.isArray(change.replacements))
            || change.kind === 'deactivate'
          )
        )
      )
    ));
  }
  const drafts = changes.flatMap((change) => {
    if (!isRecord(change)) return [];
    if (servedCueId === null && change.kind === 'create' && isRecord(change.cue)) {
      return [change.cue];
    }
    if (
      servedCueId !== null
      && change.kind === 'replace'
      && change.cueId === servedCueId
      && Array.isArray(change.replacements)
    ) {
      return change.replacements.filter(isRecord);
    }
    return [];
  });
  return drafts.some((draft) => (
    Array.isArray(draft.acceptedWordIds)
    && draft.acceptedWordIds.includes(submittedWordId)
  ));
}

export function normalizeSessionReflectionResultV5(
  value: SessionReflectionResultV5Wire,
): SessionReflectionResultV5 {
  return {
    schemaVersion: 'session_reflection_result.v5',
    itemResults: value.itemResults.map((itemResult) => ({
      ...itemResult,
      proposals: itemResult.proposals.map((proposal) => ({
        ...proposal,
        operation: proposal.operation.kind === 'repair_production_cue'
          ? {
              ...proposal.operation,
              version: 2,
              taskId: `production-task:${proposal.operation.wordId}:default_production`,
            }
          : proposal.operation,
      })),
    })),
  };
}

function structurallyEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => structurallyEqual(value, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => (
      key === rightKeys[index] && structurallyEqual(left[key], right[key])
    ));
}

export function classifyProposalAcceptance(
  proposed: ReflectionOperation,
  authorized: ReflectionOperation,
): 'exact' | 'revised' {
  if (proposed.kind !== authorized.kind || proposed.version !== authorized.version) {
    throw new Error('A revised proposal acceptance must preserve operation kind and version.');
  }
  return structurallyEqual(proposed, authorized) ? 'exact' : 'revised';
}

export type ProposalReviewDispositionKind = ProposalReviewDisposition['kind'];
export type OperationApplicationStateKind = OperationApplicationState['kind'];

const proposalReviewTransitions: Record<
  ProposalReviewDispositionKind,
  ReadonlySet<ProposalReviewDispositionKind>
> = {
  pending: new Set(['deferred', 'accepted', 'dismissed', 'superseded']),
  deferred: new Set(['accepted', 'dismissed', 'superseded']),
  accepted: new Set(),
  dismissed: new Set(),
  superseded: new Set(),
};

const operationApplicationTransitions: Record<
  OperationApplicationStateKind,
  ReadonlySet<OperationApplicationStateKind>
> = {
  unsupported: new Set(['pending', 'authorization_withdrawn']),
  pending: new Set([
    'applied',
    'failed',
    'stale',
    'already_satisfied',
    'authorization_withdrawn',
  ]),
  applied: new Set(),
  failed: new Set(),
  stale: new Set(),
  already_satisfied: new Set(),
  authorization_withdrawn: new Set(),
};

export function isProposalReviewTransitionAllowed(
  from: ProposalReviewDispositionKind,
  to: ProposalReviewDispositionKind,
): boolean {
  return proposalReviewTransitions[from].has(to);
}

export function assertProposalReviewTransition(
  from: ProposalReviewDispositionKind,
  to: ProposalReviewDispositionKind,
): void {
  if (!isProposalReviewTransitionAllowed(from, to)) {
    throw new Error(`Invalid proposal review transition: ${from} -> ${to}.`);
  }
}

export function isOperationApplicationTransitionAllowed(
  from: OperationApplicationStateKind,
  to: OperationApplicationStateKind,
): boolean {
  return operationApplicationTransitions[from].has(to);
}

export function assertOperationApplicationTransition(
  from: OperationApplicationStateKind,
  to: OperationApplicationStateKind,
): void {
  if (!isOperationApplicationTransitionAllowed(from, to)) {
    throw new Error(`Invalid operation application transition: ${from} -> ${to}.`);
  }
}
