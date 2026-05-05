import { useEffect, useRef, useState, type RefObject } from 'react';
import type { ReviewRating, SessionItemWithWord, Word, WordMeaning } from '../../types';
import {
  dismissWordFromStudy,
  fetchWordMeanings,
  updateWordMeaningVisibility,
  updateWordPersonalNotes,
} from '../../services/api';
import {
  beginDrainSession,
  beginUnstudiedDrill,
  createSessionState,
  dismissCurrentItemFromSession,
  markCurrentItemStarted,
  rateCurrentItem,
  type LearningWordProgress,
  type ReviewItemProgress,
  type SessionState,
  type UnstudiedWordProgress,
} from '../../lib/session-state';
import { getSchedulerActiveItem, getSchedulerLength } from '../../lib/session-scheduler';
import {
  beginDrainSessionSummary,
  createSessionSummary,
  updateSessionSummaryForRating,
  type SessionSummary,
} from './session-summary';
import {
  getActiveRatingOptions,
  getRatingForKey,
  type RatingOption,
} from './session-rating';
import {
  getActiveAnswerPinyin,
  getActiveAnswerText,
  getActiveMeaningSelection,
  getActivePrompt,
  getActiveReviewState,
  getActiveWordPersonalNotes,
  isProductionReviewItem,
  isReviewInReinforcement,
} from './session-selectors';
import {
  ensureSessionPrefetch,
  getSessionPayloadItemCount,
  getSessionPrefetchSnapshot,
  resetSessionPrefetchCache,
  type SessionPrefetchState,
} from './session-prefetch';
import { cloneSessionState } from './session-state-copy';
import {
  applySessionCommit,
  type DeferredSessionCommit,
} from './session-commit';
import type { FrozenProductionCard } from './StudySessionPanel';

type SessionUndoSnapshot = {
  sessionState: SessionState;
  sessionSummary: SessionSummary | null;
  restoreUi: 'revealed' | 'production-input';
};

export type StudySessionControllerOptions = {
  setError: (message: string | null) => void;
  onSessionEnded: () => Promise<void>;
};

export type StudySessionHomePageProps = {
  sessionPrefetch: SessionPrefetchState;
  sessionStarted: boolean;
  sessionPhase: SessionState['phase'] | null;
  sessionLoading: boolean;
  displayedSessionItemCount: number;
  reviewedCount: number;
  sessionSummary: SessionSummary | null;
  activeItem: SessionItemWithWord | null;
  activeWord: Word | null;
  activeLearningProgress: LearningWordProgress | undefined;
  activeUnstudiedProgress: UnstudiedWordProgress | undefined;
  activeReviewProgress: ReviewItemProgress | undefined;
  hasUndo: boolean;
  submittingRating: ReviewRating | null;
  personalNotesEditorOpen: boolean;
  personalNotesEditorSaving: boolean;
  productionAwaitingNext: boolean;
  frozenProductionCard: FrozenProductionCard | null;
  activeAllMeanings: string[];
  activeWordPersonalNotes: string;
  reviewInReinforcement: boolean;
  activeElapsedTime: string;
  activePrompt: string | null;
  activePromptDisplayedMeanings: string[];
  activeReviewState: string;
  answerRevealed: boolean;
  activeAnswerPinyin: string | null;
  activeAnswerText: string | null;
  activeMeaningRows: WordMeaning[];
  meaningVisibilitySavingKey: string | null;
  productionRequiresHanziInput: boolean;
  productionAwaitingRating: boolean;
  productionHanziInput: string;
  productionHanziError: string | null;
  productionHanziInputRef: RefObject<HTMLInputElement>;
  activeRatingOptions: RatingOption[];
  onStartSession: () => void;
  onEndSession: () => void;
  onUndoLastRating: () => void;
  onContinueAfterAutoForgot: () => void;
  onDismissCurrentWord: () => void;
  onOpenPersonalNotesEditor: () => void;
  onBeginUnstudiedDrill: (wordId: string) => void;
  onToggleMeaningVisibility: (meaning: WordMeaning) => void;
  onSubmitProductionHanzi: () => void;
  onProductionHanziInputChange: (value: string) => void;
  onRevealAnswer: () => void;
  onRate: (rating: ReviewRating, options: { restoreUi: 'revealed' | 'production-input' }) => void;
};

export type PersonalNotesEditorController = {
  open: boolean;
  inputRef: RefObject<HTMLTextAreaElement>;
  value: string;
  isSaving: boolean;
  error: string | null;
  canSubmit: boolean;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
};

export type StudySessionController = {
  sessionStarted: boolean;
  prefetchSession: () => Promise<void>;
  homePageProps: StudySessionHomePageProps;
  personalNotesEditor: PersonalNotesEditorController;
};

export function useStudySession({
  setError,
  onSessionEnded,
}: StudySessionControllerOptions): StudySessionController {
  const [sessionPrefetch, setSessionPrefetch] = useState<SessionPrefetchState>(() => getSessionPrefetchSnapshot());
  const [sessionStarted, setSessionStarted] = useState(false);
  const [sessionState, setSessionState] = useState<SessionState | null>(null);
  const [sessionSummary, setSessionSummary] = useState<SessionSummary | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [answerRevealed, setAnswerRevealed] = useState(false);
  const [submittingRating, setSubmittingRating] = useState<ReviewRating | null>(null);
  const [pendingSessionCommit, setPendingSessionCommit] = useState<DeferredSessionCommit | null>(null);
  const [lastUndoSnapshot, setLastUndoSnapshot] = useState<SessionUndoSnapshot | null>(null);
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

  function syncSessionPrefetchState() {
    setSessionPrefetch(getSessionPrefetchSnapshot());
  }

  async function prefetchSession(): Promise<void> {
    syncSessionPrefetchState();
    await ensureSessionPrefetch(syncSessionPrefetchState);
  }

  const displayedSessionItemCount = sessionStarted
    ? sessionState
      ? getSchedulerLength(sessionState.scheduler)
      : 0
    : getSessionPayloadItemCount(sessionPrefetch.payload) ?? 0;
  const activeItem: SessionItemWithWord | null =
    sessionStarted && sessionState ? getSchedulerActiveItem(sessionState.scheduler) ?? null : null;
  const activeWord = activeItem?.word ?? null;
  const activeWordPersonalNotes = getActiveWordPersonalNotes({
    word: activeWord,
    overridesByWordId: sessionPersonalNotesOverridesByWordId,
  });
  const {
    meaningRows: activeMeaningRows,
    allMeanings: activeAllMeanings,
    promptDisplayedMeanings: activePromptDisplayedMeanings,
  } = getActiveMeaningSelection({
    word: activeWord,
    meaningRowsByWordId: sessionMeaningRowsByWordId,
  });
  const activeReviewItem = activeItem?.reviewItem ?? null;
  const activeLearningProgress = activeWord ? sessionState?.learningProgress[activeWord.id] : undefined;
  const activeUnstudiedProgress = activeWord ? sessionState?.unstudiedProgress[activeWord.id] : undefined;
  const activeReviewProgress = activeReviewItem ? sessionState?.reviewProgress[activeReviewItem.id] : undefined;
  const reviewedCount = sessionStarted ? sessionState?.answeredCount ?? 0 : 0;
  const activeReviewFailureCount = activeReviewProgress?.failureCount ?? 0;
  const activeReviewReinforcementStreak = activeReviewProgress?.reinforcementStreak ?? 0;
  const reviewInReinforcement = isReviewInReinforcement({
    word: activeWord,
    failureCount: activeReviewFailureCount,
  });
  const activePrompt = getActivePrompt({
    reviewItem: activeReviewItem,
    word: activeWord,
    promptDisplayedMeanings: activePromptDisplayedMeanings,
    allMeanings: activeAllMeanings,
  });
  const activeAnswerText = getActiveAnswerText({
    reviewItem: activeReviewItem,
    word: activeWord,
    allMeanings: activeAllMeanings,
  });
  const activeAnswerPinyin = getActiveAnswerPinyin(activeItem);
  const activeReviewState = getActiveReviewState({
    reviewInReinforcement,
    reinforcementStreak: activeReviewReinforcementStreak,
    failureCount: activeReviewFailureCount,
  });
  const productionRequiresHanziInput = isProductionReviewItem(activeReviewItem);
  const productionAwaitingRating = productionRequiresHanziInput && productionUiPhase === 'await-rating';
  const productionAwaitingNext = productionUiPhase === 'await-next' && frozenProductionCard !== null;
  const activeRatingOptions = getActiveRatingOptions({
    wordStatus: activeWord?.status,
    reviewInReinforcement,
  });
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
  }, [activeWord, sessionMeaningRowsByWordId, setError]);

  function resetProductionUi() {
    setProductionHanziInput('');
    setProductionHanziError(null);
    setProductionUiPhase('idle');
    setFrozenProductionCard(null);
  }

  function resetAnswerAndProductionUi() {
    setAnswerRevealed(false);
    resetProductionUi();
  }

  function resetPersonalNotesEditorUi() {
    setPersonalNotesEditorTargetWordId(null);
    setPersonalNotesEditorDraft('');
    setPersonalNotesEditorSaving(false);
    setPersonalNotesEditorError(null);
  }

  function resetSessionScopedUi() {
    setAnswerRevealed(false);
    setSessionPersonalNotesOverridesByWordId({});
    setSessionMeaningRowsByWordId({});
    setMeaningVisibilitySavingKey(null);
    resetPersonalNotesEditorUi();
    resetProductionUi();
  }

  async function handleStartSession() {
    setSessionLoading(true);
    setError(null);

    try {
      const sessionPayload = await ensureSessionPrefetch(syncSessionPrefetchState);
      const sessionItemCount = getSessionPayloadItemCount(sessionPayload) ?? 0;
      if (sessionItemCount === 0) {
        setError('No session items are currently available.');
        return;
      }

      const startedAt = new Date().toISOString();
      setSessionNow(startedAt);
      setSessionState(createSessionState(sessionPayload.buckets));
      resetSessionScopedUi();
      setPendingSessionCommit(null);
      setLastUndoSnapshot(null);
      setSessionSummary(createSessionSummary({
        startedAt,
        initialQueueLength: sessionItemCount,
      }));
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
        beginDrainSessionSummary({
          summary: current,
          drainedState,
        }),
      );
      resetAnswerAndProductionUi();
      return;
    }

    if (pendingSessionCommit) {
      try {
        await applySessionCommit(pendingSessionCommit);
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
    resetSessionScopedUi();
    setPendingSessionCommit(null);
    setLastUndoSnapshot(null);
    resetSessionPrefetchCache();
    setSessionPrefetch(getSessionPrefetchSnapshot());
    await onSessionEnded();
    void ensureSessionPrefetch(syncSessionPrefetchState).catch(() => undefined);
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
      // A new rating closes the undo window for the previously deferred commit.
      if (pendingSessionCommit) {
        await applySessionCommit(pendingSessionCommit);
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
      resetAnswerAndProductionUi();
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
        await applySessionCommit(pendingSessionCommit);
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
    // Unmask the active card after the queue already advanced due to an incorrect hanzi submission.
    resetAnswerAndProductionUi();
  }

  function handleUndoLastRating() {
    if (!lastUndoSnapshot || submittingRating !== null) {
      return;
    }

    setSessionState(cloneSessionState(lastUndoSnapshot.sessionState));
    setSessionSummary(lastUndoSnapshot.sessionSummary);
    setAnswerRevealed(lastUndoSnapshot.restoreUi === 'revealed');
    resetProductionUi();
    setPendingSessionCommit(null);
    setLastUndoSnapshot(null);
    setError(null);
  }

  function handleBeginUnstudiedDrill(wordId: string) {
    setSessionState((current) => (current ? beginUnstudiedDrill(current, wordId) : current));
  }

  async function handleDismissCurrentWord() {
    if (!sessionState || !activeWord) {
      return;
    }

    setError(null);

    try {
      const confirmationMessage =
        activeWord.status === 'unstudied'
          ? 'Dismiss this new word? This immediately removes it from this session and cannot be undone.'
          : 'Dismiss this word? This immediately removes both directions from this session, returns it to unstudied, and cannot be undone.';
      if (!window.confirm(confirmationMessage)) {
        return;
      }

      const transition = dismissCurrentItemFromSession(sessionState);
      if (transition.dismiss.type === 'none') {
        return;
      }

      setSessionState(transition.state);
      resetAnswerAndProductionUi();
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
    resetPersonalNotesEditorUi();
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
    lastUndoSnapshot,
    personalNotesEditorOpen,
    sessionStarted,
    sessionState,
    submittingRating,
  ]);

  return {
    sessionStarted,
    prefetchSession,
    homePageProps: {
      sessionPrefetch,
      sessionStarted,
      sessionPhase: sessionState?.phase ?? null,
      sessionLoading,
      displayedSessionItemCount,
      reviewedCount,
      sessionSummary,
      activeItem,
      activeWord,
      activeLearningProgress,
      activeUnstudiedProgress,
      activeReviewProgress,
      hasUndo: lastUndoSnapshot !== null,
      submittingRating,
      personalNotesEditorOpen,
      personalNotesEditorSaving,
      productionAwaitingNext,
      frozenProductionCard,
      activeAllMeanings,
      activeWordPersonalNotes,
      reviewInReinforcement,
      activeElapsedTime,
      activePrompt,
      activePromptDisplayedMeanings,
      activeReviewState,
      answerRevealed,
      activeAnswerPinyin,
      activeAnswerText,
      activeMeaningRows,
      meaningVisibilitySavingKey,
      productionRequiresHanziInput,
      productionAwaitingRating,
      productionHanziInput,
      productionHanziError,
      productionHanziInputRef,
      activeRatingOptions,
      onStartSession: () => void handleStartSession(),
      onEndSession: () => void handleEndSession(),
      onUndoLastRating: handleUndoLastRating,
      onContinueAfterAutoForgot: handleContinueAfterAutoForgot,
      onDismissCurrentWord: () => void handleDismissCurrentWord(),
      onOpenPersonalNotesEditor: handleOpenPersonalNotesEditor,
      onBeginUnstudiedDrill: handleBeginUnstudiedDrill,
      onToggleMeaningVisibility: (meaning) => void handleToggleMeaningVisibility(meaning),
      onSubmitProductionHanzi: () => void handleSubmitProductionHanzi(),
      onProductionHanziInputChange: (value) => {
        setProductionHanziInput(value);
        if (productionHanziError) {
          setProductionHanziError(null);
        }
      },
      onRevealAnswer: () => setAnswerRevealed(true),
      onRate: (rating, options) => void handleRate(rating, options),
    },
    personalNotesEditor: {
      open: personalNotesEditorOpen,
      inputRef: personalNotesEditorInputRef,
      value: personalNotesEditorDraft,
      isSaving: personalNotesEditorSaving,
      error: personalNotesEditorError,
      canSubmit: personalNotesEditorCanSubmit,
      onChange: setPersonalNotesEditorDraft,
      onCancel: handleCancelPersonalNotesEditor,
      onSave: () => void handleSavePersonalNotesEditor(),
    },
  };
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
