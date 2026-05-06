import cors from 'cors';
import express from 'express';
import { pathToFileURL } from 'node:url';
import {
  captureProductionMistakeCandidate,
  completeLearningWordSession,
  completeReviewItemSession,
  completeUnstudiedWordSession,
  dismissWordFromStudy,
  addUnstudiedUserPriorityByHanzi,
  dbConfig,
  getUnstudiedCountBaseline,
  getHomeOverview,
  getLearningPolicy,
  getPrioritizedUnstudiedWords,
  getProductionMistakeCandidates,
  getReviewItems,
  getSessionPayload,
  getWordMeanings,
  getWords,
  getWordStatusCounts,
  updateWordMeaningVisibility,
  updateWordPersonalNotes,
  updateWordUserPriority,
} from './db.ts';

const port = dbConfig.port;

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get('/api/words', (req, res) => {
    const words = getWords();
    res.json(words);
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

  app.get('/api/review-items', (req, res) => {
    res.json(getReviewItems());
  });

  app.get('/api/production-mistake-candidates', (req, res) => {
    try {
      res.json(getProductionMistakeCandidates());
    } catch {
      res.status(500).json({ error: 'Failed to load production mistake candidates' });
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

  app.post('/api/priority/unstudied/add-by-hanzi', (req, res) => {
    const hanzi = req.body?.hanzi;

    if (typeof hanzi !== 'string') {
      res.status(400).json({ error: 'Expected string hanzi' });
      return;
    }

    const normalizedHanzi = hanzi.trim();
    if (normalizedHanzi.length === 0) {
      res.status(400).json({ error: 'Expected non-empty hanzi' });
      return;
    }

    try {
      const addedWords = addUnstudiedUserPriorityByHanzi(normalizedHanzi);
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
      dataDir: dbConfig.dataDir,
      dbPath: dbConfig.dbPath,
      wordStatusCounts: getWordStatusCounts(),
      ...getHomeOverview(studyDayKey),
      ...getLearningPolicy(studyDayKey),
    });
  });

  app.post('/api/review-items/:id/complete-session', (req, res) => {
    const failureCount = req.body?.failureCount;
    const terminalRating = req.body?.terminalRating ?? null;

    if (!Number.isInteger(failureCount) || failureCount < 0) {
      res.status(400).json({ error: 'Expected non-negative integer failureCount' });
      return;
    }

    if (terminalRating !== null && terminalRating !== 'hard' && terminalRating !== 'good' && terminalRating !== 'easy') {
      res.status(400).json({ error: 'Invalid terminal rating' });
      return;
    }

    try {
      const updatedItem = completeReviewItemSession(req.params.id, failureCount, terminalRating);
      res.json(updatedItem);
    } catch (error) {
      if (error instanceof Error && error.message === 'Review item not found') {
        res.status(404).json({ error: error.message });
        return;
      }

      res.status(500).json({ error: 'Failed to complete review item session' });
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

    if (bumpDelta === undefined && forceTop === undefined && reset === undefined) {
      res.status(400).json({ error: 'Expected at least one user-priority field to update' });
      return;
    }

    try {
      const updatedWord = updateWordUserPriority(req.params.id, { bumpDelta, forceTop, reset });
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
