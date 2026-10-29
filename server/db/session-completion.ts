import { createHash } from 'node:crypto';
import type { DeferredSessionCommit } from '../../src/features/session/session-commit.ts';
import { SESSION_COMPLETION_UNDO_MS, type SessionCompletion, type StageSessionCompletionRequest } from '../../src/domain/session-completion.ts';
import { validateDebriefInventory } from '../../src/domain/session-debrief.ts';
import { parseSessionReflectionEvidenceSupplement, parseSessionReflectionEvidenceSupplementV2 } from '../../src/domain/reflection-evidence.ts';
import { getDb } from './connection.ts';
import { requireLearnerId, runWithLearnerId } from './learner-context.ts';
import { getHostedServiceControls } from './hosted-operations.ts';
import { getSessionWordReport } from './session-word-outcomes.ts';
import { completeLearningWordSession, completeUnstudiedWordSession, recordAcceptedReviewAttemptBatch,
  recordAcceptedContrastSelectionAttempt, recordReviewSessionSummary } from './persistence.ts';
import { recordPureCueAssessment } from './pure-cues.ts';

export class SessionCompletionInputError extends Error {}
export class SessionCompletionConflictError extends Error {}
export class SessionCompletionNotFoundError extends Error {}
type CompletionRow = { learner_id: string; session_id: string; revision_id: string; staged_at: string; close_at: string;
  input_json: string; report_json: string; status: SessionCompletion['status']; closed_at: string | null; last_error: string | null };
function row(sessionId: string, revisionId?: string): CompletionRow | undefined {
  return getDb().prepare(`SELECT * FROM learner_session_completions WHERE learner_id = ? AND session_id = ?
    ${revisionId === undefined ? 'ORDER BY staged_at DESC, rowid DESC LIMIT 1' : 'AND revision_id = ?'}`)
    .get(...(revisionId === undefined ? [requireLearnerId(), sessionId] : [requireLearnerId(), sessionId, revisionId])) as CompletionRow | undefined;
}
function dto(value: CompletionRow, now: string): SessionCompletion {
  const input = JSON.parse(value.input_json) as StageSessionCompletionRequest;
  return { sessionId: value.session_id, revisionId: value.revision_id, status: value.status,
    closeAt: value.close_at, serverNow: now, completedAt: input.summary.completedAt,
    canUndo: (value.status === 'pending' || value.status === 'failed') && now < value.close_at && input.pendingCommit !== null,
    report: JSON.parse(value.report_json) as SessionCompletion['report'], error: value.last_error };
}
function canonicalTimestamp(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value)
    throw new SessionCompletionInputError(`Expected canonical ISO ${label}`);
}
function nonempty(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new SessionCompletionInputError(`Expected non-empty ${label}`);
}
function validateInput(value: unknown): asserts value is StageSessionCompletionRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new SessionCompletionInputError('Expected completion input');
  const input = value as StageSessionCompletionRequest;
  nonempty(input.revisionId, 'completion revision id'); canonicalTimestamp(input.startedAt, 'startedAt');
  if (typeof input.studyDayKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.studyDayKey)
    || new Date(`${input.studyDayKey}T00:00:00.000Z`).toISOString().slice(0, 10) !== input.studyDayKey)
    throw new SessionCompletionInputError('Expected UTC studyDayKey');
  if (!input.summary || typeof input.summary !== 'object') throw new SessionCompletionInputError('Expected completion summary');
  canonicalTimestamp(input.summary.completedAt, 'completedAt');
  if (input.summary.completedAt < input.startedAt) throw new SessionCompletionInputError('Completion precedes session start');
  for (const key of ['completedReviewActionCount', 'failedReviewActionCount', 'activeDurationMs'] as const) {
    if (!Number.isInteger(input.summary[key]) || input.summary[key] < 0) throw new SessionCompletionInputError(`Expected non-negative integer ${key}`);
  }
  if (input.summary.failedReviewActionCount > input.summary.completedReviewActionCount) throw new SessionCompletionInputError('Failed count exceeds completed count');
  if (input.summary.completedLearningWordCount !== undefined && (!Number.isInteger(input.summary.completedLearningWordCount)
    || input.summary.completedLearningWordCount < 0)) throw new SessionCompletionInputError('Expected non-negative learning count');
  if (input.summary.debriefInventory !== undefined) validateDebriefInventory(input.summary.debriefInventory);
  if (input.pendingCommit !== null && (typeof input.pendingCommit !== 'object' || input.pendingCommit === undefined))
    throw new SessionCompletionInputError('Expected pending commit or null');
  if (input.reflectionEvidence === undefined) throw new SessionCompletionInputError('Expected reflection evidence or null');
  if (input.reflectionEvidence !== null) {
    const evidence = input.reflectionEvidence as { schemaVersion?: unknown };
    if (evidence.schemaVersion === 'session_reflection_evidence_supplement.v2') parseSessionReflectionEvidenceSupplementV2(input.reflectionEvidence);
    else parseSessionReflectionEvidenceSupplement(input.reflectionEvidence);
  }
}
function applyFinalCommit(sessionId: string, commit: DeferredSessionCommit | null, studyDayKey: string, now: string): void {
  if (!commit) return;
  switch (commit.type) {
    case 'commit-review-action-session':
      if (commit.sessionId !== sessionId) throw new SessionCompletionInputError('Final commit belongs to another session');
      recordAcceptedReviewAttemptBatch({ sessionId, events: commit.events, commitIntent: commit }); break;
    case 'commit-contrast-selection-action-session':
      if (commit.sessionId !== sessionId) throw new SessionCompletionInputError('Final commit belongs to another session');
      recordAcceptedContrastSelectionAttempt({ sessionId, event: commit.event, commitIntent: commit }); break;
    case 'commit-pure-cue-production-session':
      if (commit.sessionId !== sessionId) throw new SessionCompletionInputError('Final commit belongs to another session');
      recordPureCueAssessment({ ...commit, sessionId, committedAt: now }); break;
    case 'commit-learning-word-session':
      nonempty(commit.wordId, 'final learning word id');
      if (typeof commit.success !== 'boolean') throw new SessionCompletionInputError('Expected boolean learning success');
      completeLearningWordSession(commit.wordId, commit.success, sessionId, studyDayKey, true); break;
    case 'commit-unstudied-word-session':
      nonempty(commit.wordId, 'final new word id'); completeUnstudiedWordSession(commit.wordId, studyDayKey, sessionId, true); break;
    default: throw new SessionCompletionInputError('Unsupported pending session commit');
  }
}
export function stageSessionCompletion(sessionId: string, value: unknown, now = new Date().toISOString()): SessionCompletion {
  nonempty(sessionId, 'session id'); canonicalTimestamp(now, 'server timestamp');
  try { validateInput(value); } catch (error) { throw new SessionCompletionInputError(error instanceof Error ? error.message : 'Invalid completion input'); }
  const inputJson = JSON.stringify(value);
  const previous = row(sessionId, value.revisionId);
  if (previous) {
    if (createHash('sha256').update(previous.input_json).digest('hex') !== createHash('sha256').update(inputJson).digest('hex'))
      throw new SessionCompletionConflictError('Completion revision already has different input');
    return dto(previous, now);
  }
  if (getDb().prepare('SELECT 1 FROM learner_session_completions WHERE learner_id = ? AND session_id = ? AND status = ?')
    .get(requireLearnerId(), sessionId, 'closed')) throw new SessionCompletionConflictError('Session is already closed');
  if (getDb().prepare("SELECT 1 FROM learner_session_completions WHERE learner_id = ? AND status IN ('pending','failed')")
    .get(requireLearnerId())) throw new SessionCompletionConflictError('Another completion is pending');
  if (getDb().prepare('SELECT 1 FROM review_session_summaries WHERE session_id = ?').get(sessionId))
    throw new SessionCompletionConflictError('Session already has a completed summary');
  const closeAt = new Date(Date.parse(now) + SESSION_COMPLETION_UNDO_MS).toISOString();
  getDb().exec('BEGIN IMMEDIATE');
  try {
    // Exercise the same persistence contracts without advancing progress during the Undo window.
    getDb().exec('SAVEPOINT completion_preview');
    let report: SessionCompletion['report'];
    try {
      applyFinalCommit(sessionId, value.pendingCommit, value.studyDayKey, now);
      report = getSessionWordReport(sessionId);
    } catch (error) {
      if (error instanceof Error && (error.message.startsWith('Expected ') || error.message.startsWith('Invalid ')
        || error.message.startsWith('Accepted ') || error.message.startsWith('Review attempt') || error.message.startsWith('Pure cue ')
        || error.message.startsWith('Study attempt') || error.message === 'Word not found')) throw new SessionCompletionInputError(error.message);
      throw error;
    } finally { getDb().exec('ROLLBACK TO completion_preview'); getDb().exec('RELEASE completion_preview'); }
    getDb().prepare(`INSERT INTO learner_session_completions
      (learner_id, session_id, revision_id, staged_at, close_at, input_json, report_json, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`)
      .run(requireLearnerId(), sessionId, value.revisionId, now, closeAt, inputJson, JSON.stringify(report));
    getDb().exec('COMMIT');
  } catch (error) { getDb().exec('ROLLBACK'); throw error; }
  return dto(row(sessionId, value.revisionId)!, now);
}
export function closeSessionCompletion(sessionId: string, revisionId: string, now = new Date().toISOString()): SessionCompletion {
  nonempty(revisionId, 'completion revision id'); canonicalTimestamp(now, 'server timestamp');
  const existing = row(sessionId, revisionId);
  if (!existing) throw new SessionCompletionNotFoundError('Session completion not found');
  if (existing.status === 'closed') return dto(existing, now);
  if (existing.status === 'cancelled') throw new SessionCompletionConflictError('Completion was cancelled');
  const input = JSON.parse(existing.input_json) as StageSessionCompletionRequest;
  getDb().exec('BEGIN IMMEDIATE');
  try {
    applyFinalCommit(sessionId, input.pendingCommit, input.studyDayKey, now);
    recordReviewSessionSummary({ sessionId,
      completedAt: input.summary.completedAt,
      completedReviewActionCount: input.summary.completedReviewActionCount,
      failedReviewActionCount: input.summary.failedReviewActionCount,
      activeDurationMs: input.summary.activeDurationMs,
      completedLearningWordCount: input.summary.completedLearningWordCount,
      debriefInventory: input.summary.debriefInventory,
    });
    getDb().prepare(`INSERT INTO learner_owned_study_sessions (id, started_at, ended_at, processing_state, processed_at)
      VALUES (?, ?, ?, 'open', NULL) ON CONFLICT(learner_id, id) DO UPDATE SET ended_at = excluded.ended_at`)
      .run(sessionId, input.startedAt, input.summary.completedAt);
    const report = getSessionWordReport(sessionId);
    getDb().prepare(`UPDATE learner_session_completions SET status = 'closed', closed_at = ?, report_json = ?, last_error = NULL
      WHERE learner_id = ? AND session_id = ? AND revision_id = ?`).run(now, JSON.stringify(report), requireLearnerId(), sessionId, revisionId);
    if (input.reflectionEvidence !== null) {
      getDb().prepare(`INSERT INTO learner_session_reflection_dispatches
        (learner_id, session_id, revision_id, evidence_json, status) VALUES (?, ?, ?, ?, 'queued')
        ON CONFLICT(learner_id, session_id) DO NOTHING`).run(requireLearnerId(), sessionId, revisionId, JSON.stringify(input.reflectionEvidence));
    }
    getDb().exec('COMMIT');
  } catch (error) {
    getDb().exec('ROLLBACK');
    getDb().prepare(`UPDATE learner_session_completions SET status = 'failed', last_error = ?
      WHERE learner_id = ? AND session_id = ? AND revision_id = ?`)
      .run('Session could not be saved. Retry closing the session.', requireLearnerId(), sessionId, revisionId);
    throw error;
  }
  return dto(row(sessionId, revisionId)!, now);
}
export function undoSessionCompletion(sessionId: string, revisionId: string, now = new Date().toISOString()): SessionCompletion {
  nonempty(revisionId, 'completion revision id'); canonicalTimestamp(now, 'server timestamp');
  const existing = row(sessionId, revisionId);
  if (!existing) throw new SessionCompletionNotFoundError('Session completion not found');
  if (existing.status === 'cancelled') return dto(existing, now);
  if (existing.status === 'closed' || now >= existing.close_at) {
    if (existing.status !== 'closed') closeSessionCompletion(sessionId, revisionId, now);
    throw new SessionCompletionConflictError('Undo window has closed');
  }
  const input = JSON.parse(existing.input_json) as StageSessionCompletionRequest;
  if (input.pendingCommit === null) throw new SessionCompletionConflictError('No undoable final action remains');
  getDb().prepare(`UPDATE learner_session_completions SET status = 'cancelled', last_error = NULL
    WHERE learner_id = ? AND session_id = ? AND revision_id = ? AND status IN ('pending','failed')`)
    .run(requireLearnerId(), sessionId, revisionId);
  return dto(row(sessionId, revisionId)!, now);
}
export function getSessionCompletion(sessionId: string, now = new Date().toISOString()): SessionCompletion | null {
  const existing = row(sessionId);
  if (!existing) return null;
  if (existing.status === 'pending' && now >= existing.close_at && !getHostedServiceControls().maintenanceMode) {
    try { return closeSessionCompletion(sessionId, existing.revision_id, now); } catch { return dto(row(sessionId, existing.revision_id)!, now); }
  }
  return dto(existing, now);
}
export function getCurrentSessionCompletion(now = new Date().toISOString()): SessionCompletion | null {
  const current = getDb().prepare(`SELECT session_id FROM learner_session_completions WHERE learner_id = ?
    AND status IN ('pending','failed') ORDER BY staged_at DESC, rowid DESC LIMIT 1`).get(requireLearnerId()) as { session_id: string } | undefined;
  return current ? getSessionCompletion(current.session_id, now) : null;
}
export function closeDueSessionCompletions(now = new Date().toISOString()): number {
  const due = getDb().prepare(`SELECT learner_id, session_id, revision_id FROM learner_session_completions
    WHERE status = 'pending' AND close_at <= ? ORDER BY close_at`).all(now) as Array<{ learner_id: string; session_id: string; revision_id: string }>;
  let closed = 0;
  for (const value of due) runWithLearnerId(value.learner_id, () => {
    try { closeSessionCompletion(value.session_id, value.revision_id, now); closed++; } catch { /* Persisted failure requires explicit retry. */ }
  });
  return closed;
}
