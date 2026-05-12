import { useEffect, useRef, useState, type RefObject } from 'react';
import type { ReviewRating, Word, WordMeaning } from '../../types';
import type { SessionStudyItem } from '../../domain/study-actions';
import {
  captureProductionMistakeCandidate,
  dismissWordFromStudy,
  fetchWordMeanings,
  recordReviewSessionSummary,
  updateWordMeaningVisibility,
  updateWordPersonalNotes,
} from '../../services/api';
import {
  beginBucketDrainSession,
  completeActiveUnstudiedIntro,
  createBucketSessionState,
  dismissActiveBucketSessionUnit,
  getActiveSessionUnit,
  getBucketSessionTotalCount,
  markActiveSessionUnitStarted,
  rateActiveSessionUnit,
  type BucketSessionState,
  type LearningWordProgress,
  type ReviewActionProgress,
  type UnstudiedWordProgress,
} from '../../lib/session-state';
import type { ActiveBucketSchedulerUnit } from '../../lib/session-scheduler';
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
  getPersonalNotesEditorTarget,
  isProductionSessionItem,
  isReviewInReinforcement,
} from './session-selectors';
import {
  ensureSessionPrefetch,
  getSessionPayloadItemCount,
  getSessionPrefetchSnapshot,
  resetSessionPrefetchCache,
  type SessionPrefetchState,
} from './session-prefetch';
import { cloneBucketSessionState } from './session-state-copy';
import {
  applySessionCommit,
  type DeferredSessionCommit,
} from './session-commit';
import type { FrozenProductionCard } from './StudySessionPanel';

type SessionUndoSnapshot = {
  sessionState: BucketSessionState;
  sessionSummary: SessionSummary | null;
  restoreUi: 'revealed' | 'production-input';
};

type PendingProductionMistakeCapture = {
  targetWordId: string;
  attemptedHanzi: string;
  note: string;
};

export type StudySessionControllerOptions = {
  setError: (message: string | null) => void;
  onSessionEnded: () => Promise<void>;
};

export type StudySessionHomePageProps = {
  sessionPrefetch: SessionPrefetchState;
  sessionStarted: boolean;
  sessionPhase: BucketSessionState['phase'] | null;
  sessionLoading: boolean;
  displayedSessionItemCount: number;
  reviewedCount: number;
  sessionSummary: SessionSummary | null;
  activeItem: SessionStudyItem | null;
  activeWord: Word | null;
  activeLearningProgress: LearningWordProgress | undefined;
  activeUnstudiedProgress: UnstudiedWordProgress | undefined;
  activeReviewProgress: ReviewActionProgress | undefined;
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
  productionContrastCandidateChecked: boolean;
  productionContrastCandidateNote: string;
  activeRatingOptions: RatingOption[];
  onStartSession: () => void;
  onEndSession: () => void;
  onUndoLastRating: () => void;
  onContinueAfterAutoForgot: () => void;
  onProductionContrastCandidateCheckedChange: (checked: boolean) => void;
  onProductionContrastCandidateNoteChange: (value: string) => void;
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
  const [sessionState, setSessionState] = useState<BucketSessionState | null>(null);
  const [sessionSummary, setSessionSummary] = useState<SessionSummary | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [answerRevealed, setAnswerRevealed] = useState(false);
  const [submittingRating, setSubmittingRating] = useState<ReviewRating | null>(null);
  const [pendingSessionCommit, setPendingSessionCommit] = useState<DeferredSessionCommit | null>(null);
  const [pendingProductionMistakeCapture, setPendingProductionMistakeCapture] =
    useState<PendingProductionMistakeCapture | null>(null);
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
  const [productionContrastCandidateChecked, setProductionContrastCandidateChecked] = useState(false);
  const [productionContrastCandidateNote, setProductionContrastCandidateNote] = useState('');
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
      ? getBucketSessionTotalCount(sessionState)
      : 0
    : getSessionPayloadItemCount(sessionPrefetch.payload) ?? 0;
  const activeUnit = sessionStarted && sessionState ? getOptionalActiveSessionUnit(sessionState) : null;
  const activeItem: SessionStudyItem | null = activeUnit?.type === 'study' ? activeUnit.item : null;
  const activeWord = activeUnit?.type === 'unstudied_intro' ? activeUnit.word : activeItem?.word ?? null;
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
  const activeLearningProgress = activeWord ? adaptLearningProgress(sessionState?.progress.learning[activeWord.id]) : undefined;
  const activeUnstudiedProgress = activeWord ? adaptUnstudiedProgress(sessionState?.progress.unstudied[activeWord.id]) : undefined;
  const activeReviewProgress =
    activeUnit?.type === 'study' && activeUnit.bucket === 'review'
      ? sessionState?.reviewProgress[activeUnit.item.sessionActionId]
      : undefined;
  const reviewedCount = sessionStarted ? sessionState?.answeredCount ?? 0 : 0;
  const activeReviewFailureCount = activeReviewProgress?.failureCount ?? 0;
  const activeReviewReinforcementStreak = activeReviewProgress?.reinforcementStreak ?? 0;
  const reviewInReinforcement = isReviewInReinforcement({
    word: activeWord,
    failureCount: activeReviewFailureCount,
  });
  const activePrompt = getActivePrompt({
    item: activeItem,
    word: activeWord,
    promptDisplayedMeanings: activePromptDisplayedMeanings,
    allMeanings: activeAllMeanings,
  });
  const activeAnswerText = getActiveAnswerText({
    item: activeItem,
    word: activeWord,
    allMeanings: activeAllMeanings,
  });
  const activeAnswerPinyin = getActiveAnswerPinyin(activeWord);
  const activeReviewState = getActiveReviewState({
    reviewInReinforcement,
    reinforcementStreak: activeReviewReinforcementStreak,
    failureCount: activeReviewFailureCount,
  });
  const productionRequiresHanziInput = isProductionSessionItem(activeItem);
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
    setProductionContrastCandidateChecked(false);
    setProductionContrastCandidateNote('');
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

  async function applyPendingUndoClosure() {
    if (pendingSessionCommit) {
      await applySessionCommit(pendingSessionCommit);
      setPendingSessionCommit(null);
    }

    if (pendingProductionMistakeCapture) {
      const capture = pendingProductionMistakeCapture;
      setPendingProductionMistakeCapture(null);
      void captureProductionMistakeCandidate(
        capture.targetWordId,
        capture.attemptedHanzi,
        capture.note,
      ).catch((captureError: unknown) => {
        console.warn('Failed to capture production mistake candidate', captureError);
      });
    }

    setLastUndoSnapshot(null);
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
      const sessionId = createFrontendSessionId();
      setSessionNow(startedAt);
      setSessionState(createBucketSessionState({ buckets: sessionPayload.buckets, sessionId }));
      resetSessionScopedUi();
      setPendingSessionCommit(null);
      setPendingProductionMistakeCapture(null);
      setLastUndoSnapshot(null);
      setSessionSummary(createSessionSummary({
        sessionId,
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
      const drainedState = beginBucketDrainSession(sessionState);
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

    if (pendingSessionCommit || pendingProductionMistakeCapture) {
      try {
        await applyPendingUndoClosure();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
        return;
      }
    }

    if (sessionSummary) {
      try {
        await recordReviewSessionSummary({
          sessionId: sessionSummary.sessionId,
          completedAt: sessionSummary.completedAt ?? new Date().toISOString(),
          completedReviewActionCount: sessionSummary.completedReviewActions,
          failedReviewActionCount: sessionSummary.lapsedReviewActionIds.length,
        });
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
    setPendingProductionMistakeCapture(null);
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
      await applyPendingUndoClosure();

      setLastUndoSnapshot({
        sessionState: cloneBucketSessionState(sessionState),
        sessionSummary,
        restoreUi: options?.restoreUi ?? 'revealed',
      });

      const transition = rateActiveSessionUnit(sessionState, rating);
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
      activeItem.actionKind !== 'production'
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
      await applyPendingUndoClosure();

      setLastUndoSnapshot({
        sessionState: cloneBucketSessionState(sessionState),
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

      const transition = rateActiveSessionUnit(sessionState, 'forgot');
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
        targetWordId: activeWord.id,
        attemptedHanzi: submittedHanzi,
        status: activeWord.status,
        reviewedCount,
        queuedCount: sessionState ? getBucketSessionTotalCount(sessionState) : 0,
        promptDisplayedMeanings: [...activePromptDisplayedMeanings],
        fallbackPrompt: activeWord.meaning,
        answerPinyin: activeWord.pinyin,
        answerText: activeWord.hanzi,
        allMeanings: [...activeAllMeanings],
        personalNotes: activeWordPersonalNotes,
        intervalHours: activeItem.intervalHours,
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
    if (productionContrastCandidateChecked && frozenProductionCard) {
      setPendingProductionMistakeCapture({
        targetWordId: frozenProductionCard.targetWordId,
        attemptedHanzi: frozenProductionCard.attemptedHanzi,
        note: productionContrastCandidateNote,
      });
    }

    // Unmask the active card after the queue already advanced due to an incorrect hanzi submission.
    resetAnswerAndProductionUi();
  }

  function handleUndoLastRating() {
    if (!lastUndoSnapshot || submittingRating !== null) {
      return;
    }

    setSessionState(cloneBucketSessionState(lastUndoSnapshot.sessionState));
    setSessionSummary(lastUndoSnapshot.sessionSummary);
    setAnswerRevealed(lastUndoSnapshot.restoreUi === 'revealed');
    resetProductionUi();
    setPendingSessionCommit(null);
    setPendingProductionMistakeCapture(null);
    setLastUndoSnapshot(null);
    setError(null);
  }

  function handleBeginUnstudiedDrill(wordId: string) {
    setSessionState((current) => (current ? completeActiveUnstudiedIntro(current).state : current));
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

      const transition = dismissActiveBucketSessionUnit(sessionState);
      if (transition.dismiss.type === 'none') {
        return;
      }

      setSessionState(transition.state);
      resetAnswerAndProductionUi();
      setLastUndoSnapshot(null);
      setPendingProductionMistakeCapture(null);
      await dismissWordFromStudy(transition.dismiss.wordId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  }

  function handleOpenPersonalNotesEditor() {
    const target = getPersonalNotesEditorTarget({
      word: activeWord,
      activeWordPersonalNotes,
      frozenProductionCard,
      productionAwaitingNext,
      overridesByWordId: sessionPersonalNotesOverridesByWordId,
    });

    if (!target) {
      return;
    }

    setPersonalNotesEditorTargetWordId(target.wordId);
    setPersonalNotesEditorDraft(target.personalNotes);
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
      setFrozenProductionCard((current) =>
        current?.targetWordId === personalNotesEditorTargetWordId
          ? { ...current, personalNotes: nextPersonalNotes }
          : current,
      );
      handleCancelPersonalNotesEditor();
    } catch (err) {
      setPersonalNotesEditorError(err instanceof Error ? err.message : 'Failed to save personal notes');
      setPersonalNotesEditorSaving(false);
    }
  }

  useEffect(() => {
    if (!sessionStarted || !sessionState || answerRevealed || activeUnit?.type !== 'study') {
      return;
    }

    setSessionState((current) => {
      if (!current) {
        return current;
      }

      const currentActiveUnit = getOptionalActiveSessionUnit(current);
      return currentActiveUnit?.type === 'study' ? markActiveSessionUnitStarted(current) : current;
    });
  }, [activeUnit?.type, activeUnit?.type === 'study' ? activeUnit.item.sessionActionId : null, answerRevealed, sessionStarted, sessionState]);

  useEffect(() => {
    if (productionUiPhase === 'await-next') {
      return;
    }

    setProductionHanziInput('');
    setProductionHanziError(null);
    if (productionUiPhase === 'await-rating' && !productionRequiresHanziInput) {
      setProductionUiPhase('idle');
    }
  }, [activeItem?.sessionActionId, productionUiPhase, productionRequiresHanziInput]);

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
    activeItem?.sessionActionId,
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
    productionContrastCandidateChecked,
    productionContrastCandidateNote,
    productionRequiresHanziInput,
    productionSubmissionInputActive,
    frozenProductionCard,
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
      productionContrastCandidateChecked,
      productionContrastCandidateNote,
      activeRatingOptions,
      onStartSession: () => void handleStartSession(),
      onEndSession: () => void handleEndSession(),
      onUndoLastRating: handleUndoLastRating,
      onContinueAfterAutoForgot: handleContinueAfterAutoForgot,
      onProductionContrastCandidateCheckedChange: setProductionContrastCandidateChecked,
      onProductionContrastCandidateNoteChange: setProductionContrastCandidateNote,
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

function getOptionalActiveSessionUnit(state: BucketSessionState): ActiveBucketSchedulerUnit | null {
  if (getBucketSessionTotalCount(state) === 0) {
    return null;
  }

  return getActiveSessionUnit(state);
}

function adaptLearningProgress(progress: BucketSessionState['progress']['learning'][string] | undefined): LearningWordProgress | undefined {
  if (!progress) {
    return undefined;
  }

  return {
    coveredDirections: {
      forward: progress.coveredSkills.recognition,
      reverse: progress.coveredSkills.production,
    },
    firstTryGood: {
      forward: progress.firstTryGood.recognition,
      reverse: progress.firstTryGood.production,
    },
    attempts: {
      forward: progress.attempts.recognition,
      reverse: progress.attempts.production,
    },
  };
}

function adaptUnstudiedProgress(
  progress: BucketSessionState['progress']['unstudied'][string] | undefined,
): UnstudiedWordProgress | undefined {
  if (!progress) {
    return undefined;
  }

  return {
    introComplete: progress.introComplete,
    consecutiveSuccesses: {
      forward: progress.successStreaks.recognition,
      reverse: progress.successStreaks.production,
    },
  };
}

function createFrontendSessionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
