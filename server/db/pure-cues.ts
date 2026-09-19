import { randomUUID } from 'node:crypto';
import {
  PURE_CUE_INITIAL_EASE_FACTOR,
  PURE_CUE_INITIAL_INTERVAL_HOURS,
  derivePureCueAssessment,
  schedulePureCueAssessment,
  selectPureCuesForSession,
  type PureCue,
  type PureCueAcceptedAnswer,
  type PureCueAssessmentEvent,
  type PureCueAssessmentSummary,
  type PureCueSelection,
  type PureCueServedSnapshot,
} from '../../src/domain/pure-cues.ts';
import { getConfig, getDb } from './connection.ts';
import { requireLearnerId } from './learner-context.ts';

type PureCueRow = {
  id: string;
  stimulus: string;
  axis_note: string;
  interval_hours: number;
  ease_factor: number;
  last_studied_at: string | null;
  next_due_at: string;
  strong_since: string | null;
  strong_successes: number;
  active: number;
};

type ServedSnapshotRow = {
  snapshot_id: string;
  pure_cue_id: string;
  served_at: string;
  stimulus: string;
  axis_note: string;
  accepted_answers_json: string;
  consumed_attempt_id: string | null;
};

type PureCueAttemptRow = {
  attempt_id: string;
  pure_cue_id: string;
  snapshot_id: string;
  session_id: string;
  session_action_id: string;
  committed_at: string;
  events_json: string;
  failure_count: number;
  terminal_rating: 'hard' | 'good' | 'easy' | null;
};

type CompensationSnapshotRow = {
  session_id: string;
  session_action_id: string;
  target_word_id: string;
  captured_at: string;
  production_skill_state_json: string;
  admission_state_json: string;
  compensated_by_invocation_id: string | null;
  compensated_at: string | null;
};

export type ProductionSchedulerStateSnapshot = {
  sessionId: string;
  sessionActionId: string;
  targetWordId: string;
  capturedAt: string;
  sourceAttemptIds: string[];
  productionSkillState: {
    enabled: boolean;
    intervalHours: number;
    lastStudiedAt: string;
    nextDueAt: string | null;
    easeFactor: number;
  } | null;
  admissionState: {
    studyPhase: string;
    earliestNextStudyAt: string | null;
  } | null;
  legacyReviewItemMirror: null;
  compensatedByInvocationId: string | null;
  compensatedAt: string | null;
};

export type RestoreProductionSchedulerSnapshotResult =
  | { kind: 'restored'; snapshot: ProductionSchedulerStateSnapshot }
  | { kind: 'already_restored'; snapshot: ProductionSchedulerStateSnapshot }
  | { kind: 'unavailable'; reason: 'pre_release_snapshot_unavailable' };

export type CreatePureCueInput = {
  id?: string;
  stimulus: string;
  axisNote?: string;
  acceptedWordIds: string[];
  createdAt: string;
};

export type IssuePureCueServedSnapshotInput = {
  snapshotId?: string;
  pureCueId: string;
  servedAt: string;
};

export type RecordPureCueAssessmentInput = {
  attemptId: string;
  snapshotId: string;
  sessionId: string;
  sessionActionId: string;
  events: PureCueAssessmentEvent[];
  committedAt: string;
};

export type PureCueAssessmentRecord = {
  attemptId: string;
  pureCueId: string;
  snapshotId: string;
  sessionId: string;
  sessionActionId: string;
  committedAt: string;
  events: PureCueAssessmentEvent[];
  summary: PureCueAssessmentSummary;
  scheduledCue: PureCue;
};

export function getPureCue(id: string): PureCue | null {
  const learnerId = requireLearnerId();
  assertNonEmpty(id, 'Pure cue id');
  const row = getDb().prepare(`${pureCueSelect()} WHERE learner_id = ? AND id = ?`)
    .get(learnerId, id) as PureCueRow | undefined;
  return row ? mapPureCueRow(row, learnerId) : null;
}

export function getPureCues(): PureCue[] {
  const learnerId = requireLearnerId();
  const rows = getDb().prepare(`${pureCueSelect()} WHERE learner_id = ? ORDER BY created_at, id`)
    .all(learnerId) as PureCueRow[];
  return rows.map((row) => mapPureCueRow(row, learnerId));
}

export function createPureCueWithoutTransaction(input: CreatePureCueInput): PureCue {
  const learnerId = requireLearnerId();
  const id = input.id ?? randomUUID();
  const stimulus = input.stimulus.trim();
  const axisNote = (input.axisNote ?? '').trim();
  assertNonEmpty(id, 'Pure cue id');
  assertNonEmpty(stimulus, 'Pure cue stimulus');
  assertCanonicalIso(input.createdAt, 'Pure cue createdAt');
  const acceptedWordIds = normalizeAcceptedWordIds(input.acceptedWordIds, 2);
  assertVisibleWords(acceptedWordIds);

  getDb().prepare(`
    INSERT INTO pure_cues (
      learner_id, id, stimulus, axis_note, interval_hours, ease_factor,
      last_studied_at, next_due_at, strong_since, strong_successes, active, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL, 0, 1, ?)
  `).run(
    learnerId,
    id,
    stimulus,
    axisNote,
    PURE_CUE_INITIAL_INTERVAL_HOURS,
    PURE_CUE_INITIAL_EASE_FACTOR,
    input.createdAt,
    input.createdAt,
  );
  insertAcceptedWords(learnerId, id, acceptedWordIds, 0);
  return getPureCue(id)!;
}

export function extendPureCueAcceptedWordsWithoutTransaction(input: {
  id: string;
  acceptedWordIds: string[];
}): PureCue {
  const learnerId = requireLearnerId();
  const existing = getPureCue(input.id);
  if (existing === null) throw new Error(`Pure cue ${input.id} does not exist for the current learner.`);
  const requested = normalizeAcceptedWordIds(input.acceptedWordIds, 1);
  assertVisibleWords(requested);
  const existingSet = new Set(existing.acceptedWordIds);
  const additions = requested.filter((wordId) => !existingSet.has(wordId));
  insertAcceptedWords(learnerId, input.id, additions, existing.acceptedWordIds.length);
  return getPureCue(input.id)!;
}

export function isWordProductionProxied(wordId: string): boolean {
  requireLearnerId();
  assertNonEmpty(wordId, 'Word id');
  const row = getDb().prepare(`
    SELECT relevance_state
    FROM word_skill_relevance
    WHERE word_id = ? AND skill_id = 'production'
  `).get(wordId) as { relevance_state: string } | undefined;
  return row?.relevance_state === 'proxied';
}

export function setWordProductionProxiedWithoutTransaction(input: {
  wordId: string;
  proxied: boolean;
  updatedAt: string;
}): 'applied' | 'already_satisfied' | 'preserved_suppressed' {
  requireLearnerId();
  assertNonEmpty(input.wordId, 'Word id');
  assertCanonicalIso(input.updatedAt, 'Production proxy updatedAt');
  assertVisibleWords([input.wordId]);
  const existing = getDb().prepare(`
    SELECT relevance_state FROM word_skill_relevance
    WHERE word_id = ? AND skill_id = 'production'
  `).get(input.wordId) as { relevance_state: string } | undefined;
  if (existing?.relevance_state === 'suppressed') return 'preserved_suppressed';
  const desired = input.proxied ? 'proxied' : 'normal';
  if ((existing?.relevance_state ?? 'normal') === desired) return 'already_satisfied';

  getDb().prepare(`
    INSERT INTO learner_owned_word_skill_relevance (
      word_id, skill_id, relevance_state, updated_at, source_event_id
    ) VALUES (?, 'production', ?, ?, NULL)
    ON CONFLICT(learner_id, word_id, skill_id) DO UPDATE SET
      relevance_state = excluded.relevance_state,
      updated_at = excluded.updated_at,
      source_event_id = NULL
  `).run(input.wordId, desired, input.updatedAt);
  return 'applied';
}

export function selectStoredPureCuesForSession(input: {
  ordinaryReviewCount: number;
  now: string;
  random?: () => number;
}): PureCueSelection {
  return selectPureCuesForSession({ ...input, cues: getPureCues() });
}

export function issuePureCueServedSnapshot(
  input: IssuePureCueServedSnapshotInput,
): PureCueServedSnapshot {
  const learnerId = requireLearnerId();
  assertCanonicalIso(input.servedAt, 'Pure cue servedAt');
  const cue = getPureCue(input.pureCueId);
  if (cue === null || !cue.active) throw new Error(`Active pure cue ${input.pureCueId} is unavailable.`);
  const acceptedAnswers = getAcceptedAnswers(learnerId, cue.id);
  const snapshotId = input.snapshotId ?? randomUUID();
  assertNonEmpty(snapshotId, 'Pure cue snapshot id');
  getDb().prepare(`
    INSERT INTO pure_cue_served_snapshots (
      learner_id, snapshot_id, pure_cue_id, served_at, stimulus, axis_note,
      accepted_answers_json, consumed_attempt_id, consumed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)
  `).run(
    learnerId,
    snapshotId,
    cue.id,
    input.servedAt,
    cue.stimulus,
    cue.axisNote,
    JSON.stringify(acceptedAnswers),
  );
  return getPureCueServedSnapshot(snapshotId)!;
}

export function getPureCueServedSnapshot(snapshotId: string): PureCueServedSnapshot | null {
  const learnerId = requireLearnerId();
  const row = getDb().prepare(`
    SELECT * FROM pure_cue_served_snapshots
    WHERE learner_id = ? AND snapshot_id = ?
  `).get(learnerId, snapshotId) as ServedSnapshotRow | undefined;
  return row ? mapServedSnapshotRow(row) : null;
}

export function recordPureCueAssessment(
  input: RecordPureCueAssessmentInput,
  random: () => number = Math.random,
): PureCueAssessmentRecord {
  if (getDb().isTransaction) return recordPureCueAssessmentWithoutTransaction(input, random);
  getDb().exec('BEGIN IMMEDIATE');
  try {
    const result = recordPureCueAssessmentWithoutTransaction(input, random);
    getDb().exec('COMMIT');
    return result;
  } catch (error) {
    getDb().exec('ROLLBACK');
    throw error;
  }
}

export function recordPureCueAssessmentWithoutTransaction(
  input: RecordPureCueAssessmentInput,
  random: () => number = Math.random,
): PureCueAssessmentRecord {
  const learnerId = requireLearnerId();
  assertNonEmpty(input.attemptId, 'Pure cue attempt id');
  assertNonEmpty(input.sessionId, 'Pure cue session id');
  assertNonEmpty(input.sessionActionId, 'Pure cue session action id');
  assertCanonicalIso(input.committedAt, 'Pure cue committedAt');
  const eventsJson = JSON.stringify(input.events);
  const existing = getDb().prepare(`
    SELECT * FROM pure_cue_attempts
    WHERE learner_id = ? AND session_id = ? AND session_action_id = ?
  `).get(learnerId, input.sessionId, input.sessionActionId) as PureCueAttemptRow | undefined;
  if (existing) {
    if (
      existing.attempt_id !== input.attemptId
      || existing.snapshot_id !== input.snapshotId
      || existing.events_json !== eventsJson
    ) {
      throw new Error('Pure cue session action was already committed with different evidence.');
    }
    return mapAssessmentRecord(existing);
  }

  const snapshotRow = getDb().prepare(`
    SELECT * FROM pure_cue_served_snapshots
    WHERE learner_id = ? AND snapshot_id = ?
  `).get(learnerId, input.snapshotId) as ServedSnapshotRow | undefined;
  if (!snapshotRow) throw new Error(`Pure cue served snapshot ${input.snapshotId} is unavailable.`);
  if (snapshotRow.consumed_attempt_id !== null) {
    throw new Error(`Pure cue served snapshot ${input.snapshotId} has already been consumed.`);
  }
  const snapshot = mapServedSnapshotRow(snapshotRow);
  const summary = derivePureCueAssessment(snapshot, input.events, getConfig().studyProfile);
  const cue = getPureCue(snapshot.pureCueId);
  if (cue === null) throw new Error(`Pure cue ${snapshot.pureCueId} is unavailable.`);
  const scheduledCue = schedulePureCueAssessment(cue, summary, input.committedAt, random);

  getDb().prepare(`
    INSERT INTO pure_cue_attempts (
      learner_id, attempt_id, pure_cue_id, snapshot_id, session_id, session_action_id,
      committed_at, events_json, failure_count, terminal_rating
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    learnerId,
    input.attemptId,
    cue.id,
    input.snapshotId,
    input.sessionId,
    input.sessionActionId,
    input.committedAt,
    eventsJson,
    summary.failureCount,
    summary.terminalRating,
  );
  getDb().prepare(`
    UPDATE pure_cues
    SET interval_hours = ?, ease_factor = ?, last_studied_at = ?, next_due_at = ?,
        strong_since = ?, strong_successes = ?
    WHERE learner_id = ? AND id = ?
  `).run(
    scheduledCue.intervalHours,
    scheduledCue.easeFactor,
    scheduledCue.lastStudiedAt,
    scheduledCue.nextDueAt,
    scheduledCue.strongSince,
    scheduledCue.strongSuccesses,
    learnerId,
    cue.id,
  );
  const consumed = getDb().prepare(`
    UPDATE pure_cue_served_snapshots
    SET consumed_attempt_id = ?, consumed_at = ?
    WHERE learner_id = ? AND snapshot_id = ? AND consumed_attempt_id IS NULL
  `).run(input.attemptId, input.committedAt, learnerId, input.snapshotId);
  if (consumed.changes !== 1) throw new Error('Pure cue served snapshot was concurrently consumed.');
  return mapAssessmentRecord(getDb().prepare(`
    SELECT * FROM pure_cue_attempts WHERE learner_id = ? AND attempt_id = ?
  `).get(learnerId, input.attemptId) as PureCueAttemptRow);
}

/**
 * Capture after every accepted event in the action batch is durable and before
 * projecting its lapse. Any event id discovers and links the complete batch.
 */
export function captureProductionSchedulerSnapshotForAttemptBatchWithoutTransaction(input: {
  sourceAttemptId: string;
  capturedAt: string;
}): ProductionSchedulerStateSnapshot {
  const learnerId = requireLearnerId();
  assertNonEmpty(input.sourceAttemptId, 'Source attempt id');
  assertCanonicalIso(input.capturedAt, 'Scheduler snapshot capturedAt');
  const source = getDb().prepare(`
    SELECT session_id, session_action_id, target_word_id, action_kind
    FROM study_attempt_events WHERE id = ?
  `).get(input.sourceAttemptId) as {
    session_id: string;
    session_action_id: string;
    target_word_id: string;
    action_kind: string;
  } | undefined;
  if (!source) throw new Error(`Source attempt ${input.sourceAttemptId} is unavailable to the current learner.`);
  if (source.action_kind !== 'production') throw new Error('Scheduler compensation requires a production attempt batch.');
  const batch = getDb().prepare(`
    SELECT id, target_word_id, action_kind, rating
    FROM study_attempt_events
    WHERE session_id = ? AND session_action_id = ?
    ORDER BY action_attempt_sequence, session_event_sequence, id
  `).all(source.session_id, source.session_action_id) as Array<{
    id: string;
    target_word_id: string;
    action_kind: string;
    rating: string | null;
  }>;
  if (
    batch.length === 0
    || batch.some((event) => event.action_kind !== 'production' || event.target_word_id !== source.target_word_id)
  ) {
    throw new Error('Scheduler compensation attempt batch is inconsistent.');
  }
  if (!batch.some((event) => event.rating === 'forgot')) {
    throw new Error('Scheduler compensation snapshot requires a lapsed production batch.');
  }

  let existing = getDb().prepare(`
    SELECT * FROM pure_cue_scheduler_compensation_snapshots
    WHERE learner_id = ? AND session_id = ? AND session_action_id = ?
  `).get(learnerId, source.session_id, source.session_action_id) as CompensationSnapshotRow | undefined;
  if (!existing) {
    const production = getDb().prepare(`
      SELECT enabled, interval_hours, last_studied_at, next_due_at, ease_factor
      FROM word_skill_state WHERE word_id = ? AND skill_id = 'production'
    `).get(source.target_word_id) as {
      enabled: number;
      interval_hours: number;
      last_studied_at: string;
      next_due_at: string | null;
      ease_factor: number;
    } | undefined;
    const admission = getDb().prepare(`
      SELECT study_phase, earliest_next_study_at
      FROM word_study_admission_state WHERE word_id = ?
    `).get(source.target_word_id) as {
      study_phase: string;
      earliest_next_study_at: string | null;
    } | undefined;
    const productionSnapshot = production ? {
      enabled: production.enabled !== 0,
      intervalHours: production.interval_hours,
      lastStudiedAt: production.last_studied_at,
      nextDueAt: production.next_due_at,
      easeFactor: production.ease_factor,
    } : null;
    const admissionSnapshot = admission ? {
      studyPhase: admission.study_phase,
      earliestNextStudyAt: admission.earliest_next_study_at,
    } : null;
    getDb().prepare(`
      INSERT INTO pure_cue_scheduler_compensation_snapshots (
        learner_id, session_id, session_action_id, target_word_id, captured_at,
        production_skill_state_json, admission_state_json,
        compensated_by_invocation_id, compensated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)
    `).run(
      learnerId,
      source.session_id,
      source.session_action_id,
      source.target_word_id,
      input.capturedAt,
      JSON.stringify(productionSnapshot),
      JSON.stringify(admissionSnapshot),
    );
    existing = getDb().prepare(`
      SELECT * FROM pure_cue_scheduler_compensation_snapshots
      WHERE learner_id = ? AND session_id = ? AND session_action_id = ?
    `).get(learnerId, source.session_id, source.session_action_id) as CompensationSnapshotRow;
  } else if (existing.target_word_id !== source.target_word_id) {
    throw new Error('Existing scheduler compensation snapshot targets a different word.');
  }

  const insertLink = getDb().prepare(`
    INSERT OR IGNORE INTO pure_cue_scheduler_compensation_snapshot_attempts (
      learner_id, source_attempt_id, session_id, session_action_id
    ) VALUES (?, ?, ?, ?)
  `);
  for (const event of batch) {
    insertLink.run(learnerId, event.id, source.session_id, source.session_action_id);
  }
  return mapCompensationSnapshot(existing, learnerId);
}

export function restoreProductionSchedulerSnapshotWithoutTransaction(input: {
  sourceAttemptId: string;
  compensationInvocationId: string;
  restoredAt: string;
}): RestoreProductionSchedulerSnapshotResult {
  const learnerId = requireLearnerId();
  assertNonEmpty(input.sourceAttemptId, 'Source attempt id');
  assertNonEmpty(input.compensationInvocationId, 'Compensation invocation id');
  assertCanonicalIso(input.restoredAt, 'Scheduler snapshot restoredAt');
  const row = getDb().prepare(`
    SELECT snapshot.*
    FROM pure_cue_scheduler_compensation_snapshot_attempts AS link
    JOIN pure_cue_scheduler_compensation_snapshots AS snapshot
      ON snapshot.learner_id = link.learner_id
     AND snapshot.session_id = link.session_id
     AND snapshot.session_action_id = link.session_action_id
    WHERE link.learner_id = ? AND link.source_attempt_id = ?
  `).get(learnerId, input.sourceAttemptId) as CompensationSnapshotRow | undefined;
  if (!row) return { kind: 'unavailable', reason: 'pre_release_snapshot_unavailable' };
  if (row.compensated_by_invocation_id !== null) {
    return { kind: 'already_restored', snapshot: mapCompensationSnapshot(row, learnerId) };
  }
  const invocation = getDb().prepare(`
    SELECT invocation_id FROM reflection_operation_invocations WHERE invocation_id = ?
  `).get(input.compensationInvocationId) as { invocation_id: string } | undefined;
  if (!invocation) throw new Error(`Compensation invocation ${input.compensationInvocationId} is unavailable to the current learner.`);

  const snapshot = mapCompensationSnapshot(row, learnerId);
  if (snapshot.productionSkillState === null) {
    getDb().prepare(`
      DELETE FROM learner_owned_word_skill_state
      WHERE learner_id = ? AND word_id = ? AND skill_id = 'production'
    `).run(learnerId, snapshot.targetWordId);
  } else {
    const state = snapshot.productionSkillState;
    getDb().prepare(`
      INSERT INTO learner_owned_word_skill_state (
        learner_id, word_id, skill_id, enabled, interval_hours,
        last_studied_at, next_due_at, ease_factor
      ) VALUES (?, ?, 'production', ?, ?, ?, ?, ?)
      ON CONFLICT(learner_id, word_id, skill_id) DO UPDATE SET
        enabled = excluded.enabled,
        interval_hours = excluded.interval_hours,
        last_studied_at = excluded.last_studied_at,
        next_due_at = excluded.next_due_at,
        ease_factor = excluded.ease_factor
    `).run(
      learnerId,
      snapshot.targetWordId,
      state.enabled ? 1 : 0,
      state.intervalHours,
      state.lastStudiedAt,
      state.nextDueAt,
      state.easeFactor,
    );
  }
  if (snapshot.admissionState === null) {
    getDb().prepare(`
      DELETE FROM learner_owned_word_study_admission_state
      WHERE learner_id = ? AND word_id = ?
    `).run(learnerId, snapshot.targetWordId);
  } else {
    getDb().prepare(`
      INSERT INTO learner_owned_word_study_admission_state (
        learner_id, word_id, study_phase, earliest_next_study_at
      ) VALUES (?, ?, ?, ?)
      ON CONFLICT(learner_id, word_id) DO UPDATE SET
        study_phase = excluded.study_phase,
        earliest_next_study_at = excluded.earliest_next_study_at
    `).run(
      learnerId,
      snapshot.targetWordId,
      snapshot.admissionState.studyPhase,
      snapshot.admissionState.earliestNextStudyAt,
    );
  }
  const updated = getDb().prepare(`
    UPDATE pure_cue_scheduler_compensation_snapshots
    SET compensated_by_invocation_id = ?, compensated_at = ?
    WHERE learner_id = ? AND session_id = ? AND session_action_id = ?
      AND compensated_by_invocation_id IS NULL
  `).run(
    input.compensationInvocationId,
    input.restoredAt,
    learnerId,
    snapshot.sessionId,
    snapshot.sessionActionId,
  );
  if (updated.changes !== 1) throw new Error('Scheduler compensation snapshot was concurrently restored.');
  const restored = getDb().prepare(`
    SELECT * FROM pure_cue_scheduler_compensation_snapshots
    WHERE learner_id = ? AND session_id = ? AND session_action_id = ?
  `).get(learnerId, snapshot.sessionId, snapshot.sessionActionId) as CompensationSnapshotRow;
  return { kind: 'restored', snapshot: mapCompensationSnapshot(restored, learnerId) };
}

function mapAssessmentRecord(row: PureCueAttemptRow): PureCueAssessmentRecord {
  const events = JSON.parse(row.events_json) as PureCueAssessmentEvent[];
  return {
    attemptId: row.attempt_id,
    pureCueId: row.pure_cue_id,
    snapshotId: row.snapshot_id,
    sessionId: row.session_id,
    sessionActionId: row.session_action_id,
    committedAt: row.committed_at,
    events,
    summary: { failureCount: row.failure_count, terminalRating: row.terminal_rating },
    scheduledCue: getPureCue(row.pure_cue_id)!,
  };
}

function mapCompensationSnapshot(
  row: CompensationSnapshotRow,
  learnerId: string,
): ProductionSchedulerStateSnapshot {
  const sourceAttemptIds = (getDb().prepare(`
    SELECT source_attempt_id
    FROM pure_cue_scheduler_compensation_snapshot_attempts
    WHERE learner_id = ? AND session_id = ? AND session_action_id = ?
    ORDER BY source_attempt_id
  `).all(learnerId, row.session_id, row.session_action_id) as Array<{ source_attempt_id: string }>)
    .map((link) => link.source_attempt_id);
  return {
    sessionId: row.session_id,
    sessionActionId: row.session_action_id,
    targetWordId: row.target_word_id,
    capturedAt: row.captured_at,
    sourceAttemptIds,
    productionSkillState: JSON.parse(row.production_skill_state_json),
    admissionState: JSON.parse(row.admission_state_json),
    legacyReviewItemMirror: null,
    compensatedByInvocationId: row.compensated_by_invocation_id,
    compensatedAt: row.compensated_at,
  };
}

function pureCueSelect(): string {
  return `SELECT id, stimulus, axis_note, interval_hours, ease_factor, last_studied_at,
    next_due_at, strong_since, strong_successes, active FROM pure_cues`;
}

function mapPureCueRow(row: PureCueRow, learnerId: string): PureCue {
  const acceptedWordIds = (getDb().prepare(`
    SELECT word_id FROM pure_cue_accepted_words
    WHERE learner_id = ? AND pure_cue_id = ? ORDER BY position, word_id
  `).all(learnerId, row.id) as Array<{ word_id: string }>).map((item) => item.word_id);
  return {
    id: row.id,
    stimulus: row.stimulus,
    axisNote: row.axis_note,
    acceptedWordIds,
    intervalHours: row.interval_hours,
    easeFactor: row.ease_factor,
    lastStudiedAt: row.last_studied_at,
    nextDueAt: row.next_due_at,
    strongSince: row.strong_since,
    strongSuccesses: row.strong_successes,
    active: row.active === 1,
  };
}

function getAcceptedAnswers(learnerId: string, cueId: string): PureCueAcceptedAnswer[] {
  return getDb().prepare(`
    SELECT membership.word_id, words.hanzi, words.traditional
    FROM pure_cue_accepted_words AS membership
    JOIN lexical_words AS words ON words.id = membership.word_id
    WHERE membership.learner_id = ? AND membership.pure_cue_id = ?
    ORDER BY membership.position, membership.word_id
  `).all(learnerId, cueId).map((row: unknown) => {
    const answer = row as { word_id: string; hanzi: string; traditional: string | null };
    return { wordId: answer.word_id, hanzi: answer.hanzi, traditional: answer.traditional };
  });
}

function mapServedSnapshotRow(row: ServedSnapshotRow): PureCueServedSnapshot {
  return {
    snapshotId: row.snapshot_id,
    pureCueId: row.pure_cue_id,
    servedAt: row.served_at,
    stimulus: row.stimulus,
    axisNote: row.axis_note,
    acceptedAnswers: JSON.parse(row.accepted_answers_json) as PureCueAcceptedAnswer[],
  };
}

function insertAcceptedWords(
  learnerId: string,
  cueId: string,
  wordIds: readonly string[],
  positionOffset: number,
): void {
  const insert = getDb().prepare(`
    INSERT INTO pure_cue_accepted_words (learner_id, pure_cue_id, word_id, position)
    VALUES (?, ?, ?, ?)
  `);
  wordIds.forEach((wordId, index) => insert.run(learnerId, cueId, wordId, positionOffset + index));
}

function normalizeAcceptedWordIds(wordIds: readonly string[], minimum: number): string[] {
  if (!Array.isArray(wordIds)) throw new Error('Pure cue acceptedWordIds must be an array.');
  const normalized = wordIds.map((wordId) => wordId.trim());
  if (normalized.some((wordId) => wordId.length === 0)) {
    throw new Error('Pure cue accepted word ids must be non-empty.');
  }
  if (new Set(normalized).size !== normalized.length) {
    throw new Error('Pure cue accepted word ids must be unique.');
  }
  if (normalized.length < minimum) {
    throw new Error(`Pure cue requires at least ${minimum} accepted word${minimum === 1 ? '' : 's'}.`);
  }
  return normalized;
}

function assertVisibleWords(wordIds: readonly string[]): void {
  const placeholders = wordIds.map(() => '?').join(', ');
  const visible = getDb().prepare(`SELECT id FROM words WHERE id IN (${placeholders})`)
    .all(...wordIds) as Array<{ id: string }>;
  const visibleIds = new Set(visible.map((word) => word.id));
  const missing = wordIds.filter((wordId) => !visibleIds.has(wordId));
  if (missing.length > 0) throw new Error(`Unknown or invisible accepted word: ${missing.join(', ')}.`);
}

function assertNonEmpty(value: string, label: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label} must be non-empty.`);
}

function assertCanonicalIso(value: string, label: string): void {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    throw new Error(`${label} must be a canonical ISO timestamp.`);
  }
}
