import { getDb } from './connection.ts';
import { requireLearnerId } from './learner-context.ts';
import { emitBackendEvent } from './vocabulary-content.ts';
import type { VocabularyWordMode } from '../../src/domain/vocabulary-session.ts';

export type VocabularyLearnerWord = {
  learnerId: string; wordId: string; inStash: boolean; addedAt: string;
  intendedUseText: string | null; mode: VocabularyWordMode; modeChangedAt: string;
  automaticPromotionPaused: boolean;
  stateVersion: number; scopeEstablishedAt: string | null; dismissedAt: string | null;
};
export type VocabularySchedulerState = {
  intervalHours: number; easeFactor: number; enabled: number; cleanCoveredSessions: number;
  legacyAdmissionAt?: string | null;
};
export type VocabularyWordSchedule = {
  wordId: string; nextEligibleAt: string | null; lastPractisedAt: string | null;
  policyVersion: string; schedulerState: VocabularySchedulerState; stateVersion: number;
  refreshRequestedAt: string | null; refreshUntil: string | null;
};
export class VocabularyStateConflict extends Error {}
export class VocabularyStateInputError extends Error {}
export class VocabularyStateNotFoundError extends Error {}
const modes: readonly VocabularyWordMode[] = ['unstudied', 'solidify', 'practice', 'maintain'];
let savepointSequence = 0;
function atomic<T>(operation: () => T): T {
  const name = `vocabulary_learner_${++savepointSequence}`;
  getDb().exec(`SAVEPOINT ${name}`);
  try { const result = operation(); getDb().exec(`RELEASE ${name}`); return result; }
  catch (error) { getDb().exec(`ROLLBACK TO ${name}`); getDb().exec(`RELEASE ${name}`); throw error; }
}
function timestamp(value: string): string {
  if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new VocabularyStateInputError('Expected a canonical UTC timestamp');
  }
  return value;
}
function requireWord(wordId: string): VocabularyLearnerWord {
  const word = getVocabularyLearnerWord(wordId);
  if (!word) throw new VocabularyStateInputError('Word is not in this learner’s vocabulary');
  return word;
}
export function getVocabularyLearnerWord(wordId: string): VocabularyLearnerWord | null {
  const row = getDb().prepare(`SELECT learner_id AS learnerId, word_id AS wordId, in_stash AS inStash,
    added_at AS addedAt, intended_use_text AS intendedUseText, mode, mode_changed_at AS modeChangedAt,
    automatic_promotion_paused AS automaticPromotionPaused, state_version AS stateVersion, scope_established_at AS scopeEstablishedAt, dismissed_at AS dismissedAt
    FROM learner_words WHERE learner_id = ? AND word_id = ?`).get(requireLearnerId(), wordId) as (Omit<VocabularyLearnerWord, 'inStash' | 'automaticPromotionPaused'> & { inStash: number; automaticPromotionPaused: number }) | undefined;
  return row ? { ...row, inStash: row.inStash === 1, automaticPromotionPaused: row.automaticPromotionPaused === 1 } : null;
}
export function getVocabularyWordSchedule(wordId: string): VocabularyWordSchedule | null {
  const row = getDb().prepare(`SELECT word_id AS wordId, next_eligible_at AS nextEligibleAt,
    last_practised_at AS lastPractisedAt, policy_version AS policyVersion, scheduler_state_json AS schedulerStateJson,
    state_version AS stateVersion, refresh_requested_at AS refreshRequestedAt, refresh_until AS refreshUntil
    FROM learner_word_schedules WHERE learner_id = ? AND word_id = ?`).get(requireLearnerId(), wordId) as (Omit<VocabularyWordSchedule, 'schedulerState'> & { schedulerStateJson: string }) | undefined;
  if (!row) return null;
  const { schedulerStateJson, ...fields } = row;
  return { ...fields, schedulerState: JSON.parse(schedulerStateJson) as VocabularySchedulerState };
}
/** Enrollment is explicit. Merely looking up a lexical word creates no learner state. */
export function addVocabularyWord(wordId: string, intendedUseText: string | null = null): VocabularyLearnerWord {
  const learnerId = requireLearnerId();
  return atomic(() => {
    if (!getDb().prepare('SELECT 1 FROM lexical_words WHERE id = ?').get(wordId)) {
      throw new VocabularyStateInputError('Unknown word');
    }
    const existing = getVocabularyLearnerWord(wordId);
    if (existing) return setVocabularyStashMembership(wordId,true);
    const now = new Date().toISOString();
    getDb().prepare(`INSERT INTO learner_words
      (learner_id, word_id, in_stash, added_at, intended_use_text, mode, mode_changed_at)
      VALUES (?, ?, 1, ?, ?, 'unstudied', ?)
      ON CONFLICT(learner_id, word_id) DO UPDATE SET in_stash = 1, state_version = state_version + 1`)
      .run(learnerId, wordId, now, intendedUseText, now);
    getDb().prepare(`INSERT OR IGNORE INTO learner_word_schedules
      (learner_id, word_id, policy_version, scheduler_state_json) VALUES (?, ?, 'vocabulary-v1', ?)`)
      .run(learnerId, wordId, JSON.stringify({ intervalHours: 24, easeFactor: 2.5, enabled: 1, cleanCoveredSessions: 0 }));
    emitBackendEvent({ name: 'vocabulary.word.added', learnerId, entityKind: 'word', entityId: wordId,
      actorKind: 'learner', actorId: learnerId, data: { intendedUseText } });
    return requireWord(wordId);
  });
}
/** Enroll only an actually selected ready diet word. Existing membership/mode always wins. */
export function enrollVocabularyDietWord(wordId: string): VocabularyLearnerWord {
  return atomic(() => {
    const existing = getVocabularyLearnerWord(wordId);
    if (existing) return existing;
    if (!getDb().prepare('SELECT 1 FROM lexical_words WHERE id=?').get(wordId)) throw new VocabularyStateInputError('Unknown word');
    const learnerId=requireLearnerId(),now=new Date().toISOString();
    getDb().prepare(`INSERT INTO learner_words(learner_id,word_id,in_stash,added_at,mode,mode_changed_at)
      VALUES (?,?,0,?,'unstudied',?)`).run(learnerId,wordId,now,now);
    getDb().prepare(`INSERT INTO learner_word_schedules(learner_id,word_id,policy_version,scheduler_state_json)
      VALUES (?,?,'vocabulary-v1',?)`).run(learnerId,wordId,JSON.stringify({intervalHours:24,easeFactor:2.5,enabled:1,cleanCoveredSessions:0}));
    emitBackendEvent({name:'vocabulary.word.enrolled',learnerId,actorKind:'learner',actorId:learnerId,entityKind:'word',entityId:wordId,
      data:{source:'selected_diet_word',inStash:false}});
    return requireWord(wordId);
  });
}
/** Learner Words-panel projection. Dismissed unstudied records stay retained but leave the list. */
export function listVocabularyLearnerWords(): Array<{
  wordId: string; hanzi: string; traditional: string | null; pinyin: string; meaning: string;
  mode: VocabularyWordMode; inStash: number; stateVersion: number; nextEligibleAt: string | null; refreshUntil: string | null;
}> {
  const rows = getDb().prepare(`SELECT l.word_id AS wordId,w.hanzi,w.traditional,w.pinyin,w.meaning,l.mode,l.in_stash AS inStash,
    l.state_version AS stateVersion,s.next_eligible_at AS nextEligibleAt,s.refresh_until AS refreshUntil
    FROM learner_words l JOIN lexical_words w ON w.id=l.word_id JOIN learner_word_schedules s USING(learner_id,word_id)
    WHERE l.learner_id=? AND (l.in_stash=1 OR l.mode!='unstudied') ORDER BY l.added_at DESC,l.word_id LIMIT 1000`)
    .all(requireLearnerId()) as Array<{ wordId: string; hanzi: string; traditional: string | null; pinyin: string; meaning: string;
      mode: VocabularyWordMode; inStash: number; stateVersion: number; nextEligibleAt: string | null; refreshUntil: string | null }>;
  return rows.map((row) => ({ ...row }));
}
function checkVersion(word: VocabularyLearnerWord,expectedVersion?: number): void {
  if (expectedVersion !== undefined && (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1)) throw new VocabularyStateInputError('Expected positive word-state version');
  if (expectedVersion !== undefined && word.stateVersion !== expectedVersion) throw new VocabularyStateConflict('Word state changed; reload before saving');
}
/** Stash membership and learning mode are independent. Removing membership alone does not dismiss learning. */
export function setVocabularyStashMembership(wordId: string,inStash: boolean,expectedVersion?: number): VocabularyLearnerWord {
  if (typeof inStash !== 'boolean') throw new VocabularyStateInputError('Expected stash membership');
  return atomic(() => {
    const before = getVocabularyLearnerWord(wordId);
    if (!before) {
      if (expectedVersion !== undefined || !inStash) throw new VocabularyStateInputError('Word is not in this learner’s vocabulary');
      return addVocabularyWord(wordId);
    }
    checkVersion(before,expectedVersion);
    if (before.inStash===inStash && (!inStash || before.dismissedAt===null)) return before;
    getDb().prepare('UPDATE learner_words SET in_stash=?,dismissed_at=CASE WHEN ? THEN NULL ELSE dismissed_at END,state_version=state_version+1 WHERE learner_id=? AND word_id=?')
      .run(inStash?1:0,inStash?1:0,before.learnerId,wordId);
    emitBackendEvent({ name: 'vocabulary.stash.membership_changed',learnerId: before.learnerId,actorKind: 'learner',actorId: before.learnerId,
      entityKind: 'word',entityId: wordId,data: { before: before.inStash,after: inStash,mode: before.mode } });
    return requireWord(wordId);
  });
}
/** Explicit dismissal stops future word study; it preserves scheduling, content and historical evidence. */
export function dismissVocabularyWord(wordId: string,expectedVersion?: number): VocabularyLearnerWord {
  return atomic(() => {
    const before = getVocabularyLearnerWord(wordId);
    if (!before) throw new VocabularyStateNotFoundError('Word not found');
    checkVersion(before,expectedVersion);
    if (!before.inStash && before.mode==='unstudied' && before.dismissedAt!==null) return before;
    const changedAt = before.mode==='unstudied' ? before.modeChangedAt : new Date().toISOString();
    getDb().prepare(`UPDATE learner_words SET in_stash=0,mode='unstudied',automatic_promotion_paused=0,dismissed_at=?,mode_changed_at=?,state_version=state_version+1
      WHERE learner_id=? AND word_id=?`).run(new Date().toISOString(),changedAt,before.learnerId,wordId);
    emitBackendEvent({ name: 'vocabulary.word.dismissed',learnerId: before.learnerId,actorKind: 'learner',actorId: before.learnerId,
      entityKind: 'word',entityId: wordId,data: { before: { mode: before.mode,inStash: before.inStash },after: { mode: 'unstudied',inStash: false } } });
    return requireWord(wordId);
  });
}
/** Explicit Solidify keeps that mode until another choice; scheduling and history are independent. */
export function changeVocabularyMode(wordId: string, mode: VocabularyWordMode, expectedVersion: number): VocabularyLearnerWord {
  if (!modes.includes(mode)) throw new VocabularyStateInputError('Unknown vocabulary mode');
  return atomic(() => {
    const before = requireWord(wordId);
    if (before.stateVersion !== expectedVersion) throw new VocabularyStateConflict('Word state changed; reload before choosing mode');
    const automaticPromotionPaused = mode === 'solidify';
    const now = new Date().toISOString();
    getDb().prepare(`UPDATE learner_words SET mode = ?, automatic_promotion_paused = ?, dismissed_at=NULL, mode_changed_at = ?, state_version = state_version + 1
      WHERE learner_id = ? AND word_id = ?`).run(mode, automaticPromotionPaused ? 1 : 0, before.mode === mode ? before.modeChangedAt : now, requireLearnerId(), wordId);
    emitBackendEvent({ name: 'vocabulary.mode.changed', learnerId: before.learnerId, actorKind: 'learner',
      actorId: before.learnerId, entityKind: 'word', entityId: wordId,
      data: { before: before.mode, after: mode, automaticPromotionPaused, source: 'explicit_choice' } });
    return requireWord(wordId);
  });
}
/** Refresh is bounded attention. It neither resets SRS history nor changes mode. */
export function requestVocabularyRefresh(wordId: string, now = new Date().toISOString()): VocabularyWordSchedule {
  timestamp(now);
  return atomic(() => {
    const word = requireWord(wordId);
    if (word.mode !== 'maintain') throw new VocabularyStateInputError('Temporary refresh is for Maintain words');
    const until = new Date(Date.parse(now) + 3 * 86_400_000).toISOString();
    const updated = getDb().prepare(`UPDATE learner_word_schedules SET refresh_requested_at = ?, refresh_until = ?,
      next_eligible_at = ?, state_version = state_version + 1 WHERE learner_id = ? AND word_id = ?`)
      .run(now, until, now, word.learnerId, wordId);
    if (updated.changes !== 1) throw new Error('Enrolled word has no production schedule');
    emitBackendEvent({ name: 'vocabulary.refresh.requested', learnerId: word.learnerId,
      entityKind: 'word', entityId: wordId, data: { until } });
    return getVocabularyWordSchedule(wordId)!;
  });
}
/** Candidate ordering guarantees refresh priority without promising every due word. */
export function listVocabularyCandidates(limit = 30, now = new Date().toISOString(),
  options: { modes?: readonly VocabularyWordMode[]; inStash?: boolean } = {}): VocabularyLearnerWord[] {
  timestamp(now);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new VocabularyStateInputError('Invalid candidate limit');
  if (options.modes?.some((mode) => !modes.includes(mode))) throw new VocabularyStateInputError('Unknown vocabulary mode');
  if (options.inStash !== undefined && typeof options.inStash !== 'boolean') throw new VocabularyStateInputError('Expected stash membership');
  const learnerId = requireLearnerId();
  if (options.modes?.length === 0) return [];
  const modeClause = options.modes ? `AND w.mode IN (${options.modes.map(() => '?').join(',')})` : '';
  const stashClause = options.inStash === undefined ? '' : 'AND w.in_stash=?';
  const filterValues = [...options.modes ?? [],...(options.inStash === undefined ? [] : [options.inStash ? 1 : 0])];
  const rows = getDb().prepare(`SELECT w.word_id FROM learner_words w
    JOIN learner_word_schedules s USING (learner_id, word_id)
    WHERE w.learner_id = ? AND w.dismissed_at IS NULL AND (w.mode != 'unstudied' OR w.in_stash = 1)
      AND (s.next_eligible_at IS NULL OR s.next_eligible_at <= ?)
      AND COALESCE(json_extract(s.scheduler_state_json, '$.enabled'), 1) = 1
      ${modeClause} ${stashClause}
    ORDER BY CASE WHEN s.refresh_until > ? THEN 0 ELSE 1 END,
      CASE w.mode WHEN 'solidify' THEN 0 WHEN 'practice' THEN 1 WHEN 'maintain' THEN 2 ELSE 3 END,
      s.next_eligible_at, w.added_at, w.word_id LIMIT ?`).all(learnerId, now, ...filterValues, now, limit) as {word_id: string}[];
  return rows.map(({word_id}) => requireWord(word_id));
}
