import { randomUUID } from 'node:crypto';
import type { VocabularySense } from '../../src/domain/vocabulary-content.ts';
import { getDb } from './connection.ts';
import { requireLearnerId } from './learner-context.ts';
import { emitBackendEvent, getVocabularySenseCatalog, getVocabularySenses } from './vocabulary-content.ts';
import { getVocabularyLearnerWord, VocabularyStateConflict, VocabularyStateInputError } from './vocabulary-learners.ts';
import { getVocabularyWordSenseCoverage } from './vocabulary-sense-coverage.ts';
import { requestWordReserveReconciliation } from './word-reserve.ts';

export type VocabularyLearnerSenseDisposition = 'active' | 'excluded';
export type VocabularyLearnerSenseChoice = { senseId: string; disposition: VocabularyLearnerSenseDisposition };
export type VocabularyLearnerSenseScope = {
  wordId: string;
  stateVersion: number | null;
  catalogVersion: number;
  selectionVersion: number;
  inventoryEstablished: boolean;
  selectionEstablished: boolean;
  defaultSenseIds: string[] | null;
  sharedExcludedSenseIds: string[];
  senses: VocabularySense[];
  choices: VocabularyLearnerSenseChoice[];
  includedSenseIds: string[];
  scopeEstablishedAt: string | null;
};

/** Learner choices are identity-bound. Retired rows remain stored but never enter an effective set. */
export function resolveVocabularyLearnerSenseScope(wordId: string): VocabularyLearnerSenseScope {
  const learnerId = requireLearnerId();
  const catalog = getVocabularySenseCatalog(wordId);
  const coverage = getVocabularyWordSenseCoverage(wordId);
  const word = getVocabularyLearnerWord(wordId);
  const senses = getVocabularySenses(wordId).filter(sense => sense.status === 'active');
  const active = new Set(senses.map(sense => sense.senseId));
  const choices = (getDb().prepare(`SELECT sense_id AS senseId,disposition FROM learner_senses
    WHERE learner_id=? AND word_id=? ORDER BY sense_id`).all(learnerId,wordId) as VocabularyLearnerSenseChoice[])
    .filter(choice => active.has(choice.senseId)).map(choice => ({...choice}));
  const bySense = new Map(choices.map(choice => [choice.senseId,choice.disposition]));
  const defaults = coverage.defaultUsefulSenseIds === null ? null : coverage.defaultUsefulSenseIds.filter(id => active.has(id)).sort();
  return {
    wordId,stateVersion:word?.stateVersion ?? null,catalogVersion:catalog.version,selectionVersion:coverage.version,
    inventoryEstablished:catalog.establishedAt !== null,selectionEstablished:defaults !== null,
    defaultSenseIds:defaults,sharedExcludedSenseIds:coverage.excludedSenseIds,senses,choices,scopeEstablishedAt:word?.scopeEstablishedAt ?? null,
    includedSenseIds:[...active].filter(id => bySense.get(id) === 'active' ||
      (bySense.get(id) !== 'excluded' && defaults?.includes(id))).sort(),
  };
}

/** Unknown shared selection retains the existing permissive serving policy, with explicit learner choices applied. */
export function vocabularyLearnerSenseIsEligible(scope: VocabularyLearnerSenseScope, senseId: string): boolean {
  if (!scope.senses.some(sense => sense.senseId === senseId)) return false;
  if (scope.selectionEstablished) return scope.includedSenseIds.includes(senseId);
  const choice = scope.choices.find(entry => entry.senseId === senseId);
  if (choice) return choice.disposition === 'active';
  return !scope.sharedExcludedSenseIds.includes(senseId);
}

export type WriteVocabularyLearnerSenseScope = {
  senseIds: string[];
  targetSenseId?: string | null;
  expectedStateVersion: number;
  expectedCatalogVersion: number;
  expectedSelectionVersion: number;
  surface: string;
  intendedUseText?: string | null;
};

/** Confirmation stores deviations plus the target, never a frozen copy of shared defaults. */
export function writeVocabularyLearnerSenseScope(wordId: string, input: WriteVocabularyLearnerSenseScope): VocabularyLearnerSenseScope {
  const learnerId = requireLearnerId();
  if (!input.surface?.trim()) throw new VocabularyStateInputError('A sense choice requires its originating surface');
  if (input.intendedUseText !== undefined && input.intendedUseText !== null && typeof input.intendedUseText !== 'string') {
    throw new VocabularyStateInputError('Expected context text');
  }
  for (const [name,value,minimum] of [
    ['word',input.expectedStateVersion,1],['catalog',input.expectedCatalogVersion,0],['selection',input.expectedSelectionVersion,0],
  ] as const) if (!Number.isSafeInteger(value) || value < minimum) throw new VocabularyStateInputError(`Expected a valid ${name} version`);
  const db = getDb();
  const point = `learner_scope_${randomUUID().replaceAll('-','')}`;
  db.exec(`SAVEPOINT ${point}`);
  try {
    const before = resolveVocabularyLearnerSenseScope(wordId);
    if (before.stateVersion === null) throw new VocabularyStateInputError('Word is not in this learner’s vocabulary');
    if (before.stateVersion !== input.expectedStateVersion || before.catalogVersion !== input.expectedCatalogVersion ||
      before.selectionVersion !== input.expectedSelectionVersion) throw new VocabularyStateConflict('Word or sense selection changed; reload before saving');
    if (!before.inventoryEstablished || !before.selectionEstablished) throw new VocabularyStateInputError('Wait for the sense inventory and defaults before choosing senses');
    const active = new Set(before.senses.map(sense => sense.senseId));
    if (!Array.isArray(input.senseIds) || input.senseIds.some(id => typeof id !== 'string' || !active.has(id)) ||
      new Set(input.senseIds).size !== input.senseIds.length) throw new VocabularyStateInputError('Expected distinct active senses belonging to this word');
    if (!input.senseIds.length) throw new VocabularyStateInputError('Choose at least one sense');
    const selected = new Set(input.senseIds);
    if (input.targetSenseId != null && !selected.has(input.targetSenseId)) throw new VocabularyStateInputError('The target must be one of the selected senses');
    // Old retired identities are historical evidence and must not silently transfer to replacements.
    db.prepare(`DELETE FROM learner_senses WHERE learner_id=? AND word_id=?
      AND sense_id IN (SELECT sense_id FROM senses WHERE word_id=? AND status='active')`).run(learnerId,wordId,wordId);
    const insert = db.prepare('INSERT INTO learner_senses(learner_id,word_id,sense_id,disposition) VALUES (?,?,?,?)');
    const defaults = new Set(before.defaultSenseIds!);
    for (const senseId of active) {
      if (selected.has(senseId) && (!defaults.has(senseId) || senseId === input.targetSenseId)) insert.run(learnerId,wordId,senseId,'active');
      else if (!selected.has(senseId) && defaults.has(senseId)) insert.run(learnerId,wordId,senseId,'excluded');
    }
    const at = new Date().toISOString();
    db.prepare(`UPDATE learner_words SET scope_established_at=?,state_version=state_version+1,
      intended_use_text=CASE WHEN ? THEN ? ELSE intended_use_text END WHERE learner_id=? AND word_id=?`)
      .run(at,input.intendedUseText === undefined ? 0 : 1,input.intendedUseText ?? null,learnerId,wordId);
    const after = resolveVocabularyLearnerSenseScope(wordId);
    emitBackendEvent({name:'vocabulary.learner_senses.changed',learnerId,actorKind:'learner',actorId:learnerId,
      entityKind:'word',entityId:wordId,occurredAt:at,data:{surface:input.surface,targetSenseId:input.targetSenseId ?? null,
        before:{senseIds:before.includedSenseIds,choices:before.choices,stateVersion:before.stateVersion},
        after:{senseIds:after.includedSenseIds,choices:after.choices,stateVersion:after.stateVersion},
        catalogVersion:after.catalogVersion,selectionVersion:after.selectionVersion}});
    requestWordReserveReconciliation();
    db.exec(`RELEASE ${point}`);
    return after;
  } catch (error) {
    db.exec(`ROLLBACK TO ${point}`);db.exec(`RELEASE ${point}`);throw error;
  }
}
