import { ensureCurrentVocabularyPreparation } from '../db/preparation-compatibility.ts';
import { getDb } from '../db/connection.ts';
import { getWordReserveCandidates, replaceWordReserveCandidates, getBlockedPreparationWordIds,
  finishWordReserveReconciliation, requestWordReserveReconciliation, getTopWordReserveCandidates, setWordReserveReadiness } from '../db/word-reserve.ts';
import { enqueueWordPreparation } from '../db/preparation-work.ts';
import { buildUnstudiedAdmissionSeedSource } from '../db/unstudied-admission.ts';
import { planVocabularyNewWords, vocabularyDailyNewWordLimit } from './composition.ts';
import { teachingReady } from './teaching-readiness.ts';

/** Prepare tomorrow's candidates as well as today's, without changing an active session. */
export function reconcileVocabularyPreparationReserve(now = new Date().toISOString()): void {
  const top = getTopWordReserveCandidates();
  const target = Math.max(top.length,2 * vocabularyDailyNewWordLimit());
  const existing = new Set(getWordReserveCandidates());
  const blocked = target > 0 ? getBlockedPreparationWordIds() : new Set<string>();
  // Failure holds a slot; repeated visits must not grow speculative generation across the corpus.
  const excludedIds = new Set([...top,...[...blocked].filter((id) => !existing.has(id))]);
  const candidates = [...top,...(target > top.length ? planVocabularyNewWords({
    limit: target-top.length, seed: buildUnstudiedAdmissionSeedSource('reserve', target), now,
    preferredIds: existing, excludedIds,
  }).newWordIds : [])].slice(0,40);
  getDb().exec('SAVEPOINT reconcile_vocabulary_reserve');
  try {
    replaceWordReserveCandidates(candidates, now);
    // Empty/partial reserves must remain discoverable when eligibility changes with time.
    let deferred = candidates.length < target;
    for (const wordId of candidates) {
      if(teachingReady(wordId)){setWordReserveReadiness(wordId,true,now);continue;}
      if (blocked.has(wordId)) { setWordReserveReadiness(wordId,false,now); continue; }
      if (!ensureCurrentVocabularyPreparation(wordId,now)) { setWordReserveReadiness(wordId,false,now); deferred = true; continue; }
      const ready=teachingReady(wordId);
      setWordReserveReadiness(wordId,ready,now);
      if (!ready) enqueueWordPreparation(wordId, 'teaching');
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
