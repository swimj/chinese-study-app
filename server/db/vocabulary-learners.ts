import { getDb } from './connection.ts';
import { requireLearnerId } from './learner-context.ts';
import { emitBackendEvent } from './vocabulary-content.ts';
import type { VocabularyWordMode } from '../../src/domain/vocabulary-session.ts';

export type VocabularyLearnerWord = {
  learnerId: string; wordId: string; inStash: boolean; addedAt: string;
  intendedUseText: string | null; mode: VocabularyWordMode; modeChangedAt: string;
  stateVersion: number; scopeEstablishedAt: string | null;
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
    state_version AS stateVersion, scope_established_at AS scopeEstablishedAt
    FROM learner_words WHERE learner_id = ? AND word_id = ?`).get(requireLearnerId(), wordId) as (Omit<VocabularyLearnerWord, 'inStash'> & { inStash: number }) | undefined;
  return row ? { ...row, inStash: row.inStash === 1 } : null;
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
    if (existing?.inStash) return existing;
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
/** A mode choice changes mode only; scheduling and historical evidence are independent. */
export function changeVocabularyMode(wordId: string, mode: VocabularyWordMode, expectedVersion: number): VocabularyLearnerWord {
  if (!modes.includes(mode)) throw new VocabularyStateInputError('Unknown vocabulary mode');
  return atomic(() => {
    const before = requireWord(wordId);
    if (before.stateVersion !== expectedVersion) throw new VocabularyStateConflict('Word state changed; reload before choosing mode');
    if (before.mode === mode) return before;
    const now = new Date().toISOString();
    getDb().prepare(`UPDATE learner_words SET mode = ?, mode_changed_at = ?, state_version = state_version + 1
      WHERE learner_id = ? AND word_id = ?`).run(mode, now, requireLearnerId(), wordId);
    emitBackendEvent({ name: 'vocabulary.mode.changed', learnerId: before.learnerId, actorKind: 'learner',
      actorId: before.learnerId, entityKind: 'word', entityId: wordId,
      data: { before: before.mode, after: mode, source: 'explicit_choice' } });
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
export function listVocabularyCandidates(limit = 30, now = new Date().toISOString()): VocabularyLearnerWord[] {
  timestamp(now);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new VocabularyStateInputError('Invalid candidate limit');
  const rows = getDb().prepare(`SELECT w.word_id FROM learner_words w
    JOIN learner_word_schedules s USING (learner_id, word_id)
    WHERE w.learner_id = ? AND (w.mode != 'unstudied' OR w.in_stash = 1)
      AND (s.next_eligible_at IS NULL OR s.next_eligible_at <= ?)
      AND COALESCE(json_extract(s.scheduler_state_json, '$.enabled'), 1) = 1
    ORDER BY CASE WHEN s.refresh_until > ? THEN 0 ELSE 1 END,
      CASE w.mode WHEN 'solidify' THEN 0 WHEN 'practice' THEN 1 WHEN 'maintain' THEN 2 ELSE 3 END,
      s.next_eligible_at, w.added_at, w.word_id LIMIT ?`).all(requireLearnerId(), now, now, limit) as {word_id: string}[];
  return rows.map(({word_id}) => requireWord(word_id));
}
