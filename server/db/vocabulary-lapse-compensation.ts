import { randomUUID } from 'node:crypto';
import { VOCABULARY_COMPENSATION_POLICY, type VocabularyReflectionCase } from '../../src/domain/vocabulary-reflection.ts';
import { isLearnerPronunciationRejection, type VocabularySessionProjection } from '../../src/domain/vocabulary-session.ts';
import { getDb } from './connection.ts';
import { emitBackendEvent } from './vocabulary-content.ts';
import { isActiveVocabularyRefreshRequest, type VocabularySchedulerState } from './vocabulary-learners.ts';

type SchedulerState = VocabularySchedulerState & { strongSince?: string | null; strongSuccesses?: number };
type ScheduleRow = {
  next_eligible_at: string | null; last_practised_at: string | null; scheduler_state_json: string;
  refresh_requested_at?: string | null; refresh_until?: string | null;
};
type Snapshot = {
  scheduler: SchedulerState; lastPractisedAt: string | null;
  nextEligibleAt: string | null;
  refreshRequestedAt: string | null; refreshUntil: string | null;
};

function isTimestampOrNull(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value);
}

function parseSnapshotObject(json: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(json);
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function readSnapshot(json: string, pure: boolean): Snapshot | null {
  // Completion receipts preserve the word DTO and the pure cue SQL row respectively.
  const raw = parseSnapshotObject(json);
  if (!raw) return null;
  const scheduler = pure
    ? typeof raw.scheduler_state_json === 'string' ? parseSnapshotObject(raw.scheduler_state_json) as SchedulerState | null : null
    : raw.schedulerState as SchedulerState | null | undefined;
  const lastPractisedAt = pure ? raw.last_practised_at : raw.lastPractisedAt;
  const nextEligibleAt = pure ? raw.next_eligible_at : raw.nextEligibleAt;
  const refreshRequestedAt = pure ? null : raw.refreshRequestedAt;
  const refreshUntil = pure ? null : raw.refreshUntil;
  if (!scheduler || !Number.isFinite(scheduler.intervalHours) || scheduler.intervalHours <= 0
    || !Number.isFinite(scheduler.easeFactor) || scheduler.easeFactor <= 0
    || !isTimestampOrNull(lastPractisedAt) || !isTimestampOrNull(nextEligibleAt)
    || !isTimestampOrNull(refreshRequestedAt) || !isTimestampOrNull(refreshUntil)
    || !isTimestampOrNull(scheduler.resetUntil ?? null)
    || (scheduler.cleanCoveredSessions !== undefined
      && (!Number.isSafeInteger(scheduler.cleanCoveredSessions) || scheduler.cleanCoveredSessions < 0))) return null;
  if (pure && (!isTimestampOrNull(scheduler.strongSince ?? null)
    || !Number.isSafeInteger(scheduler.strongSuccesses ?? 0) || (scheduler.strongSuccesses ?? 0) < 0)) return null;
  return { scheduler, lastPractisedAt, nextEligibleAt, refreshRequestedAt, refreshUntil };
}

/** Called in the transaction that records and completes the learner's feedback judgment. */
export function compensateUnfairVocabularyLapse(
  evidence: VocabularyReflectionCase, judgmentId: string, unfairEncounterIds: readonly string[], at: string,
): void {
  const unfair = new Set(unfairEncounterIds);
  if ([...unfair].some(id => !evidence.evidence.some(encounter => encounter.encounterId === id))) {
    throw new Error('Unfair judgment references unknown encounter');
  }
  const { completionId, learnerId, wordId, contentId } = evidence;
  const pure = wordId === null;
  const subject = wordId ?? contentId;
  if (subject === null) throw new Error('Feedback compensation requires a subject');
  const effectiveRejected = evidence.evidence.filter(encounter =>
    encounter.snapshot.role === 'general' && encounter.snapshot.kind === 'production'
    && (pure ? encounter.snapshot.schedulingScope === 'pure_cue' : encounter.snapshot.schedulingScope !== 'pure_cue')
    && (pure ? encounter.snapshot.contentId === subject : encounter.wordId === subject)
    && encounter.effectiveResponses.some(response => response.payload.outcome === 'rejected'));
  if (!effectiveRejected.length || effectiveRejected.some(encounter => !unfair.has(encounter.encounterId)
    || encounter.effectiveResponses.some(response => isLearnerPronunciationRejection(
      encounter.snapshot.kind, response.payload, encounter.snapshot.assessment?.acceptedAnswers ?? [],
    )))) return;

  const db = getDb();
  const subjectKey = `${completionId}/${pure ? 'pure' : 'word'}/${subject}`;
  const policy = VOCABULARY_COMPENSATION_POLICY.version;
  const key = `${policy}/${subjectKey}`;
  if (db.prepare('SELECT 1 FROM learner_state_effects WHERE effect_key IN (?,?)')
    .get(key, `vocabulary-unfair-feedback.v1/${subjectKey}`)) return;
  const completion = db.prepare(`SELECT report_json FROM vocabulary_session_completions
    WHERE completion_id=? AND learner_id=? AND status='closed'`).get(completionId, learnerId) as { report_json: string } | undefined;
  if (!completion) throw new Error('Feedback compensation requires its original closed completion');
  const report = JSON.parse(completion.report_json) as VocabularySessionProjection;
  const coverage = pure ? report.pureCueOutcomes?.find(cue => cue.contentId === subject)?.covered : report.words?.[subject]?.covered;
  if (coverage === false) return;

  const table = pure ? 'learner_pure_cue_schedules' : 'learner_word_schedules';
  const column = pure ? 'content_id' : 'word_id';
  const readSchedule = db.prepare(`SELECT * FROM ${table} WHERE learner_id=? AND ${column}=?`);
  const current = readSchedule.get(learnerId, subject) as ScheduleRow | undefined;
  const receipt = db.prepare(`SELECT effect_key,before_json,after_json FROM learner_state_effects
    WHERE effect_key=? AND completion_id=? AND learner_id=? AND kind=? AND word_id IS ? AND pure_cue_content_id IS ?`)
    .get(`${completionId}/${pure ? 'pure_cue' : 'production'}/${subject}`, completionId, learnerId,
      pure ? 'pure_cue_schedule_applied' : 'production_schedule_applied', wordId, pure ? subject : null) as
    { effect_key: string; before_json: string; after_json: string } | undefined;
  const prior = receipt ? readSnapshot(receipt.before_json, pure) : null;
  const lapsed = receipt ? readSnapshot(receipt.after_json, pure) : null;

  let reason: string | null = null;
  if (!current) reason = 'missing_current_schedule';
  else if (coverage !== true) reason = 'missing_completion_coverage';
  else if (!receipt) reason = 'missing_lapse_receipt';
  else if (!prior || !lapsed) reason = 'missing_or_invalid_schedule_snapshot';

  if (current && prior && lapsed && reason === null) {
    const state = JSON.parse(current.scheduler_state_json) as SchedulerState;
    const breakUntil = new Date(Date.parse(at) + VOCABULARY_COMPENSATION_POLICY.breakMs).toISOString();
    const strongSince = prior.scheduler.strongSince ?? null;
    const dueAt = [breakUntil, state.resetUntil ?? '', prior.scheduler.resetUntil ?? ''].sort().at(-1)!;
    const adjusted = { ...state, intervalHours: prior.scheduler.intervalHours, easeFactor: prior.scheduler.easeFactor,
      cleanCoveredSessions: prior.scheduler.cleanCoveredSessions ?? 0, resetUntil: dueAt, postCompensationEarliestCheckAt: dueAt };
    if (pure) {
      db.prepare(`UPDATE learner_pure_cue_schedules SET next_eligible_at=?,last_practised_at=?,scheduler_state_json=?,state_version=state_version+1
        WHERE learner_id=? AND content_id=?`).run(dueAt, prior.lastPractisedAt,
          JSON.stringify({ ...adjusted, strongSince, strongSuccesses: prior.scheduler.strongSuccesses ?? 0 }), learnerId, subject);
    } else {
      const nextEligibleAt = [dueAt, current.next_eligible_at ?? '', prior.nextEligibleAt ?? ''].sort().at(-1)!;
      // Roll back a refresh created by this lapse only while it is still the current
      // refresh and the learner has not made an explicit request for that window.
      const restoreRefresh = prior.refreshUntil !== lapsed.refreshUntil
        && current.refresh_until === lapsed.refreshUntil && current.refresh_requested_at === lapsed.refreshRequestedAt
        && !isActiveVocabularyRefreshRequest(learnerId, subject, current.refresh_until ?? null, at);
      db.prepare(`UPDATE learner_word_schedules SET next_eligible_at=?,last_practised_at=?,scheduler_state_json=?,refresh_requested_at=?,refresh_until=?,
        state_version=state_version+1 WHERE learner_id=? AND word_id=?`).run(nextEligibleAt, prior.lastPractisedAt, JSON.stringify(adjusted),
          restoreRefresh ? prior.refreshRequestedAt : current.refresh_requested_at ?? null,
          restoreRefresh ? prior.refreshUntil : current.refresh_until ?? null, learnerId, subject);
    }
  }

  const after = reason === null ? readSchedule.get(learnerId, subject) : current;
  const outcome = reason === null ? 'applied' : 'unavailable';
  db.prepare(`INSERT INTO learner_state_effects(effect_id,learner_id,word_id,pure_cue_content_id,completion_id,judgment_id,
    effect_key,kind,before_json,after_json,applied_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(), learnerId, wordId,
      pure ? subject : null, completionId, judgmentId, key, 'unfair_feedback_compensation', JSON.stringify(current ?? null),
      JSON.stringify({ schedule: after ?? null, outcome, reason, policy, lapseEffectKey: receipt?.effect_key ?? null }), at);
  emitBackendEvent({ name: `vocabulary.reflection.compensation_${outcome}`, entityKind: 'reflection', entityId: judgmentId,
    learnerId, occurredAt: at, data: { effectKey: key, reason } });
}
