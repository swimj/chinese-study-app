import { useEffect, useRef, useState, type RefObject } from 'react';
import type { ReviewRating, Word, WordMeaning } from '../../types';
import type {
  ProductionAnswerWord,
  ProductionResponseResolution,
  SessionStudyItem,
  StudyManagementActionKind,
} from '../../domain/study-actions';
import { studyManagementActionRemovesCurrentReviewAction } from '../../domain/study-actions';
import { resolveSessionProductionResponse } from '../../domain/production-response';
import {
  dismissWordFromStudy,
  fetchWordMeanings,
  generateSessionReflection,
  recordStudyManagementAction,
  recordReviewSessionSummary,
  updateWordMeaningVisibility,
  updateWordPersonalNotes,
} from '../../services/api';
import {
  normalizeProductionAnswer,
  studyProfile,
} from '../../study-profile';
import {
  beginBucketDrainSession,
  cancelRatedReviewSessionAction,
  completeActiveUnstudiedIntro,
  createBucketSessionState,
  dismissActiveBucketSessionUnit,
  dismissBucketSessionWordFromSnapshot,
  dropActiveReviewSessionAction,
  getActiveSessionUnit,
  getBucketSessionTotalCount,
  markActiveSessionUnitStarted,
  rateActiveSessionUnit,
  rateActiveContrastSelectionUnit,
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
import type { FrozenContrastCard, FrozenProductionCard } from './StudySessionPanel';
import {
  createActiveSessionClock,
  finishActiveSessionClock,
  getActiveSessionDurationMs,
  updateActiveSessionClockForVisibility,
  type ActiveSessionClock,
} from './active-session-time';
import {
  appendAcceptedProductionAttemptIds,
  buildSessionReflectionEvidenceSupplement,
  createSessionReflectionEvidenceAccumulator,
  dropSessionReflectionEvidenceForAction,
  recordProductionMistakeEvidence,
  restoreSessionReflectionEvidence,
  snapshotSessionReflectionEvidence,
  createLearnerRequestedReflectionAccumulator,
  buildLearnerRequestedReflectionSupplement,
  appendAcceptedLearnerRequestedAttemptIds,
  dropLearnerRequestedReflectionForAction,
  toggleLearnerRequestedReview,
  type SessionReflectionEvidenceAccumulator,
  type LearnerRequestedReflectionAccumulator,
  type SessionReflectionEvidenceSupplementV1,
} from './session-reflection-evidence';
import {
  beginSessionFinalization,
  completeSessionFinalization,
  completeSessionReflectionGeneration,
  createSessionFinalizationState,
  failSessionReflectionGeneration,
  finalizeSessionBeforeReflection,
  isCurrentSessionReflectionRequest,
  resetFailedSessionFinalization,
  retrySessionReflectionGeneration,
  type SessionFinalizationState,
} from './session-finalization';

type SessionUndoSnapshot = {
  sessionState: BucketSessionState;
  sessionSummary: SessionSummary | null;
  ui: SessionUiSnapshot;
  reflectionEvidence: SessionReflectionEvidenceAccumulator;
};

type SessionUiSnapshot = {
  answerRevealed: boolean;
  productionHanziInput: string;
  productionHanziError: string | null;
  productionSubmittedResponse: string | null;
  productionResponseResolution: ProductionResponseResolution | null;
  productionUiPhase: 'idle' | 'await-rating' | 'await-next';
  frozenProductionCard: FrozenProductionCard | null;
  contrastSelectedWordId: string | null;
  frozenContrastCard: FrozenContrastCard | null;
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
  sessionFinalization: SessionFinalizationState;
  activeItem: SessionStudyItem | null;
  activeWord: Word | null;
  activeLearningProgress: LearningWordProgress | undefined;
  activeUnstudiedProgress: UnstudiedWordProgress | undefined;
  activeReviewProgress: ReviewActionProgress | undefined;
  hasUndo: boolean;
  submittingRating: ReviewRating | null;
  personalNotesEditorOpen: boolean;
  personalNotesEditorSaving: boolean;
  studyManagementSubmitting: boolean;
  productionAwaitingNext: boolean;
  frozenProductionCard: FrozenProductionCard | null;
  contrastAwaitingNext: boolean;
  frozenContrastCard: FrozenContrastCard | null;
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
  contrastSelectedWordId: string | null;
  contrastAwaitingRating: boolean;
  activeRatingOptions: RatingOption[];
  learnerRequestedReview: boolean;
  frozenProductionLearnerRequestedReview: boolean;
  onStartSession: () => void;
  onEndSession: () => void;
  onRetrySessionReflection: () => void;
  onUndoLastRating: () => void;
  onContinueAfterAutoForgot: () => void;
  onContinueAfterAutoContrastForgot: () => void;
  onDismissCurrentWord: () => void;
  onManageStudyAction: (action: StudyManagementActionKind, note: string) => void;
  onDismissFrozenProductionWord: () => void;
  onManageFrozenProductionAction: (action: StudyManagementActionKind, note: string) => void;
  onOpenPersonalNotesEditor: () => void;
  onBeginUnstudiedDrill: (wordId: string) => void;
  onToggleMeaningVisibility: (meaning: WordMeaning) => void;
  onSubmitProductionHanzi: () => void;
  onNoClueProduction: () => void;
  onProductionHanziInputChange: (value: string) => void;
  onSelectContrastChoice: (wordId: string) => void;
  onRevealAnswer: () => void;
  onToggleLearnerRequestedReview: () => void;
  onToggleFrozenProductionLearnerRequestedReview: () => void;
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
  refreshSessionPrefetch: () => Promise<void>;
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
  const [studyManagementSubmitting, setStudyManagementSubmitting] = useState(false);
  const [personalNotesEditorError, setPersonalNotesEditorError] = useState<string | null>(null);
  const [productionHanziInput, setProductionHanziInput] = useState('');
  const [productionHanziError, setProductionHanziError] = useState<string | null>(null);
  const [productionSubmittedResponse, setProductionSubmittedResponse] = useState<string | null>(null);
  const [productionResponseResolution, setProductionResponseResolution] = useState<ProductionResponseResolution | null>(null);
  const [productionUiPhase, setProductionUiPhase] = useState<'idle' | 'await-rating' | 'await-next'>('idle');
  const [contrastSelectedWordId, setContrastSelectedWordId] = useState<string | null>(null);
  const [frozenProductionCard, setFrozenProductionCard] = useState<FrozenProductionCard | null>(null);
  const [frozenContrastCard, setFrozenContrastCard] = useState<FrozenContrastCard | null>(null);
  const personalNotesEditorInputRef = useRef<HTMLTextAreaElement | null>(null);
  const productionHanziInputRef = useRef<HTMLInputElement | null>(null);
  const activeSessionClockRef = useRef<ActiveSessionClock | null>(null);
  const reflectionEvidenceRef = useRef<SessionReflectionEvidenceAccumulator>(
    createSessionReflectionEvidenceAccumulator(),
  );
  const learnerRequestedReflectionRef = useRef<LearnerRequestedReflectionAccumulator>(
    createLearnerRequestedReflectionAccumulator(),
  );
  const pendingReflectionSupplementRef = useRef<unknown>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const productionAnswerWordsRef = useRef<ProductionAnswerWord[]>([]);
  const [sessionFinalization, setSessionFinalization] = useState<SessionFinalizationState>(
    createSessionFinalizationState,
  );
  const sessionFinalizationRef = useRef<SessionFinalizationState>(sessionFinalization);

  function updateSessionFinalization(
    updater: (current: SessionFinalizationState) => SessionFinalizationState,
  ) {
    const next = updater(sessionFinalizationRef.current);
    sessionFinalizationRef.current = next;
    setSessionFinalization(next);
  }

  function syncSessionPrefetchState() {
    setSessionPrefetch(getSessionPrefetchSnapshot());
  }

  async function prefetchSession(): Promise<void> {
    syncSessionPrefetchState();
    await ensureSessionPrefetch(syncSessionPrefetchState);
  }

  async function refreshSessionPrefetch(): Promise<void> {
    resetSessionPrefetchCache();
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
  const activeAnswerPinyin = getActiveAnswerPinyin({
    item: activeItem,
    word: activeWord,
  });
  const activeReviewState = getActiveReviewState({
    reviewInReinforcement,
    reinforcementStreak: activeReviewReinforcementStreak,
    failureCount: activeReviewFailureCount,
  });
  const productionRequiresHanziInput = isProductionSessionItem(activeItem);
  const contrastSelectionActive = activeItem?.actionKind === 'contrast_selection';
  const contrastAwaitingRating =
    contrastSelectionActive &&
    contrastSelectedWordId !== null &&
    contrastSelectedWordId === activeItem?.contrastSelection?.promptTargetWordId;
  const productionAwaitingRating = productionRequiresHanziInput && productionUiPhase === 'await-rating';
  const productionAwaitingNext = productionUiPhase === 'await-next' && frozenProductionCard !== null;
  const contrastAwaitingNext = frozenContrastCard !== null;
  const activeRatingOptions = getActiveRatingOptions({
    actionKind: activeItem?.actionKind,
    wordStatus: activeWord?.status,
    reviewInReinforcement,
  });
  const activeElapsedTime =
    sessionStarted && activeSessionClockRef.current
      ? formatElapsedTime(getActiveSessionDurationMs(activeSessionClockRef.current, new Date(sessionNow).getTime()))
      : '0:00';
  const personalNotesEditorOpen = personalNotesEditorTargetWordId !== null;
  const productionSubmissionInputActive =
    sessionStarted &&
    productionRequiresHanziInput &&
    !answerRevealed &&
    !productionAwaitingNext &&
    !personalNotesEditorOpen;
  const personalNotesEditorCanSubmit = !personalNotesEditorSaving;
  const learnerRequestedReview = activeItem !== null && learnerRequestedReflectionRef.current.items.some((item) => (
    item.sessionActionId === activeItem.sessionActionId && item.learnerRequestedReview
  ));
  const frozenProductionLearnerRequestedReview = frozenProductionCard !== null
    && learnerRequestedReflectionRef.current.items.some((item) => (
      item.sessionActionId === frozenProductionCard.sessionActionId && item.learnerRequestedReview
    ));

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
    setProductionSubmittedResponse(null);
    setProductionResponseResolution(null);
    setProductionUiPhase('idle');
    setFrozenProductionCard(null);
  }

  function resetContrastUi() {
    setContrastSelectedWordId(null);
    setFrozenContrastCard(null);
  }

  function resetAnswerAndProductionUi() {
    setAnswerRevealed(false);
    resetProductionUi();
    resetContrastUi();
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
    resetContrastUi();
  }

  function createSessionUiSnapshot(): SessionUiSnapshot {
    return {
      answerRevealed,
      productionHanziInput,
      productionHanziError,
      productionSubmittedResponse,
      productionResponseResolution,
      productionUiPhase,
      frozenProductionCard,
      contrastSelectedWordId,
      frozenContrastCard,
    };
  }

  function restoreSessionUiSnapshot(snapshot: SessionUiSnapshot) {
    setAnswerRevealed(snapshot.answerRevealed);
    setProductionHanziInput(snapshot.productionHanziInput);
    setProductionHanziError(snapshot.productionHanziError);
    setProductionSubmittedResponse(snapshot.productionSubmittedResponse);
    setProductionResponseResolution(snapshot.productionResponseResolution);
    setProductionUiPhase(snapshot.productionUiPhase);
    setFrozenProductionCard(snapshot.frozenProductionCard);
    setContrastSelectedWordId(snapshot.contrastSelectedWordId);
    setFrozenContrastCard(snapshot.frozenContrastCard);
  }

  async function applyPendingUndoClosure(): Promise<SessionReflectionEvidenceAccumulator> {
    if (pendingSessionCommit) {
      const commit = pendingSessionCommit;
      const acceptedEvidence =
        commit.type === 'commit-review-action-session'
          ? appendAcceptedProductionAttemptIds(
              reflectionEvidenceRef.current,
              {
                sessionActionId: commit.sessionActionId,
                acceptedAttempts: commit.events,
              },
            )
          : reflectionEvidenceRef.current;
      const acceptedRequests = commit.type === 'commit-review-action-session'
        ? appendAcceptedLearnerRequestedAttemptIds(learnerRequestedReflectionRef.current, {
            sessionActionId: commit.sessionActionId, acceptedAttempts: commit.events,
          })
        : learnerRequestedReflectionRef.current;
      await applySessionCommit(commit);
      reflectionEvidenceRef.current = acceptedEvidence;
      learnerRequestedReflectionRef.current = acceptedRequests;
      setPendingSessionCommit(null);
    }

    setLastUndoSnapshot(null);
    return reflectionEvidenceRef.current;
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
      const startedAtMs = new Date(startedAt).getTime();
      const sessionId = createFrontendSessionId();
      activeSessionIdRef.current = sessionId;
      reflectionEvidenceRef.current = createSessionReflectionEvidenceAccumulator();
      learnerRequestedReflectionRef.current = createLearnerRequestedReflectionAccumulator();
      pendingReflectionSupplementRef.current = null;
      updateSessionFinalization(() => createSessionFinalizationState());
      setSessionNow(startedAt);
      activeSessionClockRef.current = createActiveSessionClock({
        nowMs: startedAtMs,
        visibilityState: typeof document === 'undefined' ? undefined : document.visibilityState,
        supportsVisibilityApi: typeof document !== 'undefined' && 'visibilityState' in document,
      });
      setSessionState(createBucketSessionState({ buckets: sessionPayload.buckets, sessionId }));
      productionAnswerWordsRef.current = sessionPayload.productionAnswerWords.map((word) => ({
        wordId: word.wordId,
        hanzi: word.hanzi,
        traditional: word.traditional,
      }));
      resetSessionScopedUi();
      setPendingSessionCommit(null);
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

    if (sessionState?.phase === 'completed') {
      if (sessionFinalizationRef.current.kind === 'finalized') {
        await closeCompletedSession();
      } else if (sessionFinalizationRef.current.kind === 'unfinalized') {
        await finishCompletedSession();
      }
      return;
    }

  }

  async function finishCompletedSession() {
    if (!sessionSummary || !sessionState || sessionState.phase !== 'completed') {
      throw new Error('Session finalization invariant violated: expected a completed session summary.');
    }

    updateSessionFinalization(beginSessionFinalization);
    setError(null);
    const finalizingSummary = sessionSummary;
    let evidence: SessionReflectionEvidenceAccumulator;

    try {
      evidence = await finalizeSessionBeforeReflection({
        flushPendingCommit: applyPendingUndoClosure,
        recordSummary: async () => {
          const activeDurationMs = activeSessionClockRef.current
            ? getActiveSessionDurationMs(activeSessionClockRef.current, Date.now())
            : 0;
          await recordReviewSessionSummary({
            sessionId: finalizingSummary.sessionId,
            completedAt: finalizingSummary.completedAt ?? new Date().toISOString(),
            completedReviewActionCount: finalizingSummary.completedReviewActions,
            failedReviewActionCount: finalizingSummary.lapsedReviewActionIds.length,
            activeDurationMs,
          });
        },
      });
    } catch (err) {
      updateSessionFinalization(resetFailedSessionFinalization);
      setError(err instanceof Error ? err.message : 'Unknown error');
      return;
    }

    const hasReflectionEvidence = evidence.items.length > 0
      || learnerRequestedReflectionRef.current.items.length > 0;
    updateSessionFinalization((current) =>
      completeSessionFinalization({
        state: current,
        hasReflectionEvidence,
      }),
    );

    if (hasReflectionEvidence) {
      try {
        const supplement = learnerRequestedReflectionRef.current.items.length > 0
          ? buildLearnerRequestedReflectionSupplement(evidence, learnerRequestedReflectionRef.current)
          : buildSessionReflectionEvidenceSupplement(evidence);
        pendingReflectionSupplementRef.current = supplement;
        void runSessionReflectionGeneration(finalizingSummary.sessionId, supplement);
      } catch (err) {
        updateSessionFinalization((current) =>
          failSessionReflectionGeneration(
            current,
            err instanceof Error ? err.message : 'Unknown reflection error',
            { retryable: false },
          ),
        );
      }
    }
  }

  async function runSessionReflectionGeneration(
    sessionId: string,
    supplement: unknown,
  ) {
    try {
      const result = await generateSessionReflection({
        sessionId,
        evidence: supplement,
      });
      if (!isCurrentSessionReflectionRequest({
        activeSessionId: activeSessionIdRef.current,
        requestSessionId: sessionId,
      })) {
        return;
      }
      updateSessionFinalization((current) =>
        completeSessionReflectionGeneration(current, result),
      );
    } catch (err) {
      if (!isCurrentSessionReflectionRequest({
        activeSessionId: activeSessionIdRef.current,
        requestSessionId: sessionId,
      })) {
        return;
      }
      updateSessionFinalization((current) =>
        failSessionReflectionGeneration(
          current,
          err instanceof Error ? err.message : 'Unknown reflection error',
        ),
      );
    }
  }

  function handleRetrySessionReflection() {
    if (
      sessionFinalizationRef.current.kind !== 'finalized'
      || sessionFinalizationRef.current.reflection.kind !== 'failed'
    ) {
      return;
    }
    const sessionId = activeSessionIdRef.current;
    const supplement = pendingReflectionSupplementRef.current;
    if (!sessionId || !supplement) {
      throw new Error('Session finalization invariant violated: reflection retry evidence is unavailable.');
    }
    updateSessionFinalization(retrySessionReflectionGeneration);
    void runSessionReflectionGeneration(sessionId, supplement);
  }

  async function closeCompletedSession() {
    activeSessionIdRef.current = null;
    setSessionStarted(false);
    setSessionState(null);
    setSessionSummary(null);
    updateSessionFinalization(() => createSessionFinalizationState());
    activeSessionClockRef.current = null;
    reflectionEvidenceRef.current = createSessionReflectionEvidenceAccumulator();
    learnerRequestedReflectionRef.current = createLearnerRequestedReflectionAccumulator();
    pendingReflectionSupplementRef.current = null;
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
    _options?: {
      restoreUi?: 'revealed' | 'production-input';
    },
  ) {
    if (!sessionState || !activeItem || !activeWord) {
      return;
    }

    if (activeItem.actionKind === 'contrast_selection' && contrastSelectedWordId === null) {
      setError('Choose an answer before rating this contrast prompt.');
      return;
    }

    setSubmittingRating(rating);
    setError(null);

    try {
      // A new rating closes the undo window for the previously deferred commit.
      const submittedProductionUndoSnapshot =
        productionAwaitingRating ? lastUndoSnapshot : null;
      await applyPendingUndoClosure();

      if (submittedProductionUndoSnapshot) {
        setLastUndoSnapshot(submittedProductionUndoSnapshot);
      } else {
        setLastUndoSnapshot({
          sessionState: cloneBucketSessionState(sessionState),
          sessionSummary,
          ui: createSessionUiSnapshot(),
          reflectionEvidence: snapshotSessionReflectionEvidence(reflectionEvidenceRef.current),
        });
      }

      const transition =
        activeItem.actionKind === 'contrast_selection'
          ? rateActiveContrastSelectionUnit({
              state: sessionState,
              selectedWordId: contrastSelectedWordId ?? '',
              rating,
              practiceMore: false,
            })
          : rateActiveSessionUnit(sessionState, rating, {
              response:
                activeItem.actionKind === 'production'
                  ? productionSubmittedResponse
                  : null,
              productionResponse:
                activeItem.actionKind === 'production'
                  ? productionResponseResolution
                  : null,
            });
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

    const submittedHanzi = normalizeProductionAnswer(
      productionHanziInput,
      studyProfile.defaultProductionMatchOptions,
    );
    if (submittedHanzi.length === 0) {
      setProductionHanziError(`Enter ${studyProfile.labels.target} before submitting.`);
      return;
    }

    setSubmittingRating('good');
    setError(null);

    try {
      await applyPendingUndoClosure();

      setLastUndoSnapshot({
        sessionState: cloneBucketSessionState(sessionState),
        sessionSummary,
        ui: createSessionUiSnapshot(),
        reflectionEvidence: snapshotSessionReflectionEvidence(reflectionEvidenceRef.current),
      });

      let resolution: ProductionResponseResolution;
      if (activeWord.status === 'review') {
        resolution = resolveSessionProductionResponse({
          submittedText: productionHanziInput,
          anchorWordId: activeWord.id,
          production: activeItem.production,
          answerWords: productionAnswerWordsRef.current,
        });
      } else {
        const accepted = submittedHanzi === normalizeProductionAnswer(
          activeWord.hanzi,
          studyProfile.defaultProductionMatchOptions,
        );
        resolution = {
          submittedText: productionHanziInput,
          submittedWordId: accepted ? activeWord.id : null,
          result: accepted ? 'accepted_anchor' : 'rejected',
        };
      }
      const isCorrect = resolution.result !== 'rejected';

      if (isCorrect) {
        setProductionHanziError(null);
        setProductionSubmittedResponse(productionHanziInput);
        setProductionResponseResolution(resolution);
        setProductionUiPhase('await-rating');
        setAnswerRevealed(true);
        return;
      }
      applyAutomaticProductionForgot({
        stateAtResponse: sessionState,
        itemAtResponse: activeItem,
        wordAtResponse: activeWord,
        response: productionHanziInput,
        resolution: activeWord.status === 'review' ? resolution : null,
        attemptedHanzi: submittedHanzi,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSubmittingRating(null);
    }
  }

  async function handleNoClueProduction() {
    if (
      personalNotesEditorOpen ||
      !sessionState ||
      !activeItem ||
      !activeWord ||
      activeItem.actionKind !== 'production' ||
      productionHanziInput.trim().length > 0
    ) {
      return;
    }

    setSubmittingRating('forgot');
    setError(null);

    try {
      await applyPendingUndoClosure();
      setLastUndoSnapshot({
        sessionState: cloneBucketSessionState(sessionState),
        sessionSummary,
        ui: createSessionUiSnapshot(),
        reflectionEvidence: snapshotSessionReflectionEvidence(reflectionEvidenceRef.current),
      });
      applyAutomaticProductionForgot({
        stateAtResponse: sessionState,
        itemAtResponse: activeItem,
        wordAtResponse: activeWord,
        response: null,
        resolution: activeWord.status === 'review'
          ? {
              responseKind: 'no_clue',
              submittedText: null,
              submittedWordId: null,
              result: 'rejected',
            }
          : null,
        attemptedHanzi: null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSubmittingRating(null);
    }
  }

  function applyAutomaticProductionForgot({
    stateAtResponse,
    itemAtResponse,
    wordAtResponse,
    response,
    resolution,
    attemptedHanzi,
  }: {
    stateAtResponse: BucketSessionState;
    itemAtResponse: SessionStudyItem;
    wordAtResponse: Word;
    response: string | null;
    resolution: ProductionResponseResolution | null;
    attemptedHanzi: string | null;
  }) {
    const transition = rateActiveSessionUnit(stateAtResponse, 'forgot', {
      response,
      productionResponse: resolution,
    });
    if (wordAtResponse.status === 'review') {
      const attempts = transition.state.reviewProgress[itemAtResponse.sessionActionId]?.attempts;
      const incorrectAttempt = attempts?.[attempts.length - 1];
      if (!incorrectAttempt) {
        throw new Error(
          'Session reflection evidence invariant violated: production failure has no attempt event.',
        );
      }
      reflectionEvidenceRef.current = recordProductionMistakeEvidence(
        reflectionEvidenceRef.current,
        {
          item: itemAtResponse,
          incorrectAttempt,
          promptDisplayedMeanings: activePromptDisplayedMeanings,
        },
      );
    }
    setPendingSessionCommit(transition.commit.type === 'none' ? null : transition.commit);
    setSessionState(transition.state);
    setSessionSummary((current) =>
      updateSessionSummaryForRating({
        summary: current,
        transition,
        rating: 'forgot',
        activeWord: wordAtResponse,
        activeItem: itemAtResponse,
        previousPhase: stateAtResponse.phase,
      }),
    );
    setFrozenProductionCard({
      sessionActionId: itemAtResponse.sessionActionId,
      targetWordId: wordAtResponse.id,
      actionKind: 'production',
      sampledSkillIds: [...itemAtResponse.sampledSkillIds],
      contentRef: itemAtResponse.contentRef,
      production: itemAtResponse.production ?? null,
      attemptedHanzi,
      status: wordAtResponse.status,
      reviewedCount,
      queuedCount: getBucketSessionTotalCount(stateAtResponse),
      promptDisplayedMeanings: itemAtResponse.production ? [] : [...activePromptDisplayedMeanings],
      fallbackPrompt: activePrompt ?? wordAtResponse.meaning,
      answerPinyin: wordAtResponse.pinyin,
      answerText: wordAtResponse.hanzi,
      allMeanings: [...activeAllMeanings],
      personalNotes: activeWordPersonalNotes,
      intervalHours: itemAtResponse.intervalHours,
      example: wordAtResponse.examples[0] ?? '',
    });
    setProductionHanziError(
      attemptedHanzi === null
        ? `No clue recorded. Expected "${wordAtResponse.hanzi}".`
        : `Incorrect ${studyProfile.labels.target}. Expected "${wordAtResponse.hanzi}".`,
    );
    setProductionUiPhase('await-next');
    setAnswerRevealed(true);
  }

  function handleContinueAfterAutoForgot() {
    // Unmask the active card after the queue already advanced due to an incorrect hanzi submission.
    resetAnswerAndProductionUi();
  }

  function handlePreviewContrastChoice(wordId: string) {
    if (!activeItem || activeItem.actionKind !== 'contrast_selection' || answerRevealed || personalNotesEditorOpen) {
      return;
    }

    const contrastSelection = activeItem.contrastSelection;
    if (!contrastSelection?.choices.some((choice) => choice.word.id === wordId)) {
      throw new Error('Session invariant violated: selected contrast choice is not part of the active contrast item.');
    }

    setContrastSelectedWordId(wordId);
    setError(null);
  }

  async function handleSelectContrastChoice(wordId: string) {
    if (!activeItem || activeItem.actionKind !== 'contrast_selection' || answerRevealed || personalNotesEditorOpen) {
      return;
    }

    const contrastSelection = activeItem.contrastSelection;
    if (!contrastSelection?.choices.some((choice) => choice.word.id === wordId)) {
      throw new Error('Session invariant violated: selected contrast choice is not part of the active contrast item.');
    }

    setContrastSelectedWordId(wordId);
    setAnswerRevealed(true);

    if (
      !sessionState ||
      !activeWord ||
      wordId === contrastSelection.promptTargetWordId
    ) {
      return;
    }

    setSubmittingRating('forgot');
    setError(null);

    try {
      await applyPendingUndoClosure();

      setLastUndoSnapshot({
        sessionState: cloneBucketSessionState(sessionState),
        sessionSummary,
        ui: createSessionUiSnapshot(),
        reflectionEvidence: snapshotSessionReflectionEvidence(reflectionEvidenceRef.current),
      });

      const transition = rateActiveContrastSelectionUnit({
        state: sessionState,
        selectedWordId: wordId,
        rating: 'forgot',
        practiceMore: false,
      });
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
      setFrozenContrastCard({
        item: activeItem,
        selectedWordId: wordId,
        reviewedCount,
        queuedCount: getBucketSessionTotalCount(sessionState),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSubmittingRating(null);
    }
  }

  function handleContinueAfterAutoContrastForgot() {
    resetAnswerAndProductionUi();
  }

  function handleUndoLastRating() {
    if (!lastUndoSnapshot || submittingRating !== null) {
      return;
    }

    setSessionState(cloneBucketSessionState(lastUndoSnapshot.sessionState));
    setSessionSummary(lastUndoSnapshot.sessionSummary);
    restoreSessionUiSnapshot(lastUndoSnapshot.ui);
    reflectionEvidenceRef.current = restoreSessionReflectionEvidence(
      lastUndoSnapshot.reflectionEvidence,
    );
    setPendingSessionCommit(null);
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
      if (activeItem) {
        reflectionEvidenceRef.current = dropSessionReflectionEvidenceForAction(
          reflectionEvidenceRef.current,
          activeItem.sessionActionId,
        );
        learnerRequestedReflectionRef.current = dropLearnerRequestedReflectionForAction(
          learnerRequestedReflectionRef.current,
          activeItem.sessionActionId,
        );
      }
      resetAnswerAndProductionUi();
      setLastUndoSnapshot(null);
      await dismissWordFromStudy(transition.dismiss.wordId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  }

  async function handleManageStudyAction(managementAction: StudyManagementActionKind, note: string) {
    if (!sessionState || !activeItem || !activeWord) {
      return;
    }

    if (activeWord.status !== 'review') {
      setError('Study management actions are currently limited to review cards.');
      return;
    }

    if (activeItem.actionKind !== 'production' && activeItem.actionKind !== 'contrast_selection') {
      setError('This card only supports dismiss from Manage Study right now.');
      return;
    }

    setStudyManagementSubmitting(true);
    setError(null);

    try {
      await recordStudyManagementAction({
        sessionId: sessionState.sessionId,
        sessionActionId: activeItem.sessionActionId,
        targetWordId: activeItem.targetWordId,
        actionKind: activeItem.actionKind,
        sampledSkillIds: activeItem.sampledSkillIds,
        contentRef: activeItem.contentRef,
        managementAction,
        note,
      });

      if (studyManagementActionRemovesCurrentReviewAction(managementAction)) {
        reflectionEvidenceRef.current = dropSessionReflectionEvidenceForAction(
          reflectionEvidenceRef.current,
          activeItem.sessionActionId,
        );
        learnerRequestedReflectionRef.current = dropLearnerRequestedReflectionForAction(
          learnerRequestedReflectionRef.current,
          activeItem.sessionActionId,
        );
        setSessionState(dropActiveReviewSessionAction(sessionState));
        resetAnswerAndProductionUi();
        setLastUndoSnapshot(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setStudyManagementSubmitting(false);
    }
  }

  async function handleManageFrozenProductionAction(managementAction: StudyManagementActionKind, note: string) {
    if (!sessionState || !frozenProductionCard) {
      return;
    }

    if (frozenProductionCard.status !== 'review') {
      setError('Study management actions are currently limited to review cards.');
      return;
    }

    setStudyManagementSubmitting(true);
    setError(null);

    try {
      await recordStudyManagementAction({
        sessionId: sessionState.sessionId,
        sessionActionId: frozenProductionCard.sessionActionId,
        targetWordId: frozenProductionCard.targetWordId,
        actionKind: frozenProductionCard.actionKind,
        sampledSkillIds: frozenProductionCard.sampledSkillIds,
        contentRef: frozenProductionCard.contentRef,
        managementAction,
        note,
      });

      if (!studyManagementActionRemovesCurrentReviewAction(managementAction)) {
        return;
      }

      const nextState = cancelRatedReviewSessionAction(sessionState, frozenProductionCard.sessionActionId);
      reflectionEvidenceRef.current = dropSessionReflectionEvidenceForAction(
        reflectionEvidenceRef.current,
        frozenProductionCard.sessionActionId,
      );
      learnerRequestedReflectionRef.current = dropLearnerRequestedReflectionForAction(
        learnerRequestedReflectionRef.current,
        frozenProductionCard.sessionActionId,
      );
      setSessionState(nextState);
      setSessionSummary((current) =>
        cancelFrozenProductionRatingInSummary({
          summary: current,
          nextState,
          sessionActionId: frozenProductionCard.sessionActionId,
        }),
      );
      setPendingSessionCommit(null);
      resetAnswerAndProductionUi();
      setLastUndoSnapshot(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setStudyManagementSubmitting(false);
    }
  }

  async function handleDismissFrozenProductionWord() {
    if (!sessionState || !frozenProductionCard) {
      return;
    }

    setStudyManagementSubmitting(true);
    setError(null);

    try {
      const confirmed = window.confirm(
        'Dismiss this word? This removes it from this session, returns it to unstudied, and cannot be undone.',
      );
      if (!confirmed) {
        return;
      }

      await dismissWordFromStudy(frozenProductionCard.targetWordId);
      const nextState = dismissBucketSessionWordFromSnapshot(
        cancelRatedReviewSessionAction(sessionState, frozenProductionCard.sessionActionId),
        frozenProductionCard.targetWordId,
      );
      reflectionEvidenceRef.current = dropSessionReflectionEvidenceForAction(
        reflectionEvidenceRef.current,
        frozenProductionCard.sessionActionId,
      );
      learnerRequestedReflectionRef.current = dropLearnerRequestedReflectionForAction(
        learnerRequestedReflectionRef.current,
        frozenProductionCard.sessionActionId,
      );
      setSessionState(nextState);
      setSessionSummary((current) =>
        cancelFrozenProductionRatingInSummary({
          summary: current,
          nextState,
          sessionActionId: frozenProductionCard.sessionActionId,
        }),
      );
      setPendingSessionCommit(null);
      resetAnswerAndProductionUi();
      setLastUndoSnapshot(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setStudyManagementSubmitting(false);
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

    const updateElapsedTime = () => {
      setSessionNow(new Date().toISOString());
    };
    const intervalId = window.setInterval(updateElapsedTime, 1000);

    if (typeof document !== 'undefined' && 'visibilityState' in document) {
      const handleVisibilityChange = () => {
        if (activeSessionClockRef.current) {
          activeSessionClockRef.current = updateActiveSessionClockForVisibility({
            clock: activeSessionClockRef.current,
            nowMs: Date.now(),
            visibilityState: document.visibilityState,
          });
        }
        updateElapsedTime();
      };
      document.addEventListener('visibilitychange', handleVisibilityChange);
      return () => {
        window.clearInterval(intervalId);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      };
    }

    return () => window.clearInterval(intervalId);
  }, [sessionStarted, sessionState?.phase, sessionSummary?.startedAt]);

  useEffect(() => {
    if (sessionState?.phase !== 'completed' || !activeSessionClockRef.current) {
      return;
    }

    const completedAtMs = sessionSummary?.completedAt ? new Date(sessionSummary.completedAt).getTime() : Date.now();
    activeSessionClockRef.current = finishActiveSessionClock(activeSessionClockRef.current, completedAtMs);
    const activeDurationMs = getActiveSessionDurationMs(activeSessionClockRef.current, completedAtMs);
    setSessionSummary((current) => (current ? { ...current, activeDurationMs } : current));
  }, [sessionState?.phase, sessionSummary?.completedAt]);

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

        if (contrastAwaitingNext) {
          handleContinueAfterAutoContrastForgot();
          return;
        }

        if (activeWord?.status === 'unstudied' && !activeUnstudiedProgress?.introComplete) {
          handleBeginUnstudiedDrill(activeWord.id);
          return;
        }

        if (productionRequiresHanziInput && !answerRevealed) {
          return;
        }

        if (contrastSelectionActive && !answerRevealed) {
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

      if (contrastSelectionActive && !answerRevealed) {
        if (event.key === '1' || event.key === '2') {
          const choiceIndex = Number(event.key) - 1;
          const choiceWordId = activeItem?.contrastSelection?.choices[choiceIndex]?.word.id;
          if (!choiceWordId) {
            return;
          }

          event.preventDefault();
          handlePreviewContrastChoice(choiceWordId);
          return;
        }

        if (event.key === 'Enter') {
          event.preventDefault();
          if (!contrastSelectedWordId) {
            return;
          }

          void handleSelectContrastChoice(contrastSelectedWordId);
          return;
        }
      }

      if ((event.key === 'z' || event.key === 'Z') && lastUndoSnapshot) {
        event.preventDefault();
        handleUndoLastRating();
        return;
      }

      if (productionAwaitingNext || contrastAwaitingNext) {
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
    activeItem,
    activeUnstudiedProgress?.introComplete,
    activeWord,
    activeWordPersonalNotes,
    answerRevealed,
    contrastAwaitingNext,
    contrastSelectionActive,
    contrastSelectedWordId,
    productionAwaitingNext,
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
    refreshSessionPrefetch,
    homePageProps: {
      sessionPrefetch,
      sessionStarted,
      sessionPhase: sessionState?.phase ?? null,
      sessionLoading,
      displayedSessionItemCount,
      reviewedCount,
      sessionSummary,
      sessionFinalization,
      activeItem,
      activeWord,
      activeLearningProgress,
      activeUnstudiedProgress,
      activeReviewProgress,
      hasUndo: lastUndoSnapshot !== null,
      submittingRating,
      personalNotesEditorOpen,
      personalNotesEditorSaving,
      studyManagementSubmitting,
      productionAwaitingNext,
      frozenProductionCard,
      contrastAwaitingNext,
      frozenContrastCard,
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
      contrastSelectedWordId,
      contrastAwaitingRating,
      activeRatingOptions,
      learnerRequestedReview,
      frozenProductionLearnerRequestedReview,
      onStartSession: () => void handleStartSession(),
      onEndSession: () => void handleEndSession(),
      onRetrySessionReflection: handleRetrySessionReflection,
      onUndoLastRating: handleUndoLastRating,
      onContinueAfterAutoForgot: handleContinueAfterAutoForgot,
      onContinueAfterAutoContrastForgot: handleContinueAfterAutoContrastForgot,
      onDismissCurrentWord: () => void handleDismissCurrentWord(),
      onManageStudyAction: (action, note) => void handleManageStudyAction(action, note),
      onDismissFrozenProductionWord: () => void handleDismissFrozenProductionWord(),
      onManageFrozenProductionAction: (action, note) => void handleManageFrozenProductionAction(action, note),
      onOpenPersonalNotesEditor: handleOpenPersonalNotesEditor,
      onBeginUnstudiedDrill: handleBeginUnstudiedDrill,
      onToggleMeaningVisibility: (meaning) => void handleToggleMeaningVisibility(meaning),
      onSubmitProductionHanzi: () => void handleSubmitProductionHanzi(),
      onNoClueProduction: () => void handleNoClueProduction(),
      onProductionHanziInputChange: (value) => {
        setProductionHanziInput(value);
        if (productionHanziError) {
          setProductionHanziError(null);
        }
      },
      onSelectContrastChoice: handleSelectContrastChoice,
      onRevealAnswer: () => setAnswerRevealed(true),
      onToggleLearnerRequestedReview: () => {
        if (!activeItem || activeItem.actionKind !== 'production') return;
        learnerRequestedReflectionRef.current = toggleLearnerRequestedReview(
          learnerRequestedReflectionRef.current,
          activeItem,
          activePromptDisplayedMeanings,
        );
        setSessionNow(new Date().toISOString());
      },
      onToggleFrozenProductionLearnerRequestedReview: () => {
        if (!frozenProductionCard || frozenProductionCard.status !== 'review') return;
        learnerRequestedReflectionRef.current = toggleLearnerRequestedReview(
          learnerRequestedReflectionRef.current,
          {
            sessionActionId: frozenProductionCard.sessionActionId,
            targetWordId: frozenProductionCard.targetWordId,
            actionKind: 'production',
            production: frozenProductionCard.production ?? null,
            word: { status: frozenProductionCard.status },
          },
          frozenProductionCard.promptDisplayedMeanings,
        );
        setSessionNow(new Date().toISOString());
      },
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

function formatElapsedTime(elapsedMs: number) {
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

function cancelFrozenProductionRatingInSummary({
  summary,
  nextState,
  sessionActionId,
}: {
  summary: SessionSummary | null;
  nextState: BucketSessionState;
  sessionActionId: string;
}): SessionSummary | null {
  if (!summary) {
    return summary;
  }

  return {
    ...summary,
    answeredCount: nextState.answeredCount,
    completedAt:
      nextState.phase === 'completed'
        ? summary.completedAt ?? new Date().toISOString()
        : null,
    lapsedReviewActionIds: summary.lapsedReviewActionIds.filter((id) => id !== sessionActionId),
  };
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
