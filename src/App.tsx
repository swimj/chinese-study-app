import { useEffect, useMemo, useState } from 'react';
import type { ReviewItem, ReviewRating, Word } from './types';
import type { BackendStatus } from './services/api';
import {
  completeLearningSession,
  completeReviewSession,
  completeUnstudiedSession,
  fetchSessionItems,
  fetchStatus,
  fetchWords,
} from './services/api';

type LearningWordProgress = {
  coveredDirections: Record<'forward' | 'reverse', boolean>;
  firstTryGood: Record<'forward' | 'reverse', boolean>;
  attempts: Record<'forward' | 'reverse', number>;
};

type UnstudiedWordProgress = {
  introComplete: boolean;
  consecutiveSuccesses: Record<'forward' | 'reverse', number>;
};

type ReviewItemProgress = {
  failureCount: number;
  reinforcementStreak: number;
};

function App() {
  const [words, setWords] = useState<Word[]>([]);
  const [sessionPreviewItems, setSessionPreviewItems] = useState<ReviewItem[]>([]);
  const [activeSessionItems, setActiveSessionItems] = useState<ReviewItem[]>([]);
  const [backendStatus, setBackendStatus] = useState<BackendStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [answerRevealed, setAnswerRevealed] = useState(false);
  const [submittingRating, setSubmittingRating] = useState<ReviewRating | null>(null);
  const [answeredCount, setAnsweredCount] = useState(0);
  const [learningProgress, setLearningProgress] = useState<Record<string, LearningWordProgress>>({});
  const [unstudiedProgress, setUnstudiedProgress] = useState<Record<string, UnstudiedWordProgress>>({});
  const [reviewProgress, setReviewProgress] = useState<Record<string, ReviewItemProgress>>({});

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

  const displayedSessionItems = sessionStarted ? activeSessionItems : sessionPreviewItems;
  const activeItem = sessionStarted ? activeSessionItems[0] ?? null : null;
  const activeWord = activeItem ? wordsById.get(activeItem.wordId) ?? null : null;
  const activeLearningProgress = activeWord ? learningProgress[activeWord.id] : undefined;
  const activeUnstudiedProgress = activeWord ? unstudiedProgress[activeWord.id] : undefined;
  const activeReviewProgress = activeItem ? reviewProgress[activeItem.id] : undefined;
  const reviewedCount = sessionStarted ? answeredCount : 0;
  const wordStatusCounts = countWordStatuses(words);
  const learningWords = words.filter((word) => word.status === 'learning');
  const unstudiedWords = words.filter((word) => word.status === 'unstudied');
  const activePrompt =
    activeItem && activeWord
      ? activeItem.direction === 'forward'
        ? activeWord.hanzi
        : activeWord.meaning
      : null;
  const activeAnswer =
    activeItem && activeWord
      ? activeItem.direction === 'forward'
        ? `${activeWord.meaning} (${activeWord.pinyin})`
        : `${activeWord.hanzi} (${activeWord.pinyin})`
      : null;
  const activeReviewState =
    activeReviewProgress && activeReviewProgress.failureCount > 0 ? 'Reinforcement active' : 'Initial recall';
  const ratingOptions: Array<{ value: ReviewRating; label: string; note: string }> = [
    { value: 'forgot', label: 'Forgot', note: 'Counts as a failure and may trigger same-session reinforcement.' },
    { value: 'hard', label: 'Hard', note: 'Successful recall with effort.' },
    { value: 'good', label: 'Good', note: 'Successful recall with normal confidence.' },
    { value: 'easy', label: 'Easy', note: 'Successful recall with strong confidence.' },
  ];

  async function reloadDashboard() {
    const [wordsResponse, sessionItemsResponse, statusResponse] = await Promise.all([
      fetchWords(),
      fetchSessionItems(),
      fetchStatus(),
    ]);
    setWords(wordsResponse);
    setSessionPreviewItems(sessionItemsResponse);
    setBackendStatus(statusResponse);
  }

  async function handleStartSession() {
    setSessionLoading(true);
    setError(null);

    try {
      const [wordsResponse, sessionItemsResponse, statusResponse] = await Promise.all([
        fetchWords(),
        fetchSessionItems(),
        fetchStatus(),
      ]);

      setWords(wordsResponse);
      setSessionPreviewItems(sessionItemsResponse);
      setBackendStatus(statusResponse);
      setActiveSessionItems(sessionItemsResponse);
      setLearningProgress({});
      setUnstudiedProgress({});
      setReviewProgress({});
      setAnsweredCount(0);
      setAnswerRevealed(false);
      setSessionStarted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSessionLoading(false);
    }
  }

  async function handleEndSession() {
    setSessionStarted(false);
    setActiveSessionItems([]);
    setLearningProgress({});
    setUnstudiedProgress({});
    setReviewProgress({});
    setAnswerRevealed(false);
    await reloadDashboard();
  }

  async function handleRate(rating: ReviewRating) {
    if (!activeItem || !activeWord) {
      return;
    }

    setSubmittingRating(rating);
    setError(null);

    try {
      if (activeWord.status === 'review') {
        await handleReviewAttempt(activeItem, rating);
      } else if (activeWord.status === 'learning') {
        await handleLearningAttempt(activeItem, activeWord, rating);
      } else {
        await handleUnstudiedAttempt(activeItem, activeWord, rating);
      }

      setAnsweredCount((count) => count + 1);
      setAnswerRevealed(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSubmittingRating(null);
    }
  }

  async function handleReviewAttempt(item: ReviewItem, rating: ReviewRating) {
    const currentProgress = reviewProgress[item.id] ?? { failureCount: 0, reinforcementStreak: 0 };

    if (currentProgress.failureCount === 0 && rating !== 'forgot') {
      const updatedItem = await completeReviewSession(item.id, 0, rating);
      setWords((currentWords) => currentWords);
      setReviewProgress((current) => {
        const copy = { ...current };
        delete copy[item.id];
        return copy;
      });
      setActiveSessionItems((currentItems) => currentItems.filter((queuedItem) => queuedItem.id !== item.id));
      setSessionPreviewItems((currentItems) =>
        currentItems.map((queuedItem) => (queuedItem.id === updatedItem.id ? updatedItem : queuedItem)),
      );
      return;
    }

    const nextProgress: ReviewItemProgress = {
      failureCount: currentProgress.failureCount + (rating === 'forgot' ? 1 : 0),
      reinforcementStreak: rating === 'forgot' ? 0 : currentProgress.reinforcementStreak + 1,
    };

    if (nextProgress.reinforcementStreak >= 3) {
      await completeReviewSession(item.id, nextProgress.failureCount, null);
      setReviewProgress((current) => {
        const copy = { ...current };
        delete copy[item.id];
        return copy;
      });
      setActiveSessionItems((currentItems) => currentItems.filter((queuedItem) => queuedItem.id !== item.id));
      return;
    }

    setReviewProgress((current) => ({ ...current, [item.id]: nextProgress }));
    setActiveSessionItems((currentItems) => rotateCurrentItem(currentItems));
  }

  async function handleLearningAttempt(item: ReviewItem, word: Word, rating: ReviewRating) {
    const currentProgress = learningProgress[word.id] ?? createInitialLearningProgress();
    const direction = item.direction;
    const nextProgress: LearningWordProgress = {
      coveredDirections: { ...currentProgress.coveredDirections },
      firstTryGood: { ...currentProgress.firstTryGood },
      attempts: { ...currentProgress.attempts },
    };

    nextProgress.attempts[direction] += 1;

    if (rating === 'good') {
      nextProgress.coveredDirections[direction] = true;
      if (nextProgress.attempts[direction] === 1) {
        nextProgress.firstTryGood[direction] = true;
      }
    }

    const bothCovered = nextProgress.coveredDirections.forward && nextProgress.coveredDirections.reverse;

    if (!bothCovered) {
      setLearningProgress((current) => ({ ...current, [word.id]: nextProgress }));
      setActiveSessionItems((currentItems) => {
        const remaining = currentItems.slice(1);
        return rating === 'good' ? remaining : [...remaining, item];
      });
      return;
    }

    const success = nextProgress.firstTryGood.forward && nextProgress.firstTryGood.reverse;
    const updatedWord = await completeLearningSession(word.id, success);

    setWords((currentWords) =>
      currentWords.map((entry) => (entry.id === updatedWord.id ? updatedWord : entry)),
    );
    setLearningProgress((current) => {
      const copy = { ...current };
      delete copy[word.id];
      return copy;
    });
    setActiveSessionItems((currentItems) => currentItems.filter((queuedItem) => queuedItem.wordId !== word.id));
  }

  async function handleUnstudiedAttempt(item: ReviewItem, word: Word, rating: ReviewRating) {
    const currentProgress = unstudiedProgress[word.id] ?? createInitialUnstudiedProgress();
    const direction = item.direction;
    const nextProgress: UnstudiedWordProgress = {
      introComplete: currentProgress.introComplete,
      consecutiveSuccesses: { ...currentProgress.consecutiveSuccesses },
    };

    if (rating === 'forgot') {
      nextProgress.consecutiveSuccesses[direction] = 0;
    } else {
      nextProgress.consecutiveSuccesses[direction] += 1;
    }

    const done =
      nextProgress.consecutiveSuccesses.forward >= 3 &&
      nextProgress.consecutiveSuccesses.reverse >= 3;

    if (!done) {
      setUnstudiedProgress((current) => ({ ...current, [word.id]: nextProgress }));
      setActiveSessionItems((currentItems) => rotateCurrentItem(currentItems));
      return;
    }

    const updatedWord = await completeUnstudiedSession(word.id);
    setWords((currentWords) =>
      currentWords.map((entry) => (entry.id === updatedWord.id ? updatedWord : entry)),
    );
    setUnstudiedProgress((current) => {
      const copy = { ...current };
      delete copy[word.id];
      return copy;
    });
    setActiveSessionItems((currentItems) => currentItems.filter((queuedItem) => queuedItem.wordId !== word.id));
  }

  function handleBeginUnstudiedDrill(wordId: string) {
    setUnstudiedProgress((current) => ({
      ...current,
      [wordId]: {
        ...(current[wordId] ?? createInitialUnstudiedProgress()),
        introComplete: true,
      },
    }));
  }

  return (
    <div className="container">
      <header className="header">
        <div>
          <h1 className="title">Mandarin SRS App</h1>
          <p className="subtitle">Covering criteria now run fully in frontend session state before commit.</p>
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
              <span className="stat-label">Learning / Review</span>
              <strong className="stat-value">{wordStatusCounts.learning} / {wordStatusCounts.review}</strong>
            </div>
            <div className="stat-card">
              <span className="stat-label">{sessionStarted ? 'Items left in session' : 'Session preview items'}</span>
              <strong className="stat-value">{displayedSessionItems.length}</strong>
            </div>
            <div className="stat-card">
              <span className="stat-label">Answered this session</span>
              <strong className="stat-value">{reviewedCount}</strong>
            </div>
          </div>
          <p className="notes">Learning coverage day: {backendStatus?.learningCoverageDate ?? 'Unknown'}.</p>
          {!sessionStarted ? (
            <button type="button" onClick={handleStartSession} disabled={sessionLoading || sessionPreviewItems.length === 0}>
              {sessionLoading ? 'Preparing session...' : 'Start session'}
            </button>
          ) : (
            <button type="button" onClick={handleEndSession}>
              End session
            </button>
          )}
          <h3>Session snapshot</h3>
          <ul className="word-list">
            {displayedSessionItems.map((item) => {
              const word = wordsById.get(item.wordId);
              return (
                <li key={item.id} className="word-item">
                  <div>
                    <strong>{word?.hanzi ?? item.wordId}</strong>
                    <span>{item.direction === 'forward' ? 'Hanzi → Meaning' : 'Meaning → Hanzi'}</span>
                  </div>
                  <div>{word?.meaning ?? 'Unknown word'}</div>
                </li>
              );
            })}
          </ul>
          <h3>Learning words</h3>
          <ul className="word-list">
            {learningWords.map((word) => (
              <li key={word.id} className="word-item">
                <div>
                  <strong>{word.hanzi}</strong>
                  <span>Streak {word.learningStreak}</span>
                </div>
                <div>{word.meaning}</div>
              </li>
            ))}
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
          <h2>Study session</h2>
          {!sessionStarted ? (
            <p className="notes">Start the session to freeze the current session snapshot into frontend state.</p>
          ) : !activeItem || !activeWord ? (
            <div className="stack">
              <p className="notes">No session items remain in the active snapshot.</p>
              <button type="button" onClick={handleEndSession}>
                Back to overview
              </button>
            </div>
          ) : activeWord.status === 'unstudied' && !activeUnstudiedProgress?.introComplete ? (
            <div className="review-card">
              <p className="badge">New word introduction</p>
              <div className="prompt-block">
                <span className="prompt-label">Hanzi</span>
                <strong className="prompt-value">{activeWord.hanzi}</strong>
                <span className="prompt-meta">{activeWord.pinyin} · {activeWord.meaning}</span>
                <span className="prompt-meta">{activeWord.examples[0]}</span>
              </div>
              <button type="button" onClick={() => handleBeginUnstudiedDrill(activeWord.id)}>
                Begin recall drills
              </button>
            </div>
          ) : (
            <div className="review-card">
              <p className="badge">
                {activeWord.status === 'review' ? 'Review' : activeWord.status === 'learning' ? 'Learning' : 'New word'}
                {' · '}
                {activeItem.direction === 'forward' ? 'Hanzi → Meaning' : 'Meaning → Hanzi'}
              </p>
              <p className="notes">Answered {reviewedCount} this session · {activeSessionItems.length} still queued.</p>
              <div className="prompt-block">
                <span className="prompt-label">Prompt</span>
                <strong className="prompt-value">{activePrompt}</strong>
                <span className="prompt-meta">
                  {activeWord.status === 'review'
                    ? `${activeReviewState} · Failures ${activeReviewProgress?.failureCount ?? 0}`
                    : activeWord.status === 'learning'
                      ? `Covered ${Number(activeLearningProgress?.coveredDirections.forward ?? false) + Number(activeLearningProgress?.coveredDirections.reverse ?? false)}/2 directions`
                      : `Consecutive successes ${activeUnstudiedProgress?.consecutiveSuccesses.forward ?? 0}/3 forward · ${activeUnstudiedProgress?.consecutiveSuccesses.reverse ?? 0}/3 reverse`}
                </span>
              </div>
              {answerRevealed ? (
                <div className="answer-block">
                  <span className="prompt-label">Answer</span>
                  <strong className="answer-value">{activeAnswer}</strong>
                  <span className="prompt-meta">
                    Interval {activeItem.intervalHours} hour{activeItem.intervalHours === 1 ? '' : 's'}
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
        Session coverage is now determined entirely in frontend state before durable backend updates are committed.
      </footer>
    </div>
  );
}

function createInitialLearningProgress(): LearningWordProgress {
  return {
    coveredDirections: {
      forward: false,
      reverse: false,
    },
    firstTryGood: {
      forward: false,
      reverse: false,
    },
    attempts: {
      forward: 0,
      reverse: 0,
    },
  };
}

function createInitialUnstudiedProgress(): UnstudiedWordProgress {
  return {
    introComplete: false,
    consecutiveSuccesses: {
      forward: 0,
      reverse: 0,
    },
  };
}

function countWordStatuses(words: Word[]) {
  return words.reduce(
    (counts, word) => {
      counts[word.status] += 1;
      return counts;
    },
    {
      unstudied: 0,
      learning: 0,
      review: 0,
    } as Record<Word['status'], number>,
  );
}

function rotateCurrentItem(items: ReviewItem[]) {
  if (items.length <= 1) {
    return items;
  }

  return [...items.slice(1), items[0]];
}

export default App;
