import type { PureCueServedSnapshot } from './pure-cues';
import type { JsonSchema } from './reflection-result-schema';
import type {
  ReflectionWordSnapshotV1, ReflectionServedCueSnapshotV1, SessionReflectionBundleV1,
  PromotePureElicitationWordPlanV1, ReflectionItemResultV2,
} from './reflection';

export type PureCueReflectionItemV1 = {
  source: 'pure_cue_mistake'; sourceActionKind: 'pure_cue';
  itemId: string; sourceAttemptId: string; firstEventId: string;
  sessionActionId: string; occurredAt: string; rawResponse: string;
  submittedWord: ReflectionWordSnapshotV1;
  servedSnapshot: PureCueServedSnapshot;
  currentCue: { id: string; stimulus: string; axisNote: string; teachingNote: string; acceptedWordIds: string[]; acceptedWords: ReflectionWordSnapshotV1[] };
  activeProductionCues: ReflectionServedCueSnapshotV1[];
  targetWord: null; sessionNote: null;
  existingContent: { contrastClusters: []; knownAcceptedAlternates: [] };
};
export type PureCueReflectionBundleV1 = {
  schemaVersion: 'pure_cue_reflection_bundle.v1'; generatedAt: string;
  session: SessionReflectionBundleV1['session']; items: PureCueReflectionItemV1[];
};
/** Project only the language evidence needed by the provider; retain full provenance internally. */
export function projectPureCueReflectionInput(bundle: PureCueReflectionBundleV1) {
  const words = bundle.items.map(item => item.submittedWord.hanzi);
  if (new Set(words).size !== words.length) {
    throw new Error('Pure cue reflection requires unambiguous submitted words in its saved evidence.');
  }
  const lexical = ({ hanzi, pinyin, meanings }: ReflectionWordSnapshotV1) => ({ hanzi, pinyin, meanings });
  return {
    items: bundle.items.map(item => ({
      stimulus: item.servedSnapshot.stimulus,
      rawResponse: item.rawResponse,
      submittedWord: lexical(item.submittedWord),
      currentCue: {
        acceptedWords: item.currentCue.acceptedWords.map(lexical),
        axisNote: item.currentCue.axisNote,
        teachingNote: item.currentCue.teachingNote,
      },
      activeProductionCues: item.activeProductionCues.map(({ cueId, cueType, text }) => ({ cueId, cueType, text })),
    })),
  };
}

export type ReconcilePureCueResponseOperationV1 = {
  kind: 'reconcile_pure_cue_response'; version: 1; sourceAttemptId: string;
  responseWordId: string; pureCueId: string;
  expectedAcceptedWordIds: string[]; expectedTeachingNote: string; teachingNote: string;
  responseWordPlan: PromotePureElicitationWordPlanV1;
};
export type PureCueReflectionResultV1Wire = {
  schemaVersion: 'pure_cue_reflection_result.v1';
  itemResults: Array<{
    submittedWord: string; learnerExplanation: string; rationale: string;
    decision: 'extend' | 'explanation_only'; reason: 'does_not_fit' | 'uncertain' | null;
    extension: { teachingNote: string; responseWordPlan: Omit<PromotePureElicitationWordPlanV1, 'wordId'> } | null;
  }>;
};
export type PureCueReflectionResultV1 = {
  schemaVersion: 'pure_cue_reflection_result.v1'; itemResults: ReflectionItemResultV2[];
};
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(text) && new Set(v).size === v.length;
function fields(v: unknown, names: string[], path: string): string[] {
  if (!record(v)) return [`${path}: expected object`];
  return [...names.filter(n => !(n in v)).map(n => `${path}.${n}: required`), ...Object.keys(v).filter(n => !names.includes(n)).map(n => `${path}.${n}: unexpected field`)];
}
function planErrors(v: unknown, durable: boolean): string[] {
  const errors = fields(v, [...(durable ? ['wordId'] : []), 'deactivateCueIds', 'distinctiveCueDrafts'], 'responseWordPlan');
  if (!record(v)) return errors;
  if (durable && !text(v.wordId)) errors.push('responseWordPlan.wordId: required');
  if (!strings(v.deactivateCueIds)) errors.push('responseWordPlan.deactivateCueIds: expected unique cue IDs');
  if (!Array.isArray(v.distinctiveCueDrafts)) errors.push('responseWordPlan.distinctiveCueDrafts: expected array');
  else for (const draft of v.distinctiveCueDrafts) {
    errors.push(...fields(draft, ['cueType', 'text'], 'draft'));
    if (!record(draft) || !['definition_gloss', 'minimal_context', 'circumstance'].includes(String(draft.cueType)) || !text(draft.text)) errors.push('draft: invalid cue type or text');
  }
  return errors;
}
export function validateReconcilePureCueResponseOperation(value: unknown): string[] {
  const errors = fields(value, ['kind','version','sourceAttemptId','responseWordId','pureCueId','expectedAcceptedWordIds','expectedTeachingNote','teachingNote','responseWordPlan'], 'operation');
  if (!record(value)) return errors;
  if (value.kind !== 'reconcile_pure_cue_response' || value.version !== 1) errors.push('operation: unsupported contract');
  for (const key of ['sourceAttemptId','responseWordId','pureCueId','teachingNote']) if (!text(value[key])) errors.push(`operation.${key}: required`);
  if (typeof value.expectedTeachingNote !== 'string') errors.push('operation.expectedTeachingNote: expected string');
  if (!strings(value.expectedAcceptedWordIds) || value.expectedAcceptedWordIds.length < 2) errors.push('operation.expectedAcceptedWordIds: expected at least two unique members');
  else if (value.expectedAcceptedWordIds.includes(String(value.responseWordId))) errors.push('operation: response already accepted');
  errors.push(...planErrors(value.responseWordPlan, true));
  if (record(value.responseWordPlan) && value.responseWordPlan.wordId !== value.responseWordId) errors.push('operation: only response word C may be changed');
  return errors;
}
export function validatePureCueReflectionOperationEvidenceContext(operation: ReconcilePureCueResponseOperationV1, item: PureCueReflectionItemV1): string[] {
  const errors = validateReconcilePureCueResponseOperation(operation);
  if (errors.length) return errors;
  if (operation.sourceAttemptId !== item.sourceAttemptId || operation.responseWordId !== item.submittedWord.wordId || operation.pureCueId !== item.currentCue.id) errors.push('operation: source identity does not match evidence');
  if (operation.expectedTeachingNote !== item.currentCue.teachingNote || [...operation.expectedAcceptedWordIds].sort().join('\0') !== [...item.currentCue.acceptedWordIds].sort().join('\0')) errors.push('operation: expected content does not match evidence');
  if (operation.responseWordPlan.deactivateCueIds.some(id => !item.activeProductionCues.some(c => c.cueId === id))) errors.push('operation: may only deactivate active C cues');
  return errors;
}
function assertFields(value: unknown, names: string[], path: string): asserts value is Record<string, unknown> {
  const errors = fields(value, names, path);
  if (errors.length) throw new Error(errors.join('\n'));
}
function assertWordSnapshot(value: unknown): asserts value is ReflectionWordSnapshotV1 {
  assertFields(value, ['wordId', 'hanzi', 'pinyin', 'meanings'], 'word');
  if (!text(value.wordId) || !text(value.hanzi) || typeof value.pinyin !== 'string'
    || !Array.isArray(value.meanings) || !value.meanings.every(text)) {
    throw new Error('Invalid pure cue reflection word snapshot');
  }
}
function timestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}
export function parsePureCueReflectionBundle(value: unknown): PureCueReflectionBundleV1 {
  assertFields(value, ['schemaVersion', 'generatedAt', 'session', 'items'], 'bundle');
  if (value.schemaVersion !== 'pure_cue_reflection_bundle.v1' || !timestamp(value.generatedAt)
    || !Array.isArray(value.items)) throw new Error('Invalid pure cue reflection bundle');
  assertFields(value.session, ['sessionId', 'startedAt', 'endedAt', 'studyProfile'], 'session');
  if (!text(value.session.sessionId) || value.session.studyProfile !== 'mandarin'
    || !(value.session.startedAt === null || timestamp(value.session.startedAt))
    || !(value.session.endedAt === null || timestamp(value.session.endedAt))) {
    throw new Error('Invalid pure cue reflection session');
  }
  const ids = new Set<string>();
  const sourceIds = new Set<string>();
  for (const item of value.items) {
    assertFields(item, ['source', 'sourceActionKind', 'itemId', 'sourceAttemptId', 'firstEventId',
      'sessionActionId', 'occurredAt', 'rawResponse', 'submittedWord', 'servedSnapshot', 'currentCue',
      'activeProductionCues', 'targetWord', 'sessionNote', 'existingContent'], 'item');
    if (item.source !== 'pure_cue_mistake' || item.sourceActionKind !== 'pure_cue'
      || !text(item.itemId) || ids.has(item.itemId) || !text(item.sourceAttemptId)
      || sourceIds.has(item.sourceAttemptId) || !text(item.firstEventId)
      || !text(item.sessionActionId) || !timestamp(item.occurredAt) || !text(item.rawResponse)
      || item.targetWord !== null || item.sessionNote !== null || !Array.isArray(item.activeProductionCues)) {
      throw new Error('Invalid pure cue reflection item');
    }
    assertWordSnapshot(item.submittedWord);
    const responseWordId = item.submittedWord.wordId;
    assertFields(item.currentCue, ['id', 'stimulus', 'axisNote', 'teachingNote', 'acceptedWordIds', 'acceptedWords'], 'currentCue');
    const cue = item.currentCue;
    if (!text(cue.id) || !text(cue.stimulus) || typeof cue.axisNote !== 'string'
      || typeof cue.teachingNote !== 'string' || !strings(cue.acceptedWordIds)
      || cue.acceptedWordIds.length < 2 || cue.acceptedWordIds.includes(responseWordId)
      || !Array.isArray(cue.acceptedWords) || cue.acceptedWords.length !== cue.acceptedWordIds.length) {
      throw new Error('Invalid pure cue reflection current cue');
    }
    const memberIds = new Set<string>();
    for (const word of cue.acceptedWords) {
      assertWordSnapshot(word);
      if (!cue.acceptedWordIds.includes(word.wordId) || memberIds.has(word.wordId)) {
        throw new Error('Invalid pure cue reflection accepted member identity');
      }
      memberIds.add(word.wordId);
    }
    assertFields(item.servedSnapshot, ['snapshotId', 'pureCueId', 'servedAt', 'stimulus', 'axisNote', 'teachingNote', 'acceptedAnswers'], 'servedSnapshot');
    const snapshot = item.servedSnapshot;
    if (!text(snapshot.snapshotId) || !timestamp(snapshot.servedAt) || snapshot.pureCueId !== cue.id
      || snapshot.stimulus !== cue.stimulus || snapshot.axisNote !== cue.axisNote
      || typeof snapshot.teachingNote !== 'string' || !Array.isArray(snapshot.acceptedAnswers)
      || snapshot.acceptedAnswers.length < 2) throw new Error('Invalid pure cue served snapshot');
    const servedIds = new Set<string>();
    for (const answer of snapshot.acceptedAnswers) {
      assertFields(answer, ['wordId', 'hanzi', 'traditional'], 'acceptedAnswer');
      if (!text(answer.wordId) || !text(answer.hanzi)
        || !(answer.traditional === null || typeof answer.traditional === 'string')
        || answer.wordId === responseWordId || servedIds.has(answer.wordId)) {
        throw new Error('Invalid pure cue served answer');
      }
      servedIds.add(answer.wordId);
    }
    assertFields(item.existingContent, ['contrastClusters', 'knownAcceptedAlternates'], 'existingContent');
    if (!Array.isArray(item.existingContent.contrastClusters) || item.existingContent.contrastClusters.length
      || !Array.isArray(item.existingContent.knownAcceptedAlternates) || item.existingContent.knownAcceptedAlternates.length) {
      throw new Error('Pure cue evidence cannot carry word-targeted existing content');
    }
    const activeIds = new Set<string>();
    for (const productionCue of item.activeProductionCues) {
      assertFields(productionCue, ['cueId', 'cueType', 'text', 'acceptedWordIds'], 'activeProductionCue');
      if (!text(productionCue.cueId) || activeIds.has(productionCue.cueId) || !text(productionCue.text)
        || !['definition_gloss', 'minimal_context', 'circumstance'].includes(String(productionCue.cueType))
        || !strings(productionCue.acceptedWordIds) || !productionCue.acceptedWordIds.includes(responseWordId)) {
        throw new Error('Invalid pure cue response word production cue');
      }
      activeIds.add(productionCue.cueId);
    }
    ids.add(item.itemId);
    sourceIds.add(item.sourceAttemptId);
  }
  return value as PureCueReflectionBundleV1;
}
export function validatePureCueReflectionResultV1Wire(value: unknown, bundle?: PureCueReflectionBundleV1): string[] {
  const errors = fields(value, ['schemaVersion','itemResults'], 'result');
  if (!record(value)) return errors;
  if (value.schemaVersion !== 'pure_cue_reflection_result.v1') errors.push('result: invalid schema version');
  if (!Array.isArray(value.itemResults)) return [...errors, 'result.itemResults: expected array'];
  const ids = new Set<string>();
  for (const item of value.itemResults) {
    errors.push(...fields(item, ['submittedWord','learnerExplanation','rationale','decision','reason','extension'], 'item'));
    if (!record(item)) continue;
    if (!text(item.submittedWord) || ids.has(item.submittedWord)) errors.push('item.submittedWord: missing or duplicate');
    else { ids.add(item.submittedWord); if (bundle && bundle.items.filter(e => e.submittedWord.hanzi === item.submittedWord).length !== 1) errors.push('item.submittedWord: unknown or ambiguous evidence'); }
    if (!text(item.learnerExplanation) || !text(item.rationale)) errors.push('item: explanation and rationale required');
    if (item.decision === 'extend') {
      if (item.reason !== null) errors.push('item.reason: extend requires null');
      errors.push(...fields(item.extension, ['teachingNote','responseWordPlan'], 'extension'));
      if (record(item.extension)) {
        if (!text(item.extension.teachingNote)) errors.push('extension.teachingNote: required');
        errors.push(...planErrors(item.extension.responseWordPlan, false));
        const evidence = bundle?.items.find(e => e.submittedWord.hanzi === item.submittedWord);
        if (evidence && record(item.extension.responseWordPlan) && strings(item.extension.responseWordPlan.deactivateCueIds) && item.extension.responseWordPlan.deactivateCueIds.some(id => !evidence.activeProductionCues.some(c => c.cueId === id))) errors.push('extension: may only deactivate active C cues');
      }
    } else if (item.decision === 'explanation_only') {
      if (!['does_not_fit','uncertain'].includes(String(item.reason)) || item.extension !== null) errors.push('item: explanation only requires reason and null extension');
    } else errors.push('item.decision: invalid');
  }
  if (bundle && ids.size !== bundle.items.length) errors.push('result: exactly one result per evidence item required');
  return errors;
}
export function normalizePureCueReflectionResult(value: unknown, bundle: PureCueReflectionBundleV1): PureCueReflectionResultV1 {
  const errors = validatePureCueReflectionResultV1Wire(value, bundle);
  if (errors.length) throw new Error(errors.join('\n'));
  const wire = value as PureCueReflectionResultV1Wire;
  return { schemaVersion: wire.schemaVersion, itemResults: wire.itemResults.map(result => {
    const item = bundle.items.find(e => e.submittedWord.hanzi === result.submittedWord)!;
    return { itemId: item.itemId, diagnosisTags: result.decision === 'extend' ? ['valid_or_near_valid_alternate'] : [], learnerExplanation: result.learnerExplanation, questions: [], proposals: result.extension === null ? [] : [{ proposalGroupKey: null, rationale: result.rationale, operation: { kind: 'reconcile_pure_cue_response', version: 1, sourceAttemptId: item.sourceAttemptId, responseWordId: item.submittedWord.wordId, pureCueId: item.currentCue.id, expectedAcceptedWordIds: [...item.currentCue.acceptedWordIds], expectedTeachingNote: item.currentCue.teachingNote, teachingNote: result.extension.teachingNote, responseWordPlan: { ...result.extension.responseWordPlan, wordId: item.submittedWord.wordId } } }] };
  }) };
}
export function validatePureCueReflectionResult(value: unknown, bundle: PureCueReflectionBundleV1): string[] {
  const errors = fields(value, ['schemaVersion', 'itemResults'], 'result');
  if (!record(value)) return errors;
  if (value.schemaVersion !== 'pure_cue_reflection_result.v1') errors.push('Invalid pure cue result version');
  if (!Array.isArray(value.itemResults)) return [...errors, 'Expected result items'];
  const ids = new Set<string>();
  for (const result of value.itemResults) {
    errors.push(...fields(result, ['itemId', 'diagnosisTags', 'learnerExplanation', 'questions', 'proposals'], 'itemResult'));
    if (!record(result)) continue;
    if (!text(result.itemId) || !text(result.learnerExplanation)) errors.push('Invalid item result identity or explanation');
    if (!Array.isArray(result.diagnosisTags)
      || !result.diagnosisTags.every(tag => tag === 'valid_or_near_valid_alternate')
      || result.diagnosisTags.length > 1) errors.push('Invalid pure cue diagnosis tags');
    if (!Array.isArray(result.questions) || result.questions.length !== 0) errors.push('Pure cue results do not contain questions');
    const item = bundle.items.find(e => e.itemId === result.itemId);
    if (!item || !text(result.itemId) || ids.has(result.itemId)) { errors.push('Unknown or duplicate result item'); continue; }
    ids.add(result.itemId);
    if (!Array.isArray(result.proposals)) { errors.push('Expected proposal array'); continue; }
    if (result.proposals.length > 1) errors.push('Only one extension proposal allowed');
    for (const proposal of result.proposals) {
      errors.push(...fields(proposal, ['proposalGroupKey', 'rationale', 'operation'], 'proposal'));
      if (!record(proposal)) continue;
      if (proposal.proposalGroupKey !== null) errors.push('Pure cue proposal group must be null');
      if (!text(proposal.rationale)) errors.push('Proposal rationale required');
      const structural = validateReconcilePureCueResponseOperation(proposal.operation);
      errors.push(...structural);
      if (!structural.length) errors.push(...validatePureCueReflectionOperationEvidenceContext(proposal.operation as ReconcilePureCueResponseOperationV1, item));
    }
  }
  if (ids.size !== bundle.items.length) errors.push('Exactly one result per evidence item required');
  return errors;
}
const object = (properties: Record<string, JsonSchema>): JsonSchema => ({ type:'object',properties,required:Object.keys(properties),additionalProperties:false });
const string: JsonSchema = {type:'string'};
export const PURE_CUE_REFLECTION_RESULT_JSON_SCHEMA: JsonSchema = object({
  schemaVersion:{type:'string',enum:['pure_cue_reflection_result.v1']},
  itemResults:{type:'array',items:object({submittedWord:string,learnerExplanation:string,rationale:string,decision:{type:'string',enum:['extend','explanation_only']},reason:{type:['string','null'],enum:['does_not_fit','uncertain',null]},extension:{anyOf:[{type:'null'},object({teachingNote:string,responseWordPlan:object({deactivateCueIds:{type:'array',items:string},distinctiveCueDrafts:{type:'array',items:object({cueType:{type:'string',enum:['definition_gloss','minimal_context','circumstance']},text:string})}})})]}})}
});

export type PureCueMistakeReflectionItemV1 = PureCueReflectionItemV1;
