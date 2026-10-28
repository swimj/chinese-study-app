import { ensureCurrentVocabularyPreparation } from '../db/preparation-compatibility.ts';
import { getDb } from '../db/connection.ts';
import { getWordReserveCandidates, replaceWordReserveCandidates, getBlockedPreparationWordIds,
  finishWordReserveReconciliation, requestWordReserveReconciliation } from '../db/word-reserve.ts';
import { enqueueWordPreparation } from '../db/preparation-work.ts';
import { buildUnstudiedAdmissionSeedSource } from '../db/unstudied-admission.ts';
import { planVocabularyNewWords, vocabularyDailyNewWordLimit } from './composition.ts';
import { teachingReady } from './teaching-readiness.ts';

/** Prepare tomorrow's candidates as well as today's, without changing an active session. */
export function reconcileVocabularyPreparationReserve(now = new Date().toISOString()): void {
  const target = 2 * vocabularyDailyNewWordLimit();
  const existing = new Set(getWordReserveCandidates());
  const blocked = target > 0 ? getBlockedPreparationWordIds() : new Set<string>();
  // Failure holds a slot; repeated visits must not grow speculative generation across the corpus.
  const excludedIds = new Set([...blocked].filter((id) => !existing.has(id)));
  const candidates = target > 0 ? planVocabularyNewWords({
    limit: target, seed: buildUnstudiedAdmissionSeedSource('reserve', target), now,
    preferredIds: existing, excludedIds,
  }).newWordIds : [];
  getDb().exec('SAVEPOINT reconcile_vocabulary_reserve');
  try {
    replaceWordReserveCandidates(candidates, now);
    let deferred = false;
    for (const wordId of candidates) {
      if (blocked.has(wordId)) continue;
      if (!ensureCurrentVocabularyPreparation(wordId,now)) { deferred = true; continue; }
      if (!teachingReady(wordId)) enqueueWordPreparation(wordId, 'teaching');
    }
    if (deferred) requestWordReserveReconciliation(now);
    else finishWordReserveReconciliation();
    getDb().exec('RELEASE SAVEPOINT reconcile_vocabulary_reserve');
  } catch (error) {
    getDb().exec('ROLLBACK TO SAVEPOINT reconcile_vocabulary_reserve');
    getDb().exec('RELEASE SAVEPOINT reconcile_vocabulary_reserve');
    throw error;
  }
}
