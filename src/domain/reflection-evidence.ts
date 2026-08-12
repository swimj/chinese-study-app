import type {
  ContrastSelectionReflectionItemV1,
  ProductionMistakeReflectionItemV1,
  ProductionCueTypeV0,
  ReflectionCueSnapshotV0,
  ReflectionExistingContentV0,
  ReflectionInputItemV1,
  ReflectionWordSnapshotV1,
  SessionNoteReflectionItemV1,
  SessionReflectionBundle,
  SessionReflectionBundleV1,
  SessionReflectionBundleV2,
  SessionReflectionBundleV3,
} from './reflection';

export type ProductionMistakeCueEvidenceV1 = Omit<ReflectionCueSnapshotV0, 'cueType'> & {
  cueType: ProductionCueTypeV0;
};

export type ProductionMistakeEvidenceSupplementV1 = {
  itemId: string;
  sessionActionId: string;
  targetWordId: string;
  cuesAsShown: ProductionMistakeCueEvidenceV1[];
  rawResponse: string | null;
  responseKind: 'typed' | 'no_clue';
  attemptIds: string[];
};

export type SessionReflectionEvidenceSupplementV1 = {
  schemaVersion: 'session_reflection_evidence_supplement.v1';
  items: ProductionMistakeEvidenceSupplementV1[];
};

export type SessionReflectionEvidenceSupplementV2 = {
  schemaVersion: 'session_reflection_evidence_supplement.v2';
  items: Array<ProductionMistakeEvidenceSupplementV1 & { learnerRequestedReview?: true }>;
};

type UnknownRecord = Record<string, unknown>;

const bundleCueTypes = new Set([
  'definition_gloss',
  'cloze',
  'minimal_context',
  'other',
]);
const actionKinds = new Set(['recognition', 'production', 'contrast_selection']);
const studyProfiles = new Set(['mandarin', 'french']);
const responseKinds = new Set(['matched_known_word', 'no_clue', 'unmatched_text']);
const productionCueTypesV0 = new Set(['definition_gloss', 'minimal_context', 'circumstance']);
const reflectionSignals = new Set(['clear_now', 'still_shaky', 'want_more_practice']);

export function validateSessionReflectionEvidenceSupplement(value: unknown): string[] {
  const errors = validateObjectFields(value, ['schemaVersion', 'items'], '$');
  if (!isRecord(value)) return errors;

  if (value.schemaVersion !== 'session_reflection_evidence_supplement.v1') {
    errors.push('$.schemaVersion: expected session_reflection_evidence_supplement.v1');
  }
  if (!Array.isArray(value.items)) {
    errors.push('$.items: expected array');
    return errors;
  }

  const itemIds = new Set<string>();
  const actionIds = new Set<string>();
  const attemptIds = new Set<string>();
  for (const [index, item] of value.items.entries()) {
    const path = `$.items[${index}]`;
    errors.push(...validateObjectFields(
      item,
      ['itemId', 'sessionActionId', 'targetWordId', 'cuesAsShown', 'rawResponse', 'responseKind', 'attemptIds'],
      path,
    ));
    if (!isRecord(item)) continue;

    errors.push(...validateUniqueId(item.itemId, `${path}.itemId`, itemIds, 'item id'));
    errors.push(...validateUniqueId(
      item.sessionActionId,
      `${path}.sessionActionId`,
      actionIds,
      'session action id',
    ));
    errors.push(...validateId(item.targetWordId, `${path}.targetWordId`));
    errors.push(...validateNullableNonEmptyString(item.rawResponse, `${path}.rawResponse`));
    if (item.responseKind !== 'typed' && item.responseKind !== 'no_clue') {
      errors.push(`${path}.responseKind: value is not in the allowed enum`);
    } else if (item.responseKind === 'no_clue' && item.rawResponse !== null) {
      errors.push(`${path}.rawResponse: must be null for a no-clue response`);
    } else if (item.responseKind === 'typed' && item.rawResponse === null) {
      errors.push(`${path}.rawResponse: typed responses require raw text`);
    }
    errors.push(...validateCueList(
      item.cuesAsShown,
      `${path}.cuesAsShown`,
      true,
      productionCueTypesV0,
    ));

    if (!Array.isArray(item.attemptIds)) {
      errors.push(`${path}.attemptIds: expected array`);
    } else {
      if (item.attemptIds.length === 0) {
        errors.push(`${path}.attemptIds: at least one accepted attempt id is required`);
      }
      for (const [attemptIndex, attemptId] of item.attemptIds.entries()) {
        errors.push(...validateUniqueId(
          attemptId,
          `${path}.attemptIds[${attemptIndex}]`,
          attemptIds,
          'attempt id',
        ));
      }
    }
  }
  return errors;
}

export function parseSessionReflectionEvidenceSupplement(
  value: unknown,
): SessionReflectionEvidenceSupplementV1 {
  const errors = validateSessionReflectionEvidenceSupplement(value);
  if (errors.length > 0) {
    throw new Error(`Invalid session reflection evidence supplement:\n${errors.join('\n')}`);
  }
  return value as SessionReflectionEvidenceSupplementV1;
}

export function parseSessionReflectionEvidenceSupplementV2(value: unknown): SessionReflectionEvidenceSupplementV2 {
  if (!isRecord(value)) throw new Error('Invalid learner-requested reflection evidence supplement');
  const rootErrors = validateObjectFields(value, ['schemaVersion', 'items'], '$');
  const items = Array.isArray(value.items) ? value.items : null;
  const normalizedItems = items?.map((item) => {
    if (!isRecord(item)) return item;
    const { learnerRequestedReview: _marker, ...base } = item;
    return base;
  });
  const errors = normalizedItems === undefined
    ? ['$.items: expected array']
    : validateSessionReflectionEvidenceSupplement({
        schemaVersion: 'session_reflection_evidence_supplement.v1',
        items: normalizedItems,
      });
  items?.forEach((item, index) => {
    if (isRecord(item) && item.learnerRequestedReview !== undefined && item.learnerRequestedReview !== true) {
      errors.push(`$.items[${index}].learnerRequestedReview: expected true when present`);
    }
  });
  errors.push(...rootErrors);
  if (value.schemaVersion !== 'session_reflection_evidence_supplement.v2') errors.push('$.schemaVersion: expected session_reflection_evidence_supplement.v2');
  if (errors.length > 0) throw new Error(`Invalid learner-requested reflection evidence supplement:\n${errors.join('\n')}`);
  return value as SessionReflectionEvidenceSupplementV2;
}

/**
 * Validates the complete, reusable V0 evidence envelope. This accepts every
 * declared item source; the initial steel thread applies a narrower policy in
 * validateInitialReflectionMilestoneBundle.
 */
export function validateSessionReflectionBundle(value: unknown): string[] {
  const errors = validateObjectFields(
    value,
    ['schemaVersion', 'generatedAt', 'session', 'items'],
    '$',
  );
  if (!isRecord(value)) return errors;

  if (value.schemaVersion !== 'session_reflection_bundle.v1') {
    errors.push('$.schemaVersion: expected session_reflection_bundle.v1');
  }
  errors.push(...validateUtcTimestamp(value.generatedAt, '$.generatedAt'));
  errors.push(...validateSession(value.session, '$.session'));
  if (!Array.isArray(value.items)) {
    errors.push('$.items: expected array');
    return errors;
  }

  const itemIds = new Set<string>();
  const actionIds = new Set<string>();
  for (const [index, item] of value.items.entries()) {
    errors.push(...validateReflectionInputItem(
      item,
      `$.items[${index}]`,
      itemIds,
      actionIds,
    ));
  }
  return errors;
}

export function parseSessionReflectionBundle(value: unknown): SessionReflectionBundleV1 {
  const errors = validateSessionReflectionBundle(value);
  if (errors.length > 0) {
    throw new Error(`Invalid session reflection bundle:\n${errors.join('\n')}`);
  }
  return value as SessionReflectionBundleV1;
}

export function validateSessionReflectionBundleV2(value: unknown): string[] {
  const errors = validateObjectFields(
    value,
    ['schemaVersion', 'generatedAt', 'session', 'items'],
    '$',
  );
  if (!isRecord(value)) return errors;
  if (value.schemaVersion !== 'session_reflection_bundle.v2') {
    errors.push('$.schemaVersion: expected session_reflection_bundle.v2');
  }
  errors.push(...validateUtcTimestamp(value.generatedAt, '$.generatedAt'));
  errors.push(...validateSession(value.session, '$.session'));
  if (!Array.isArray(value.items)) {
    errors.push('$.items: expected array');
    return errors;
  }
  if (value.items.length === 0) {
    errors.push('$.items: at least one qualifying production mistake is required');
  }
  const itemIds = new Set<string>();
  const actionIds = new Set<string>();
  const attemptIds = new Set<string>();
  for (const [index, item] of value.items.entries()) {
    const path = `$.items[${index}]`;
    if (!isRecord(item)) {
      errors.push(`${path}: expected object`);
      continue;
    }
    errors.push(...validateItemBase(
      item,
      path,
      [
        'source',
        'sourceActionKind',
        'sourceAttemptId',
        'servedCue',
        'rawResponse',
        'submittedWord',
        'responseKind',
      ],
      itemIds,
      actionIds,
    ));
    if (item.source !== 'production_mistake') {
      errors.push(`${path}.source: expected production_mistake`);
    }
    if (item.sourceActionKind !== 'production') {
      errors.push(`${path}.sourceActionKind: expected production`);
    }
    errors.push(...validateUniqueId(
      item.sourceAttemptId,
      `${path}.sourceAttemptId`,
      attemptIds,
      'source attempt id',
    ));
    errors.push(...validateServedCueSnapshot(
      item.servedCue,
      `${path}.servedCue`,
      isRecord(item.targetWord) ? item.targetWord.wordId : null,
    ));
    errors.push(...validateNullableNonEmptyString(item.rawResponse, `${path}.rawResponse`));
    errors.push(...validateNullableWord(item.submittedWord, `${path}.submittedWord`));
    if (typeof item.responseKind !== 'string' || !responseKinds.has(item.responseKind)) {
      errors.push(`${path}.responseKind: value is not in the allowed enum`);
    } else {
      if (item.responseKind === 'matched_known_word' && item.submittedWord === null) {
        errors.push(`${path}.submittedWord: a matched response requires a word snapshot`);
      }
      if (item.responseKind !== 'matched_known_word' && item.submittedWord !== null) {
        errors.push(`${path}.submittedWord: only an unambiguous matched response may include a word snapshot`);
      }
      if (item.responseKind === 'no_clue' && item.rawResponse !== null) {
        errors.push(`${path}.rawResponse: must be null for a no-clue response`);
      }
      if (item.responseKind !== 'no_clue' && item.rawResponse === null) {
        errors.push(`${path}.rawResponse: typed responses require raw text`);
      }
    }
  }
  return errors;
}

export function parseSessionReflectionBundleV2(value: unknown): SessionReflectionBundleV2 {
  const errors = validateSessionReflectionBundleV2(value);
  if (errors.length > 0) {
    throw new Error(`Invalid session reflection bundle V2:\n${errors.join('\n')}`);
  }
  return value as SessionReflectionBundleV2;
}

export function validateSessionReflectionBundleV3(value: unknown): string[] {
  if (!isRecord(value)) return validateSessionReflectionBundleV2(value);
  const items = Array.isArray(value.items) ? value.items.map((item) => {
    if (!isRecord(item)) return item;
    const { learnerRequestedReview: _marker, ...base } = item;
    if (base.responseKind !== null) return base;
    return {
      ...base,
      responseKind: base.submittedWord === null ? 'unmatched_text' : 'matched_known_word',
    };
  }) : value.items;
  const errors = validateSessionReflectionBundleV2({ ...value, schemaVersion: 'session_reflection_bundle.v2', items });
  if (value.schemaVersion !== 'session_reflection_bundle.v3') {
    errors.push('$.schemaVersion: expected session_reflection_bundle.v3');
  }
  if (Array.isArray(value.items)) value.items.forEach((item, index) => {
    if (isRecord(item) && item.learnerRequestedReview !== undefined && item.learnerRequestedReview !== true) {
      errors.push(`$.items[${index}].learnerRequestedReview: expected true when present`);
    }
    if (isRecord(item) && item.responseKind === null && item.learnerRequestedReview !== true) {
      errors.push(`$.items[${index}].responseKind: null is reserved for learner-requested review`);
    }
  });
  return errors;
}

export function parseSessionReflectionBundleV3(value: unknown): SessionReflectionBundleV3 {
  const errors = validateSessionReflectionBundleV3(value);
  if (errors.length > 0) throw new Error(`Invalid session reflection bundle V3:\n${errors.join('\n')}`);
  return value as SessionReflectionBundleV3;
}

export function parseStoredSessionReflectionBundle(value: unknown): SessionReflectionBundle {
  if (isRecord(value) && value.schemaVersion === 'session_reflection_bundle.v2') {
    return parseSessionReflectionBundleV2(value);
  }
  if (isRecord(value) && value.schemaVersion === 'session_reflection_bundle.v3') {
    return parseSessionReflectionBundleV3(value);
  }
  return parseSessionReflectionBundle(value);
}

/**
 * Adds the accepted initial-reflection scope to the reusable V0 structural
 * contract: a completed session and at least one typed production mistake.
 */
export function validateInitialReflectionMilestoneBundle(value: unknown): string[] {
  const errors = validateSessionReflectionBundle(value);
  if (!isRecord(value)) return errors;

  if (isRecord(value.session) && value.session.endedAt === null) {
    errors.push('$.session.endedAt: a completed session timestamp is required');
  }
  if (!Array.isArray(value.items)) return errors;
  if (value.items.length === 0) {
    errors.push('$.items: at least one qualifying production mistake is required');
  }

  for (const [index, item] of value.items.entries()) {
    const path = `$.items[${index}]`;
    if (!isRecord(item)) continue;
    if (item.source !== 'production_mistake') {
      errors.push(`${path}.source: initial reflection accepts only production_mistake items`);
      continue;
    }
    if (item.responseKind === 'no_clue') {
      errors.push(`${path}.responseKind: no-clue evidence is outside the initial reflection milestone`);
    }
    errors.push(...validateNonEmptyString(item.rawResponse, `${path}.rawResponse`));
  }
  return errors;
}

export function parseInitialReflectionMilestoneBundle(
  value: unknown,
): SessionReflectionBundleV1 {
  const errors = validateInitialReflectionMilestoneBundle(value);
  if (errors.length > 0) {
    throw new Error(`Invalid initial reflection milestone bundle:\n${errors.join('\n')}`);
  }
  return value as SessionReflectionBundleV1;
}

function validateSession(value: unknown, path: string): string[] {
  const errors = validateObjectFields(
    value,
    ['sessionId', 'startedAt', 'endedAt', 'studyProfile'],
    path,
  );
  if (!isRecord(value)) return errors;
  errors.push(...validateId(value.sessionId, `${path}.sessionId`));
  errors.push(...validateNullableUtcTimestamp(value.startedAt, `${path}.startedAt`));
  errors.push(...validateNullableUtcTimestamp(value.endedAt, `${path}.endedAt`));
  if (typeof value.studyProfile !== 'string' || !studyProfiles.has(value.studyProfile)) {
    errors.push(`${path}.studyProfile: value is not in the allowed enum`);
  }
  return errors;
}

function validateReflectionInputItem(
  value: unknown,
  path: string,
  itemIds: Set<string>,
  actionIds: Set<string>,
): string[] {
  if (!isRecord(value)) return [`${path}: expected object`];
  switch (value.source) {
    case 'production_mistake':
      return validateProductionMistakeItem(value, path, itemIds, actionIds);
    case 'session_note':
      return validateSessionNoteItem(value, path, itemIds, actionIds);
    case 'contrast_selection':
      return validateContrastSelectionItem(value, path, itemIds, actionIds);
    default: {
      const errors = validateItemBase(
        value,
        path,
        ['source', 'sourceActionKind', 'cuesAsShown'],
        itemIds,
        actionIds,
      );
      errors.push(`${path}.source: value is not in the allowed union`);
      return errors;
    }
  }
}

function validateProductionMistakeItem(
  value: UnknownRecord,
  path: string,
  itemIds: Set<string>,
  actionIds: Set<string>,
): string[] {
  const errors = validateItemBase(
    value,
    path,
    [
      'source',
      'sourceActionKind',
      'cuesAsShown',
      'rawResponse',
      'submittedWord',
      'responseKind',
    ],
    itemIds,
    actionIds,
  );
  if (value.sourceActionKind !== 'production') {
    errors.push(`${path}.sourceActionKind: expected production`);
  }
  if (value.targetWord === null) {
    errors.push(`${path}.targetWord: production mistakes require a target word`);
  }
  errors.push(...validateCueList(value.cuesAsShown, `${path}.cuesAsShown`, true));
  errors.push(...validateNullableNonEmptyString(value.rawResponse, `${path}.rawResponse`));
  errors.push(...validateNullableWord(value.submittedWord, `${path}.submittedWord`));
  if (typeof value.responseKind !== 'string' || !responseKinds.has(value.responseKind)) {
    errors.push(`${path}.responseKind: value is not in the allowed enum`);
  } else {
    if (value.responseKind === 'no_clue' && value.rawResponse !== null) {
      errors.push(`${path}.rawResponse: must be null for a no-clue response`);
    }
    if (value.responseKind !== 'no_clue' && value.rawResponse === null) {
      errors.push(`${path}.rawResponse: typed and unmatched responses require raw text`);
    }
    if (value.responseKind === 'matched_known_word' && value.submittedWord === null) {
      errors.push(`${path}.submittedWord: a matched response requires a word snapshot`);
    }
    if (value.responseKind !== 'matched_known_word' && value.submittedWord !== null) {
      errors.push(`${path}.submittedWord: only matched responses may include a word snapshot`);
    }
  }
  return errors;
}

function validateSessionNoteItem(
  value: UnknownRecord,
  path: string,
  itemIds: Set<string>,
  actionIds: Set<string>,
): string[] {
  const errors = validateItemBase(
    value,
    path,
    [
      'source',
      'sourceActionKind',
      'cuesAsShown',
      'relatedWords',
      'linkedAttemptId',
    ],
    itemIds,
    actionIds,
    false,
  );
  if (
    value.sourceActionKind !== null
    && (typeof value.sourceActionKind !== 'string' || !actionKinds.has(value.sourceActionKind))
  ) {
    errors.push(`${path}.sourceActionKind: value is not in the allowed enum`);
  }
  errors.push(...validateCueList(value.cuesAsShown, `${path}.cuesAsShown`, false));
  errors.push(...validateWordList(value.relatedWords, `${path}.relatedWords`));
  errors.push(...validateNullableId(value.linkedAttemptId, `${path}.linkedAttemptId`));
  return errors;
}

function validateContrastSelectionItem(
  value: UnknownRecord,
  path: string,
  itemIds: Set<string>,
  actionIds: Set<string>,
): string[] {
  const errors = validateItemBase(
    value,
    path,
    [
      'source',
      'sourceActionKind',
      'promptAsShown',
      'reflectionSignal',
    ],
    itemIds,
    actionIds,
  );
  if (value.sourceActionKind !== 'contrast_selection') {
    errors.push(`${path}.sourceActionKind: expected contrast_selection`);
  }
  if (value.targetWord === null) {
    errors.push(`${path}.targetWord: contrast selections require a target word`);
  }
  errors.push(...validateContrastPrompt(value.promptAsShown, `${path}.promptAsShown`));
  if (
    value.reflectionSignal !== null
    && (typeof value.reflectionSignal !== 'string'
      || !reflectionSignals.has(value.reflectionSignal))
  ) {
    errors.push(`${path}.reflectionSignal: value is not in the allowed enum`);
  }
  return errors;
}

function validateItemBase(
  value: UnknownRecord,
  path: string,
  unionFields: readonly string[],
  itemIds: Set<string>,
  actionIds: Set<string>,
  requireUniqueActionId = true,
): string[] {
  const fields = [
    'itemId',
    'sessionActionId',
    'occurredAt',
    'targetWord',
    'sessionNote',
    'existingContent',
    ...unionFields,
  ];
  const errors = validateObjectFields(value, fields, path);
  errors.push(...validateUniqueId(value.itemId, `${path}.itemId`, itemIds, 'item id'));
  if (value.sessionActionId === null) {
    // The broad V0 session-note shape permits evidence without an action.
  } else if (!requireUniqueActionId) {
    // A note may deliberately link to an action that already has its own
    // reflection item; the action reference is not the note's identity.
    errors.push(...validateId(value.sessionActionId, `${path}.sessionActionId`));
  } else {
    errors.push(...validateUniqueId(
      value.sessionActionId,
      `${path}.sessionActionId`,
      actionIds,
      'session action id',
    ));
  }
  errors.push(...validateNullableUtcTimestamp(value.occurredAt, `${path}.occurredAt`));
  errors.push(...validateNullableWord(value.targetWord, `${path}.targetWord`));
  errors.push(...validateNullableString(value.sessionNote, `${path}.sessionNote`));
  errors.push(...validateExistingContent(value.existingContent, `${path}.existingContent`));
  return errors;
}

function validateWord(value: unknown, path: string): string[] {
  const errors = validateObjectFields(
    value,
    ['wordId', 'hanzi', 'pinyin', 'meanings'],
    path,
  );
  if (!isRecord(value)) return errors;
  errors.push(...validateId(value.wordId, `${path}.wordId`));
  errors.push(...validateString(value.hanzi, `${path}.hanzi`));
  errors.push(...validateString(value.pinyin, `${path}.pinyin`));
  errors.push(...validateStringArray(value.meanings, `${path}.meanings`, true));
  return errors;
}

function validateNullableWord(value: unknown, path: string): string[] {
  return value === null ? [] : validateWord(value, path);
}

function validateWordList(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) return [`${path}: expected array`];
  const errors: string[] = [];
  const wordIds = new Set<string>();
  for (const [index, word] of value.entries()) {
    errors.push(...validateWord(word, `${path}[${index}]`));
    if (isRecord(word)) {
      errors.push(...validateUniqueId(
        word.wordId,
        `${path}[${index}].wordId`,
        wordIds,
        'word id',
      ).filter((error) => error.includes('duplicate')));
    }
  }
  return errors;
}

function validateCueList(
  value: unknown,
  path: string,
  requireNonEmpty: boolean,
  allowedCueTypes: Set<string> = bundleCueTypes,
): string[] {
  if (!Array.isArray(value)) return [`${path}: expected array`];
  const errors: string[] = [];
  if (requireNonEmpty && value.length === 0) {
    errors.push(`${path}: at least one cue is required`);
  }
  const cueIds = new Set<string>();
  for (const [index, cue] of value.entries()) {
    const cuePath = `${path}[${index}]`;
    errors.push(...validateObjectFields(
      cue,
      ['cueId', 'cueType', 'displayOrder', 'text', 'displayedMeanings'],
      cuePath,
    ));
    if (!isRecord(cue)) continue;
    if (cue.cueId !== null) {
      errors.push(...validateUniqueId(cue.cueId, `${cuePath}.cueId`, cueIds, 'cue id'));
    }
    if (typeof cue.cueType !== 'string' || !allowedCueTypes.has(cue.cueType)) {
      errors.push(`${cuePath}.cueType: value is not in the allowed enum`);
    }
    if (!Number.isInteger(cue.displayOrder) || (cue.displayOrder as number) < 0) {
      errors.push(`${cuePath}.displayOrder: expected non-negative integer`);
    } else if (cue.displayOrder !== index) {
      errors.push(`${cuePath}.displayOrder: cues must be ordered contiguously from zero`);
    }
    errors.push(...validateNonEmptyString(cue.text, `${cuePath}.text`));
    errors.push(...validateStringArray(
      cue.displayedMeanings,
      `${cuePath}.displayedMeanings`,
      false,
    ));
  }
  return errors;
}

function validateServedCueSnapshot(
  value: unknown,
  path: string,
  targetWordId: unknown,
): string[] {
  const errors = validateObjectFields(
    value,
    ['cueId', 'cueType', 'text', 'acceptedWordIds'],
    path,
  );
  if (!isRecord(value)) return errors;
  if (value.cueId !== null) errors.push(...validateId(value.cueId, `${path}.cueId`));
  if (value.cueId === null && value.cueType !== 'definition_gloss') {
    errors.push(`${path}.cueType: fallback evidence must be definition_gloss`);
  }
  if (typeof value.cueType !== 'string' || !productionCueTypesV0.has(value.cueType)) {
    errors.push(`${path}.cueType: value is not in the allowed enum`);
  }
  errors.push(...validateNonEmptyString(value.text, `${path}.text`));
  errors.push(...validateIdArray(value.acceptedWordIds, `${path}.acceptedWordIds`));
  if (
    typeof targetWordId === 'string'
    && Array.isArray(value.acceptedWordIds)
    && !value.acceptedWordIds.includes(targetWordId)
  ) {
    errors.push(`${path}.acceptedWordIds: must include the task word`);
  }
  return errors;
}

function validateExistingContent(value: unknown, path: string): string[] {
  const errors = validateObjectFields(
    value,
    ['contrastClusters', 'knownAcceptedAlternates'],
    path,
  );
  if (!isRecord(value)) return errors;

  if (!Array.isArray(value.contrastClusters)) {
    errors.push(`${path}.contrastClusters: expected array`);
  } else {
    const clusterIds = new Set<string>();
    for (const [index, cluster] of value.contrastClusters.entries()) {
      const clusterPath = `${path}.contrastClusters[${index}]`;
      errors.push(...validateObjectFields(
        cluster,
        ['clusterId', 'title', 'memberWordIds', 'promptCount', 'notes'],
        clusterPath,
      ));
      if (!isRecord(cluster)) continue;
      errors.push(...validateUniqueId(
        cluster.clusterId,
        `${clusterPath}.clusterId`,
        clusterIds,
        'cluster id',
      ));
      errors.push(...validateNullableString(cluster.title, `${clusterPath}.title`));
      errors.push(...validateIdArray(cluster.memberWordIds, `${clusterPath}.memberWordIds`));
      if (!Number.isInteger(cluster.promptCount) || (cluster.promptCount as number) < 0) {
        errors.push(`${clusterPath}.promptCount: expected non-negative integer`);
      }
      errors.push(...validateStringArray(cluster.notes, `${clusterPath}.notes`, false));
    }
  }

  if (!Array.isArray(value.knownAcceptedAlternates)) {
    errors.push(`${path}.knownAcceptedAlternates: expected array`);
  } else {
    for (const [index, alternate] of value.knownAcceptedAlternates.entries()) {
      const alternatePath = `${path}.knownAcceptedAlternates[${index}]`;
      errors.push(...validateObjectFields(
        alternate,
        ['cueId', 'acceptedWordIds', 'note'],
        alternatePath,
      ));
      if (!isRecord(alternate)) continue;
      errors.push(...validateNullableId(alternate.cueId, `${alternatePath}.cueId`));
      errors.push(...validateIdArray(
        alternate.acceptedWordIds,
        `${alternatePath}.acceptedWordIds`,
      ));
      errors.push(...validateNullableString(alternate.note, `${alternatePath}.note`));
    }
  }
  return errors;
}

function validateContrastPrompt(value: unknown, path: string): string[] {
  const errors = validateObjectFields(
    value,
    [
      'promptId',
      'promptText',
      'explanationShown',
      'choiceWords',
      'promptTargetWordId',
    ],
    path,
  );
  if (!isRecord(value)) return errors;
  errors.push(...validateId(value.promptId, `${path}.promptId`));
  errors.push(...validateNonEmptyString(value.promptText, `${path}.promptText`));
  errors.push(...validateNullableString(value.explanationShown, `${path}.explanationShown`));
  errors.push(...validateWordList(value.choiceWords, `${path}.choiceWords`));
  errors.push(...validateId(value.promptTargetWordId, `${path}.promptTargetWordId`));
  if (
    Array.isArray(value.choiceWords)
    && typeof value.promptTargetWordId === 'string'
    && !value.choiceWords.some((word) => (
      isRecord(word) && word.wordId === value.promptTargetWordId
    ))
  ) {
    errors.push(`${path}.promptTargetWordId: target must be one of the displayed choices`);
  }
  return errors;
}

function validateObjectFields(
  value: unknown,
  fields: readonly string[],
  path: string,
): string[] {
  if (!isRecord(value)) return [`${path}: expected object`];
  const errors: string[] = [];
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) {
      errors.push(`${path}.${field}: required property is missing`);
    }
  }
  for (const field of Object.keys(value)) {
    if (!fields.includes(field)) errors.push(`${path}.${field}: unknown property`);
  }
  return errors;
}

function validateUniqueId(
  value: unknown,
  path: string,
  ids: Set<string>,
  label: string,
): string[] {
  const errors = validateId(value, path);
  if (errors.length > 0) return errors;
  const id = value as string;
  if (ids.has(id)) {
    errors.push(`${path}: duplicate ${label} "${id}"`);
  } else {
    ids.add(id);
  }
  return errors;
}

function validateId(value: unknown, path: string): string[] {
  return validateNonEmptyString(value, path);
}

function validateNullableId(value: unknown, path: string): string[] {
  return value === null ? [] : validateId(value, path);
}

function validateIdArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) return [`${path}: expected array`];
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const [index, id] of value.entries()) {
    errors.push(...validateUniqueId(id, `${path}[${index}]`, ids, 'id'));
  }
  return errors;
}

function validateStringArray(
  value: unknown,
  path: string,
  requireNonEmpty: boolean,
): string[] {
  if (!Array.isArray(value)) return [`${path}: expected array`];
  const errors: string[] = [];
  if (requireNonEmpty && value.length === 0) {
    errors.push(`${path}: at least one value is required`);
  }
  for (const [index, entry] of value.entries()) {
    errors.push(...validateNonEmptyString(entry, `${path}[${index}]`));
  }
  return errors;
}

function validateString(value: unknown, path: string): string[] {
  return typeof value === 'string' ? [] : [`${path}: expected string`];
}

function validateNonEmptyString(value: unknown, path: string): string[] {
  const errors = validateString(value, path);
  if (errors.length === 0 && (value as string).trim().length === 0) {
    errors.push(`${path}: must not be empty`);
  }
  return errors;
}

function validateNullableString(value: unknown, path: string): string[] {
  return value === null ? [] : validateString(value, path);
}

function validateNullableNonEmptyString(value: unknown, path: string): string[] {
  return value === null ? [] : validateNonEmptyString(value, path);
}

function validateNullableUtcTimestamp(value: unknown, path: string): string[] {
  return value === null ? [] : validateUtcTimestamp(value, path);
}

function validateUtcTimestamp(value: unknown, path: string): string[] {
  if (typeof value !== 'string') return [`${path}: expected UTC timestamp string`];
  const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
  if (!timestampPattern.test(value)) {
    return [`${path}: expected canonical UTC timestamp with millisecond precision`];
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    return [`${path}: invalid UTC timestamp`];
  }
  return [];
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Compile-time checks keep validators and the canonical union from drifting.
type _ValidatedBundleItems =
  | ProductionMistakeReflectionItemV1
  | SessionNoteReflectionItemV1
  | ContrastSelectionReflectionItemV1;
type _BundleUnionIsCovered =
  ReflectionInputItemV1 extends _ValidatedBundleItems
    ? _ValidatedBundleItems extends ReflectionInputItemV1
      ? true
      : never
    : never;
const bundleUnionIsCovered: _BundleUnionIsCovered = true;
void bundleUnionIsCovered;

type _CanonicalShapesAreReferenced =
  | ReflectionWordSnapshotV1
  | ReflectionCueSnapshotV0
  | ReflectionExistingContentV0;
type _KeepCanonicalShapesReferenced = _CanonicalShapesAreReferenced;
