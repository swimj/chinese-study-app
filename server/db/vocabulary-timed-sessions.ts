import { getDb } from './connection.ts';
import { requireLearnerId } from './learner-context.ts';
import { readHostedServiceControl } from './hosted-operations.ts';
import { LAPSE_INTERVAL_HOURS } from './review-policy.ts';
import { selectVocabularyReviewSkills } from '../vocabulary/review-selection.ts';
import { DEFAULT_DAILY_STUDY_MINUTES, isDailyStudyMinutes, timedItemClass, timedTargetKey, TIMED_SESSION_NOTE_MAX_LENGTH,
  type DailyStudyMinutes, type TimedTargetKind, type VocabularyTimedSessionContext } from '../../src/domain/timed-session.ts';
import type { VocabularySessionAction, VocabularySessionInitialContext, VocabularySessionProjection, VocabularySkill,
  VocabularyWordMode } from '../../src/domain/vocabulary-session.ts';

/** Persistence and closure effects for the timed daily practice prototype. */
export class VocabularyTimedSessionInputError extends Error {}

/** Read at Start only; a session keeps the paradigm it began under. */
export function vocabularyTimedSessionsEnabled(): boolean {
  return readHostedServiceControl('timed_sessions').enabled;
}

const DAILY_STUDY_MINUTES_KEY = 'daily_study_minutes';
export function getDailyStudyMinutes(): { minutes: DailyStudyMinutes; source: 'chosen' | 'default' } {
  const row = getDb().prepare('SELECT value_json FROM learner_settings WHERE learner_id=? AND setting_key=?')
    .get(requireLearnerId(), DAILY_STUDY_MINUTES_KEY) as { value_json: string } | undefined;
  if (!row) return { minutes: DEFAULT_DAILY_STUDY_MINUTES, source: 'default' };
  const value: unknown = JSON.parse(row.value_json);
  if (!isDailyStudyMinutes(value)) throw new Error('Invalid daily_study_minutes setting');
  return { minutes: value, source: 'chosen' };
}
export function setDailyStudyMinutes(value: unknown): { dailyStudyMinutes: DailyStudyMinutes } {
  if (!isDailyStudyMinutes(value)) throw new VocabularyTimedSessionInputError('Expected dailyStudyMinutes to be 10, 20 or 30');
  getDb().prepare(`INSERT INTO learner_settings(learner_id,setting_key,value_json,updated_at) VALUES (?,?,?,?)
    ON CONFLICT(learner_id,setting_key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`)
    .run(requireLearnerId(), DAILY_STUDY_MINUTES_KEY, JSON.stringify(value), new Date().toISOString());
  return { dailyStudyMinutes: getDailyStudyMinutes().minutes };
}

/** Active time already spent in the day's timed sessions, including abandoned ones. */
export function timedDayActiveMs(dayKey: string): number {
  const row = getDb().prepare(`SELECT COALESCE(SUM(COALESCE(session_active_ms,last_active_ms)),0) AS total
    FROM vocabulary_timed_session_records WHERE learner_id=? AND day_key=?`).get(requireLearnerId(), dayKey) as { total: number };
  return Number(row.total);
}

export function readTimedSkipDays(): Map<string, number> {
  const rows = getDb().prepare('SELECT target_kind,target_id,skip_days FROM learner_timed_skip_counts WHERE learner_id=?')
    .all(requireLearnerId()) as { target_kind: TimedTargetKind; target_id: string; skip_days: number }[];
  return new Map(rows.map((row) => [timedTargetKey(row.target_kind, row.target_id), Number(row.skip_days)]));
}

type WordTarget = { kind: 'word'; id: string; mode: VocabularyWordMode; selectedSkill?: VocabularySkill };
type CueTarget = { kind: 'pure_cue'; id: string };
/** When the classic rule would have shown each target, and whether its production schedule sits on the lapse interval. */
export function timedTargetFacts(targets: readonly (WordTarget | CueTarget)[]): VocabularyTimedSessionContext['facts'] {
  const learnerId = requireLearnerId(); const facts: Record<string, { classicDueAt: string | null; priorLapse: boolean | null }> = {};
  const schedule = getDb().prepare('SELECT next_eligible_at,scheduler_state_json FROM learner_word_schedules WHERE learner_id=? AND word_id=?');
  const skill = getDb().prepare('SELECT next_due_at FROM learner_owned_word_skill_state WHERE learner_id=? AND word_id=? AND skill_id=?');
  const cue = getDb().prepare('SELECT next_eligible_at FROM learner_pure_cue_schedules WHERE learner_id=? AND content_id=?');
  for (const target of targets) {
    if (target.kind === 'pure_cue') {
      const row = cue.get(learnerId, target.id) as { next_eligible_at: string | null } | undefined;
      facts[timedTargetKey('pure_cue', target.id)] = { classicDueAt: row?.next_eligible_at ?? null, priorLapse: null };
      continue;
    }
    const review = target.mode === 'practice' || target.mode === 'maintain';
    if (review && target.selectedSkill && target.selectedSkill !== 'production') {
      const row = skill.get(learnerId, target.id, target.selectedSkill) as { next_due_at: string | null } | undefined;
      facts[timedTargetKey('word', target.id)] = { classicDueAt: row?.next_due_at ?? null, priorLapse: null };
      continue;
    }
    const row = schedule.get(learnerId, target.id) as { next_eligible_at: string | null; scheduler_state_json: string } | undefined;
    const interval = row ? (JSON.parse(row.scheduler_state_json) as { intervalHours?: number }).intervalHours : undefined;
    facts[timedTargetKey('word', target.id)] = { classicDueAt: row?.next_eligible_at ?? null,
      priorLapse: review ? interval === LAPSE_INTERVAL_HOURS : null };
  }
  return facts;
}

export function createTimedSessionRecord(sessionId: string, timed: VocabularyTimedSessionContext, startedAt: string): void {
  getDb().prepare(`INSERT INTO vocabulary_timed_session_records(session_id,learner_id,day_key,budget_ms,budget_source,day_active_ms_at_start,started_at)
    VALUES (?,?,?,?,?,?,?)`).run(sessionId, requireLearnerId(), timed.dayKey, timed.budgetMs, timed.budgetSource, timed.dayActiveMsAtStart, startedAt);
}
type RecordRow = { last_active_ms: number; note: string | null; started_at: string };
function record(sessionId: string): RecordRow {
  const row = getDb().prepare('SELECT last_active_ms,note,started_at FROM vocabulary_timed_session_records WHERE session_id=? AND learner_id=?')
    .get(sessionId, requireLearnerId()) as RecordRow | undefined;
  if (!row) throw new Error('Timed session record is missing');
  return { ...row, last_active_ms: Number(row.last_active_ms) };
}
export function readTimedSessionRecord(sessionId: string): { lastActiveMs: number; note: string | null } {
  const row = record(sessionId); return { lastActiveMs: row.last_active_ms, note: row.note };
}
/**
 * The client's active measure arrives with each Next. It is the learner's own soft
 * target, so it is trusted within wall-clock bounds and never moves backward.
 */
export function recordTimedActiveMs(sessionId: string, activeDurationMs: number, now = new Date().toISOString()): number {
  const row = record(sessionId);
  if (!Number.isSafeInteger(activeDurationMs) || activeDurationMs < 0
    || activeDurationMs > Math.max(0, Date.parse(now) - Date.parse(row.started_at)) + 5000)
    throw new VocabularyTimedSessionInputError('Expected bounded integer activeDurationMs');
  if (activeDurationMs <= row.last_active_ms) return row.last_active_ms;
  getDb().prepare('UPDATE vocabulary_timed_session_records SET last_active_ms=? WHERE session_id=?').run(activeDurationMs, sessionId);
  return activeDurationMs;
}
export function markTimedGateHeld(sessionId: string): void {
  getDb().prepare('UPDATE vocabulary_timed_session_records SET gate_held=1 WHERE session_id=? AND learner_id=? AND gate_held=0').run(sessionId, requireLearnerId());
}
export function saveTimedSessionNote(sessionId: string, note: unknown, now = new Date().toISOString()): { note: string | null } {
  if (typeof note !== 'string') throw new VocabularyTimedSessionInputError('Expected note text');
  const trimmed = note.trim();
  if (trimmed.length > TIMED_SESSION_NOTE_MAX_LENGTH) throw new VocabularyTimedSessionInputError(`Keep the note under ${TIMED_SESSION_NOTE_MAX_LENGTH} characters`);
  record(sessionId);
  getDb().prepare('UPDATE vocabulary_timed_session_records SET note=?,note_at=? WHERE session_id=?')
    .run(trimmed || null, trimmed ? now : null, sessionId);
  return { note: trimmed || null };
}

function effective(actions: readonly VocabularySessionAction[], projection: VocabularySessionProjection) {
  const undone = new Set(projection.undoneActionIds);
  return actions.filter((action) => action.sequence <= projection.throughSequence && !undone.has(action.actionId));
}
/** Day active time at which the session wraps up; the latest effective extension wins. */
export function timedWrapThreshold(timed: VocabularyTimedSessionContext, actions: readonly VocabularySessionAction[], projection: VocabularySessionProjection): number {
  const extension = effective(actions, projection).findLast((action): action is Extract<VocabularySessionAction, { kind: 'resume' }> =>
    action.kind === 'resume' && action.payload.untilDayActiveMs !== undefined);
  return extension?.payload.untilDayActiveMs ?? timed.untilDayActiveMs;
}
/** The latest effective wrap-up came from the day's allowance rather than running out of work. */
export function timedBudgetWrapped(actions: readonly VocabularySessionAction[], projection: VocabularySessionProjection): boolean {
  if (projection.phase === 'active') return false;
  const finish = effective(actions, projection).findLast((action) => action.kind === 'finish_for_now');
  return finish?.kind === 'finish_for_now' && finish.payload.source === 'budget';
}

/**
 * Closure: clear counts for served items, count one passed-over day for each due
 * held item left unstarted (including items the 1,000-item cap kept out of the
 * pool), and fill the session record. Intervals and due dates are untouched.
 */
export function finalizeTimedSession(input: { context: VocabularySessionInitialContext; actions: readonly VocabularySessionAction[];
  projection: VocabularySessionProjection; activeDurationMs: number | null; startedAt: string; now: string }): void {
  const timed = input.context.timed; if (!timed) return;
  const { context, projection } = input; const learnerId = requireLearnerId(); const sessionId = context.sessionId;
  const row = record(sessionId);
  const started = new Set<string>();
  for (const word of Object.values(projection.words)) if (word.admitted) started.add(timedTargetKey('word', word.wordId));
  for (const encounter of projection.encounters) if (encounter.wordId === null && !encounter.presentationUndone)
    started.add(timedTargetKey('pure_cue', encounter.snapshot.contentId));
  const clear = getDb().prepare('DELETE FROM learner_timed_skip_counts WHERE learner_id=? AND target_kind=? AND target_id=?');
  for (const key of started) { const [kind, id] = split(key); clear.run(learnerId, kind, id); }
  const passedOver = new Set<string>();
  for (const selection of selectVocabularyReviewSkills({ now: input.startedAt })) passedOver.add(timedTargetKey('word', selection.wordId));
  for (const entry of context.reviewOrder ?? []) if (entry.kind === 'pure_cue') passedOver.add(timedTargetKey('pure_cue', entry.id));
  const skip = getDb().prepare(`INSERT INTO learner_timed_skip_counts(learner_id,target_kind,target_id,skip_days,last_skipped_day,updated_at)
    VALUES (?,?,?,1,?,?) ON CONFLICT(learner_id,target_kind,target_id) DO UPDATE SET skip_days=skip_days+1,
    last_skipped_day=excluded.last_skipped_day,updated_at=excluded.updated_at WHERE last_skipped_day<>excluded.last_skipped_day`);
  for (const key of passedOver) if (!started.has(key)) { const [kind, id] = split(key); skip.run(learnerId, kind, id, timed.dayKey, input.now); }

  const served: { key: string; class: string; classicDueAt: string | null; priorLapse: boolean | null; outcome: 'covered' | 'uncovered'; accepted: number; rejected: number }[] = [];
  for (const word of Object.values(projection.words)) {
    if (!word.admitted) continue;
    const key = timedTargetKey('word', word.wordId);
    const responses = projection.encounters.filter((entry) => entry.wordId === word.wordId && !entry.presentationUndone).flatMap((entry) => entry.effectiveResponses);
    served.push({ key, class: timedItemClass('word', word.initialMode), ...(timed.facts[key] ?? { classicDueAt: null, priorLapse: null }),
      outcome: word.covered ? 'covered' : 'uncovered', accepted: responses.filter((response) => response.payload.outcome === 'accepted').length,
      rejected: responses.filter((response) => response.payload.outcome === 'rejected').length });
  }
  for (const cue of projection.pureCueOutcomes) {
    const key = timedTargetKey('pure_cue', cue.contentId); if (!started.has(key)) continue;
    served.push({ key, class: 'held', ...(timed.facts[key] ?? { classicDueAt: null, priorLapse: null }), outcome: cue.covered ? 'covered' : 'uncovered',
      accepted: cue.acceptedResponses, rejected: cue.rejectedResponses });
  }
  const live = effective(input.actions, projection);
  const sessionActiveMs = Math.max(input.activeDurationMs ?? 0, row.last_active_ms);
  getDb().prepare(`UPDATE vocabulary_timed_session_records SET closed_at=?,session_active_ms=?,day_active_ms=day_active_ms_at_start+?,
    budget_wrapped=?,extensions=?,new_words_started=?,unstarted_pressing_json=?,served_json=? WHERE session_id=?`).run(
    input.now, sessionActiveMs, sessionActiveMs, timedBudgetWrapped(input.actions, projection) ? 1 : 0,
    live.filter((action) => action.kind === 'resume' && action.payload.untilDayActiveMs !== undefined).length,
    Object.values(projection.words).filter((word) => word.admitted && word.initialMode === 'unstudied').length,
    JSON.stringify(timed.pressingKeys.filter((key) => !started.has(key))), JSON.stringify(served), sessionId);
}
function split(key: string): [TimedTargetKind, string] {
  const index = key.indexOf(':'); const kind = key.slice(0, index);
  if (kind !== 'word' && kind !== 'pure_cue') throw new Error(`Invalid timed target key ${key}`);
  return [kind, key.slice(index + 1)];
}
