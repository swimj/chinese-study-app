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
import {
  beginDrainSession,
  beginUnstudiedDrill,
  createSessionState,
  markCurrentItemStarted,
  rateCurrentItem,
  type SessionState,
} from './lib/session-state';

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

type SessionSummary = {
  startedAt: string;
  completedAt: string | null;
  initialQueueLength: number;
  answeredCount: number;
  completedReviewItems: number;
  encounteredReviewItemIds: string[];
  lapsedReviewItems: number;
  lapsedReviewLabels: string[];
  completedLearningWords: number;
  completedUnstudiedWords: number;
  completionMode: 'natural' | 'drain';
};

const WORDS_PAGE_SIZE = 20;

function App() {
  const [currentPage, setCurrentPage] = useState<AppPage>('home');
  const [words, setWords] = useState<Word[]>([]);
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([]);
  const [sessionPreviewItems, setSessionPreviewItems] = useState<ReviewItem[]>([]);
  const [backendStatus, setBackendStatus] = useState<BackendStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [sessionState, setSessionState] = useState<SessionState | null>(null);
  const [sessionSummary, setSessionSummary] = useState<SessionSummary | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [answerRevealed, setAnswerRevealed] = useState(false);
  const [submittingRating, setSubmittingRating] = useState<ReviewRating | null>(null);
  const [wordsPageNumber, setWordsPageNumber] = useState(0);
  const [sessionNow, setSessionNow] = useState(() => new Date().toISOString());

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

  const displayedSessionItems = sessionStarted ? sessionState?.queue ?? [] : sessionPreviewItems;
  const activeItem = sessionStarted ? sessionState?.queue[0] ?? null : null;
  const activeWord = activeItem ? wordsById.get(activeItem.wordId) ?? null : null;
  const activeLearningProgress = activeWord ? sessionState?.learningProgress[activeWord.id] : undefined;
  const activeUnstudiedProgress = activeWord ? sessionState?.unstudiedProgress[activeWord.id] : undefined;
  const activeReviewProgress = activeItem ? sessionState?.reviewProgress[activeItem.id] : undefined;
  const reviewedCount = sessionStarted ? sessionState?.answeredCount ?? 0 : 0;
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

  const activeAnswerText =
    activeItem && activeWord
      ? activeItem.direction === 'forward'
        ? activeWord.meaning
        : activeWord.hanzi
      : null;
  const activeAnswerPinyin = activeItem && activeWord ? activeWord.pinyin : null;

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
  const activeElapsedTime =
    sessionStarted && sessionSummary
      ? formatElapsedTime(sessionSummary.startedAt, sessionSummary.completedAt ?? sessionNow)
      : '0:00';

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
      const startedAt = new Date().toISOString();
      setSessionNow(startedAt);
      setSessionState(createSessionState(sessionItemsResponse));
      setSessionSummary({
        startedAt,
        completedAt: null,
        initialQueueLength: sessionItemsResponse.length,
        answeredCount: 0,
        completedReviewItems: 0,
        encounteredReviewItemIds: [],
        lapsedReviewItems: 0,
        lapsedReviewLabels: [],
        completedLearningWords: 0,
        completedUnstudiedWords: 0,
        completionMode: 'natural',
      });
      setAnswerRevealed(false);
      setSessionStarted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSessionLoading(false);
    }
  }

  async function handleEndSession() {
    if (sessionStarted && sessionState && sessionState.phase === 'active') {
      const drainedState = beginDrainSession(sessionState);
      setSessionState(drainedState);
      setSessionSummary((current) =>
        current
          ? {
              ...current,
              answeredCount: drainedState.answeredCount,
              completionMode: 'drain',
              completedAt:
                drainedState.phase === 'completed' && current.completedAt === null
                  ? new Date().toISOString()
                  : current.completedAt,
            }
          : current,
      );
      setAnswerRevealed(false);
      return;
    }

    setSessionStarted(false);
    setSessionState(null);
    setSessionSummary(null);
    setAnswerRevealed(false);
    await reloadDashboard();
  }

  async function handleRate(rating: ReviewRating) {
    if (!sessionState || !activeItem || !activeWord) {
      return;
    }

    setSubmittingRating(rating);
    setError(null);

    try {
      const transition = rateCurrentItem(sessionState, wordsById, rating);

      switch (transition.commit.type) {
        case 'commit-review-item-session': {
          const reviewCommit = transition.commit;
          const reviewEncounterLabel = formatReviewEncounterLabel(activeItem, activeWord);
          const updatedItem = await completeReviewSession(
            reviewCommit.reviewItemId,
            reviewCommit.failureCount,
            reviewCommit.terminalRating,
          );
          setReviewItems((currentItems) =>
            currentItems.map((existing) => (existing.id === updatedItem.id ? updatedItem : existing)),
          );
          setSessionPreviewItems((currentItems) =>
            currentItems.map((queuedItem) => (queuedItem.id === updatedItem.id ? updatedItem : queuedItem)),
          );
          setSessionSummary((current) =>
            current
              ? {
                  ...current,
                  completedReviewItems: current.completedReviewItems + 1,
                  encounteredReviewItemIds: current.encounteredReviewItemIds.includes(reviewCommit.reviewItemId)
                    ? current.encounteredReviewItemIds
                    : [...current.encounteredReviewItemIds, reviewCommit.reviewItemId],
                  lapsedReviewItems:
                    current.lapsedReviewItems + (reviewCommit.terminalRating === null ? 1 : 0),
                  lapsedReviewLabels:
                    reviewCommit.terminalRating === null
                      ? [...current.lapsedReviewLabels, reviewEncounterLabel]
                      : current.lapsedReviewLabels,
                }
              : current,
          );
          break;
        }
        case 'commit-learning-word-session': {
          const updatedWord = await completeLearningSession(
            transition.commit.wordId,
            transition.commit.success,
          );
          setWords((currentWords) =>
            currentWords.map((entry) => (entry.id === updatedWord.id ? updatedWord : entry)),
          );
          setSessionSummary((current) =>
            current
              ? {
                  ...current,
                  completedLearningWords: current.completedLearningWords + 1,
                }
              : current,
          );
          break;
        }
        case 'commit-unstudied-word-session': {
          const updatedWord = await completeUnstudiedSession(transition.commit.wordId);
          setWords((currentWords) =>
            currentWords.map((entry) => (entry.id === updatedWord.id ? updatedWord : entry)),
          );
          setSessionSummary((current) =>
            current
              ? {
                  ...current,
                  completedUnstudiedWords: current.completedUnstudiedWords + 1,
                }
              : current,
          );
          break;
        }
        case 'none':
          break;
      }

      setSessionState(transition.state);
      setSessionSummary((current) =>
        current
          ? {
              ...current,
              answeredCount: transition.state.answeredCount,
              completedAt:
                transition.state.phase === 'completed' && current.completedAt === null
                  ? new Date().toISOString()
                  : current.completedAt,
              completionMode:
                transition.state.phase === 'completed'
                  ? sessionState.phase === 'draining'
                    ? 'drain'
                    : current.completionMode
                  : current.completionMode,
            }
          : current,
      );
      setAnswerRevealed(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSubmittingRating(null);
    }
  }

  function handleBeginUnstudiedDrill(wordId: string) {
    setSessionState((current) => (current ? beginUnstudiedDrill(current, wordId) : current));
  }

  useEffect(() => {
    if (!sessionStarted || !sessionState || answerRevealed) {
      return;
    }

    setSessionState((current) => (current ? markCurrentItemStarted(current) : current));
  }, [answerRevealed, sessionStarted, sessionState]);

  useEffect(() => {
    if (!sessionStarted || sessionState?.phase === 'completed' || !sessionSummary) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setSessionNow(new Date().toISOString());
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [sessionStarted, sessionState?.phase, sessionSummary?.startedAt]);

  useEffect(() => {
    if (!sessionStarted || !sessionState || sessionState.phase === 'completed') {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || submittingRating !== null) {
        return;
      }

      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      if (event.key === ' ') {
        event.preventDefault();

        if (activeWord?.status === 'unstudied' && !activeUnstudiedProgress?.introComplete) {
          handleBeginUnstudiedDrill(activeWord.id);
          return;
        }

        if (!answerRevealed) {
          setAnswerRevealed(true);
          return;
        }

        if (activeWord && activeWord.status !== 'review') {
          void handleRate('good');
        }
        return;
      }

      if (!answerRevealed) {
        return;
      }

      const ratingByKey: Partial<Record<string, ReviewRating>> = {
        '1': 'forgot',
        '2': 'hard',
        '3': 'good',
        '4': 'easy',
      };

      const nextRating = ratingByKey[event.key];
      if (!nextRating) {
        return;
      }

      const ratingAllowed = activeRatingOptions.some((option) => option.value === nextRating);
      if (!ratingAllowed) {
        return;
      }

      event.preventDefault();
      void handleRate(nextRating);
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    activeRatingOptions,
    activeUnstudiedProgress?.introComplete,
    activeWord,
    answerRevealed,
    sessionStarted,
    sessionState,
    submittingRating,
  ]);

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
                  {sessionState?.phase === 'active'
                    ? 'End session'
                    : sessionState?.phase === 'completed'
                      ? 'Close summary'
                      : 'Back to overview'}
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
              ) : sessionState?.phase === 'completed' && sessionSummary ? (
                <SessionSummaryPanel summary={sessionSummary} />
              ) : !activeItem || !activeWord ? (
                <div className="stack">
                  <p className="notes">
                    No session items remain in the active snapshot.
                  </p>
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
                    {sessionState?.phase === 'draining' ? 'Draining' : activeWord.status === 'review' ? 'Review' : activeWord.status === 'learning' ? 'Learning' : 'New word'}
                    {' · '}
                    {activeItem.direction === 'forward' ? 'Hanzi → Meaning' : 'Meaning → Hanzi'}
                  </p>
                  <p className="notes">
                    Answered {reviewedCount} this session · {sessionState?.queue.length ?? 0} still queued · Elapsed {activeElapsedTime}
                  </p>
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
                      <span className="answer-pinyin">{activeAnswerPinyin}</span>
                      <strong className="answer-value">{activeAnswerText}</strong>
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

function SessionSummaryPanel({ summary }: { summary: SessionSummary }) {
  const elapsedLabel = formatElapsedTime(summary.startedAt, summary.completedAt ?? new Date().toISOString());

  return (
    <div className="summary-card">
      <p className="badge">
        {summary.completionMode === 'drain' ? 'Session complete via drain mode' : 'Session complete'}
      </p>
      <h3>Session summary</h3>
      <p className="notes">
        {summary.completionMode === 'drain'
          ? 'You ended intake and finished the remaining open work.'
          : 'You naturally exhausted the session queue.'}
      </p>
      <div className="summary-topline">
        <span className="badge">Unique review items encountered {summary.encounteredReviewItemIds.length}</span>
        <span className="badge">Lapses {summary.lapsedReviewItems}</span>
      </div>
      {summary.lapsedReviewLabels.length > 0 ? (
        <div className="summary-lapses">
          <p className="notes">Lapsed review items</p>
          <ul className="word-list">
            {summary.lapsedReviewLabels.map((label, index) => (
              <li key={`${label}-${index}`} className="word-item">
                <div>
                  <strong>{label}</strong>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="summary-grid">
        <div className="stat-card">
          <span className="stat-label">Elapsed time</span>
          <strong className="stat-value">{elapsedLabel}</strong>
        </div>
        <div className="stat-card">
          <span className="stat-label">Answers given</span>
          <strong className="stat-value">{summary.answeredCount}</strong>
        </div>
        <div className="stat-card">
          <span className="stat-label">Session items at start</span>
          <strong className="stat-value">{summary.initialQueueLength}</strong>
        </div>
        <div className="stat-card">
          <span className="stat-label">Review items completed</span>
          <strong className="stat-value">{summary.completedReviewItems}</strong>
        </div>
        <div className="stat-card">
          <span className="stat-label">Learning words covered</span>
          <strong className="stat-value">{summary.completedLearningWords}</strong>
        </div>
        <div className="stat-card">
          <span className="stat-label">New words introduced</span>
          <strong className="stat-value">{summary.completedUnstudiedWords}</strong>
        </div>
      </div>
      <p className="notes">
        Started {formatDateTime(summary.startedAt)}{summary.completedAt ? ` · Completed ${formatDateTime(summary.completedAt)}` : ''}
      </p>
    </div>
  );
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

function formatReviewEncounterLabel(item: ReviewItem, word: Word) {
  return item.direction === 'forward'
    ? `${word.hanzi} -> ${word.meaning}`
    : `${word.meaning} -> ${word.hanzi}`;
}

function formatElapsedTime(startedAt: string, completedAt: string) {
  const elapsedMs = Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime());
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes < 60) {
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}:${remainingMinutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function formatScheduledValue(row: InspectableRow) {
  if (row.status === 'learning') {
    return row.word.lastLearningCoveredOn ? formatDate(row.word.lastLearningCoveredOn) : 'Not yet covered';
  }

  return formatDateTime(row.nextScheduledAt);
}

export default App;
