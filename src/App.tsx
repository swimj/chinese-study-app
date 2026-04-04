import { useEffect, useMemo, useState } from 'react';
import type { ReviewItem, ReviewRating, Word } from './types';
import type { BackendStatus } from './services/api';
import { fetchReviewItems, fetchStatus, fetchWords, introduceNewWords, submitReviewAnswer } from './services/api';

function App() {
  const [words, setWords] = useState<Word[]>([]);
  const [dueItems, setDueItems] = useState<ReviewItem[]>([]);
  const [backendStatus, setBackendStatus] = useState<BackendStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [answerRevealed, setAnswerRevealed] = useState(false);
  const [submittingRating, setSubmittingRating] = useState<ReviewRating | null>(null);
  const [answeredCount, setAnsweredCount] = useState(0);
  const [introducingWords, setIntroducingWords] = useState(false);

  async function reloadDashboard() {
    const [wordsResponse, reviewItemsResponse, statusResponse] = await Promise.all([
      fetchWords(),
      fetchReviewItems(true),
      fetchStatus(),
    ]);
    setWords(wordsResponse);
    setDueItems(reviewItemsResponse);
    setBackendStatus(statusResponse);
  }

  useEffect(() => {
    async function loadData() {
      try {
        await reloadDashboard();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      }
    }

    loadData();
  }, []);

  const wordsById = useMemo(
    () => new Map(words.map((word) => [word.id, word])),
    [words],
  );

  const activeReviewItem = dueItems[0] ?? null;
  const activeWord = activeReviewItem ? wordsById.get(activeReviewItem.wordId) ?? null : null;

  async function handleRate(rating: ReviewRating) {
    if (!activeReviewItem) {
      return;
    }

    setSubmittingRating(rating);
    setError(null);

    try {
      await submitReviewAnswer(activeReviewItem.id, rating);
      await reloadDashboard();
      setAnsweredCount((count) => count + 1);
      setAnswerRevealed(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSubmittingRating(null);
    }
  }

  async function handleIntroduceWords() {
    setIntroducingWords(true);
    setError(null);

    try {
      await introduceNewWords();
      await reloadDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIntroducingWords(false);
    }
  }

  const reviewedCount = sessionStarted ? answeredCount : 0;
  const wordStatusCounts = backendStatus?.wordStatusCounts ?? {
    unstudied: 0,
    learning: 0,
    review: 0,
    mature: 0,
  };
  const unstudiedWords = words.filter((word) => word.status === 'unstudied');
  const activePrompt =
    activeReviewItem && activeWord
      ? activeReviewItem.direction === 'forward'
        ? activeWord.hanzi
        : activeWord.meaning
      : null;
  const activeAnswer =
    activeReviewItem && activeWord
      ? activeReviewItem.direction === 'forward'
        ? `${activeWord.meaning} (${activeWord.pinyin})`
        : `${activeWord.hanzi} (${activeWord.pinyin})`
      : null;
  const ratingOptions: Array<{ value: ReviewRating; label: string; note: string }> = [
    { value: 'forgot', label: 'Forgot', note: 'Reset this direction to immediate re-review.' },
    { value: 'hard', label: 'Hard', note: 'Small step forward for a shaky answer.' },
    { value: 'good', label: 'Good', note: 'Normal progress for a correct answer.' },
    { value: 'easy', label: 'Easy', note: 'Give this direction a bigger jump.' },
  ];

  return (
    <div className="container">
      <header className="header">
        <div>
          <h1 className="title">Mandarin SRS App</h1>
          <p className="subtitle">Unit 3: separate unstudied words from active review and introduce them gradually.</p>
        </div>
        <div>
          <p className="badge">
            Backend: {backendStatus ? `${backendStatus.mode} @ ${new Date(backendStatus.time).toLocaleTimeString()}` : 'Unknown'}
          </p>
          {backendStatus ? <p className="status-meta">{backendStatus.dbPath}</p> : null}
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
          <h2>Overview</h2>
          <p className="notes">Loaded {words.length} words from the backend.</p>
          <div className="stack">
            <div className="stat-card">
              <span className="stat-label">Unstudied</span>
              <strong className="stat-value">{wordStatusCounts.unstudied}</strong>
            </div>
            <div className="stat-card">
              <span className="stat-label">Learning / Review / Mature</span>
              <strong className="stat-value">
                {wordStatusCounts.learning} / {wordStatusCounts.review} / {wordStatusCounts.mature}
              </strong>
            </div>
            <div className="stat-card">
              <span className="stat-label">Due now</span>
              <strong className="stat-value">{dueItems.length}</strong>
            </div>
            <div className="stat-card">
              <span className="stat-label">Reviewed this session</span>
              <strong className="stat-value">{reviewedCount}</strong>
            </div>
          </div>
          <div className="stack">
            <p className="notes">
              Daily new-word limit: {backendStatus?.dailyNewWordLimit ?? 0}. Introduced today:{' '}
              {backendStatus?.introducedToday ?? 0}. Remaining today: {backendStatus?.remainingToday ?? 0}.
            </p>
            <button
              type="button"
              onClick={handleIntroduceWords}
              disabled={introducingWords || (backendStatus?.remainingToday ?? 0) === 0 || unstudiedWords.length === 0}
            >
              {introducingWords ? 'Introducing...' : 'Introduce today’s new words'}
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              if (!sessionStarted) {
                setAnsweredCount(0);
              }
              setAnswerRevealed(false);
              setSessionStarted(true);
            }}
            disabled={dueItems.length === 0}
          >
            {sessionStarted ? 'Resume review' : 'Start review'}
          </button>
          <h3>Upcoming queue</h3>
          <ul className="word-list">
            {dueItems.map((item) => {
              const word = wordsById.get(item.wordId);
              return (
                <li key={item.id} className="word-item">
                  <div>
                    <strong>{word?.hanzi ?? item.wordId}</strong>
                    <span>{item.direction === 'forward' ? 'Hanzi → Meaning' : 'Meaning → Hanzi'}</span>
                  </div>
                  <div>{word?.meaning ?? item.status}</div>
                </li>
              );
            })}
          </ul>
          <h3>Unstudied words</h3>
          <ul className="word-list">
            {unstudiedWords.map((word) => (
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
          <h2>Review session</h2>
          {!sessionStarted ? (
            <p className="notes">Start the session to review one direction at a time.</p>
          ) : !activeReviewItem || !activeWord ? (
            <div className="stack">
              <p className="notes">No due review items remain in this session.</p>
              <button type="button" onClick={() => setSessionStarted(false)}>
                Back to overview
              </button>
            </div>
          ) : (
            <div className="review-card">
              <p className="badge">
                {activeReviewItem.direction === 'forward' ? 'Hanzi → Meaning' : 'Meaning → Hanzi'}
              </p>
              <p className="notes">Answered {reviewedCount} this session · {dueItems.length} still due.</p>
              <div className="prompt-block">
                <span className="prompt-label">Prompt</span>
                <strong className="prompt-value">{activePrompt}</strong>
                <span className="prompt-meta">Word status: {activeWord.status}</span>
              </div>
              {answerRevealed ? (
                <div className="answer-block">
                  <span className="prompt-label">Answer</span>
                  <strong className="answer-value">{activeAnswer}</strong>
                  <span className="prompt-meta">
                    Status {activeReviewItem.status} · Interval {activeReviewItem.intervalDays} day
                    {activeReviewItem.intervalDays === 1 ? '' : 's'}
                  </span>
                  <span className="prompt-meta">{activeWord.examples[0]}</span>
                </div>
              ) : (
                <button type="button" onClick={() => setAnswerRevealed(true)}>
                  Reveal answer
                </button>
              )}

              {answerRevealed ? (
                <div className="rating-grid">
                  {ratingOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className="rating-button"
                      onClick={() => handleRate(option.value)}
                      disabled={submittingRating !== null}
                    >
                      <strong>{option.label}</strong>
                      <span>{option.note}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>

      <footer className="footer">
        Unit 3: unstudied words stay out of review until you explicitly introduce them.
      </footer>
    </div>
  );
}

export default App;
