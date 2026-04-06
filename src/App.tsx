import { Fragment, useEffect, useMemo, useState } from 'react';
import type { ReviewItem, ReviewRating, Word } from './types';
import type { BackendStatus } from './services/api';
import {
  completeLearningSession,
  completeReviewSession,
  completeUnstudiedSession,
  fetchReviewItems,
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

type AppPage = 'home' | 'words';

type InspectableRow = {
  id: string;
  word: Word;
  status: 'learning' | 'review';
  nextScheduledAt: string | null;
  direction: ReviewItem['direction'] | null;
  intervalHours: number | null;
  reviewItem: ReviewItem | null;
  reviewItems: ReviewItem[];
};

const WORDS_PAGE_SIZE = 20;

function App() {
  const [currentPage, setCurrentPage] = useState<AppPage>('home');
  const [words, setWords] = useState<Word[]>([]);
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([]);
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
  const [wordsPageNumber, setWordsPageNumber] = useState(0);

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

  const reviewItemsByWordId = useMemo(() => {
    const grouped = new Map<string, ReviewItem[]>();

    for (const item of reviewItems) {
      const existing = grouped.get(item.wordId) ?? [];
      existing.push(item);
      grouped.set(item.wordId, existing);
    }

    for (const items of grouped.values()) {
      items.sort((left, right) => left.direction.localeCompare(right.direction));
    }

    return grouped;
  }, [reviewItems]);

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

  const inspectableRows = useMemo(() => {
    const rows: InspectableRow[] = [];

    for (const word of words) {
      if (word.status !== 'learning' && word.status !== 'review') {
        continue;
      }

      const items = reviewItemsByWordId.get(word.id) ?? [];

      if (word.status === 'learning') {
        rows.push({
          id: `word-${word.id}`,
          word,
          status: 'learning',
          nextScheduledAt: word.lastLearningCoveredOn ? `${word.lastLearningCoveredOn}T00:00:00` : null,
          direction: null,
          intervalHours: null,
          reviewItem: null,
          reviewItems: items,
        });
        continue;
      }

      for (const item of items) {
        rows.push({
          id: item.id,
          word,
          status: 'review',
          nextScheduledAt: item.nextDueAt,
          direction: item.direction,
          intervalHours: item.intervalHours,
          reviewItem: item,
          reviewItems: items,
        });
      }
    }

    rows.sort((left, right) => {
      const statusDelta = getStatusSortOrder(left.status) - getStatusSortOrder(right.status);
      if (statusDelta !== 0) {
        return statusDelta;
      }

      const leftScheduled = left.nextScheduledAt ?? '';
      const rightScheduled = right.nextScheduledAt ?? '';
      if (leftScheduled !== rightScheduled) {
        return leftScheduled.localeCompare(rightScheduled);
      }

      if (right.word.priority !== left.word.priority) {
        return right.word.priority - left.word.priority;
      }

      return left.word.createdAt.localeCompare(right.word.createdAt);
    });

    return rows;
  }, [reviewItemsByWordId, words]);

  const totalWordPages = Math.max(1, Math.ceil(inspectableRows.length / WORDS_PAGE_SIZE));
  const pagedInspectableRows = inspectableRows.slice(
    wordsPageNumber * WORDS_PAGE_SIZE,
    wordsPageNumber * WORDS_PAGE_SIZE + WORDS_PAGE_SIZE,
  );

  useEffect(() => {
    setWordsPageNumber((current) => Math.min(current, totalWordPages - 1));
  }, [totalWordPages]);

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

  const reviewRatingOptions: Array<{ value: ReviewRating; label: string; note: string }> = [
    { value: 'forgot', label: 'Forgot', note: 'Counts as a failure and may trigger same-session reinforcement.' },
    { value: 'hard', label: 'Hard', note: 'Successful recall with effort.' },
    { value: 'good', label: 'Good', note: 'Successful recall with normal confidence.' },
    { value: 'easy', label: 'Easy', note: 'Successful recall with strong confidence.' },
  ];

  const binaryRecallOptions: Array<{ value: ReviewRating; label: string; note: string }> = [
    { value: 'forgot', label: 'Forgot', note: 'Did not recall it correctly.' },
    { value: 'good', label: 'Good', note: 'Correct recall.' },
  ];

  const activeRatingOptions =
    activeWord?.status === 'review' ? reviewRatingOptions : binaryRecallOptions;

  async function reloadDashboard() {
    const [wordsResponse, reviewItemsResponse, sessionItemsResponse, statusResponse] = await Promise.all([
      fetchWords(),
      fetchReviewItems(),
      fetchSessionItems(),
      fetchStatus(),
    ]);

    setWords(wordsResponse);
    setReviewItems(reviewItemsResponse);
    setSessionPreviewItems(sessionItemsResponse);
    setBackendStatus(statusResponse);
  }

  async function handleStartSession() {
    setSessionLoading(true);
    setError(null);

    try {
      const [wordsResponse, reviewItemsResponse, sessionItemsResponse, statusResponse] = await Promise.all([
        fetchWords(),
        fetchReviewItems(),
        fetchSessionItems(),
        fetchStatus(),
      ]);

      setWords(wordsResponse);
      setReviewItems(reviewItemsResponse);
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
      setReviewItems((currentItems) =>
        currentItems.map((existing) => (existing.id === updatedItem.id ? updatedItem : existing)),
      );
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
      const updatedItem = await completeReviewSession(item.id, nextProgress.failureCount, null);
      setReviewItems((currentItems) =>
        currentItems.map((existing) => (existing.id === updatedItem.id ? updatedItem : existing)),
      );
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

    if (rating === 'good') {
      nextProgress.consecutiveSuccesses[direction] += 1;
    } else {
      nextProgress.consecutiveSuccesses[direction] = 0;
    }

    const done =
      nextProgress.consecutiveSuccesses.forward >= 3 &&
      nextProgress.consecutiveSuccesses.reverse >= 3;

    if (!done) {
      const directionCovered = nextProgress.consecutiveSuccesses[direction] >= 3;
      setUnstudiedProgress((current) => ({ ...current, [word.id]: nextProgress }));
      setActiveSessionItems((currentItems) => {
        if (directionCovered) {
          return currentItems.filter((queuedItem) => queuedItem.id !== item.id);
        }

        return rotateCurrentItem(currentItems);
      });
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
      <nav className="navbar" aria-label="Primary">
        <div className="nav-brand">
          <strong>Mandarin SRS App</strong>
          <span>Study workflow and inspection tools</span>
        </div>
        <div className="nav-tabs">
          <button
            type="button"
            className={`nav-tab ${currentPage === 'home' ? 'active' : ''}`}
            onClick={() => setCurrentPage('home')}
          >
            Home
          </button>
          <button
            type="button"
            className={`nav-tab ${currentPage === 'words' ? 'active' : ''}`}
            onClick={() => setCurrentPage('words')}
          >
            Words
          </button>
        </div>
      </nav>

      {error ? (
        <div className="panel">
          <h2>Error</h2>
          <p className="notes">{error}</p>
        </div>
      ) : null}

      {currentPage === 'home' ? (
        <>
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
                          ? `Binary recall · Covered ${Number(activeLearningProgress?.coveredDirections.forward ?? false) + Number(activeLearningProgress?.coveredDirections.reverse ?? false)}/2 directions`
                          : `Binary recall · Consecutive successes ${activeUnstudiedProgress?.consecutiveSuccesses.forward ?? 0}/3 forward · ${activeUnstudiedProgress?.consecutiveSuccesses.reverse ?? 0}/3 reverse`}
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
                      {activeRatingOptions.map((option) => (
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
        </>
      ) : (
        <WordsPage
          rows={pagedInspectableRows}
          currentPage={wordsPageNumber}
          totalPages={totalWordPages}
          totalItems={inspectableRows.length}
          pageSize={WORDS_PAGE_SIZE}
          onPreviousPage={() => setWordsPageNumber((current) => Math.max(0, current - 1))}
          onNextPage={() => setWordsPageNumber((current) => Math.min(totalWordPages - 1, current + 1))}
        />
      )}

      <footer className="footer">
        Session coverage is now determined entirely in frontend state before durable backend updates are committed.
      </footer>
    </div>
  );
}

function WordsPage({
  rows,
  currentPage,
  totalPages,
  totalItems,
  pageSize,
  onPreviousPage,
  onNextPage,
}: {
  rows: InspectableRow[];
  currentPage: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPreviousPage: () => void;
  onNextPage: () => void;
}) {
  const startIndex = totalItems === 0 ? 0 : currentPage * pageSize + 1;
  const endIndex = Math.min(totalItems, (currentPage + 1) * pageSize);
  const [expandedRowIds, setExpandedRowIds] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setExpandedRowIds((current) => {
      const next: Record<string, boolean> = {};

      for (const row of rows) {
        if (current[row.id]) {
          next[row.id] = true;
        }
      }

      return next;
    });
  }, [rows]);

  function toggleRow(rowId: string) {
    setExpandedRowIds((current) => ({
      ...current,
      [rowId]: !current[rowId],
    }));
  }

  return (
    <section className="words-page">
      <header className="header">
        <div>
          <h1 className="title">Words</h1>
          <p className="subtitle">Inspect all words currently in learning or review, plus their scheduling metadata.</p>
        </div>
        <div className="pagination-summary">
          <span className="badge">Showing {startIndex}-{endIndex} of {totalItems}</span>
        </div>
      </header>

      <div className="panel">
        <div className="pagination-bar">
          <p className="notes">
            Page {totalItems === 0 ? 0 : currentPage + 1} of {totalPages}
          </p>
          <div className="pagination-actions">
            <button type="button" onClick={onPreviousPage} disabled={currentPage === 0}>
              Previous
            </button>
            <button type="button" onClick={onNextPage} disabled={currentPage >= totalPages - 1 || totalItems === 0}>
              Next
            </button>
          </div>
        </div>

        {rows.length === 0 ? (
          <p className="notes">No words are currently in learning or review.</p>
        ) : (
          <div className="table-shell">
            <table className="words-table">
              <thead>
                <tr>
                  <th>Word</th>
                  <th>Status</th>
                  <th>Next scheduled date</th>
                  <th>Direction</th>
                  <th>Interval</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const isExpanded = Boolean(expandedRowIds[row.id]);

                  return (
                    <Fragment key={row.id}>
                      <tr
                        className={`table-row ${isExpanded ? 'expanded' : ''}`}
                        onClick={() => toggleRow(row.id)}
                      >
                        <td>
                          <div className="table-word-cell">
                            <strong>{row.word.hanzi}</strong>
                            <span>{row.word.pinyin}</span>
                          </div>
                        </td>
                        <td>
                          <span className={`status-pill status-${row.status}`}>{row.status}</span>
                        </td>
                        <td>{formatScheduledValue(row)}</td>
                        <td>{row.direction ? formatDirection(row.direction) : 'N/A'}</td>
                        <td>{row.intervalHours !== null ? `${row.intervalHours}h` : 'N/A'}</td>
                      </tr>
                      {isExpanded ? (
                        <tr className="detail-row">
                          <td colSpan={5}>
                            <div className="detail-panel">
                              <div className="word-record-header">
                                <div>
                                  <h2>{row.word.hanzi}</h2>
                                  <p className="notes">{row.word.pinyin} · {row.word.meaning}</p>
                                </div>
                                <span className={`status-pill status-${row.status}`}>{row.status}</span>
                              </div>

                              <dl className="metadata-grid">
                                <div>
                                  <dt>Word ID</dt>
                                  <dd>{row.word.id}</dd>
                                </div>
                                <div>
                                  <dt>Priority</dt>
                                  <dd>{row.word.priority}</dd>
                                </div>
                                <div>
                                  <dt>Learning streak</dt>
                                  <dd>{row.word.learningStreak}</dd>
                                </div>
                                <div>
                                  <dt>Created</dt>
                                  <dd>{formatDateTime(row.word.createdAt)}</dd>
                                </div>
                                <div>
                                  <dt>Last learning success</dt>
                                  <dd>{formatDate(row.word.lastLearningSuccessOn)}</dd>
                                </div>
                                <div>
                                  <dt>Last learning covered</dt>
                                  <dd>{formatDate(row.word.lastLearningCoveredOn)}</dd>
                                </div>
                              </dl>

                              {row.reviewItem ? (
                                <div className="review-items-section">
                                  <h3>Selected review item</h3>
                                  <dl className="metadata-grid compact">
                                    <div>
                                      <dt>Review item ID</dt>
                                      <dd>{row.reviewItem.id}</dd>
                                    </div>
                                    <div>
                                      <dt>Direction</dt>
                                      <dd>{formatDirection(row.reviewItem.direction)}</dd>
                                    </div>
                                    <div>
                                      <dt>Interval</dt>
                                      <dd>{row.reviewItem.intervalHours}h</dd>
                                    </div>
                                    <div>
                                      <dt>Ease factor</dt>
                                      <dd>{row.reviewItem.easeFactor.toFixed(2)}</dd>
                                    </div>
                                    <div>
                                      <dt>Last reviewed</dt>
                                      <dd>{formatDateTime(row.reviewItem.lastReviewedAt)}</dd>
                                    </div>
                                    <div>
                                      <dt>Next due</dt>
                                      <dd>{formatDateTime(row.reviewItem.nextDueAt)}</dd>
                                    </div>
                                  </dl>
                                </div>
                              ) : null}

                              <div className="review-items-section">
                                <h3>All review directions</h3>
                                {row.reviewItems.length === 0 ? (
                                  <p className="notes">No review items found for this word.</p>
                                ) : (
                                  <div className="review-items-grid">
                                    {row.reviewItems.map((item) => (
                                      <div key={item.id} className="review-item-card">
                                        <div className="review-item-topline">
                                          <strong>{formatDirection(item.direction)}</strong>
                                          <span className="badge">{item.id}</span>
                                        </div>
                                        <dl className="metadata-grid compact">
                                          <div>
                                            <dt>Interval</dt>
                                            <dd>{item.intervalHours}h</dd>
                                          </div>
                                          <div>
                                            <dt>Ease factor</dt>
                                            <dd>{item.easeFactor.toFixed(2)}</dd>
                                          </div>
                                          <div>
                                            <dt>Last reviewed</dt>
                                            <dd>{formatDateTime(item.lastReviewedAt)}</dd>
                                          </div>
                                          <div>
                                            <dt>Next due</dt>
                                            <dd>{formatDateTime(item.nextDueAt)}</dd>
                                          </div>
                                        </dl>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
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

function getStatusSortOrder(status: Word['status']) {
  switch (status) {
    case 'learning':
      return 0;
    case 'review':
      return 1;
    default:
      return 2;
  }
}

function formatDate(value: string | null) {
  if (!value) {
    return 'Never';
  }

  return new Date(`${value}T00:00:00`).toLocaleDateString();
}

function formatDateTime(value: string | null) {
  if (!value) {
    return 'Not scheduled';
  }

  return new Date(value).toLocaleString();
}

function formatDirection(direction: ReviewItem['direction']) {
  return direction === 'forward' ? 'Hanzi → Meaning' : 'Meaning → Hanzi';
}

function formatScheduledValue(row: InspectableRow) {
  if (row.status === 'learning') {
    return row.word.lastLearningCoveredOn ? formatDate(row.word.lastLearningCoveredOn) : 'Not yet covered';
  }

  return formatDateTime(row.nextScheduledAt);
}

function rotateCurrentItem(items: ReviewItem[]) {
  if (items.length <= 1) {
    return items;
  }

  return [...items.slice(1), items[0]];
}

export default App;
