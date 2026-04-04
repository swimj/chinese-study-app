import cors from 'cors';
import express from 'express';
import {
  dbConfig,
  getDailyIntroductionStats,
  getDueReviewItems,
  getReviewItems,
  getWords,
  getWordStatusCounts,
  introduceNewWords,
  submitReviewAnswer,
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

app.get('/api/status', (req, res) => {
  const introductionStats = getDailyIntroductionStats();

  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    mode: dbConfig.mode,
    dataDir: dbConfig.dataDir,
    dbPath: dbConfig.dbPath,
    wordStatusCounts: getWordStatusCounts(),
    ...introductionStats,
  });
});

app.post('/api/words/introduce', (req, res) => {
  const requestedCount = req.body?.count;

  if (requestedCount !== undefined && (!Number.isInteger(requestedCount) || requestedCount < 0)) {
    res.status(400).json({ error: 'Invalid introduction count' });
    return;
  }

  try {
    const result = introduceNewWords(requestedCount);
    res.json(result);
  } catch {
    res.status(500).json({ error: 'Failed to introduce new words' });
  }
});

app.post('/api/review-items/:id/answer', (req, res) => {
  const rating = req.body?.rating;

  if (rating !== 'forgot' && rating !== 'hard' && rating !== 'good' && rating !== 'easy') {
    res.status(400).json({ error: 'Invalid rating' });
    return;
  }

  try {
    const updatedItem = submitReviewAnswer(req.params.id, rating);
    res.json(updatedItem);
  } catch (error) {
    if (error instanceof Error && error.message === 'Review item not found') {
      res.status(404).json({ error: error.message });
      return;
    }

    res.status(500).json({ error: 'Failed to update review item' });
  }
});

app.listen(port, () => {
  console.log(`Backend server running at http://localhost:${port}`);
  console.log(`Mode: ${dbConfig.mode}`);
  console.log(`Database: ${dbConfig.dbPath}`);
});
