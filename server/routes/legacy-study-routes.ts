import { prepareSessionPayload } from '../word-content/session-preparation.ts';
import { getSessionPayload, recordAcceptedReviewAttemptBatch, type ReviewAttemptCommitIntent, recordAcceptedContrastSelectionAttempt, recordPureCueAssessment, recordStudyManagementAction, getSharedContentPublicationForContent, reportSharedContentPublication, suppressProductionForWordOutsideSession, getSessionRecoveryHighlights, recordReviewSessionSummary, completeLearningWordSession, completeUnstudiedWordSession, dismissWordFromStudy, requireLearnerId } from '../db.ts';
import type { StudyAttemptEvent, ContrastSelectionCommitIntent, StudySkillId, StudyContentRef } from '../../src/domain/study-actions.ts';
import type { PureCueAssessmentEvent } from '../../src/domain/pure-cues.ts';
import type { Response, Request, Express } from 'express';
import { SessionCompletionInputError, SessionCompletionConflictError, SessionCompletionNotFoundError, getCurrentSessionCompletion, getSessionCompletion, stageSessionCompletion, undoSessionCompletion, closeSessionCompletion } from '../db/session-completion.ts';
import { validateDebriefInventory } from '../../src/domain/session-debrief.ts';
import { getSessionDebrief } from '../db/session-debrief.ts';
import { SessionWordOutcomeConflictError } from '../db/session-word-outcomes.ts';
import { type StudyCommitDiagnosticSink, type StudyCommitRoute, describeStudyCommitFailure, describeStudyCommitSuccess } from '../study-commit-diagnostics.ts';
import type { ReflectionLifecycleLogger } from '../reflection/lifecycle-log.ts';
import { readStudyDayKeyFromQuery, normalizeStudyDayKey } from './request-helpers.ts';
import type { CreateAppOptions } from '../index.ts';

/** Retired Mandarin study model: session payload, attempt commits, management actions, completion, summaries, and word lifecycle. The Mandarin cutover fence rejects these writes; the French legacy app still uses them. */
export function registerLegacyStudyRoutes(app: Express, { options, studyCommitDiagnosticSink, reflectionLifecycleLogger }: { options: Pick<CreateAppOptions, 'canPrepareWords' | 'wakeSessionCompletions' | 'wakeSessionDebriefs' | 'wakeWordPreparation'>; studyCommitDiagnosticSink: StudyCommitDiagnosticSink; reflectionLifecycleLogger: ReflectionLifecycleLogger }): void {
  app.post('/api/session-payload', async (req, res) => {
    const studyDayKey = readStudyDayKeyFromQuery(req.body?.studyDayKey);
    if (!studyDayKey || Object.keys(req.body ?? {}).some((key) => key !== 'studyDayKey')) {
      res.status(400).json({ error: 'Expected YYYY-MM-DD studyDayKey' });
      return;
    }
    try {
      res.json(await prepareSessionPayload(studyDayKey, {
        wake: options.wakeWordPreparation ?? (() => {}),
        budgetMs: options.canPrepareWords?.() ? 30_000 : 0,
      }));
    } catch {
      res.status(500).json({ error: 'Could not prepare your session. Please try again.' });
    }
  });
  app.get('/api/session-payload', (req, res) => {
    const studyDayKey = readStudyDayKeyFromQuery(req.query?.studyDayKey);
    if (!studyDayKey) {
      res.status(400).json({ error: 'Expected YYYY-MM-DD studyDayKey query parameter' });
      return;
    }

    res.json(getSessionPayload(studyDayKey));
  });
  app.post('/api/study-sessions/:sessionId/accepted-review-attempt-batch', (req, res) => {
    const sessionId = req.params.sessionId;
    const events = req.body?.events;
    const commitIntent = req.body?.commitIntent;

    if (typeof sessionId !== 'string' || sessionId.trim().length === 0) {
      res.status(400).json({ error: 'Expected non-empty session id' });
      return;
    }

    if (!Array.isArray(events)) {
      res.status(400).json({ error: 'Expected events array' });
      return;
    }

    if (typeof commitIntent !== 'object' || commitIntent === null || Array.isArray(commitIntent)) {
      res.status(400).json({ error: 'Expected commit intent object' });
      return;
    }

    const commitStartedAtMs = Date.now();
    try {
      recordAcceptedReviewAttemptBatch({
        sessionId: sessionId.trim(),
        events: events as StudyAttemptEvent[],
        commitIntent: commitIntent as ReviewAttemptCommitIntent,
      });
      recordStudyCommitSuccessSafely({
        sink: studyCommitDiagnosticSink,
        route: '/api/study-sessions/:sessionId/accepted-review-attempt-batch',
        request: req,
        elapsedMs: Date.now() - commitStartedAtMs,
      });
      res.status(204).send();
    } catch (error) {
      const isClientError =
        error instanceof Error &&
        (error.message.startsWith('Expected ') ||
          error.message.startsWith('Invalid ') ||
          error.message.startsWith('Cannot ') ||
          error.message.startsWith('Accepted attempt') ||
          error.message.startsWith('Review attempt') ||
          error.message.startsWith('Study attempt') ||
          error.message.startsWith('Word skill state not found'));
      respondWithStudyCommitFailure({
        sink: studyCommitDiagnosticSink,
        route: '/api/study-sessions/:sessionId/accepted-review-attempt-batch',
        request: req,
        response: res,
        error,
        elapsedMs: Date.now() - commitStartedAtMs,
        responseStatus: isClientError ? 400 : 500,
        publicError: isClientError
          ? error.message
          : 'Failed to record accepted review attempt batch',
      });
    }
  });
  app.post('/api/study-sessions/:sessionId/accepted-contrast-selection-attempt', (req, res) => {
    const sessionId = req.params.sessionId;
    const event = req.body?.event;
    const commitIntent = req.body?.commitIntent;

    if (typeof sessionId !== 'string' || sessionId.trim().length === 0) {
      res.status(400).json({ error: 'Expected non-empty session id' });
      return;
    }

    if (typeof event !== 'object' || event === null || Array.isArray(event)) {
      res.status(400).json({ error: 'Expected event object' });
      return;
    }

    if (typeof commitIntent !== 'object' || commitIntent === null || Array.isArray(commitIntent)) {
      res.status(400).json({ error: 'Expected commit intent object' });
      return;
    }

    const commitStartedAtMs = Date.now();
    try {
      recordAcceptedContrastSelectionAttempt({
        sessionId: sessionId.trim(),
        event: event as StudyAttemptEvent,
        commitIntent: commitIntent as ContrastSelectionCommitIntent,
      });
      recordStudyCommitSuccessSafely({
        sink: studyCommitDiagnosticSink,
        route: '/api/study-sessions/:sessionId/accepted-contrast-selection-attempt',
        request: req,
        elapsedMs: Date.now() - commitStartedAtMs,
      });
      res.status(204).send();
    } catch (error) {
      const isClientError =
        error instanceof Error &&
        (error.message.startsWith('Expected ') ||
          error.message.startsWith('Invalid ') ||
          error.message.startsWith('Accepted contrast') ||
          error.message.startsWith('Study attempt') ||
          error.message.startsWith('Word skill state not found'));
      respondWithStudyCommitFailure({
        sink: studyCommitDiagnosticSink,
        route: '/api/study-sessions/:sessionId/accepted-contrast-selection-attempt',
        request: req,
        response: res,
        error,
        elapsedMs: Date.now() - commitStartedAtMs,
        responseStatus: isClientError ? 400 : 500,
        publicError: isClientError
          ? error.message
          : 'Failed to record accepted contrast selection attempt',
      });
    }
  });
  app.post('/api/study-sessions/:sessionId/pure-cue-assessments', (req, res) => {
    const sessionId = req.params.sessionId;
    const { attemptId, snapshotId, sessionActionId, events, reinforcementSkipped } = req.body ?? {};
    if (
      typeof sessionId !== 'string' || sessionId.trim().length === 0
      || typeof attemptId !== 'string' || attemptId.trim().length === 0
      || typeof snapshotId !== 'string' || snapshotId.trim().length === 0
      || typeof sessionActionId !== 'string' || sessionActionId.trim().length === 0
      || !Array.isArray(events)
    ) {
      res.status(400).json({ error: 'Expected non-empty pure cue assessment identity and events array' });
      return;
    }
    if (reinforcementSkipped !== undefined && typeof reinforcementSkipped !== 'boolean') {
      res.status(400).json({ error: 'Expected boolean reinforcementSkipped' });
      return;
    }
    if (!events.every(isPureCueAssessmentEventInput)) {
      res.status(400).json({ error: 'Expected pure cue assessment event objects with valid primitive fields' });
      return;
    }
    const commitStartedAtMs = Date.now();
    try {
      recordPureCueAssessment({
        attemptId: attemptId.trim(),
        snapshotId: snapshotId.trim(),
        sessionId: sessionId.trim(),
        sessionActionId: sessionActionId.trim(),
        events: events as PureCueAssessmentEvent[],
        reinforcementSkipped,
        committedAt: new Date().toISOString(),
      });
      recordStudyCommitSuccessSafely({
        sink: studyCommitDiagnosticSink,
        route: '/api/study-sessions/:sessionId/pure-cue-assessments',
        request: req,
        elapsedMs: Date.now() - commitStartedAtMs,
      });
      res.status(204).send();
    } catch (error) {
      const isClientError = isPureCueAssessmentClientError(error);
      respondWithStudyCommitFailure({
        sink: studyCommitDiagnosticSink,
        route: '/api/study-sessions/:sessionId/pure-cue-assessments',
        request: req,
        response: res,
        error,
        elapsedMs: Date.now() - commitStartedAtMs,
        responseStatus: isClientError ? 400 : 500,
        publicError: isClientError && error instanceof Error
          ? error.message
          : 'Failed to record pure cue assessment',
      });
    }
  });
  app.post('/api/study-sessions/:sessionId/manage-study-action', (req, res) => {
    const sessionId = req.params.sessionId;
    const sessionActionId = req.body?.sessionActionId;
    const targetWordId = req.body?.targetWordId;
    const actionKind = req.body?.actionKind;
    const sampledSkillIds = req.body?.sampledSkillIds;
    const contentRef = req.body?.contentRef ?? null;
    const managementAction = req.body?.managementAction;

    if (typeof sessionId !== 'string' || sessionId.trim().length === 0) {
      res.status(400).json({ error: 'Expected non-empty session id' });
      return;
    }

    if (typeof sessionActionId !== 'string' || sessionActionId.trim().length === 0) {
      res.status(400).json({ error: 'Expected non-empty sessionActionId' });
      return;
    }

    if (typeof targetWordId !== 'string' || targetWordId.trim().length === 0) {
      res.status(400).json({ error: 'Expected non-empty targetWordId' });
      return;
    }

    if (actionKind !== 'production') {
      res.status(400).json({ error: 'Expected production actionKind' });
      return;
    }

    if (!Array.isArray(sampledSkillIds)) {
      res.status(400).json({ error: 'Expected sampledSkillIds array' });
      return;
    }

    if (managementAction !== 'suppress_skill') {
      res.status(400).json({ error: 'Expected suppress_skill managementAction' });
      return;
    }

    try {
      const event = recordStudyManagementAction({
        sessionId: sessionId.trim(),
        sessionActionId: sessionActionId.trim(),
        targetWordId: targetWordId.trim(),
        actionKind,
        sampledSkillIds: sampledSkillIds as StudySkillId[],
        contentRef: contentRef as StudyContentRef | null,
        managementAction,
      });
      res.status(201).json(event);
    } catch (error) {
      if (error instanceof Error && error.message === 'Word not found') {
        res.status(404).json({ error: error.message });
        return;
      }

      if (
        error instanceof Error &&
        (error.message.startsWith('Expected ') ||
          error.message.startsWith('Invalid ') ||
          error.message === 'Study management actions are currently limited to review words')
      ) {
        res.status(400).json({ error: error.message });
        return;
      }

      res.status(500).json({ error: 'Failed to record study management action' });
    }
  });
  app.post('/api/shared-content/production-cues/:cueId/reports', (req, res) => {
    const cueId = req.params.cueId?.trim();
    const category = req.body?.category;
    const note = req.body?.note ?? null;
    if (!cueId) {
      res.status(400).json({ error: 'Expected non-empty shared production cue id' });
      return;
    }
    if (!['incorrect', 'misleading', 'unsafe', 'other'].includes(category)) {
      res.status(400).json({ error: 'Invalid shared content report category' });
      return;
    }
    if (note !== null && typeof note !== 'string') {
      res.status(400).json({ error: 'Expected shared content report note to be a string or null' });
      return;
    }
    try {
      const publication = getSharedContentPublicationForContent('production_cue', cueId);
      if (!publication) {
        res.status(404).json({ error: `Shared production cue ${cueId} does not exist.` });
        return;
      }
      const report = reportSharedContentPublication({
        publicationId: publication.publicationId,
        category,
        note,
      });
      res.status(201).json(report);
    } catch (error) {
      if (error instanceof Error && error.message === 'Invalid shared content report category.') {
        res.status(400).json({ error: error.message });
        return;
      }
      if (error instanceof Error && error.message.startsWith('Retired shared content publication ')) {
        res.status(409).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: 'Failed to report shared content' });
    }
  });
  app.post('/api/study-management/production/suppress', (req, res) => {
    const targetWordId = req.body?.targetWordId;
    if (typeof targetWordId !== 'string' || targetWordId.trim().length === 0) {
      res.status(400).json({ error: 'Expected non-empty targetWordId' });
      return;
    }
    try {
      res.status(201).json(suppressProductionForWordOutsideSession({ targetWordId: targetWordId.trim() }));
    } catch (error) {
      if (error instanceof Error && error.message === 'Word not found') {
        res.status(404).json({ error: error.message });
        return;
      }
      if (error instanceof Error && error.message.startsWith('Expected ')) {
        res.status(400).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: 'Failed to suppress production for word' });
    }
  });
  app.get('/api/study-sessions/:sessionId/recovery-highlights', (req, res) => {
    if (req.params.sessionId.trim().length === 0) {
      res.status(400).json({ error: 'Expected non-empty session id' });
      return;
    }
    try {
      const highlights = getSessionRecoveryHighlights(req.params.sessionId);
      if (highlights === null) {
        res.status(404).json({ error: 'Completed session not found' });
        return;
      }
      res.json({ highlights });
    } catch {
      res.status(500).json({ error: 'Failed to load recovery highlights' });
    }
  });
  function completionError(res: Response, error: unknown): void {
    if (error instanceof SessionCompletionInputError) res.status(400).json({ error: error.message });
    else if (error instanceof SessionCompletionConflictError) res.status(409).json({ error: error.message });
    else if (error instanceof SessionCompletionNotFoundError) res.status(404).json({ error: error.message });
    else res.status(500).json({ error: 'Failed to save session completion' });
  }
  app.get('/api/session-completions/current', (_req, res) => {
    try { res.json({ completion: getCurrentSessionCompletion() }); }
    catch (error) { completionError(res, error); }
  });
  app.get('/api/study-sessions/:sessionId/completion', (req, res) => {
    try {
      const completion = getSessionCompletion(req.params.sessionId);
      if (!completion) throw new SessionCompletionNotFoundError('Session completion not found');
      res.json(completion);
    } catch (error) { completionError(res, error); }
  });
  app.post('/api/study-sessions/:sessionId/completion', (req, res) => {
    try {
      const completion = stageSessionCompletion(req.params.sessionId, req.body);
      try { options.wakeSessionCompletions?.(); } catch { /* Deadline is durable. */ }
      res.json(completion);
    } catch (error) { completionError(res, error); }
  });
  app.post('/api/study-sessions/:sessionId/completion/undo', (req, res) => {
    try { res.json(undoSessionCompletion(req.params.sessionId, req.body?.revisionId)); }
    catch (error) { completionError(res, error); }
  });
  app.post('/api/study-sessions/:sessionId/completion/close', (req, res) => {
    try {
      const completion = closeSessionCompletion(req.params.sessionId, req.body?.revisionId);
      try { options.wakeSessionCompletions?.(); options.wakeSessionDebriefs?.(); } catch { /* Jobs are durable. */ }
      res.json(completion);
    } catch (error) { completionError(res, error); }
  });
  app.post('/api/review-session-summaries', (req, res) => {
    const sessionId = req.body?.sessionId;
    const completedAt = req.body?.completedAt;
    const completedReviewActionCount = req.body?.completedReviewActionCount;
    const failedReviewActionCount = req.body?.failedReviewActionCount;
    const completedLearningWordCount = req.body?.completedLearningWordCount;
    const activeDurationMs = req.body?.activeDurationMs;
    const debriefInventory: unknown = req.body?.debriefInventory;
    if (debriefInventory !== undefined) {
      try { validateDebriefInventory(debriefInventory); }
      catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid debrief inventory' }); return; }
    }

    if (typeof sessionId !== 'string' || sessionId.trim().length === 0) {
      res.status(400).json({ error: 'Expected non-empty string sessionId' });
      return;
    }

    if (typeof completedAt !== 'string' || Number.isNaN(new Date(completedAt).getTime())) {
      res.status(400).json({ error: 'Expected ISO completedAt timestamp' });
      return;
    }

    if (!Number.isInteger(completedReviewActionCount) || completedReviewActionCount < 0) {
      res.status(400).json({ error: 'Expected non-negative integer completedReviewActionCount' });
      return;
    }

    if (!Number.isInteger(failedReviewActionCount) || failedReviewActionCount < 0) {
      res.status(400).json({ error: 'Expected non-negative integer failedReviewActionCount' });
      return;
    }

    if (!Number.isInteger(activeDurationMs) || activeDurationMs < 0) {
      res.status(400).json({ error: 'Expected non-negative integer activeDurationMs' });
      return;
    }

    if (completedLearningWordCount !== undefined &&
      (!Number.isInteger(completedLearningWordCount) || completedLearningWordCount < 0)) {
      res.status(400).json({ error: 'Expected non-negative integer completedLearningWordCount' });
      return;
    }

    const commitStartedAtMs = Date.now();
    try {
      recordReviewSessionSummary({
        sessionId,
        completedAt,
        completedReviewActionCount,
        failedReviewActionCount,
        activeDurationMs,
        completedLearningWordCount,
        ...(debriefInventory === undefined ? {} : { debriefInventory }),
      });
      try {
        reflectionLifecycleLogger.emit({
          event: 'reflection.summary_recorded',
          sessionId: sessionId.trim(),
          completedReviewActionCount,
          failedReviewActionCount,
          activeDurationMs,
        });
      } catch {
        // Observability must not turn a durable summary into a failed response.
      }
      if (debriefInventory !== undefined && getSessionDebrief(sessionId)?.status === 'queued') {
        try { options.wakeSessionDebriefs?.(); } catch { /* The queue is already durable. */ }
      }
      res.status(204).end();
    } catch (error) {
      const isClientError =
        error instanceof Error &&
        (error.message === 'Expected non-empty session id' ||
          error.message === 'Expected non-negative integer completedReviewActionCount' ||
          error.message === 'Expected non-negative integer failedReviewActionCount' ||
          error.message === 'Expected non-negative integer activeDurationMs' ||
          error.message === 'Expected failedReviewActionCount to be less than or equal to completedReviewActionCount');
      respondWithStudyCommitFailure({
        sink: studyCommitDiagnosticSink,
        route: '/api/review-session-summaries',
        request: req,
        response: res,
        error,
        elapsedMs: Date.now() - commitStartedAtMs,
        responseStatus: isClientError ? 400 : 500,
        publicError: isClientError
          ? error.message
          : 'Failed to record review session summary',
      });
    }
  });
  app.post('/api/words/:id/complete-learning-session', (req, res) => {
    if (req.body?.sessionId !== undefined && (typeof req.body.sessionId !== 'string' || !req.body.sessionId.trim())) {
      res.status(400).json({ error: 'Expected non-empty sessionId when provided' }); return;
    }
    const success = req.body?.success;

    if (typeof success !== 'boolean') {
      res.status(400).json({ error: 'Expected boolean success flag' });
      return;
    }

    try {
      const updatedWord = completeLearningWordSession(req.params.id, success, req.body?.sessionId);
      res.json(updatedWord);
    } catch (error) {
      if (error instanceof Error && error.message === 'Word not found') {
        res.status(404).json({ error: error.message });
        return;
      }

      if (error instanceof SessionWordOutcomeConflictError) { res.status(409).json({ error: error.message }); return; }
      res.status(500).json({ error: 'Failed to complete learning session' });
    }
  });
  app.post('/api/words/:id/complete-unstudied-session', (req, res) => {
    if (req.body?.sessionId !== undefined && (typeof req.body.sessionId !== 'string' || !req.body.sessionId.trim())) {
      res.status(400).json({ error: 'Expected non-empty sessionId when provided' }); return;
    }
    const studyDayKey = readStudyDayKeyFromBody(req.body?.studyDayKey);
    if (!studyDayKey) {
      res.status(400).json({ error: 'Expected YYYY-MM-DD studyDayKey in request body' });
      return;
    }

    try {
      const updatedWord = completeUnstudiedWordSession(req.params.id, studyDayKey, req.body?.sessionId);
      res.json(updatedWord);
    } catch (error) {
      if (error instanceof Error && error.message === 'Word not found') {
        res.status(404).json({ error: error.message });
        return;
      }

      if (error instanceof Error && error.message === 'Invalid study day key') {
        res.status(400).json({ error: error.message });
        return;
      }

      if (error instanceof SessionWordOutcomeConflictError) { res.status(409).json({ error: error.message }); return; }
      res.status(500).json({ error: 'Failed to complete unstudied session' });
    }
  });
  app.post('/api/words/:id/dismiss', (req, res) => {
    try {
      dismissWordFromStudy(req.params.id);
      res.status(204).send();
    } catch (error) {
      if (error instanceof Error && error.message === 'Word not found') {
        res.status(404).json({ error: error.message });
        return;
      }

      res.status(500).json({ error: 'Failed to dismiss word from study' });
    }
  });
}

function respondWithStudyCommitFailure({
  sink,
  route,
  request,
  response,
  error,
  elapsedMs,
  responseStatus,
  publicError,
}: {
  sink: StudyCommitDiagnosticSink;
  route: StudyCommitRoute;
  request: Request;
  response: Response;
  error: unknown;
  elapsedMs: number;
  responseStatus: 400 | 500;
  publicError: string;
}): void {
  const diagnostic = describeStudyCommitFailure({
    route,
    responseStatus,
    learnerId: readDiagnosticLearnerId(),
    params: { ...request.params },
    body: request.body,
    error,
    elapsedMs,
  });
  sink.record(diagnostic);
  response.status(responseStatus).json({
    error: publicError,
    diagnosticId: diagnostic.diagnosticId,
  });
}

function isPureCueAssessmentEventInput(value: unknown): value is PureCueAssessmentEvent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const event = value as Record<string, unknown>;
  return (
    typeof event.eventId === 'string'
    && typeof event.occurredAt === 'string'
    && (typeof event.response === 'string' || event.response === null)
    && (event.outcome === 'accepted' || event.outcome === 'rejected')
    && (typeof event.submittedWordId === 'string' || event.submittedWordId === null)
    && (event.rating === 'forgot' || event.rating === 'hard' || event.rating === 'good' || event.rating === 'easy')
  );
}

function isPureCueAssessmentClientError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message.startsWith('Expected ')
    || error.message.startsWith('Invalid ')
    || error.message.startsWith('Pure cue ')
    || error.message.startsWith('Duplicate pure cue ')
    || error.message.startsWith('Rejected pure cue ')
    || error.message.startsWith('Frozen pure cue ')
    || error.message.startsWith('Pure cue assessment')
  );
}

function recordStudyCommitSuccessSafely({
  sink,
  route,
  request,
  elapsedMs,
}: {
  sink: StudyCommitDiagnosticSink;
  route: Exclude<StudyCommitRoute, '/api/review-session-summaries'>;
  request: Request;
  elapsedMs: number;
}): void {
  if (!sink.recordSuccess) return;
  try {
    sink.recordSuccess(describeStudyCommitSuccess({
      route,
      learnerId: readDiagnosticLearnerId(),
      params: { ...request.params },
      body: request.body,
      elapsedMs,
    }));
  } catch {
    // Observability must not turn a durable commit into a failed response.
  }
}

function readDiagnosticLearnerId(): string | null {
  try {
    return requireLearnerId();
  } catch {
    return null;
  }
}

function readStudyDayKeyFromBody(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  return normalizeStudyDayKey(value);
}
