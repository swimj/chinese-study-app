import cors from 'cors';
import express from 'express';
import {
  completeLearningWordSession,
  completeReviewItemSession,
  completeUnstudiedWordSession,
  dbConfig,
  getDueReviewItems,
  getLearningPolicy,
  getReviewItems,
  getSessionItems,
  getWords,
  getWordStatusCounts,
} from './db.ts';

const app = express();
const port = dbConfig.port;

app.use(cors());
app.use(express.json());

app.get('/api/words', (req, res) => {
  const words = getWords();
  res.json(words);
});

app.get('/api/review-items', (req, res) => {
  const dueOnly = req.query.due === 'true';
  const reviewItems = dueOnly ? getDueReviewItems() : getReviewItems();
  res.json(reviewItems);
});

app.get('/api/session-items', (req, res) => {
  res.json(getSessionItems());
});

app.get('/api/status', (req, res) => {
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    mode: dbConfig.mode,
    dataDir: dbConfig.dataDir,
    dbPath: dbConfig.dbPath,
    wordStatusCounts: getWordStatusCounts(),
    ...getLearningPolicy(),
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
  try {
    const updatedWord = completeUnstudiedWordSession(req.params.id);
    res.json(updatedWord);
  } catch (error) {
    if (error instanceof Error && error.message === 'Word not found') {
      res.status(404).json({ error: error.message });
      return;
    }

    res.status(500).json({ error: 'Failed to complete unstudied session' });
  }
});

app.listen(port, () => {
  console.log(`Backend server running at http://localhost:${port}`);
  console.log(`Mode: ${dbConfig.mode}`);
  console.log(`Database: ${dbConfig.dbPath}`);
});
