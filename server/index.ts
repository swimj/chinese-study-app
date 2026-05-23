import cors from 'cors';
import express from 'express';
import { pathToFileURL } from 'node:url';
import {
  captureProductionMistakeCandidate,
  completeLearningWordSession,
  completeUnstudiedWordSession,
  dismissWordFromStudy,
  addUnstudiedUserPriorityByHanzi,
  dbConfig,
  getUnstudiedCountBaseline,
  getLearningPolicy,
  createContrastPrompt,
  getContrastClusterContent,
  getPrioritizedUnstudiedWords,
  getProductionMistakeCandidates,
  getReviewFailureRateDays,
  getSessionPayload,
  getTopUnstudiedPriorityWords,
  getWordMeanings,
  getWordStatusCounts,
  recordAcceptedReviewAttemptBatch,
  recordReviewSessionSummary,
  recordStudyManagementAction,
  updateWordMeaningVisibility,
  updateContrastPrompt,
  updateWordPersonalNotes,
  updateWordUserPriority,
  type ReviewAttemptCommitIntent,
} from './db.ts';
import type {
  StudyAttemptEvent,
  StudyContentRef,
  StudyManagementActionKind,
  StudySkillId,
} from '../src/domain/study-actions.ts';

const port = dbConfig.port;

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

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

  app.get('/api/production-mistake-candidates', (req, res) => {
    try {
      res.json(getProductionMistakeCandidates());
    } catch {
      res.status(500).json({ error: 'Failed to load production mistake candidates' });
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
      ...getLearningPolicy(studyDayKey),
    });
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

  app.post('/api/study-sessions/:sessionId/manage-study-action', (req, res) => {
    const sessionId = req.params.sessionId;
    const sessionActionId = req.body?.sessionActionId;
    const targetWordId = req.body?.targetWordId;
    const actionKind = req.body?.actionKind;
    const sampledSkillIds = req.body?.sampledSkillIds;
    const contentRef = req.body?.contentRef ?? null;
    const managementAction = req.body?.managementAction;
    const note = req.body?.note ?? '';
    const candidateText = req.body?.candidateText ?? null;

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
      managementAction !== 'add_contrast_candidate' &&
      managementAction !== 'suppress_skill_and_add_contrast_candidate' &&
      managementAction !== 'bad_prompt'
    ) {
      res.status(400).json({ error: 'Expected valid managementAction' });
      return;
    }

    if (typeof note !== 'string') {
      res.status(400).json({ error: 'Expected string note when provided' });
      return;
    }

    if (candidateText !== null && typeof candidateText !== 'string') {
      res.status(400).json({ error: 'Expected string candidateText when provided' });
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
        candidateText,
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

  app.post('/api/review-session-summaries', (req, res) => {
    const sessionId = req.body?.sessionId;
    const completedAt = req.body?.completedAt;
    const completedReviewActionCount = req.body?.completedReviewActionCount;
    const failedReviewActionCount = req.body?.failedReviewActionCount;

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

    try {
      recordReviewSessionSummary({
        sessionId,
        completedAt,
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
          error.message === 'Expected failedReviewActionCount to be less than or equal to completedReviewActionCount')
      ) {
        res.status(400).json({ error: error.message });
        return;
      }

      res.status(500).json({ error: 'Failed to record review session summary' });
    }
  });

  app.post('/api/production-mistake-candidates', (req, res) => {
    const targetWordId = req.body?.targetWordId;
    const attemptedHanzi = req.body?.attemptedHanzi;
    const note = req.body?.note ?? '';

    if (typeof targetWordId !== 'string' || targetWordId.trim().length === 0) {
      res.status(400).json({ error: 'Expected non-empty string targetWordId' });
      return;
    }

    if (typeof attemptedHanzi !== 'string' || attemptedHanzi.trim().length === 0) {
      res.status(400).json({ error: 'Expected non-empty string attemptedHanzi' });
      return;
    }

    if (typeof note !== 'string') {
      res.status(400).json({ error: 'Expected string note when provided' });
      return;
    }

    try {
      const candidate = captureProductionMistakeCandidate({
        targetWordId: targetWordId.trim(),
        attemptedHanzi,
        note,
      });
      res.status(201).json(candidate);
    } catch (error) {
      if (error instanceof Error && error.message === 'Word not found') {
        res.status(404).json({ error: error.message });
        return;
      }

      if (
        error instanceof Error &&
        (error.message === 'Expected non-empty attempted Hanzi' ||
          error.message === 'Expected attempted Hanzi to differ from target Hanzi')
      ) {
        res.status(400).json({ error: error.message });
        return;
      }

      res.status(500).json({ error: 'Failed to capture production mistake candidate' });
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

function normalizeStudyDayKey(value: string): string | null {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return null;
  }

  return trimmed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = createApp();
  app.listen(port, () => {
    console.log(`Backend server running at http://localhost:${port}`);
    console.log(`Mode: ${dbConfig.mode}`);
    console.log(`Database: ${dbConfig.dbPath}`);
  });
}
