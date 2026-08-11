import cors from 'cors';
import express from 'express';
import { pathToFileURL } from 'node:url';
import {
  acceptReflectionProposal,
  replaceReflectionProposal,
  applyReflectionInvocation,
  completeLearningWordSession,
  completeUnstudiedWordSession,
  acceptContrastIntakeGroup,
  addContrastIntakeToCluster,
  addContrastClusterMember,
  addContrastPromptFromIntake,
  createContrastClusterFromIntake,
  createContrastCluster,
  deleteContrastPrompt,
  deferReflectionProposal,
  dismissWordFromStudy,
  dismissContrastIntakeGroup,
  dismissReflectionProposal,
  addUnstudiedUserPriorityByHanzi,
  dbConfig,
  getUnstudiedCountBaseline,
  getLearningPolicy,
  createContrastPrompt,
  getContrastClusterContent,
  getContentDiagnostics,
  getContrastIntakeGroups,
  getContrastIntakeWords,
  getReflectionArtifactDetail,
  mergeSuggestedContrastClustersForIntakeWord,
  getPrioritizedUnstudiedWords,
  getReviewFailureRateDays,
  listReflectionArtifacts,
  listReflectionGenerationRuns,
  recoverPendingReflectionInvocations,
  getSessionActiveTimeMetrics,
  getSessionPayload,
  setDailyNewWordLimit,
  getTopUnstudiedPriorityWords,
  getWordMeanings,
  getWordStatusCounts,
  recordAcceptedContrastSelectionAttempt,
  recordAcceptedReviewAttemptBatch,
  recordReviewSessionSummary,
  recordStudyManagementAction,
  removeContrastClusterMember,
  resolveContrastPromptBadFeedback,
  resolveContrastIntakeWord,
  searchWords,
  suppressProductionForWordOutsideSession,
  reportBadProductionPromptOutsideSession,
  updateContrastCluster,
  updateContrastClusterMember,
  updateWordMeaningVisibility,
  updateContrastPrompt,
  updateWordPersonalNotes,
  updateWordUserPriority,
  withdrawReflectionInvocationAuthorization,
  type ReviewAttemptCommitIntent,
} from './db.ts';
import type { ContentDiagnosticKind } from '../src/domain/content-diagnostics.ts';
import type {
  ContrastSelectionCommitIntent,
  StudyAttemptEvent,
  StudyContentRef,
  StudyManagementActionKind,
  StudySkillId,
} from '../src/domain/study-actions.ts';
import type {
  ReflectionOperation,
  ReviewProposalRequest,
} from '../src/domain/reflection.ts';
import {
  createInitialReflectionGenerationService,
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

  app.use(cors());
  app.use(express.json());

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

  app.get('/api/contrast-intake/groups', (_req, res) => {
    try {
      res.json(getContrastIntakeGroups());
    } catch {
      res.status(500).json({ error: 'Failed to load contrast intake groups' });
    }
  });

  app.get('/api/contrast-intake/words', (_req, res) => {
    try {
      res.json(getContrastIntakeWords());
    } catch {
      res.status(500).json({ error: 'Failed to load contrast intake words' });
    }
  });

  app.post('/api/contrast-intake/words/:targetWordId/resolve', (req, res) => {
    const targetWordId = req.params.targetWordId;
    if (typeof targetWordId !== 'string' || targetWordId.trim().length === 0) {
      res.status(400).json({ error: 'Expected non-empty targetWordId' });
      return;
    }

    try {
      res.json(resolveContrastIntakeWord({ targetWordId: targetWordId.trim() }));
    } catch (error) {
      if (error instanceof Error && (error.message === 'Word not found' || error.message === 'Contrast intake word not found')) {
        res.status(404).json({ error: error.message });
        return;
      }
      if (error instanceof Error && error.message.startsWith('Expected ')) {
        res.status(400).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: 'Failed to resolve contrast intake word' });
    }
  });

  app.post('/api/contrast-intake/words/:targetWordId/merge-suggested-clusters', (req, res) => {
    const targetWordId = req.params.targetWordId;
    const destinationClusterId = req.body?.destinationClusterId;
    if (typeof targetWordId !== 'string' || targetWordId.trim().length === 0) {
      res.status(400).json({ error: 'Expected non-empty targetWordId' });
      return;
    }
    if (typeof destinationClusterId !== 'string' || destinationClusterId.trim().length === 0) {
      res.status(400).json({ error: 'Expected non-empty destinationClusterId' });
      return;
    }

    try {
      res.json(mergeSuggestedContrastClustersForIntakeWord({
        targetWordId: targetWordId.trim(),
        destinationClusterId: destinationClusterId.trim(),
      }));
    } catch (error) {
      if (error instanceof Error && error.message === 'Contrast intake word not found') {
        res.status(404).json({ error: error.message });
        return;
      }
      if (isContrastIntakeClientError(error)) {
        res.status(error.message === 'Contrast cluster not found' ? 404 : 400).json({ error: error.message });
        return;
      }

      res.status(500).json({ error: 'Failed to merge suggested contrast clusters' });
    }
  });

  app.post('/api/contrast-intake/groups/accept', (req, res) => {
    const selector = readContrastIntakeGroupSelector(req.body);
    if (!selector) {
      res.status(400).json({ error: 'Expected valid contrast intake group selector' });
      return;
    }

    try {
      res.json(acceptContrastIntakeGroup(selector));
    } catch (error) {
      if (isContrastIntakeClientError(error)) {
        res.status(error.message === 'Contrast intake group not found' ? 404 : 400).json({ error: error.message });
        return;
      }

      res.status(500).json({ error: 'Failed to accept contrast intake group' });
    }
  });

  app.post('/api/contrast-intake/groups/dismiss', (req, res) => {
    const selector = readContrastIntakeGroupSelector(req.body);
    if (!selector) {
      res.status(400).json({ error: 'Expected valid contrast intake group selector' });
      return;
    }

    try {
      res.json(dismissContrastIntakeGroup(selector));
    } catch (error) {
      if (isContrastIntakeClientError(error)) {
        res.status(error.message === 'Contrast intake group not found' ? 404 : 400).json({ error: error.message });
        return;
      }

      res.status(500).json({ error: 'Failed to dismiss contrast intake group' });
    }
  });

  app.post('/api/contrast-intake/groups/create-cluster', (req, res) => {
    if (!isPlainObject(req.body)) {
      res.status(400).json({ error: 'Expected request body object' });
      return;
    }

    try {
      res.status(201).json(createContrastClusterFromIntake(req.body));
    } catch (error) {
      if (isContrastIntakeClientError(error)) {
        res.status(error.message === 'Contrast intake group not found' ? 404 : 400).json({ error: error.message });
        return;
      }

      res.status(500).json({ error: 'Failed to create contrast cluster from intake' });
    }
  });

  app.post('/api/contrast-intake/groups/add-to-cluster', (req, res) => {
    if (!isPlainObject(req.body)) {
      res.status(400).json({ error: 'Expected request body object' });
      return;
    }

    try {
      res.json(addContrastIntakeToCluster(req.body));
    } catch (error) {
      if (isContrastIntakeClientError(error)) {
        const statusCode =
          error.message === 'Contrast intake group not found' || error.message === 'Contrast cluster not found'
            ? 404
            : 400;
        res.status(statusCode).json({ error: error.message });
        return;
      }

      res.status(500).json({ error: 'Failed to add contrast intake to cluster' });
    }
  });

  app.post('/api/contrast-intake/groups/add-prompt', (req, res) => {
    if (!isPlainObject(req.body)) {
      res.status(400).json({ error: 'Expected request body object' });
      return;
    }

    try {
      res.json(addContrastPromptFromIntake(req.body));
    } catch (error) {
      if (isContrastIntakeClientError(error)) {
        const statusCode =
          error.message === 'Contrast intake group not found' || error.message === 'Contrast cluster not found'
            ? 404
            : 400;
        res.status(statusCode).json({ error: error.message });
        return;
      }

      res.status(500).json({ error: 'Failed to add contrast prompt from intake' });
    }
  });

  app.get('/api/contrast-clusters', (_req, res) => {
    try {
      res.json({
        clusters: getContrastClusterContent(),
      });
    } catch {
      res.status(500).json({ error: 'Failed to load contrast clusters' });
    }
  });

  app.post('/api/contrast-clusters', (req, res) => {
    const title = req.body?.title;
    const note = req.body?.note ?? '';
    if (typeof title !== 'string' || title.trim().length === 0) {
      res.status(400).json({ error: 'Expected non-empty cluster title' });
      return;
    }
    if (typeof note !== 'string') {
      res.status(400).json({ error: 'Expected string note when provided' });
      return;
    }
    try {
      res.status(201).json(createContrastCluster({ title, note }));
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Expected ')) {
        res.status(400).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: 'Failed to create contrast cluster' });
    }
  });

  app.patch('/api/contrast-clusters/:clusterId', (req, res) => {
    const clusterId = req.params.clusterId;
    const title = req.body?.title;
    const note = req.body?.note ?? '';
    if (typeof clusterId !== 'string' || clusterId.trim().length === 0) {
      res.status(400).json({ error: 'Expected non-empty contrast cluster id' });
      return;
    }
    if (typeof title !== 'string' || title.trim().length === 0) {
      res.status(400).json({ error: 'Expected non-empty cluster title' });
      return;
    }
    if (typeof note !== 'string') {
      res.status(400).json({ error: 'Expected string note when provided' });
      return;
    }
    try {
      res.json(updateContrastCluster({ id: clusterId.trim(), title, note }));
    } catch (error) {
      if (error instanceof Error && (error.message === 'Contrast cluster not found')) {
        res.status(404).json({ error: error.message });
        return;
      }
      if (error instanceof Error && error.message.startsWith('Expected ')) {
        res.status(400).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: 'Failed to update contrast cluster' });
    }
  });

  app.patch('/api/contrast-clusters/:clusterId/members/:wordId', (req, res) => {
    const clusterId = req.params.clusterId;
    const wordId = req.params.wordId;
    const nuanceNote = req.body?.nuanceNote;
    const displayOrder = req.body?.displayOrder;
    if (typeof clusterId !== 'string' || clusterId.trim().length === 0) {
      res.status(400).json({ error: 'Expected non-empty contrast cluster id' });
      return;
    }
    if (typeof wordId !== 'string' || wordId.trim().length === 0) {
      res.status(400).json({ error: 'Expected non-empty word id' });
      return;
    }
    if (nuanceNote !== undefined && typeof nuanceNote !== 'string') {
      res.status(400).json({ error: 'Expected string nuanceNote when provided' });
      return;
    }
    if (displayOrder !== undefined && displayOrder !== null && (!Number.isInteger(displayOrder) || displayOrder <= 0)) {
      res.status(400).json({ error: 'Expected positive integer displayOrder when provided' });
      return;
    }

    try {
      res.json(updateContrastClusterMember({ clusterId, wordId, nuanceNote, displayOrder }));
    } catch (error) {
      if (error instanceof Error && (error.message === 'Contrast cluster member not found' || error.message === 'Contrast prompt target must be a cluster member')) {
        res.status(404).json({ error: error.message });
        return;
      }
      if (error instanceof Error && error.message.startsWith('Expected ')) {
        res.status(400).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: 'Failed to update contrast cluster member' });
    }
  });

  app.post('/api/contrast-clusters/:clusterId/members', (req, res) => {
    const clusterId = req.params.clusterId;
    const wordId = req.body?.wordId;
    const nuanceNote = req.body?.nuanceNote ?? '';
    const displayOrder = req.body?.displayOrder ?? null;
    if (typeof clusterId !== 'string' || clusterId.trim().length === 0) {
      res.status(400).json({ error: 'Expected non-empty contrast cluster id' });
      return;
    }
    if (typeof wordId !== 'string' || wordId.trim().length === 0) {
      res.status(400).json({ error: 'Expected non-empty word id' });
      return;
    }
    if (typeof nuanceNote !== 'string') {
      res.status(400).json({ error: 'Expected string nuanceNote when provided' });
      return;
    }
    if (displayOrder !== null && (!Number.isInteger(displayOrder) || displayOrder <= 0)) {
      res.status(400).json({ error: 'Expected positive integer displayOrder when provided' });
      return;
    }
    try {
      res.status(201).json(addContrastClusterMember({ clusterId, wordId, nuanceNote, displayOrder }));
    } catch (error) {
      if (error instanceof Error && (error.message === 'Word not found' || error.message === 'Contrast cluster not found')) {
        res.status(404).json({ error: error.message });
        return;
      }
      if (error instanceof Error && (error.message.startsWith('Expected ') || error.message.includes('UNIQUE constraint failed'))) {
        res.status(400).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: 'Failed to add cluster member' });
    }
  });

  app.delete('/api/contrast-clusters/:clusterId/members/:wordId', (req, res) => {
    const clusterId = req.params.clusterId;
    const wordId = req.params.wordId;
    if (typeof clusterId !== 'string' || clusterId.trim().length === 0) {
      res.status(400).json({ error: 'Expected non-empty contrast cluster id' });
      return;
    }
    if (typeof wordId !== 'string' || wordId.trim().length === 0) {
      res.status(400).json({ error: 'Expected non-empty word id' });
      return;
    }
    try {
      res.json(removeContrastClusterMember({ clusterId, wordId }));
    } catch (error) {
      if (error instanceof Error && (error.message === 'Contrast cluster member not found' || error.message === 'Contrast prompt target must be a cluster member')) {
        res.status(404).json({ error: error.message });
        return;
      }
      if (error instanceof Error && error.message.startsWith('Expected ')) {
        res.status(400).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: 'Failed to remove contrast cluster member' });
    }
  });

  app.post('/api/contrast-clusters/:clusterId/prompts', (req, res) => {
    const clusterId = req.params.clusterId;
    const targetWordId = req.body?.targetWordId;
    const promptText = req.body?.promptText;
    const explanation = req.body?.explanation ?? '';

    if (typeof clusterId !== 'string' || clusterId.trim().length === 0) {
      res.status(400).json({ error: 'Expected non-empty contrast cluster id' });
      return;
    }

    if (typeof targetWordId !== 'string' || targetWordId.trim().length === 0) {
      res.status(400).json({ error: 'Expected non-empty targetWordId' });
      return;
    }

    if (typeof promptText !== 'string' || promptText.trim().length === 0) {
      res.status(400).json({ error: 'Expected non-empty promptText' });
      return;
    }

    if (typeof explanation !== 'string') {
      res.status(400).json({ error: 'Expected string explanation when provided' });
      return;
    }

    try {
      const prompt = createContrastPrompt({
        clusterId: clusterId.trim(),
        targetWordId: targetWordId.trim(),
        promptText,
        explanation,
      });
      res.status(201).json(prompt);
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message === 'Contrast prompt target must be a cluster member' ||
          error.message === 'Expected non-empty contrast prompt text' ||
          error.message === 'Expected non-empty contrast cluster id' ||
          error.message === 'Expected non-empty word id')
      ) {
        res.status(400).json({ error: error.message });
        return;
      }

      res.status(500).json({ error: 'Failed to create contrast prompt' });
    }
  });

  app.patch('/api/contrast-prompts/:promptId', (req, res) => {
    const promptId = req.params.promptId;
    const targetWordId = req.body?.targetWordId;
    const promptText = req.body?.promptText;
    const explanation = req.body?.explanation ?? '';

    if (typeof promptId !== 'string' || promptId.trim().length === 0) {
      res.status(400).json({ error: 'Expected non-empty contrast prompt id' });
      return;
    }

    if (typeof targetWordId !== 'string' || targetWordId.trim().length === 0) {
      res.status(400).json({ error: 'Expected non-empty targetWordId' });
      return;
    }

    if (typeof promptText !== 'string' || promptText.trim().length === 0) {
      res.status(400).json({ error: 'Expected non-empty promptText' });
      return;
    }

    if (typeof explanation !== 'string') {
      res.status(400).json({ error: 'Expected string explanation when provided' });
      return;
    }

    try {
      res.json(updateContrastPrompt({
        id: promptId.trim(),
        targetWordId: targetWordId.trim(),
        promptText,
        explanation,
      }));
    } catch (error) {
      if (error instanceof Error && error.message === 'Contrast prompt not found') {
        res.status(404).json({ error: error.message });
        return;
      }

      if (
        error instanceof Error &&
        (error.message === 'Contrast prompt target must be a cluster member' ||
          error.message === 'Expected non-empty contrast prompt text' ||
          error.message === 'Expected non-empty contrast prompt id' ||
          error.message === 'Expected non-empty word id')
      ) {
        res.status(400).json({ error: error.message });
        return;
      }

      res.status(500).json({ error: 'Failed to update contrast prompt' });
    }
  });

  app.post('/api/contrast-prompts/:promptId/resolve-bad-feedback', (req, res) => {
    const promptId = req.params.promptId;
    const note = req.body?.note ?? '';

    if (typeof promptId !== 'string' || promptId.trim().length === 0) {
      res.status(400).json({ error: 'Expected non-empty contrast prompt id' });
      return;
    }

    if (typeof note !== 'string') {
      res.status(400).json({ error: 'Expected string note when provided' });
      return;
    }

    try {
      res.json(resolveContrastPromptBadFeedback({
        promptId: promptId.trim(),
        note,
      }));
    } catch (error) {
      if (error instanceof Error && error.message === 'Contrast prompt not found') {
        res.status(404).json({ error: error.message });
        return;
      }

      if (error instanceof Error && error.message.startsWith('Expected ')) {
        res.status(400).json({ error: error.message });
        return;
      }

      res.status(500).json({ error: 'Failed to resolve contrast prompt feedback' });
    }
  });

  app.delete('/api/contrast-prompts/:promptId', (req, res) => {
    const promptId = req.params.promptId;

    if (typeof promptId !== 'string' || promptId.trim().length === 0) {
      res.status(400).json({ error: 'Expected non-empty contrast prompt id' });
      return;
    }

    try {
      deleteContrastPrompt(promptId);
      res.status(204).end();
    } catch (error) {
      if (error instanceof Error && error.message === 'Contrast prompt not found') {
        res.status(404).json({ error: error.message });
        return;
      }

      if (error instanceof Error && error.message.startsWith('Expected ')) {
        res.status(400).json({ error: error.message });
        return;
      }

      res.status(500).json({ error: 'Failed to delete contrast prompt' });
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

    res.json(getTopUnstudiedPriorityWords(limit));
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
        unstudiedTotalCount: getUnstudiedCountBaseline(),
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
    const note = req.body?.note ?? '';

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

    if (actionKind !== 'production' && actionKind !== 'contrast_selection') {
      res.status(400).json({ error: 'Expected production or contrast_selection actionKind' });
      return;
    }

    if (!Array.isArray(sampledSkillIds)) {
      res.status(400).json({ error: 'Expected sampledSkillIds array' });
      return;
    }

    if (
      managementAction !== 'suppress_skill' &&
      managementAction !== 'bad_prompt'
    ) {
      res.status(400).json({ error: 'Expected valid managementAction' });
      return;
    }

    if (typeof note !== 'string') {
      res.status(400).json({ error: 'Expected string note when provided' });
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
        managementAction: managementAction as StudyManagementActionKind,
        note,
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

  app.post('/api/study-management/production/bad-prompt', (req, res) => {
    const targetWordId = req.body?.targetWordId;
    const note = req.body?.note ?? '';
    if (typeof targetWordId !== 'string' || targetWordId.trim().length === 0) {
      res.status(400).json({ error: 'Expected non-empty targetWordId' });
      return;
    }
    if (typeof note !== 'string') {
      res.status(400).json({ error: 'Expected string note when provided' });
      return;
    }
    try {
      res.status(201).json(reportBadProductionPromptOutsideSession({ targetWordId: targetWordId.trim(), note }));
    } catch (error) {
      if (error instanceof Error && error.message === 'Word not found') {
        res.status(404).json({ error: error.message });
        return;
      }
      if (error instanceof Error && error.message.startsWith('Expected ')) {
        res.status(400).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: 'Failed to report bad production prompt' });
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
    if (requestedModel !== undefined
      && requestedModel !== 'openai:gpt-5.6-luna-high'
      && requestedModel !== 'zai:glm-5.2-high') {
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
    if (requestedModel !== undefined
      && requestedModel !== 'openai:gpt-5.6-luna-high'
      && requestedModel !== 'zai:glm-5.2-high') {
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
        const review = dismissReflectionProposal(proposalId.trim(), request.reason);
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

function readContrastIntakeGroupSelector(value: unknown): {
  targetWordId: string;
  candidateText?: string | null;
  matchedWordId?: string | null;
} | null {
  if (!isPlainObject(value)) {
    return null;
  }

  const targetWordId = value.targetWordId;
  const candidateText = value.candidateText;
  const matchedWordId = value.matchedWordId;

  if (typeof targetWordId !== 'string' || targetWordId.trim().length === 0) {
    return null;
  }

  if (candidateText !== undefined && candidateText !== null && typeof candidateText !== 'string') {
    return null;
  }

  if (matchedWordId !== undefined && matchedWordId !== null && typeof matchedWordId !== 'string') {
    return null;
  }

  return {
    targetWordId: targetWordId.trim(),
    candidateText: candidateText ?? null,
    matchedWordId: matchedWordId ?? null,
  };
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
    case 'dismiss':
      if (
        keys.length !== 2
        || keys[0] !== 'action'
        || keys[1] !== 'reason'
        || (value.reason !== null && typeof value.reason !== 'string')
      ) {
        return null;
      }
      return { action: 'dismiss', reason: value.reason };
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
  );
}

function isContrastIntakeClientError(error: unknown): error is Error {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.startsWith('Expected ') ||
    error.message === 'Word not found' ||
    error.message === 'Contrast cluster not found' ||
    error.message === 'Contrast intake word not found' ||
    error.message === 'Contrast intake group not found' ||
    error.message === 'Contrast prompt target must be a cluster member'
  );
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
