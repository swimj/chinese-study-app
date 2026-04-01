import cors from 'cors';
import express from 'express';
import { getDueReviewItems, getReviewItems, getWords } from './db.ts';

const app = express();
const port = Number(process.env.PORT ?? 5174);

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
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.listen(port, () => {
  console.log(`Backend server running at http://localhost:${port}`);
});
