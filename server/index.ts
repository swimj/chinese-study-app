import cors from 'cors';
import express, { type Response } from 'express';
import { pathToFileURL } from 'node:url';
import { createClerkRequestAuthentication, type ProviderSubjectResolver } from './authentication.ts';
import {
  acceptReflectionProposal,
  acceptIntakeTriageAssessment,
  replaceReflectionProposal,
  applyReflectionInvocation,
  authorizeManualReflectionOperation,
  clearReflectionQualityAnnotation,
  completeLearningWordSession,
  completeUnstudiedWordSession,
  deferReflectionProposal,
  dismissWordFromStudy,
  dismissReflectionProposal,
  dismissIntakeTriageAssessment,
  addUnstudiedUserPriorityByHanzi,
  dbConfig,
  getLearningPolicy,
  getContentDiagnostics,
  getReflectionArtifactDetail,
  getReflectionQualityStats,
  getPrioritizedUnstudiedWords,
  getReviewFailureRateDays,
  listReflectionArtifacts,
  listReflectionGenerationRuns,
  listReflectionHelpInbox,
  recoverPendingReflectionInvocations,
  runWithLearnerId,
  getSessionActiveTimeMetrics,
  getSessionPayload,
  setDailyNewWordLimit,
  getWordMeanings,
  getWordStatusCounts,
  recordAcceptedContrastSelectionAttempt,
  recordAcceptedReviewAttemptBatch,
  recordReviewSessionSummary,
  recordStudyManagementAction,
  getSharedContentPublicationForContent,
  reportSharedContentPublication,
  searchWords,
  suppressProductionForWordOutsideSession,
  updateWordMeaningVisibility,
  updateWordPersonalNotes,
  updateWordUserPriority,
  upsertReflectionQualityAnnotation,
  markReflectionHelpInboxDone,
  withdrawReflectionInvocationAuthorization,
  type ReviewAttemptCommitIntent,
} from './db.ts';
import { getIntakeTriagePriorityWords } from './intake-triage/evidence.ts';
import {
  createIntakeTriageGenerationService,
  IntakeTriageGenerationError,
  type IntakeTriageGenerationService,
} from './intake-triage/generation.ts';
import { INTAKE_TRIAGE_PROMPT_VERSION } from './intake-triage/provider.ts';
import { IntakeTriageAssessmentError } from './db/intake-triage.ts';
import type { ContentDiagnosticKind } from '../src/domain/content-diagnostics.ts';
import type {
  ContrastSelectionCommitIntent,
  StudyAttemptEvent,
  StudyContentRef,
  StudySkillId,
} from '../src/domain/study-actions.ts';
import type {
  ClearReflectionQualityRequest,
  MarkReflectionHelpInboxDoneRequest,
  ReflectionOperation,
  ReviewProposalRequest,
  UpsertReflectionQualityRequest,
} from '../src/domain/reflection.ts';
import {
  isReflectionQualityTag,
} from '../src/domain/reflection.ts';
import {
  createInitialReflectionGenerationService,
  isReflectionModelChoice,
  RetiredReflectionSourceModelError,
  type InitialReflectionGenerationService,
} from './reflection/generation.ts';
import { ReflectionEvidenceError } from './reflection/evidence.ts';
import { LunaReflectionProviderError } from './reflection/luna-provider.ts';
import {
  createStdoutReflectionLifecycleLogger,
  type ReflectionLifecycleLogger,
} from './reflection/lifecycle-log.ts';
import { createFileReflectionProviderDiagnosticSink } from './reflection/provider-diagnostics.ts';

const port = dbConfig.port;

export type CreateAppOptions = {
  reflectionGenerationService?: InitialReflectionGenerationService;
  reflectionLifecycleLogger?: ReflectionLifecycleLogger;
  intakeTriageGenerationService?: IntakeTriageGenerationService;
  resolveClerkProviderSubject?: ProviderSubjectResolver;
};

export function createApp(options: CreateAppOptions = {}) {
  const app = express();
  const reflectionLifecycleLogger = options.reflectionLifecycleLogger
    ?? createStdoutReflectionLifecycleLogger();
  const reflectionGenerationService = options.reflectionGenerationService
    ?? createInitialReflectionGenerationService({
      lifecycleLogger: reflectionLifecycleLogger,
      providerDiagnosticSink: createFileReflectionProviderDiagnosticSink(dbConfig.dataDir),
    });
  const intakeTriageGenerationService = options.intakeTriageGenerationService
    ?? createIntakeTriageGenerationService();

  app.use(cors(dbConfig.authMode === 'clerk'
    ? {
        origin: process.env.CLERK_AUTHORIZED_PARTY,
        allowedHeaders: ['Authorization', 'Content-Type'],
      }
    : undefined));
  app.use(express.json());
  if (dbConfig.authMode === 'trusted_local') {
    app.use((_req, _res, next) => runWithLearnerId(dbConfig.learnerId, next));
  } else {
    app.use(...createClerkRequestAuthentication(options.resolveClerkProviderSubject));
  }

  app.get('/api/content-diagnostics', (req, res) => {
    const kind = req.query?.kind;
    const query = req.query?.q;
    const limit = readPositiveIntegerFromQuery(req.query?.limit, 50);
    if (!isContentDiagnosticKind(kind)) {
      res.status(400).json({ error: 'Expected kind to be word, contrast_cluster, or production_cue' });
      return;
    }
    if (typeof query !== 'string' || query.trim().length === 0) {
      res.status(400).json({ error: 'Expected non-empty string q query parameter' });
      return;
    }
    if (limit === null) {
      res.status(400).json({ error: 'Expected positive integer limit query parameter' });
      return;
    }
    try {
      res.json(getContentDiagnostics({ kind, query, limit }));
    } catch {
      res.status(500).json({ error: 'Failed to load content diagnostics' });
    }
  });

  app.get('/api/words/search', (req, res) => {
    const query = req.query?.q;
    const limit = readPositiveIntegerFromQuery(req.query?.limit, 20);

    if (typeof query !== 'string') {
      res.status(400).json({ error: 'Expected string q query parameter' });
      return;
    }

    if (limit === null) {
      res.status(400).json({ error: 'Expected positive integer limit query parameter' });
      return;
    }

    try {
      res.json({ words: searchWords(query, limit) });
    } catch {
      res.status(500).json({ error: 'Failed to search words' });
    }
  });

  app.get('/api/words/:id/meanings', (req, res) => {
    try {
      const meanings = getWordMeanings(req.params.id);
      res.json(meanings);
    } catch (error) {
      if (error instanceof Error && error.message === 'Word not found') {
        res.status(404).json({ error: error.message });
        return;
      }

      res.status(500).json({ error: 'Failed to load word meanings' });
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

  app.get('/api/priority/unstudied', (req, res) => {
    res.json(getPrioritizedUnstudiedWords());
  });

  app.get('/api/priority/unstudied/top', (req, res) => {
    const limit = readPositiveIntegerFromQuery(req.query?.limit, 50);
    if (limit === null) {
      res.status(400).json({ error: 'Expected positive integer limit query parameter' });
      return;
    }

    res.json(getIntakeTriagePriorityWords(limit));
  });

  app.post('/api/intake-triage/runs', async (_req, res) => {
    try {
      res.status(201).json(await intakeTriageGenerationService.generate());
    } catch (error) {
      if (error instanceof IntakeTriageGenerationError) {
        const status = error.code === 'no_candidates' || error.code === 'already_running'
          ? 409
          : error.providerCode === 'missing_config' ? 503 : 502;
        res.status(status).json({ error: error.message, code: error.providerCode ?? error.code });
        return;
      }
      res.status(500).json({ error: 'Failed to run the intake advisor' });
    }
  });

  app.post('/api/intake-triage/assessments/:id/accept', (req, res) => {
    try {
      res.json(acceptIntakeTriageAssessment(req.params.id, INTAKE_TRIAGE_PROMPT_VERSION));
    } catch (error) {
      handleIntakeTriageAssessmentError(error, res);
    }
  });

  app.post('/api/intake-triage/assessments/:id/dismiss', (req, res) => {
    try {
      res.json(dismissIntakeTriageAssessment(req.params.id));
    } catch (error) {
      handleIntakeTriageAssessmentError(error, res);
    }
  });

  app.post('/api/priority/unstudied/add-by-hanzi', (req, res) => {
    const hanzi = req.body?.hanzi;
    const requiredForNextSession = req.body?.requiredForNextSession;

    if (typeof hanzi !== 'string') {
      res.status(400).json({ error: 'Expected string hanzi' });
      return;
    }

    if (requiredForNextSession !== undefined && typeof requiredForNextSession !== 'boolean') {
      res.status(400).json({ error: 'Expected boolean requiredForNextSession when provided' });
      return;
    }

    const normalizedHanzi = hanzi.trim();
    if (normalizedHanzi.length === 0) {
      res.status(400).json({ error: 'Expected non-empty hanzi' });
      return;
    }

    try {
      const addedWords = addUnstudiedUserPriorityByHanzi(normalizedHanzi, requiredForNextSession === true);
      res.json({
        addedCount: addedWords.length,
        words: addedWords,
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'No matching unstudied words found') {
        res.status(404).json({ error: error.message });
        return;
      }

      res.status(500).json({ error: 'Failed to add priority words by hanzi' });
    }
  });

  app.get('/api/status', (req, res) => {
    const studyDayKey = readStudyDayKeyFromQuery(req.query?.studyDayKey);
    if (!studyDayKey) {
      res.status(400).json({ error: 'Expected YYYY-MM-DD studyDayKey query parameter' });
      return;
    }

    res.json({
      status: 'ok',
      time: new Date().toISOString(),
      mode: dbConfig.mode,
      studyProfile: dbConfig.studyProfile,
      dataDir: dbConfig.dataDir,
      dbPath: dbConfig.dbPath,
      wordStatusCounts: getWordStatusCounts(),
      reviewFailureRateDays: getReviewFailureRateDays(),
      sessionActiveTimeMetrics: getSessionActiveTimeMetrics(studyDayKey),
      ...getLearningPolicy(studyDayKey),
    });
  });

  app.patch('/api/learning-policy/daily-new-word-limit', (req, res) => {
    const dailyNewWordLimit = req.body?.dailyNewWordLimit;

    try {
      res.json(setDailyNewWordLimit(dailyNewWordLimit));
    } catch (error) {
      if (error instanceof Error && error.message === 'Expected non-negative integer dailyNewWordLimit') {
        res.status(400).json({ error: error.message });
        return;
      }

      res.status(500).json({ error: 'Failed to update daily new-word limit' });
    }
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

    try {
      recordAcceptedReviewAttemptBatch({
        sessionId: sessionId.trim(),
        events: events as StudyAttemptEvent[],
        commitIntent: commitIntent as ReviewAttemptCommitIntent,
      });
      res.status(204).send();
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.startsWith('Expected ') ||
          error.message.startsWith('Invalid ') ||
          error.message.startsWith('Cannot ') ||
          error.message.startsWith('Accepted attempt') ||
          error.message.startsWith('Review attempt') ||
          error.message.startsWith('Study attempt') ||
          error.message.startsWith('Word skill state not found'))
      ) {
        res.status(400).json({ error: error.message });
        return;
      }

      res.status(500).json({ error: 'Failed to record accepted review attempt batch' });
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

    try {
      recordAcceptedContrastSelectionAttempt({
        sessionId: sessionId.trim(),
        event: event as StudyAttemptEvent,
        commitIntent: commitIntent as ContrastSelectionCommitIntent,
      });
      res.status(204).send();
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.startsWith('Expected ') ||
          error.message.startsWith('Invalid ') ||
          error.message.startsWith('Accepted contrast') ||
          error.message.startsWith('Study attempt') ||
          error.message.startsWith('Word skill state not found'))
      ) {
        res.status(400).json({ error: error.message });
        return;
      }

      res.status(500).json({ error: 'Failed to record accepted contrast selection attempt' });
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

  app.post('/api/study-sessions/:sessionId/reflections', async (req, res) => {
    const sessionId = req.params.sessionId;
    if (typeof sessionId !== 'string' || sessionId.trim().length === 0) {
      res.status(400).json({ error: 'Expected non-empty session id' });
      return;
    }

    const normalizedSessionId = sessionId.trim();
    const requestedModel = req.body?.model;
    if (requestedModel !== undefined && !isReflectionModelChoice(requestedModel)) {
      res.status(400).json({ error: 'Expected a supported reflection model when provided' });
      return;
    }
    const generationStartedAt = Date.now();
    reflectionLifecycleLogger.emit({
      event: 'reflection.generation_requested',
      sessionId: normalizedSessionId,
    });

    try {
      const result = await reflectionGenerationService.generate(sessionId, req.body, requestedModel);
      reflectionLifecycleLogger.emit({
        event: 'reflection.generation_succeeded',
        sessionId: normalizedSessionId,
        artifactId: result.artifactId,
        proposalCount: result.proposalCount,
        status: result.status,
        elapsedMs: Date.now() - generationStartedAt,
      });
      res.status(result.status === 'created' ? 201 : 200).json(result);
    } catch (error) {
      if (error instanceof ReflectionEvidenceError) {
        reflectionLifecycleLogger.emit({
          event: 'reflection.generation_failed',
          sessionId: normalizedSessionId,
          failure: 'invalid_evidence',
          code: error.code,
          clientRequestId: null,
          elapsedMs: Date.now() - generationStartedAt,
        });
        res.status(error.httpStatus).json({
          error: error.message,
          code: error.code,
        });
        return;
      }
      if (error instanceof LunaReflectionProviderError) {
        reflectionLifecycleLogger.emit({
          event: 'reflection.generation_failed',
          sessionId: normalizedSessionId,
          failure: 'provider',
          code: error.code,
          clientRequestId: error.clientRequestId,
          elapsedMs: Date.now() - generationStartedAt,
        });
        res.status(error.code === 'missing_config' ? 503 : 502).json({
          error: error.message,
          code: error.code,
        });
        return;
      }
      reflectionLifecycleLogger.emit({
        event: 'reflection.generation_failed',
        sessionId: normalizedSessionId,
        failure: 'internal',
        code: null,
        clientRequestId: null,
        elapsedMs: Date.now() - generationStartedAt,
      });
      res.status(500).json({ error: 'Failed to generate reflection' });
    }
  });

  app.get('/api/reflection-artifacts', (req, res) => {
    const review = req.query?.review;
    if (review !== 'open' && review !== 'all') {
      res.status(400).json({ error: 'Expected review query parameter to be open or all' });
      return;
    }

    try {
      res.json({ artifacts: listReflectionArtifacts(review) });
    } catch {
      res.status(500).json({ error: 'Failed to load reflection artifacts' });
    }
  });

  app.get('/api/reflection-generation-runs', (_req, res) => {
    try {
      res.json({ runs: listReflectionGenerationRuns() });
    } catch {
      res.status(500).json({ error: 'Failed to load reflection generation runs' });
    }
  });

  app.post('/api/reflection-generation-runs/:runId/retry', async (req, res) => {
    const runId = req.params.runId;
    if (typeof runId !== 'string' || runId.trim().length === 0) {
      res.status(400).json({ error: 'Expected non-empty reflection generation run id' });
      return;
    }

    const requestedModel = req.body?.model;
    if (requestedModel !== undefined && !isReflectionModelChoice(requestedModel)) {
      res.status(400).json({ error: 'Expected a supported reflection model when provided' });
      return;
    }
    try {
      const result = await reflectionGenerationService.retry(runId.trim(), requestedModel);
      res.status(result.status === 'created' ? 201 : 200).json(result);
    } catch (error) {
      if (isReflectionNotFoundError(error, 'Reflection generation run not found.')) {
        res.status(404).json({ error: 'Reflection generation run not found' });
        return;
      }
      if (
        error instanceof RetiredReflectionSourceModelError
        || (error instanceof Error && error.name === 'RetiredReflectionSourceModelError')
      ) {
        res.status(409).json({ error: error.message });
        return;
      }
      if (error instanceof Error && (
        error.message === 'Reflection generation run is not retryable.'
        || error.message === 'Reflection generation run is not retryable by the current flow.'
      )) {
        res.status(409).json({ error: error.message });
        return;
      }
      if (error instanceof LunaReflectionProviderError) {
        res.status(error.code === 'missing_config' ? 503 : 502).json({
          error: error.message,
          code: error.code,
        });
        return;
      }
      res.status(500).json({ error: 'Failed to retry reflection generation' });
    }
  });

  app.get('/api/reflection-artifacts/:artifactId', (req, res) => {
    const artifactId = req.params.artifactId;
    if (typeof artifactId !== 'string' || artifactId.trim().length === 0) {
      res.status(400).json({ error: 'Expected non-empty reflection artifact id' });
      return;
    }

    try {
      res.json(getReflectionArtifactDetail(artifactId.trim()));
    } catch (error) {
      if (isReflectionNotFoundError(error, 'Reflection artifact not found.')) {
        res.status(404).json({ error: 'Reflection artifact not found' });
        return;
      }
      res.status(500).json({ error: 'Failed to load reflection artifact' });
    }
  });

  app.post(
    '/api/reflection-artifacts/:artifactId/items/:itemId/manual-invocations',
    (req, res) => {
      const artifactId = req.params.artifactId;
      const itemId = req.params.itemId;
      if (typeof artifactId !== 'string' || artifactId.trim().length === 0) {
        res.status(400).json({ error: 'Expected non-empty reflection artifact id' });
        return;
      }
      if (typeof itemId !== 'string' || itemId.trim().length === 0) {
        res.status(400).json({ error: 'Expected non-empty reflection item id' });
        return;
      }
      const request = readAuthorizeManualReflectionOperationRequest(req.body);
      if (request === null) {
        res.status(400).json({ error: 'Expected a valid manual reflection invocation request' });
        return;
      }

      try {
        const authorized = authorizeManualReflectionOperation({
          artifactId: artifactId.trim(),
          itemId: itemId.trim(),
          operation: request.operation,
        });
        const invocation = authorized.invocation.application.state.kind === 'pending'
          ? applyReflectionInvocation(authorized.invocation.invocation.invocationId)
          : authorized.invocation;
        res.json({
          invocation: invocation.invocation,
          application: invocation.application,
        });
      } catch (error) {
        if (
          isReflectionNotFoundError(error, 'Reflection artifact not found.')
          || isReflectionNotFoundError(error, 'Reflection item not found.')
        ) {
          res.status(404).json({
            error: error.message.replace(/\.$/, ''),
          });
          return;
        }
        if (isReflectionReviewClientError(error)) {
          res.status(400).json({ error: error.message });
          return;
        }
        res.status(500).json({ error: 'Failed to authorize manual reflection operation' });
      }
    },
  );

  app.post('/api/reflection-proposals/:proposalId/review', (req, res) => {
    const proposalId = req.params.proposalId;
    if (typeof proposalId !== 'string' || proposalId.trim().length === 0) {
      res.status(400).json({ error: 'Expected non-empty reflection proposal id' });
      return;
    }
    const request = readReviewProposalRequest(req.body);
    if (request === null) {
      res.status(400).json({ error: 'Expected a valid reflection proposal review action' });
      return;
    }

    try {
      if (request.action === 'defer') {
        const review = deferReflectionProposal(proposalId.trim());
        res.json({ review, invocation: null, application: null });
        return;
      }
      if (request.action === 'dismiss') {
        const review = dismissReflectionProposal(
          proposalId.trim(),
          request.reason,
        );
        res.json({ review, invocation: null, application: null });
        return;
      }

      const accepted = request.action === 'replace'
        ? replaceReflectionProposal({
          proposalId: proposalId.trim(),
          operation: request.operation,
        })
        : acceptReflectionProposal({
        proposalId: proposalId.trim(),
        operation: request.operation,
      });
      const invocation = accepted.invocation.application.state.kind === 'pending'
        ? applyReflectionInvocation(accepted.invocation.invocation.invocationId)
        : accepted.invocation;
      res.json({
        review: accepted.review,
        invocation: invocation.invocation,
        application: invocation.application,
      });
    } catch (error) {
      if (isReflectionNotFoundError(error, 'Reflection proposal not found.')) {
        res.status(404).json({ error: 'Reflection proposal not found' });
        return;
      }
      if (isReflectionReviewClientError(error)) {
        res.status(400).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: 'Failed to review reflection proposal' });
    }
  });

  app.post(
    '/api/reflection-invocations/:invocationId/withdraw-authorization',
    (req, res) => {
      const invocationId = req.params.invocationId;
      if (typeof invocationId !== 'string' || invocationId.trim().length === 0) {
        res.status(400).json({ error: 'Expected non-empty reflection invocation id' });
        return;
      }
      if (
        req.body !== undefined
        && (!isPlainObject(req.body) || Object.keys(req.body).length !== 0)
      ) {
        res.status(400).json({ error: 'Expected an empty request body' });
        return;
      }

      try {
        const invocation = withdrawReflectionInvocationAuthorization(invocationId.trim());
        res.json({
          invocation: invocation.invocation,
          application: invocation.application,
        });
      } catch (error) {
        if (isReflectionNotFoundError(error, 'Reflection invocation not found.')) {
          res.status(404).json({ error: 'Reflection invocation not found' });
          return;
        }
        if (
          error instanceof Error
          && error.message.startsWith('Invalid operation application transition:')
        ) {
          res.status(400).json({ error: error.message });
          return;
        }
        res.status(500).json({ error: 'Failed to withdraw reflection authorization' });
      }
    },
  );

  app.put('/api/reflection-quality', (req, res) => {
    const request = readUpsertReflectionQualityRequest(req.body);
    if (request === null) {
      res.status(400).json({ error: 'Expected a valid reflection quality annotation upsert' });
      return;
    }
    try {
      res.json(upsertReflectionQualityAnnotation(request));
    } catch (error) {
      if (isReflectionQualityNotFoundError(error)) {
        res.status(404).json({ error: error.message.replace(/\.$/, '') });
        return;
      }
      if (isReflectionQualityClientError(error)) {
        res.status(400).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: 'Failed to upsert reflection quality annotation' });
    }
  });

  app.delete('/api/reflection-quality', (req, res) => {
    const request = readClearReflectionQualityRequest(req.body);
    if (request === null) {
      res.status(400).json({ error: 'Expected a valid reflection quality clear request' });
      return;
    }
    try {
      res.json(clearReflectionQualityAnnotation(request));
    } catch (error) {
      if (isReflectionQualityNotFoundError(error)) {
        res.status(404).json({ error: error.message.replace(/\.$/, '') });
        return;
      }
      if (isReflectionQualityClientError(error)) {
        res.status(400).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: 'Failed to clear reflection quality annotation' });
    }
  });

  app.get('/api/reflection-quality-stats', (_req, res) => {
    try {
      res.json(getReflectionQualityStats());
    } catch {
      res.status(500).json({ error: 'Failed to load reflection quality stats' });
    }
  });

  app.get('/api/reflection-help-inbox', (_req, res) => {
    try {
      res.json({ entries: listReflectionHelpInbox() });
    } catch {
      res.status(500).json({ error: 'Failed to load reflection help inbox' });
    }
  });

  app.delete('/api/reflection-help-inbox', (req, res) => {
    const request = readMarkReflectionHelpInboxDoneRequest(req.body);
    if (request === null) {
      res.status(400).json({ error: 'Expected a valid reflection help inbox done request' });
      return;
    }
    try {
      res.json(markReflectionHelpInboxDone(request));
    } catch (error) {
      if (isReflectionQualityNotFoundError(error)) {
        res.status(404).json({ error: error.message.replace(/\.$/, '') });
        return;
      }
      if (isReflectionQualityClientError(error)) {
        res.status(400).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: 'Failed to mark reflection help inbox item done' });
    }
  });

  app.post('/api/review-session-summaries', (req, res) => {
    const sessionId = req.body?.sessionId;
    const completedAt = req.body?.completedAt;
    const completedReviewActionCount = req.body?.completedReviewActionCount;
    const failedReviewActionCount = req.body?.failedReviewActionCount;
    const activeDurationMs = req.body?.activeDurationMs;

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

    try {
      recordReviewSessionSummary({
        sessionId,
        completedAt,
        completedReviewActionCount,
        failedReviewActionCount,
        activeDurationMs,
      });
      reflectionLifecycleLogger.emit({
        event: 'reflection.summary_recorded',
        sessionId: sessionId.trim(),
        completedReviewActionCount,
        failedReviewActionCount,
      });
      res.status(204).end();
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message === 'Expected non-empty session id' ||
          error.message === 'Expected non-negative integer completedReviewActionCount' ||
          error.message === 'Expected non-negative integer failedReviewActionCount' ||
          error.message === 'Expected non-negative integer activeDurationMs' ||
          error.message === 'Expected failedReviewActionCount to be less than or equal to completedReviewActionCount')
      ) {
        res.status(400).json({ error: error.message });
        return;
      }

      res.status(500).json({ error: 'Failed to record review session summary' });
    }
  });

  app.post('/api/words/:id/complete-learning-session', (req, res) => {
    const success = req.body?.success;

    if (typeof success !== 'boolean') {
      res.status(400).json({ error: 'Expected boolean success flag' });
      return;
    }

    try {
      const updatedWord = completeLearningWordSession(req.params.id, success);
      res.json(updatedWord);
    } catch (error) {
      if (error instanceof Error && error.message === 'Word not found') {
        res.status(404).json({ error: error.message });
        return;
      }

      res.status(500).json({ error: 'Failed to complete learning session' });
    }
  });

  app.post('/api/words/:id/complete-unstudied-session', (req, res) => {
    const studyDayKey = readStudyDayKeyFromBody(req.body?.studyDayKey);
    if (!studyDayKey) {
      res.status(400).json({ error: 'Expected YYYY-MM-DD studyDayKey in request body' });
      return;
    }

    try {
      const updatedWord = completeUnstudiedWordSession(req.params.id, studyDayKey);
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

  app.patch('/api/words/:id/personal-notes', (req, res) => {
    const personalNotes = req.body?.personalNotes;

    if (typeof personalNotes !== 'string') {
      res.status(400).json({ error: 'Expected string personalNotes' });
      return;
    }

    try {
      const updatedWord = updateWordPersonalNotes(req.params.id, personalNotes.trim());
      res.json(updatedWord);
    } catch (error) {
      if (error instanceof Error && error.message === 'Word not found') {
        res.status(404).json({ error: error.message });
        return;
      }

      res.status(500).json({ error: 'Failed to update personal notes' });
    }
  });

  app.patch('/api/words/:id/user-priority', (req, res) => {
    const bumpDelta = req.body?.bumpDelta;
    const forceTop = req.body?.forceTop;
    const reset = req.body?.reset;
    const requiredForNextSession = req.body?.requiredForNextSession;

    if (bumpDelta !== undefined && !Number.isInteger(bumpDelta)) {
      res.status(400).json({ error: 'Expected integer bumpDelta when provided' });
      return;
    }

    if (forceTop !== undefined && typeof forceTop !== 'boolean') {
      res.status(400).json({ error: 'Expected boolean forceTop when provided' });
      return;
    }

    if (reset !== undefined && typeof reset !== 'boolean') {
      res.status(400).json({ error: 'Expected boolean reset when provided' });
      return;
    }

    if (requiredForNextSession !== undefined && typeof requiredForNextSession !== 'boolean') {
      res.status(400).json({ error: 'Expected boolean requiredForNextSession when provided' });
      return;
    }

    if (
      bumpDelta === undefined &&
      forceTop === undefined &&
      reset === undefined &&
      requiredForNextSession === undefined
    ) {
      res.status(400).json({ error: 'Expected at least one user-priority field to update' });
      return;
    }

    try {
      const updatedWord = updateWordUserPriority(req.params.id, { bumpDelta, forceTop, reset, requiredForNextSession });
      res.json(updatedWord);
    } catch (error) {
      if (error instanceof Error && error.message === 'Word not found') {
        res.status(404).json({ error: error.message });
        return;
      }

      if (error instanceof Error && error.message === 'Expected unstudied word') {
        res.status(400).json({ error: error.message });
        return;
      }

      res.status(500).json({ error: 'Failed to update user priority' });
    }
  });

  app.patch('/api/words/:wordId/meanings/:meaningId', (req, res) => {
    const showOnProductionPrompt = req.body?.showOnProductionPrompt;

    if (typeof showOnProductionPrompt !== 'boolean') {
      res.status(400).json({ error: 'Expected boolean showOnProductionPrompt' });
      return;
    }

    try {
      const updatedMeanings = updateWordMeaningVisibility(
        req.params.wordId,
        req.params.meaningId,
        showOnProductionPrompt,
      );
      res.json(updatedMeanings);
    } catch (error) {
      if (error instanceof Error && error.message === 'Word meaning not found') {
        res.status(404).json({ error: error.message });
        return;
      }

      res.status(500).json({ error: 'Failed to update word meaning visibility' });
    }
  });

  return app;
}

function readStudyDayKeyFromQuery(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  return normalizeStudyDayKey(value);
}

function readStudyDayKeyFromBody(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  return normalizeStudyDayKey(value);
}

function readPositiveIntegerFromQuery(value: unknown, fallback: number): number | null {
  if (value === undefined) {
    return fallback;
  }

  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isContentDiagnosticKind(value: unknown): value is ContentDiagnosticKind {
  return value === 'word' || value === 'contrast_cluster' || value === 'production_cue';
}

function readReviewProposalRequest(value: unknown): ReviewProposalRequest | null {
  if (!isPlainObject(value) || typeof value.action !== 'string') {
    return null;
  }
  const keys = Object.keys(value).sort();

  switch (value.action) {
    case 'defer':
      return keys.length === 1 && keys[0] === 'action'
        ? { action: 'defer' }
        : null;
    case 'dismiss': {
      const allowedKeys = new Set(['action', 'reason']);
      if (
        !keys.every((key) => allowedKeys.has(key))
        || !keys.includes('reason')
        || (value.reason !== null && typeof value.reason !== 'string')
      ) {
        return null;
      }
      return { action: 'dismiss', reason: value.reason };
    }
    case 'accept':
    case 'replace':
      if (
        keys.length !== 2
        || keys[0] !== 'action'
        || keys[1] !== 'operation'
        || !isPlainObject(value.operation)
      ) {
        return null;
      }
      return {
        action: value.action,
        operation: value.operation as ReflectionOperation,
      };
    default:
      return null;
  }
}

function isReflectionNotFoundError(error: unknown, message: string): error is Error {
  return error instanceof Error && error.message === message;
}

function isReflectionReviewClientError(error: unknown): error is Error {
  if (!(error instanceof Error)) return false;
  return (
    error.message.startsWith('Cannot authorize ')
    || error.message.startsWith('Invalid proposal review transition:')
    || error.message.startsWith('Reflection operation references unknown word ')
    || error.message.startsWith('No reflection operation registration for ')
    || error.message === 'A revised proposal acceptance must preserve operation kind and version.'
    || error.message === 'A replacement proposal must change operation kind or version.'
    || error.message === 'Manual authorization is only available for explanation-only reflection items.'
    || isReflectionQualityClientError(error)
  );
}

function readAuthorizeManualReflectionOperationRequest(
  value: unknown,
): { operation: ReflectionOperation } | null {
  if (!isPlainObject(value) || !isPlainObject(value.operation)) {
    return null;
  }
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== 'operation') {
    return null;
  }
  return { operation: value.operation as ReflectionOperation };
}

function readUpsertReflectionQualityRequest(value: unknown): UpsertReflectionQualityRequest | null {
  if (!isPlainObject(value)) return null;
  const keys = Object.keys(value);
  if (keys.some((key) => !['artifactId', 'itemId', 'tags', 'note'].includes(key))) {
    return null;
  }
  if (
    typeof value.artifactId !== 'string'
    || value.artifactId.trim().length === 0
    || typeof value.itemId !== 'string'
    || value.itemId.trim().length === 0
    || !Array.isArray(value.tags)
    || value.tags.length === 0
    || !value.tags.every((tag) => isReflectionQualityTag(tag))
  ) {
    return null;
  }
  const note = value.note === undefined ? undefined : value.note;
  if (note !== undefined && note !== null && typeof note !== 'string') {
    return null;
  }
  return note === undefined
    ? {
        artifactId: value.artifactId.trim(),
        itemId: value.itemId.trim(),
        tags: value.tags,
      }
    : {
        artifactId: value.artifactId.trim(),
        itemId: value.itemId.trim(),
        tags: value.tags,
        note,
      };
}

function readClearReflectionQualityRequest(value: unknown): ClearReflectionQualityRequest | null {
  return readItemLocatorRequest(value);
}

function readMarkReflectionHelpInboxDoneRequest(
  value: unknown,
): MarkReflectionHelpInboxDoneRequest | null {
  return readItemLocatorRequest(value);
}

function readItemLocatorRequest(value: unknown): { artifactId: string; itemId: string } | null {
  if (!isPlainObject(value)) return null;
  const keys = Object.keys(value).sort();
  if (
    keys.length !== 2
    || keys[0] !== 'artifactId'
    || keys[1] !== 'itemId'
    || typeof value.artifactId !== 'string'
    || value.artifactId.trim().length === 0
    || typeof value.itemId !== 'string'
    || value.itemId.trim().length === 0
  ) {
    return null;
  }
  return {
    artifactId: value.artifactId.trim(),
    itemId: value.itemId.trim(),
  };
}

function isReflectionQualityNotFoundError(error: unknown): error is Error {
  return error instanceof Error && (
    error.message === 'Reflection artifact not found.'
    || error.message === 'Reflection item not found.'
  );
}

function isReflectionQualityClientError(error: unknown): error is Error {
  if (!(error instanceof Error)) return false;
  return (
    error.message === 'Expected a valid reflection quality tag.'
    || error.message === 'Expected a non-empty quality tag set.'
    || error.message === 'Expected quality tags to be an array.'
    || error.message === 'other tag requires a non-empty note.'
    || error.message === 'Expected quality annotation note to be a string or null.'
    || error.message.startsWith('Expected non-empty ')
    || error.message.startsWith('Expected ')
      && error.message.includes('ISO-8601')
  );
}

function handleIntakeTriageAssessmentError(error: unknown, res: Response): void {
  if (error instanceof IntakeTriageAssessmentError) {
    const status = error.code === 'not_found' ? 404 : 409;
    res.status(status).json({ error: error.message, code: error.code });
    return;
  }
  res.status(500).json({ error: 'Failed to update the intake assessment' });
}

function normalizeStudyDayKey(value: string): string | null {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return null;
  }

  return trimmed;
}

export function recoverPendingReflectionApplicationsAtStartup() {
  return recoverPendingReflectionInvocations();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  recoverPendingReflectionApplicationsAtStartup();
  const app = createApp();
  app.listen(port, () => {
    console.log(`Backend server running at http://localhost:${port}`);
    console.log(`Mode: ${dbConfig.mode}`);
    console.log(`Database: ${dbConfig.dbPath}`);
  });
}
