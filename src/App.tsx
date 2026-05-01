import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { PriorityWord, ReviewItem, ReviewRating, SessionItemWithWord, Word, WordMeaning } from './types';
import type { BackendStatus, SessionPayload } from './services/api';
import {
  addUnstudiedPriorityByHanzi,
  completeLearningSession,
  completeReviewSession,
  completeUnstudiedSession,
  dismissWordFromStudy,
  fetchWordMeanings,
  fetchReviewItems,
  fetchUnstudiedPriorityWords,
  fetchSessionPayload,
  fetchStatus,
  fetchWords,
  updateWordMeaningVisibility,
  updateWordPersonalNotes,
  updateWordUserPriority,
} from './services/api';
import {
  beginDrainSession,
  dismissCurrentItemFromSession,
  beginUnstudiedDrill,
  createSessionState,
  markCurrentItemStarted,
  rateCurrentItem,
  type SessionCommitIntent,
  type SessionState,
} from './lib/session-state';
import { cloneSessionScheduler, getSchedulerActiveItem, getSchedulerLength } from './lib/session-scheduler';

type AppPage = 'home' | 'words' | 'priority';

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
  lapsedReviewItemIds: string[];
  completedLearningWords: number;
  completedUnstudiedWords: number;
  completionMode: 'natural' | 'drain';
};

type SessionUndoSnapshot = {
  sessionState: SessionState;
  sessionSummary: SessionSummary | null;
  restoreUi: 'revealed' | 'production-input';
};

type DeferredSessionCommit = Exclude<SessionCommitIntent, { type: 'none' }>;

// When the user submits the wrong hanzi in production training,
// the system internally rates it as "forgot", and typically rating
// is the transition step for session queue manipulation.
// But in this case, at the UI level we do not want to immediately move
// to the next card yet, we want to show the card to the user so they can
// review where they messed up. This object represents that mask over the
// session's active word concept.
type FrozenProductionCard = {
  status: Word['status'];
  reviewedCount: number;
  queuedCount: number;
  promptDisplayedMeanings: string[];
  fallbackPrompt: string;
  answerPinyin: string;
  answerText: string;
  allMeanings: string[];
  personalNotes: string;
  intervalHours: number;
  example: string;
};

const WORDS_PAGE_SIZE = 20;
const APP_VERSION = __APP_VERSION__;

type SessionPrefetchStatus = 'idle' | 'pending' | 'ready' | 'error';

type SessionPrefetchState = {
  status: SessionPrefetchStatus;
  payload: SessionPayload | null;
  fetchedAt: string | null;
  error: string | null;
};

let sessionPrefetchPromise: Promise<SessionPayload> | null = null;
let sessionPrefetchStateCache: SessionPrefetchState = {
  status: 'idle',
  payload: null,
  fetchedAt: null,
  error: null,
};

function getSessionPrefetchSnapshot(): SessionPrefetchState {
  return {
    ...sessionPrefetchStateCache,
  };
}

function resetSessionPrefetchCache() {
  sessionPrefetchPromise = null;
  sessionPrefetchStateCache = {
    status: 'idle',
    payload: null,
    fetchedAt: null,
    error: null,
  };
}

function beginSessionPrefetch(): Promise<SessionPayload> {
  if (sessionPrefetchStateCache.status === 'ready' && sessionPrefetchStateCache.payload) {
    return Promise.resolve(sessionPrefetchStateCache.payload);
  }

  if (sessionPrefetchStateCache.status === 'pending' && sessionPrefetchPromise) {
    return sessionPrefetchPromise;
  }

  sessionPrefetchStateCache = {
    status: 'pending',
    payload: null,
    fetchedAt: null,
    error: null,
  };

  sessionPrefetchPromise = fetchSessionPayload()
    .then((payload) => {
      sessionPrefetchStateCache = {
        status: 'ready',
        payload,
        fetchedAt: new Date().toISOString(),
        error: null,
      };
      sessionPrefetchPromise = null;
      return payload;
    })
    .catch((error) => {
      sessionPrefetchStateCache = {
        status: 'error',
        payload: null,
        fetchedAt: null,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
      sessionPrefetchPromise = null;
      throw error;
    });

  return sessionPrefetchPromise;
}

function App() {
  const [currentPage, setCurrentPage] = useState<AppPage>('home');
  const [words, setWords] = useState<Word[]>([]);
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([]);
  const [backendStatus, setBackendStatus] = useState<BackendStatus | null>(null);
  const [sessionPrefetch, setSessionPrefetch] = useState<SessionPrefetchState>(() => getSessionPrefetchSnapshot());
  const [error, setError] = useState<string | null>(null);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [sessionState, setSessionState] = useState<SessionState | null>(null);
  const [sessionSummary, setSessionSummary] = useState<SessionSummary | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [wordsPageLoading, setWordsPageLoading] = useState(false);
  const [priorityPageLoading, setPriorityPageLoading] = useState(false);
  const [priorityWords, setPriorityWords] = useState<PriorityWord[]>([]);
  const [priorityUnstudiedTotalCount, setPriorityUnstudiedTotalCount] = useState(0);
  const [prioritySearchHanzi, setPrioritySearchHanzi] = useState('');
  const [prioritySearchSubmitting, setPrioritySearchSubmitting] = useState(false);
  const [prioritySearchNotice, setPrioritySearchNotice] = useState<string | null>(null);
  const [priorityJumpRequestWordId, setPriorityJumpRequestWordId] = useState<string | null>(null);
  const [updatingPriorityWordId, setUpdatingPriorityWordId] = useState<string | null>(null);
  const [answerRevealed, setAnswerRevealed] = useState(false);
  const [submittingRating, setSubmittingRating] = useState<ReviewRating | null>(null);
  const [pendingSessionCommit, setPendingSessionCommit] = useState<DeferredSessionCommit | null>(null);
  const [lastUndoSnapshot, setLastUndoSnapshot] = useState<SessionUndoSnapshot | null>(null);
  const [wordsPageNumber, setWordsPageNumber] = useState(0);
  const [sessionNow, setSessionNow] = useState(() => new Date().toISOString());
  const [sessionPersonalNotesOverridesByWordId, setSessionPersonalNotesOverridesByWordId] = useState<
    Record<string, string>
  >({});
  const [sessionMeaningRowsByWordId, setSessionMeaningRowsByWordId] = useState<Record<string, WordMeaning[]>>({});
  const [meaningVisibilitySavingKey, setMeaningVisibilitySavingKey] = useState<string | null>(null);
  const [personalNotesEditorTargetWordId, setPersonalNotesEditorTargetWordId] = useState<string | null>(null);
  const [personalNotesEditorDraft, setPersonalNotesEditorDraft] = useState('');
  const [personalNotesEditorSaving, setPersonalNotesEditorSaving] = useState(false);
  const [personalNotesEditorError, setPersonalNotesEditorError] = useState<string | null>(null);
  const [productionHanziInput, setProductionHanziInput] = useState('');
  const [productionHanziError, setProductionHanziError] = useState<string | null>(null);
  const [productionUiPhase, setProductionUiPhase] = useState<'idle' | 'await-rating' | 'await-next'>('idle');
  const [frozenProductionCard, setFrozenProductionCard] = useState<FrozenProductionCard | null>(null);
  const personalNotesEditorInputRef = useRef<HTMLTextAreaElement | null>(null);
  const productionHanziInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    function syncSessionPrefetchState() {
      setSessionPrefetch(getSessionPrefetchSnapshot());
    }

    async function loadData() {
      try {
        await reloadDashboard();
        syncSessionPrefetchState();
        void ensureSessionPrefetch(syncSessionPrefetchState).catch(() => undefined);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      }
    }

    loadData();
  }, []);

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

  const displayedSessionItemCount = sessionStarted
    ? sessionState
      ? getSchedulerLength(sessionState.scheduler)
      : 0
    : getSessionPayloadItemCount(sessionPrefetch.payload) ?? 0;
  const activeItem: SessionItemWithWord | null =
    sessionStarted && sessionState ? getSchedulerActiveItem(sessionState.scheduler) ?? null : null;
  const activeWord = activeItem?.word ?? null;
  const activeWordPersonalNotesOverride = activeWord ? sessionPersonalNotesOverridesByWordId[activeWord.id] : undefined;
  const activeWordPersonalNotes = activeWordPersonalNotesOverride ?? activeWord?.personalNotes ?? '';
  const activeFallbackMeanings =
    activeWord === null
      ? []
      : activeWord.meanings.length > 0
        ? activeWord.meanings
        : activeWord.meaning.trim().length > 0
          ? [activeWord.meaning]
          : [];
  const activeMeaningRows =
    activeWord
      ? [...(sessionMeaningRowsByWordId[activeWord.id] ?? [])].sort((left, right) => left.position - right.position)
      : [];
  const activeAllMeanings = activeMeaningRows.length > 0 ? activeMeaningRows.map((meaning) => meaning.text) : activeFallbackMeanings;
  const activePromptDisplayedMeanings =
    activeMeaningRows.length > 0
      ? activeMeaningRows.filter((meaning) => meaning.showOnProductionPrompt).map((meaning) => meaning.text)
      : activeFallbackMeanings;
  const activeReviewItem = activeItem?.reviewItem ?? null;
  const activeLearningProgress = activeWord ? sessionState?.learningProgress[activeWord.id] : undefined;
  const activeUnstudiedProgress = activeWord ? sessionState?.unstudiedProgress[activeWord.id] : undefined;
  const activeReviewProgress = activeReviewItem ? sessionState?.reviewProgress[activeReviewItem.id] : undefined;
  const reviewedCount = sessionStarted ? sessionState?.answeredCount ?? 0 : 0;
  const activeReviewFailureCount = activeReviewProgress?.failureCount ?? 0;
  const activeReviewReinforcementStreak = activeReviewProgress?.reinforcementStreak ?? 0;
  const reviewInReinforcement = activeWord?.status === 'review' && activeReviewFailureCount > 0;
  const homeStatusCounts = backendStatus?.wordStatusCounts ?? {
    unstudied: 0,
    learning: 0,
    review: 0,
  };

  const inspectableRows = useMemo(() => {
    if (currentPage !== 'words') {
      return [];
    }

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
  }, [currentPage, reviewItemsByWordId, words]);

  const totalWordPages = Math.max(1, Math.ceil(inspectableRows.length / WORDS_PAGE_SIZE));
  const pagedInspectableRows = inspectableRows.slice(
    wordsPageNumber * WORDS_PAGE_SIZE,
    wordsPageNumber * WORDS_PAGE_SIZE + WORDS_PAGE_SIZE,
  );

  useEffect(() => {
    setWordsPageNumber((current) => Math.min(current, totalWordPages - 1));
  }, [totalWordPages]);

  const activePrompt =
    activeReviewItem && activeWord
      ? activeReviewItem.direction === 'forward'
        ? activeWord.hanzi
        : activePromptDisplayedMeanings[0] ?? activeAllMeanings[0] ?? activeWord.meaning
      : null;

  const activeAnswerText =
    activeReviewItem && activeWord
      ? activeReviewItem.direction === 'forward'
        ? activeAllMeanings[0] ?? activeWord.meaning
        : activeWord.hanzi
      : null;
  const activeAnswerPinyin = activeItem && activeWord ? activeWord.pinyin : null;

  const activeReviewState =
    reviewInReinforcement
      ? `Reinforcement ${activeReviewReinforcementStreak}/3 · Forgotten recalls ${activeReviewFailureCount}`
      : `Initial recall`;
  const productionRequiresHanziInput = activeReviewItem?.direction === 'reverse';
  const productionAwaitingRating = productionRequiresHanziInput && productionUiPhase === 'await-rating';
  const productionAwaitingNext = productionUiPhase === 'await-next' && frozenProductionCard !== null;

  const reviewRatingOptions: Array<{ value: ReviewRating; label: string; note: string }> = [
    { value: 'forgot', label: 'Forgot', note: 'Counts as a failure and may trigger same-session reinforcement.' },
    { value: 'hard', label: 'Hard', note: 'Successful recall with effort.' },
    { value: 'good', label: 'Good', note: 'Successful recall with normal confidence.' },
    { value: 'easy', label: 'Easy', note: 'Successful recall with strong confidence.' },
  ];
  const reviewReinforcementOptions: Array<{ value: ReviewRating; label: string; note: string }> = [
    { value: 'forgot', label: 'No', note: 'Still missed recall. Increments lapse count.' },
    { value: 'good', label: 'Yes', note: 'Correct recall. Advances reinforcement streak.' },
  ];

  const binaryRecallOptions: Array<{ value: ReviewRating; label: string; note: string }> = [
    { value: 'forgot', label: 'Forgot', note: 'Did not recall it correctly.' },
    { value: 'good', label: 'Good', note: 'Correct recall.' },
  ];

  const activeRatingOptions = activeWord?.status === 'review'
    ? reviewInReinforcement
      ? reviewReinforcementOptions
      : reviewRatingOptions
    : binaryRecallOptions;
  const activeElapsedTime =
    sessionStarted && sessionSummary
      ? formatElapsedTime(sessionSummary.startedAt, sessionSummary.completedAt ?? sessionNow)
      : '0:00';
  const personalNotesEditorOpen = personalNotesEditorTargetWordId !== null;
  const productionSubmissionInputActive =
    sessionStarted &&
    productionRequiresHanziInput &&
    !answerRevealed &&
    !productionAwaitingNext &&
    !personalNotesEditorOpen;
  const personalNotesEditorCanSubmit = !personalNotesEditorSaving;

  useEffect(() => {
    if (!activeWord || sessionMeaningRowsByWordId[activeWord.id]) {
      return;
    }

    // Prevent a stale request from mutating state after active word changes or this effect re-runs.
    let cancelled = false;
    void fetchWordMeanings(activeWord.id)
      .then((rows) => {
        if (cancelled) {
          return;
        }

        setSessionMeaningRowsByWordId((current) => ({
          ...current,
          [activeWord.id]: rows,
        }));
      })
      .catch((err) => {
        if (cancelled) {
          return;
        }

        setError(err instanceof Error ? err.message : 'Unknown error');
      });

    return () => {
      cancelled = true;
    };
  }, [activeWord, sessionMeaningRowsByWordId]);

  async function reloadDashboard() {
    const statusResponse = await fetchStatus();
    setBackendStatus(statusResponse);
  }

  async function applyPendingSessionCommit(commit: DeferredSessionCommit) {
    switch (commit.type) {
      case 'commit-review-item-session': {
        await completeReviewSession(commit.reviewItemId, commit.failureCount, commit.terminalRating);
        return;
      }
      case 'commit-learning-word-session':
        await completeLearningSession(commit.wordId, commit.success);
        return;
      case 'commit-unstudied-word-session':
        await completeUnstudiedSession(commit.wordId);
        return;
    }
  }

  async function handleStartSession() {
    setSessionLoading(true);
    setError(null);

    try {
      const sessionPayload = await ensureSessionPrefetch(() => setSessionPrefetch(getSessionPrefetchSnapshot()));
      const sessionItemCount = getSessionPayloadItemCount(sessionPayload) ?? 0;
      if (sessionItemCount === 0) {
        setError('No session items are currently available.');
        return;
      }

      const startedAt = new Date().toISOString();
      setSessionNow(startedAt);
      setSessionState(createSessionState(sessionPayload.buckets));
      setSessionPersonalNotesOverridesByWordId({});
      setSessionMeaningRowsByWordId({});
      setMeaningVisibilitySavingKey(null);
      setPersonalNotesEditorTargetWordId(null);
      setPersonalNotesEditorDraft('');
      setPersonalNotesEditorSaving(false);
      setPersonalNotesEditorError(null);
      setProductionHanziInput('');
      setProductionHanziError(null);
      setProductionUiPhase('idle');
      setFrozenProductionCard(null);
      setPendingSessionCommit(null);
      setLastUndoSnapshot(null);
      setSessionSummary({
        startedAt,
        completedAt: null,
        initialQueueLength: sessionItemCount,
        answeredCount: 0,
        completedReviewItems: 0,
        encounteredReviewItemIds: [],
        lapsedReviewItems: 0,
        lapsedReviewLabels: [],
        lapsedReviewItemIds: [],
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
      setProductionHanziInput('');
      setProductionHanziError(null);
      setProductionUiPhase('idle');
      setFrozenProductionCard(null);
      return;
    }

    if (pendingSessionCommit) {
      try {
        await applyPendingSessionCommit(pendingSessionCommit);
        setPendingSessionCommit(null);
        setLastUndoSnapshot(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
        return;
      }
    }

    setSessionStarted(false);
    setSessionState(null);
    setSessionSummary(null);
    setAnswerRevealed(false);
    setSessionPersonalNotesOverridesByWordId({});
    setSessionMeaningRowsByWordId({});
    setMeaningVisibilitySavingKey(null);
    setPersonalNotesEditorTargetWordId(null);
    setPersonalNotesEditorDraft('');
    setPersonalNotesEditorSaving(false);
    setPersonalNotesEditorError(null);
    setProductionHanziInput('');
    setProductionHanziError(null);
    setProductionUiPhase('idle');
    setFrozenProductionCard(null);
    setPendingSessionCommit(null);
    setLastUndoSnapshot(null);
    resetSessionPrefetchCache();
    setSessionPrefetch(getSessionPrefetchSnapshot());
    await reloadDashboard();
    void ensureSessionPrefetch(() => setSessionPrefetch(getSessionPrefetchSnapshot())).catch(() => undefined);
  }

  async function handleOpenWordsPage() {
    if (currentPage === 'words') {
      return;
    }

    setWordsPageLoading(true);
    setError(null);

    try {
      const [wordsResponse, reviewItemsResponse] = await Promise.all([
        fetchWords(),
        fetchReviewItems(),
      ]);

      setWords(wordsResponse);
      setReviewItems(reviewItemsResponse);
      setCurrentPage('words');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setWordsPageLoading(false);
    }
  }

  async function handleOpenPriorityPage() {
    if (currentPage === 'priority') {
      return;
    }

    setPriorityPageLoading(true);
    setError(null);

    try {
      const priorityWordsResponse = await fetchUnstudiedPriorityWords();
      setPriorityWords(sortPriorityWords(priorityWordsResponse.words));
      setPriorityUnstudiedTotalCount(priorityWordsResponse.unstudiedTotalCount);
      setPrioritySearchNotice(null);
      setPriorityJumpRequestWordId(null);
      setCurrentPage('priority');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setPriorityPageLoading(false);
    }
  }

  async function handleUpdateWordPriority(
    wordId: string,
    patch: {
      bumpDelta?: number;
      forceTop?: boolean;
      reset?: boolean;
    },
  ) {
    setUpdatingPriorityWordId(wordId);
    setError(null);

    try {
      const updatedWord = await updateWordUserPriority(wordId, patch);
      setPriorityWords((current) => {
        if (patch.reset) {
          return current.filter((entry) => entry.word.id !== updatedWord.word.id);
        }

        const updated = current.some((entry) => entry.word.id === updatedWord.word.id)
          ? current.map((entry) => (entry.word.id === updatedWord.word.id ? updatedWord : entry))
          : [...current, updatedWord];
        return sortPriorityWords(updated);
      });
      setPrioritySearchNotice(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setUpdatingPriorityWordId(null);
    }
  }

  async function handleSubmitPrioritySearch() {
    const normalizedHanzi = prioritySearchHanzi.trim();
    if (normalizedHanzi.length === 0) {
      setPrioritySearchNotice('Enter hanzi before submitting.');
      return;
    }

    setPrioritySearchSubmitting(true);
    setError(null);

    try {
      const response = await addUnstudiedPriorityByHanzi(normalizedHanzi);
      setPriorityWords((current) => {
        const byId = new Map(current.map((entry) => [entry.word.id, entry]));
        for (const word of response.words) {
          byId.set(word.word.id, word);
        }

        return sortPriorityWords([...byId.values()]);
      });
      const prioritizedAddedWord = sortPriorityWords(response.words)[0];
      setPriorityJumpRequestWordId(prioritizedAddedWord?.word.id ?? null);
      setPriorityUnstudiedTotalCount(response.unstudiedTotalCount);
      setPrioritySearchNotice(`Added ${response.addedCount} matching word${response.addedCount === 1 ? '' : 's'} for "${normalizedHanzi}".`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setPrioritySearchNotice(message);
      setPriorityJumpRequestWordId(null);
    } finally {
      setPrioritySearchSubmitting(false);
    }
  }

  async function handleRate(
    rating: ReviewRating,
    options?: {
      restoreUi?: SessionUndoSnapshot['restoreUi'];
    },
  ) {
    if (!sessionState || !activeItem || !activeWord) {
      return;
    }

    setSubmittingRating(rating);
    setError(null);

    try {
      // the user has submitted another rating, this means they no longer expect the pending one to be able to be undone.
      // apply it now.
      if (pendingSessionCommit) {
        await applyPendingSessionCommit(pendingSessionCommit);
        setPendingSessionCommit(null);
      }

      setLastUndoSnapshot({
        sessionState: cloneSessionState(sessionState),
        sessionSummary,
        restoreUi: options?.restoreUi ?? 'revealed',
      });

      const transition = rateCurrentItem(sessionState, rating);
      setPendingSessionCommit(transition.commit.type === 'none' ? null : transition.commit);

      setSessionState(transition.state);
      setSessionSummary((current) =>
        updateSessionSummaryForRating({
          summary: current,
          transition,
          rating,
          activeWord,
          activeItem,
          previousPhase: sessionState.phase,
        }),
      );
      setAnswerRevealed(false);
      setProductionHanziInput('');
      setProductionHanziError(null);
      setProductionUiPhase('idle');
      setFrozenProductionCard(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSubmittingRating(null);
    }
  }

  async function handleSubmitProductionHanzi() {
    if (
      personalNotesEditorOpen ||
      !sessionState ||
      !activeItem ||
      !activeWord ||
      activeItem.reviewItem.direction !== 'reverse'
    ) {
      return;
    }

    const submittedHanzi = normalizeHanziRecallInput(productionHanziInput);
    if (submittedHanzi.length === 0) {
      setProductionHanziError('Enter Hanzi before submitting.');
      return;
    }

    setSubmittingRating('good');
    setError(null);

    try {
      if (pendingSessionCommit) {
        await applyPendingSessionCommit(pendingSessionCommit);
        setPendingSessionCommit(null);
      }

      setLastUndoSnapshot({
        sessionState: cloneSessionState(sessionState),
        sessionSummary,
        restoreUi: 'production-input',
      });

      const expectedHanzi = normalizeHanziRecallInput(activeWord.hanzi);
      const isCorrect = submittedHanzi === expectedHanzi;

      if (isCorrect) {
        setProductionHanziError(null);
        setProductionUiPhase('await-rating');
        setAnswerRevealed(true);
        return;
      }

      const transition = rateCurrentItem(sessionState, 'forgot');
      setPendingSessionCommit(transition.commit.type === 'none' ? null : transition.commit);
      setSessionState(transition.state);
      setSessionSummary((current) =>
        updateSessionSummaryForRating({
          summary: current,
          transition,
          rating: 'forgot',
          activeWord,
          activeItem,
          previousPhase: sessionState.phase,
        }),
      );
      setFrozenProductionCard({
        status: activeWord.status,
        reviewedCount,
        queuedCount: sessionState ? getSchedulerLength(sessionState.scheduler) : 0,
        promptDisplayedMeanings: [...activePromptDisplayedMeanings],
        fallbackPrompt: activeWord.meaning,
        answerPinyin: activeWord.pinyin,
        answerText: activeWord.hanzi,
        allMeanings: [...activeAllMeanings],
        personalNotes: activeWordPersonalNotes,
        intervalHours: activeItem.reviewItem.intervalHours,
        example: activeWord.examples[0] ?? '',
      });
      setProductionHanziError(`Incorrect Hanzi. Expected "${activeWord.hanzi}".`);
      setProductionUiPhase('await-next');
      setAnswerRevealed(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSubmittingRating(null);
    }
  }

  function handleContinueAfterAutoForgot() {
    setAnswerRevealed(false);
    setProductionHanziInput('');
    setProductionHanziError(null);
    setProductionUiPhase('idle');

    // This will unmask the active card, i.e. presents the user the illusion
    // that they've advanced the queue, even though internally the queue
    // already advanced due to their wrong hanzi submission.
    setFrozenProductionCard(null);
    // note: undo window still open here, intentionally so!
  }

  function handleUndoLastRating() {
    if (!lastUndoSnapshot || submittingRating !== null) {
      return;
    }

    setSessionState(cloneSessionState(lastUndoSnapshot.sessionState));
    setSessionSummary(lastUndoSnapshot.sessionSummary);
    setAnswerRevealed(lastUndoSnapshot.restoreUi === 'revealed');
    setProductionHanziInput('');
    setProductionHanziError(null);
    setProductionUiPhase('idle');
    setFrozenProductionCard(null);
    setPendingSessionCommit(null);
    setLastUndoSnapshot(null);
    setError(null);
  }

  function handleBeginUnstudiedDrill(wordId: string) {
    setSessionState((current) => (current ? beginUnstudiedDrill(current, wordId) : current));
  }

  async function handleDismissCurrentWord() {
    if (!sessionState) {
      return;
    }

    setError(null);

    try {
      const transition = dismissCurrentItemFromSession(sessionState);
      if (transition.dismiss.type === 'none') {
        return;
      }

      const confirmationMessage =
        transition.dismiss.status === 'unstudied'
          ? 'Dismiss this new word? This immediately removes it from this session and cannot be undone.'
          : 'Dismiss this word? This immediately removes both directions from this session, returns it to unstudied, and cannot be undone.';
      if (!window.confirm(confirmationMessage)) {
        return;
      }

      setSessionState(transition.state);
      setAnswerRevealed(false);
      setProductionHanziInput('');
      setProductionHanziError(null);
      setProductionUiPhase('idle');
      setFrozenProductionCard(null);
      setLastUndoSnapshot(null);
      await dismissWordFromStudy(transition.dismiss.wordId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  }

  function handleOpenPersonalNotesEditor() {
    if (!activeWord) {
      return;
    }

    setPersonalNotesEditorTargetWordId(activeWord.id);
    setPersonalNotesEditorDraft(activeWordPersonalNotes);
    setPersonalNotesEditorError(null);
  }

  async function handleToggleMeaningVisibility(meaning: WordMeaning) {
    if (!activeWord) {
      throw new Error('Invariant violated: expected active word when toggling meaning visibility');
    }

    setMeaningVisibilitySavingKey(meaning.id);
    setError(null);

    try {
      const updatedRows = await updateWordMeaningVisibility(activeWord.id, meaning.id, !meaning.showOnProductionPrompt);
      setSessionMeaningRowsByWordId((current) => ({
        ...current,
        [activeWord.id]: updatedRows,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setMeaningVisibilitySavingKey(null);
    }
  }

  function handleCancelPersonalNotesEditor() {
    setPersonalNotesEditorTargetWordId(null);
    setPersonalNotesEditorDraft('');
    setPersonalNotesEditorSaving(false);
    setPersonalNotesEditorError(null);
  }

  async function handleSavePersonalNotesEditor() {
    if (!personalNotesEditorTargetWordId) {
      return;
    }

    const nextPersonalNotes = personalNotesEditorDraft.trim();

    setPersonalNotesEditorSaving(true);
    setPersonalNotesEditorError(null);

    try {
      await updateWordPersonalNotes(personalNotesEditorTargetWordId, nextPersonalNotes);
      setSessionPersonalNotesOverridesByWordId((current) => ({
        ...current,
        [personalNotesEditorTargetWordId]: nextPersonalNotes,
      }));
      handleCancelPersonalNotesEditor();
    } catch (err) {
      setPersonalNotesEditorError(err instanceof Error ? err.message : 'Failed to save personal notes');
      setPersonalNotesEditorSaving(false);
    }
  }

  useEffect(() => {
    if (!sessionStarted || !sessionState || answerRevealed) {
      return;
    }

    setSessionState((current) => (current ? markCurrentItemStarted(current) : current));
  }, [answerRevealed, sessionStarted, sessionState]);

  useEffect(() => {
    if (productionUiPhase === 'await-next') {
      return;
    }

    setProductionHanziInput('');
    setProductionHanziError(null);
    if (productionUiPhase === 'await-rating' && !productionRequiresHanziInput) {
      setProductionUiPhase('idle');
    }
  }, [activeReviewItem?.id, productionUiPhase, productionRequiresHanziInput]);

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
    if (!personalNotesEditorOpen) {
      return;
    }

    personalNotesEditorInputRef.current?.focus();
  }, [personalNotesEditorOpen]);

  useEffect(() => {
    if (!sessionStarted || !productionRequiresHanziInput || answerRevealed || productionAwaitingNext || personalNotesEditorOpen) {
      return;
    }

    if (activeWord?.status === 'unstudied' && !activeUnstudiedProgress?.introComplete) {
      return;
    }

    productionHanziInputRef.current?.focus();
  }, [
    activeUnstudiedProgress?.introComplete,
    activeReviewItem?.id,
    answerRevealed,
    personalNotesEditorOpen,
    productionAwaitingNext,
    productionRequiresHanziInput,
    sessionStarted,
  ]);

  useEffect(() => {
    if (!personalNotesEditorOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [personalNotesEditorOpen]);

  useEffect(() => {
    if (!sessionStarted || !sessionState || sessionState.phase === 'completed') {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || submittingRating !== null || personalNotesEditorOpen) {
        return;
      }

      if (event.key === 'Escape' && productionSubmissionInputActive) {
        event.preventDefault();
        if (document.activeElement === productionHanziInputRef.current) {
          productionHanziInputRef.current?.blur();
        } else {
          productionHanziInputRef.current?.focus();
        }
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

      if ((event.key === 'e' || event.key === 'E') && activeWord) {
        event.preventDefault();
        handleOpenPersonalNotesEditor();
        return;
      }

      if (event.key === ' ') {
        event.preventDefault();

        if (productionAwaitingNext) {
          handleContinueAfterAutoForgot();
          return;
        }

        if (activeWord?.status === 'unstudied' && !activeUnstudiedProgress?.introComplete) {
          handleBeginUnstudiedDrill(activeWord.id);
          return;
        }

        if (productionRequiresHanziInput && !answerRevealed) {
          return;
        }

        if (!answerRevealed) {
          setAnswerRevealed(true);
          return;
        }

        if (activeWord) {
          void handleRate('good', {
            restoreUi: productionRequiresHanziInput ? 'production-input' : 'revealed',
          });
        }
        return;
      }

      if ((event.key === 'z' || event.key === 'Z') && lastUndoSnapshot) {
        event.preventDefault();
        handleUndoLastRating();
        return;
      }

      if (!answerRevealed) {
        return;
      }

      const nextRating = getRatingForKey(event.key, activeRatingOptions);
      if (!nextRating) {
        return;
      }

      const ratingAllowed = activeRatingOptions.some((option) => option.value === nextRating);
      if (!ratingAllowed) {
        return;
      }

      event.preventDefault();
      void handleRate(nextRating, {
        restoreUi: productionRequiresHanziInput ? 'production-input' : 'revealed',
      });
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    activeRatingOptions,
    activeUnstudiedProgress?.introComplete,
    activeWord,
    activeWordPersonalNotes,
    answerRevealed,
    productionAwaitingNext,
    productionRequiresHanziInput,
    productionSubmissionInputActive,
    handleOpenPersonalNotesEditor,
    lastUndoSnapshot,
    personalNotesEditorOpen,
    sessionStarted,
    sessionState,
    submittingRating,
  ]);

  return (
    <div className="container">
      <nav className="navbar" aria-label="Primary">
        <div className="nav-brand">
          <strong>Mandarin SRS App</strong>
          <span>Study workflow and inspection tools · v{APP_VERSION}</span>
        </div>
        <div className="nav-tabs">
          <button
            type="button"
            className={`nav-tab ${currentPage === 'home' ? 'active' : ''}`}
            onClick={() => setCurrentPage('home')}
            disabled={wordsPageLoading}
          >
            Home
          </button>
          <button
            type="button"
            className={`nav-tab ${currentPage === 'words' ? 'active' : ''}`}
            onClick={() => void handleOpenWordsPage()}
            disabled={wordsPageLoading || priorityPageLoading}
          >
            {wordsPageLoading ? 'Loading words...' : 'Words'}
          </button>
          <button
            type="button"
            className={`nav-tab ${currentPage === 'priority' ? 'active' : ''}`}
            onClick={() => void handleOpenPriorityPage()}
            disabled={wordsPageLoading || priorityPageLoading}
          >
            {priorityPageLoading ? 'Loading priority...' : 'Priority'}
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
              <p className="notes">Home loads lightweight counts first, then prefetches the session payload in the background.</p>
              <div className="stack">
                <div className="stat-card">
                  <span className="stat-label">Due review items</span>
                  <strong className="stat-value">{backendStatus?.dueReviewItemCount ?? 0}</strong>
                </div>
                <div className="stat-card">
                  <span className="stat-label">Learning words due</span>
                  <strong className="stat-value">{backendStatus?.pendingLearningWordCount ?? 0}</strong>
                </div>
                <div className="stat-card">
                  <span className="stat-label">{sessionStarted ? 'Items left in session' : 'New words to introduce'}</span>
                  <strong className="stat-value">{sessionStarted ? displayedSessionItemCount : backendStatus?.newWordIntroCount ?? 0}</strong>
                </div>
                <div className="stat-card">
                  <span className="stat-label">{sessionStarted ? 'Answered this session' : 'Prefetched session items'}</span>
                  <strong className="stat-value">{sessionStarted ? reviewedCount : displayedSessionItemCount}</strong>
                </div>
              </div>
              <p className="notes">Corpus status counts: {homeStatusCounts.learning} learning, {homeStatusCounts.review} review, {homeStatusCounts.unstudied} unstudied.</p>
              <p className="notes">Learning coverage day: {backendStatus?.learningCoverageDate ?? 'Unknown'}.</p>
              {!sessionStarted ? (
                <p className="notes">
                  Session prefetch: {formatSessionPrefetchStatus(sessionPrefetch)}
                </p>
              ) : null}
              {!sessionStarted ? (
                <button type="button" onClick={handleStartSession} disabled={sessionLoading || !backendStatus?.hasSessionWork}>
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
            </div>

            <div className="panel">
              <h2>Study session</h2>
              {!sessionStarted ? (
                <p className="notes">Start the session to freeze the current session snapshot into frontend state.</p>
              ) : sessionState?.phase === 'completed' && sessionSummary ? (
                <div className="stack">
                  <SessionSummaryPanel summary={sessionSummary} />
                  {lastUndoSnapshot ? (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={handleUndoLastRating}
                      disabled={submittingRating !== null || personalNotesEditorOpen}
                    >
                      Undo last rating
                    </button>
                  ) : null}
                </div>
              ) : !activeItem || !activeWord ? (
                <div className="stack">
                  <p className="notes">
                    No session items remain in the active snapshot.
                  </p>
                  {lastUndoSnapshot ? (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={handleUndoLastRating}
                      disabled={submittingRating !== null || personalNotesEditorOpen}
                    >
                      Undo last rating
                    </button>
                  ) : null}
                  <button type="button" onClick={handleEndSession}>
                    Back to overview
                  </button>
                </div>
              ) : productionAwaitingNext && frozenProductionCard ? (
                <div className="review-card">
                  <div className="review-card-header">
                    <p className="badge">
                      {frozenProductionCard.status === 'review'
                        ? 'Review'
                        : frozenProductionCard.status === 'learning'
                          ? 'Learning'
                          : 'New word'}
                      {' · Meaning → Hanzi'}
                    </p>
                  </div>
                  <p className="notes">
                    Answered {frozenProductionCard.reviewedCount} this session · {frozenProductionCard.queuedCount} still queued
                  </p>
                  {lastUndoSnapshot ? (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={handleUndoLastRating}
                      disabled={submittingRating !== null || personalNotesEditorOpen}
                    >
                      Undo last rating
                    </button>
                  ) : null}
                  <div className="prompt-block">
                    <span className="prompt-label">Prompt</span>
                    {frozenProductionCard.promptDisplayedMeanings.length > 0 ? (
                      <MeaningList meanings={frozenProductionCard.promptDisplayedMeanings} className="meaning-list-prompt" />
                    ) : (
                      <span className="prompt-meta meaning-list-prompt">{frozenProductionCard.fallbackPrompt}</span>
                    )}
                  </div>
                  <div className="answer-block">
                    <span className="prompt-label">Answer</span>
                    <span className="answer-pinyin">{frozenProductionCard.answerPinyin}</span>
                    <strong className="answer-value">{frozenProductionCard.answerText}</strong>
                    <MeaningList meanings={frozenProductionCard.allMeanings} />
                    {frozenProductionCard.personalNotes.trim().length > 0 ? (
                      <span className="prompt-meta">Notes: {frozenProductionCard.personalNotes}</span>
                    ) : null}
                    <span className="prompt-meta">
                      Interval {frozenProductionCard.intervalHours} hour{frozenProductionCard.intervalHours === 1 ? '' : 's'}
                    </span>
                    <span className="prompt-meta">{frozenProductionCard.example}</span>
                  </div>
                  <p className="notes">Hanzi recall was incorrect. This item was recorded as Forgot.</p>
                  <button type="button" onClick={handleContinueAfterAutoForgot} disabled={personalNotesEditorOpen}>
                    Next
                  </button>
                </div>
              ) : activeWord.status === 'unstudied' && !activeUnstudiedProgress?.introComplete ? (
                <div className="review-card">
                  <div className="review-card-header">
                    <p className="badge">New word introduction</p>
                    <div className="inline-actions">
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => void handleDismissCurrentWord()}
                        disabled={personalNotesEditorSaving}
                      >
                        Dismiss
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={handleOpenPersonalNotesEditor}
                        disabled={personalNotesEditorSaving}
                      >
                        Edit notes
                      </button>
                    </div>
                  </div>
                  <div className="prompt-block">
                    <span className="prompt-label">Hanzi</span>
                    <strong className="prompt-value">{activeWord.hanzi}</strong>
                    <span className="prompt-meta">{activeWord.pinyin}</span>
                    <MeaningList meanings={activeAllMeanings} />
                    <span className="prompt-meta">{activeWord.examples[0]}</span>
                    {activeItem.reviewItem.direction === 'forward' && activeWordPersonalNotes.trim().length > 0 ? (
                      <span className="prompt-meta">Notes: {activeWordPersonalNotes}</span>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleBeginUnstudiedDrill(activeWord.id)}
                    disabled={personalNotesEditorOpen}
                  >
                    Begin recall drills
                  </button>
                  {lastUndoSnapshot ? (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={handleUndoLastRating}
                      disabled={submittingRating !== null || personalNotesEditorOpen}
                    >
                      Undo last rating
                    </button>
                  ) : null}
                </div>
              ) : (
                <div className="review-card">
                  <div className="review-card-header">
                    <p className="badge">
                      {sessionState?.phase === 'draining'
                        ? 'Draining'
                        : activeWord.status === 'review'
                          ? reviewInReinforcement
                            ? 'Review reinforcement'
                            : 'Review'
                          : activeWord.status === 'learning'
                            ? 'Learning'
                            : 'New word'}
                      {' · '}
                      {activeItem.reviewItem.direction === 'forward' ? 'Hanzi → Meaning' : 'Meaning → Hanzi'}
                    </p>
                    <div className="inline-actions">
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => void handleDismissCurrentWord()}
                        disabled={personalNotesEditorSaving}
                      >
                        Dismiss
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={handleOpenPersonalNotesEditor}
                        disabled={personalNotesEditorSaving}
                      >
                        Edit notes
                      </button>
                    </div>
                  </div>
                  <p className="notes">
                    Answered {reviewedCount} this session · {sessionState ? getSchedulerLength(sessionState.scheduler) : 0} still queued ·
                    {' '}Unique lapse items {sessionSummary?.lapsedReviewItemIds.length ?? 0} · Elapsed {activeElapsedTime}
                  </p>
                  {lastUndoSnapshot ? (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={handleUndoLastRating}
                      disabled={submittingRating !== null || personalNotesEditorOpen}
                    >
                      Undo last rating
                    </button>
                  ) : null}
                  <div className="prompt-block">
                    <span className="prompt-label">Prompt</span>
                    {activeItem.reviewItem.direction === 'forward' ? (
                      <strong className="prompt-value">{activePrompt}</strong>
                    ) : (
                      activePromptDisplayedMeanings.length > 0 ? (
                        <MeaningList meanings={activePromptDisplayedMeanings} className="meaning-list-prompt" />
                      ) : (
                        <span className="prompt-meta meaning-list-prompt">No production meanings selected</span>
                      )
                    )}
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
                      {activeMeaningRows.length > 0 ? (
                        <div className="stack">
                          <div className="meaning-visibility-grid">
                            <div className="meaning-visibility-header">
                              <span className="prompt-label">Definition</span>
                              <span className="prompt-label">Hide in production prompt</span>
                            </div>
                            {activeMeaningRows.map((meaning) => (
                              <div key={meaning.id} className="meaning-visibility-row">
                                <span className="prompt-meta">{meaning.text}</span>
                                <button
                                  type="button"
                                  className={`meaning-toggle-icon-button ${meaning.showOnProductionPrompt ? 'is-on' : 'is-off'}`}
                                  onClick={() => void handleToggleMeaningVisibility(meaning)}
                                  disabled={meaningVisibilitySavingKey === meaning.id}
                                  aria-label={
                                    meaning.showOnProductionPrompt
                                      ? `Hide "${meaning.text}" from production prompt`
                                      : `Show "${meaning.text}" on production prompt`
                                  }
                                  title={
                                    meaning.showOnProductionPrompt
                                      ? 'Currently shown on production prompt'
                                      : 'Currently hidden from production prompt'
                                  }
                                >
                                  <span className="meaning-toggle-pill" aria-hidden="true">
                                    <span className="meaning-toggle-thumb" />
                                  </span>
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <MeaningList meanings={activeAllMeanings} />
                      )}
                      {activeWordPersonalNotes.trim().length > 0 ? (
                        <span className="prompt-meta">Notes: {activeWordPersonalNotes}</span>
                      ) : null}
                      <span className="prompt-meta">
                        Interval {activeItem.reviewItem.intervalHours} hour{activeItem.reviewItem.intervalHours === 1 ? '' : 's'}
                      </span>
                      <span className="prompt-meta">{activeWord.examples[0]}</span>
                    </div>
                  ) : productionRequiresHanziInput && !productionAwaitingRating ? (
                    <form
                      className="stack"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void handleSubmitProductionHanzi();
                      }}
                    >
                      <label className="prompt-label" htmlFor="production-hanzi-input">
                        Type Hanzi
                      </label>
                      <input
                        ref={productionHanziInputRef}
                        id="production-hanzi-input"
                        type="text"
                        value={productionHanziInput}
                        onChange={(event) => {
                          setProductionHanziInput(event.target.value);
                          if (productionHanziError) {
                            setProductionHanziError(null);
                          }
                        }}
                        autoComplete="off"
                        autoCapitalize="none"
                        spellCheck={false}
                        disabled={submittingRating !== null || personalNotesEditorOpen}
                      />
                      {productionHanziError ? <p className="notes">{productionHanziError}</p> : null}
                      <button type="submit" disabled={submittingRating !== null || personalNotesEditorOpen}>
                        Submit Hanzi
                      </button>
                    </form>
                  ) : (
                    <button type="button" onClick={() => setAnswerRevealed(true)} disabled={personalNotesEditorOpen}>
                      Reveal answer
                    </button>
                  )}

                  {answerRevealed && (!productionRequiresHanziInput || productionAwaitingRating) ? (
                    <div className="rating-grid">
                      {activeRatingOptions.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          className="rating-button"
                          onClick={() =>
                            void handleRate(option.value, {
                              restoreUi: productionRequiresHanziInput ? 'production-input' : 'revealed',
                            })
                          }
                          disabled={submittingRating !== null || personalNotesEditorOpen}
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
      ) : currentPage === 'words' ? (
        <WordsPage
          rows={pagedInspectableRows}
          currentPage={wordsPageNumber}
          totalPages={totalWordPages}
          totalItems={inspectableRows.length}
          pageSize={WORDS_PAGE_SIZE}
          onPreviousPage={() => setWordsPageNumber((current) => Math.max(0, current - 1))}
          onNextPage={() => setWordsPageNumber((current) => Math.min(totalWordPages - 1, current + 1))}
        />
      ) : (
        <PriorityPage
          rows={priorityWords}
          unstudiedTotalCount={priorityUnstudiedTotalCount}
          searchHanzi={prioritySearchHanzi}
          searchNotice={prioritySearchNotice}
          searchSubmitting={prioritySearchSubmitting}
          dailyNewWordLimit={backendStatus?.dailyNewWordLimit ?? 2}
          jumpRequestWordId={priorityJumpRequestWordId}
          onSearchHanziChange={setPrioritySearchHanzi}
          onSearchSubmit={() => void handleSubmitPrioritySearch()}
          onJumpHandled={() => setPriorityJumpRequestWordId(null)}
          updatingWordId={updatingPriorityWordId}
          onMoveToTop={(wordId) => void handleUpdateWordPriority(wordId, { forceTop: true })}
          onBumpAgain={(wordId) => void handleUpdateWordPriority(wordId, { bumpDelta: 1 })}
          onRemove={(wordId) => void handleUpdateWordPriority(wordId, { reset: true })}
        />
      )}

      {personalNotesEditorOpen ? (
        <div className="definition-editor-modal-backdrop" role="presentation">
          <PersonalNotesEditorOverlay
            inputRef={personalNotesEditorInputRef}
            value={personalNotesEditorDraft}
            isSaving={personalNotesEditorSaving}
            error={personalNotesEditorError}
            canSubmit={personalNotesEditorCanSubmit}
            onChange={setPersonalNotesEditorDraft}
            onCancel={handleCancelPersonalNotesEditor}
            onSave={handleSavePersonalNotesEditor}
          />
        </div>
      ) : null}

      <footer className="footer">
        v{APP_VERSION} · Session coverage is now determined entirely in frontend state before durable backend updates are committed.
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
                                  {row.word.personalNotes.trim().length > 0 ? (
                                    <p className="notes">Notes: {row.word.personalNotes}</p>
                                  ) : null}
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

function PersonalNotesEditorOverlay({
  inputRef,
  value,
  isSaving,
  error,
  canSubmit,
  onChange,
  onCancel,
  onSave,
}: {
  inputRef: RefObject<HTMLTextAreaElement>;
  value: string;
  isSaving: boolean;
  error: string | null;
  canSubmit: boolean;
  onChange: (next: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div className="definition-editor-overlay" role="dialog" aria-modal="true" aria-label="Edit personal notes">
      <div className="definition-editor-header">
        <strong>Edit personal notes</strong>
        <span className="notes">Applies immediately and persists to backend.</span>
      </div>
      <textarea
        ref={inputRef}
        className="definition-editor-input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !isSaving) {
            event.preventDefault();
            onCancel();
            return;
          }

          if (event.key === 'Enter' && event.ctrlKey && canSubmit) {
            event.preventDefault();
            onSave();
          }
        }}
        disabled={isSaving}
        autoFocus
        rows={4}
      />
      {error ? <p className="notes definition-editor-error">{error}</p> : null}
      <div className="definition-editor-actions">
        <button type="button" className="secondary-button" onClick={onCancel} disabled={isSaving}>
          Cancel
        </button>
        <button type="button" onClick={onSave} disabled={!canSubmit}>
          {isSaving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  );
}

function PriorityPage({
  rows,
  unstudiedTotalCount,
  searchHanzi,
  searchNotice,
  searchSubmitting,
  dailyNewWordLimit,
  jumpRequestWordId,
  onSearchHanziChange,
  onSearchSubmit,
  onJumpHandled,
  updatingWordId,
  onMoveToTop,
  onBumpAgain,
  onRemove,
}: {
  rows: PriorityWord[];
  unstudiedTotalCount: number;
  searchHanzi: string;
  searchNotice: string | null;
  searchSubmitting: boolean;
  dailyNewWordLimit: number;
  jumpRequestWordId: string | null;
  onSearchHanziChange: (value: string) => void;
  onSearchSubmit: () => void;
  onJumpHandled: () => void;
  updatingWordId: string | null;
  onMoveToTop: (wordId: string) => void;
  onBumpAgain: (wordId: string) => void;
  onRemove: (wordId: string) => void;
}) {
  const [expandedDefinitionByWordId, setExpandedDefinitionByWordId] = useState<Record<string, boolean>>({});
  const [showJumpToTopButton, setShowJumpToTopButton] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const tableTopAnchorRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});
  const pendingMoveToTopAnchorRef = useRef<{ wordId: string; top: number } | null>(null);
  const onJumpHandledRef = useRef(onJumpHandled);

  useEffect(() => {
    onJumpHandledRef.current = onJumpHandled;
  }, [onJumpHandled]);

  useEffect(() => {
    if (!jumpRequestWordId) {
      return;
    }
    const targetRowElement = rowRefs.current[jumpRequestWordId];
    const tableTopAnchorElement = tableTopAnchorRef.current;

    if (!targetRowElement || !tableTopAnchorElement) {
      onJumpHandledRef.current();
      return;
    }

    const targetRowRect = targetRowElement.getBoundingClientRect();
    const tableTopRect = tableTopAnchorElement.getBoundingClientRect();
    const targetRowAbsoluteTop = targetRowRect.top + window.scrollY;
    const tableTopAbsoluteAtPageTop = tableTopRect.top + window.scrollY;
    const desiredScrollTop = Math.max(0, targetRowAbsoluteTop - tableTopAbsoluteAtPageTop);
    const shouldJump = targetRowRect.top > tableTopRect.top + 8;

    if (shouldJump) {
      window.scrollTo({ top: desiredScrollTop, behavior: 'smooth' });
      setShowJumpToTopButton(true);
    }

    onJumpHandledRef.current();
  }, [jumpRequestWordId]);

  useEffect(() => {
    if (!showJumpToTopButton) {
      return;
    }

    function handleScroll() {
      if (window.scrollY <= 8) {
        setShowJumpToTopButton(false);
      }
    }

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [showJumpToTopButton]);

  useLayoutEffect(() => {
    const pendingAnchor = pendingMoveToTopAnchorRef.current;
    if (!pendingAnchor) {
      return;
    }

    const anchorRowElement = rowRefs.current[pendingAnchor.wordId];
    if (!anchorRowElement) {
      pendingMoveToTopAnchorRef.current = null;
      return;
    }

    const nextTop = anchorRowElement.getBoundingClientRect().top;
    const delta = nextTop - pendingAnchor.top;
    if (Math.abs(delta) > 0.5) {
      window.scrollBy({ top: delta, behavior: 'auto' });
    }

    pendingMoveToTopAnchorRef.current = null;
  }, [rows]);

  function handleMoveToTopWithScrollLock(wordId: string) {
    const clickedIndex = rows.findIndex((entry) => entry.word.id === wordId);
    const anchorCandidate = clickedIndex > 0 ? rows[clickedIndex - 1] : null;
    if (anchorCandidate) {
      const anchorRowElement = rowRefs.current[anchorCandidate.word.id];
      if (anchorRowElement) {
        pendingMoveToTopAnchorRef.current = {
          wordId: anchorCandidate.word.id,
          top: anchorRowElement.getBoundingClientRect().top,
        };
      }
    }

    onMoveToTop(wordId);
  }

  return (
    <section className="words-page">
      <header className="header">
        <div>
          <h1 className="title">Priority</h1>
          <p className="subtitle">Search by hanzi to add matching unstudied words to the priority list.</p>
        </div>
      </header>

      <div className="panel">
        <h2>Add by hanzi</h2>
        <div className="pagination-actions">
          <input
            ref={searchInputRef}
            type="text"
            value={searchHanzi}
            onChange={(event) => onSearchHanziChange(event.target.value)}
            placeholder="Enter hanzi and submit"
            disabled={searchSubmitting}
          />
          <button type="button" onClick={onSearchSubmit} disabled={searchSubmitting}>
            {searchSubmitting ? 'Adding...' : 'Add matches'}
          </button>
        </div>
        {searchNotice ? <p className="notes">{searchNotice}</p> : null}
      </div>

      <div className="panel">
        <h2>Prioritized list</h2>
        {rows.length === 0 ? (
          <p className="notes">No prioritized unstudied words yet.</p>
        ) : (
          <div className="table-shell" ref={tableTopAnchorRef}>
            <table className="words-table">
              <thead>
                <tr>
                  <th>Word</th>
                  <th>Definition</th>
                  <th>Priority</th>
                  <th>Approx days</th>
                  <th>Bumps</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((word) => {
                  const rowUpdating = updatingWordId === word.word.id;
                  const isDefinitionExpanded = expandedDefinitionByWordId[word.word.id] ?? false;
                  const firstMeaning = word.word.meanings[0] ?? word.word.meaning;
                  const hasAdditionalMeanings = word.word.meanings.length > 1;
                  const definitionsToShow = isDefinitionExpanded ? word.word.meanings : [firstMeaning];
                  const priorityPercentile = word.forceTop
                    ? null
                    : getPriorityPercentileText(word.effectiveRank, unstudiedTotalCount);
                  const approxDaysToStudy = getApproxDaysToStudyText(
                    word.effectiveRank,
                    dailyNewWordLimit,
                  );

                  return (
                    <tr
                      key={word.word.id}
                      ref={(element) => {
                        rowRefs.current[word.word.id] = element;
                      }}
                    >
                      <td>
                        <div className="table-word-cell">
                          <strong>{word.word.hanzi}</strong>
                          <span>{word.word.pinyin}</span>
                        </div>
                      </td>
                      <td>
                        <div className="stack">
                          <MeaningList meanings={definitionsToShow} />
                          {hasAdditionalMeanings ? (
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={() =>
                                setExpandedDefinitionByWordId((current) => ({
                                  ...current,
                                  [word.word.id]: !isDefinitionExpanded,
                                }))
                              }
                            >
                              {isDefinitionExpanded ? 'Show less' : `Show all (${word.word.meanings.length})`}
                            </button>
                          ) : null}
                        </div>
                      </td>
                      <td>{priorityPercentile ?? <span className="notes">N/A</span>}</td>
                      <td>{approxDaysToStudy}</td>
                      <td>{word.bumpCount}</td>
                      <td>
                        <div className="pagination-actions">
                          <button
                            type="button"
                            onClick={() => handleMoveToTopWithScrollLock(word.word.id)}
                            disabled={rowUpdating || word.forceTop}
                          >
                            {word.forceTop ? 'At top' : 'Move to top'}
                          </button>
                          <button type="button" onClick={() => onBumpAgain(word.word.id)} disabled={rowUpdating}>
                            Bump again
                          </button>
                          <button type="button" onClick={() => onRemove(word.word.id)} disabled={rowUpdating}>
                            Remove
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {showJumpToTopButton ? (
        <button
          type="button"
          className="priority-jump-top-button"
          onClick={() => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
            setShowJumpToTopButton(false);
            window.setTimeout(() => {
              searchInputRef.current?.focus();
              searchInputRef.current?.select();
            }, 250);
          }}
        >
          Jump to top
        </button>
      ) : null}
    </section>
  );
}

async function ensureSessionPrefetch(onStateChange: () => void): Promise<SessionPayload> {
  onStateChange();

  try {
    const payload = await beginSessionPrefetch();
    onStateChange();
    return payload;
  } catch (error) {
    onStateChange();
    throw error;
  }
}

function updateSessionSummaryForRating({
  summary,
  transition,
  rating,
  activeWord,
  activeItem,
  previousPhase,
}: {
  summary: SessionSummary | null;
  transition: { state: SessionState; commit: SessionCommitIntent };
  rating: ReviewRating;
  activeWord: Word;
  activeItem: SessionItemWithWord;
  previousPhase: SessionState['phase'];
}): SessionSummary | null {
  if (!summary) {
    return summary;
  }

  const nextSummary: SessionSummary = {
    ...summary,
    answeredCount: transition.state.answeredCount,
    completedAt:
      transition.state.phase === 'completed' && summary.completedAt === null
        ? new Date().toISOString()
        : summary.completedAt,
    completionMode:
      transition.state.phase === 'completed'
        ? previousPhase === 'draining'
          ? 'drain'
          : summary.completionMode
        : summary.completionMode,
  };

  if (activeWord.status === 'review' && rating === 'forgot' && !nextSummary.lapsedReviewItemIds.includes(activeItem.reviewItem.id)) {
    nextSummary.lapsedReviewItemIds = [...nextSummary.lapsedReviewItemIds, activeItem.reviewItem.id];
  }

  switch (transition.commit.type) {
    case 'commit-review-item-session':
      nextSummary.completedReviewItems += 1;
      if (!nextSummary.encounteredReviewItemIds.includes(transition.commit.reviewItemId)) {
        nextSummary.encounteredReviewItemIds = [...nextSummary.encounteredReviewItemIds, transition.commit.reviewItemId];
      }
      if (transition.commit.terminalRating === null) {
        nextSummary.lapsedReviewItems += 1;
        nextSummary.lapsedReviewLabels = [
          ...nextSummary.lapsedReviewLabels,
          formatReviewEncounterLabel(activeItem.reviewItem, activeWord),
        ];
      }
      break;
    case 'commit-learning-word-session':
      nextSummary.completedLearningWords += 1;
      break;
    case 'commit-unstudied-word-session':
      nextSummary.completedUnstudiedWords += 1;
      break;
    case 'none':
      break;
  }

  return nextSummary;
}

function formatSessionPrefetchStatus(sessionPrefetch: SessionPrefetchState) {
  switch (sessionPrefetch.status) {
    case 'idle':
      return 'idle';
    case 'pending':
      return 'prefetching session data';
    case 'ready':
      return `ready (${getSessionPayloadItemCount(sessionPrefetch.payload) ?? 0} items)`;
    case 'error':
      return sessionPrefetch.error ? `error: ${sessionPrefetch.error}` : 'error';
    default:
      return 'unknown';
  }
}

function cloneSessionState(state: SessionState): SessionState {
  return {
    ...state,
    scheduler: cloneSessionScheduler(state.scheduler),
    startedItemIds: [...state.startedItemIds],
    dismissedWordIds: [...state.dismissedWordIds],
    learningProgress: Object.fromEntries(
      Object.entries(state.learningProgress).map(([wordId, progress]) => [
        wordId,
        {
          coveredDirections: { ...progress.coveredDirections },
          firstTryGood: { ...progress.firstTryGood },
          attempts: { ...progress.attempts },
        },
      ]),
    ),
    unstudiedProgress: Object.fromEntries(
      Object.entries(state.unstudiedProgress).map(([wordId, progress]) => [
        wordId,
        {
          introComplete: progress.introComplete,
          consecutiveSuccesses: { ...progress.consecutiveSuccesses },
        },
      ]),
    ),
    reviewProgress: Object.fromEntries(
      Object.entries(state.reviewProgress).map(([reviewItemId, progress]) => [
        reviewItemId,
        {
          failureCount: progress.failureCount,
          reinforcementStreak: progress.reinforcementStreak,
        },
      ]),
    ),
  };
}

function getSessionPayloadItemCount(payload: SessionPayload | null): number | null {
  if (!payload) {
    return null;
  }

  return payload.buckets.review.length + payload.buckets.learning.length + payload.buckets.unstudied.length;
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

function sortPriorityWords(words: PriorityWord[]) {
  return [...words].sort((left, right) => {
    const forceTopDelta = Number(right.forceTop) - Number(left.forceTop);
    if (forceTopDelta !== 0) {
      return forceTopDelta;
    }

    if (right.effectivePriority !== left.effectivePriority) {
      return right.effectivePriority - left.effectivePriority;
    }

    if (right.word.priority !== left.word.priority) {
      return right.word.priority - left.word.priority;
    }

    return left.word.createdAt.localeCompare(right.word.createdAt);
  });
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

function getPriorityPercentileText(effectiveRank: number | null, unstudiedTotalCount: number | null) {
  if (!effectiveRank || !unstudiedTotalCount || unstudiedTotalCount <= 0) {
    return 'N/A';
  }

  const higherThanPercent = Math.max(0, Math.round(((unstudiedTotalCount - effectiveRank) / unstudiedTotalCount) * 100));
  return `Higher than ${higherThanPercent}%`;
}

function getApproxDaysToStudyText(effectiveRank: number | null, dailyNewWordLimit: number) {
  if (!effectiveRank || dailyNewWordLimit <= 0) {
    return 'N/A';
  }

  return (effectiveRank / dailyNewWordLimit).toFixed(1);
}

function formatReviewEncounterLabel(item: ReviewItem, word: Word) {
  return item.direction === 'forward'
    ? `${word.hanzi} -> ${word.meaning}`
    : `${word.meaning} -> ${word.hanzi}`;
}

function getRatingForKey(
  key: string,
  ratingOptions: Array<{ value: ReviewRating; label: string; note: string }>,
) {
  const availableRatings = new Set(ratingOptions.map((option) => option.value));
  const binaryRecall =
    availableRatings.size === 2 && availableRatings.has('forgot') && availableRatings.has('good');

  if (binaryRecall) {
    if (key === '1') {
      return 'forgot' as const;
    }

    if (key === '2' || key === '3') {
      return 'good' as const;
    }

    return null;
  }

  const ratingByKey: Partial<Record<string, ReviewRating>> = {
    '1': 'forgot',
    '2': 'hard',
    '3': 'good',
    '4': 'easy',
  };

  return ratingByKey[key] ?? null;
}

function normalizeHanziRecallInput(value: string) {
  return value.replace(/\s+/g, '').trim();
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

function MeaningList({ meanings, className }: { meanings: string[]; className?: string }) {
  if (meanings.length === 0) {
    return null;
  }

  if (meanings.length === 1) {
    return <span className={className ? `prompt-meta ${className}` : 'prompt-meta'}>{meanings[0]}</span>;
  }

  return (
    <ul className={className ? `meaning-list ${className}` : 'meaning-list'}>
      {meanings.map((meaning, index) => (
        <li key={`${index}-${meaning}`}>{meaning}</li>
      ))}
    </ul>
  );
}

export default App;
