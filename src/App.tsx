import { useEffect, useState } from 'react';
import type { ReviewItem, Word } from './types';
import { fetchReviewItems, fetchStatus, fetchWords } from './services/api';

function App() {
  const [words, setWords] = useState<Word[]>([]);
  const [dueItems, setDueItems] = useState<ReviewItem[]>([]);
  const [backendStatus, setBackendStatus] = useState('Unknown');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadData() {
      try {
        const [wordsResponse, reviewItemsResponse, statusResponse] = await Promise.all([
          fetchWords(),
          fetchReviewItems(true),
          fetchStatus(),
        ]);
        setWords(wordsResponse);
        setDueItems(reviewItemsResponse);
        setBackendStatus(`${statusResponse.status} @ ${new Date(statusResponse.time).toLocaleTimeString()}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      }
    }

    loadData();
  }, []);

  return (
    <div className="container">
      <header className="header">
        <div>
          <h1 className="title">Mandarin SRS App</h1>
          <p className="subtitle">Unit 1: backend + SQLite persistence demo.</p>
        </div>
        <div>
          <p className="badge">Backend: {backendStatus}</p>
        </div>
      </header>

      {error ? (
        <div className="panel">
          <h2>Error</h2>
          <p className="notes">{error}</p>
        </div>
      ) : null}

      <div className="grid">
        <div className="panel">
          <h2>Word list</h2>
          <p className="notes">Loaded {words.length} words from the backend.</p>
          <ul className="word-list">
            {words.map((word) => (
              <li key={word.id} className="word-item">
                <div>
                  <strong>{word.hanzi}</strong>
                  <span>{word.pinyin}</span>
                </div>
                <div>{word.meaning}</div>
              </li>
            ))}
          </ul>
        </div>

        <div className="panel">
          <h2>Due review items</h2>
          <p className="notes">{dueItems.length} review directions are due now.</p>
          <ul className="word-list">
            {dueItems.map((item) => (
              <li key={item.id} className="word-item">
                <div>
                  <strong>{item.direction === 'forward' ? 'Hanzi → Meaning' : 'Meaning → Hanzi'}</strong>
                  <span>{item.status}</span>
                </div>
                <div>
                  <small>Interval {item.intervalDays}d</small>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <footer className="footer">
        Unit 1: backend connected, sample data loaded, SQLite persistence ready.
      </footer>
    </div>
  );
}

export default App;
