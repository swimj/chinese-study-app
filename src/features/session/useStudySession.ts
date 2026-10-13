import { useSessionCompletionFlow } from './useSessionCompletionFlow';
import type { SessionCompletionPanelProps } from './SessionCompletionPanel';
import type { SessionCompletion, StageSessionCompletionRequest } from '../../domain/session-completion';
import { DEFAULT_INTRODUCTION_SPACING, type StudyIntroductionOrder } from '../../domain/introduction-order';
import { resolveContentExerciseResponse } from '../../domain/word-content/materialize';
import { useIntroductionGate, type SessionIntroductionGate } from './useIntroductionGate';
import { selectedIntroduction } from '../word-introduction/model';
import { sameIntroductionCompletionTarget } from './introduction-gate';
import { useEffect, useRef, useState, type RefObject } from 'react';
import type { ReviewRating, Word, WordMeaning } from '../../types';
import type {
  ProductionResponseResolution,
  PureCueSessionReviewItem,
  SessionStudyItem,
} from '../../domain/study-actions';
import { isPureCueSessionReviewItem, studyManagementActionRemovesCurrentReviewAction } from '../../domain/study-actions';
import {
  DEFAULT_CHARACTER_PRESENTATION,
  formatCardCharacters,
  type CharacterPresentation,
} from '../../domain/card-characters';
import { resolveSessionProductionResponse } from '../../domain/production-response';
import { matchServedCueAnswer } from '../../domain/cues';
import { resolvePureCueResponse, type PureCueAssessmentEvent } from '../../domain/pure-cues';
import {
  dismissWordFromStudy,
  fetchCurrentSessionCompletion,
  closeSessionCompletion,
  fetchWordMeanings,
  recordStudyManagementAction,
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
  completeActiveUnstudiedTeaching,
  createBucketSessionState,
  dismissActiveBucketSessionUnit,
  dismissBucketSessionWordFromSnapshot,
  dropActiveReviewSessionAction,
  getActiveSessionUnit,
  getBucketSessionTotalCount,
  markActiveSessionUnitStarted,
  rateActiveSessionUnit,
  skipActiveReviewReinforcement,
  rateActivePureCueProductionUnit,
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
  getCompletedExerciseCounts,
  updateSessionSummaryForPureCueRating,
  updateSessionSummaryForRating,
  type SessionSummary,
} from './session-summary';
import {
  getActiveRatingOptions,
  getDefaultRating,
  type RatingOption,
} from './session-rating';
import { resolveSessionKey, isEditableKeyboardTarget } from './session-keyboard';
import {
  getActiveAnswerPinyin,
  getActiveAnswerText,
  getActiveMeaningSelection,
  getActivePrompt,
  getActiveReviewState,
  getCompletedReinforcementStreak,
  getActiveWordPersonalNotes,
  getPersonalNotesEditorTarget,
  hasServedProductionReveal,
  isProductionSessionItem,
  isPureCueReviewInReinforcement,
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
import type { SessionDeskHandle } from './SessionDesk';
import { getSessionDeskOutcome, getSessionDeskUnitKey, retainSessionDeskAgainKeys, updateSessionDeskAgainKeys } from './session-desk-model';
import type { FrozenContrastCard, FrozenProductionCard, FrozenPureCueCard } from './StudySessionPanel';
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
  setContentRatingRequestedReview,
  type SessionReflectionEvidenceAccumulator,
  type LearnerRequestedReflectionAccumulator,
} from './session-reflection-evidence';
import {
  hasPureCueReflectionEvidence,
  createSessionFinalizationState,
  type SessionFinalizationState,
} from './session-finalization';

type SessionUndoSnapshot = {
  introductionWordId?: string;
  sessionState: BucketSessionState;
  sessionSummary: SessionSummary | null;
  ui: SessionUiSnapshot;
  reflectionEvidence: SessionReflectionEvidenceAccumulator;
};

type ProductionUiPhase = 'idle' | 'await-supplement' | 'await-rating' | 'await-next';

type SessionUiSnapshot = {
  deskAgainKeys: string[];
  answerRevealed: boolean;
  productionHanziInput: string;
  productionHanziError: string | null;
  productionSubmittedResponse: string | null;
  productionResponseResolution: ProductionResponseResolution | null;
  pureCueResponseResolution: Pick<PureCueAssessmentEvent, 'outcome' | 'submittedWordId'> | null;
  productionUiPhase: ProductionUiPhase;
  frozenProductionCard: FrozenProductionCard | null;
  frozenPureCueCard: FrozenPureCueCard | null;
  contrastSelectedWordId: string | null;
  frozenContrastCard: FrozenContrastCard | null;
  completedReinforcementStreak: number | null;
};

export type StudySessionControllerOptions = {
  setError: (message: string | null) => void;
  onSessionEnded: () => Promise<void>;
  onReflectionGenerated?: () => Promise<void> | void;
  sessionSurfaceVisible: boolean;
  studyNewWordsFirst?: boolean;
  studyIntroductionOrder?: StudyIntroductionOrder;
  studyIntroductionSpacing?: number;
  characterPresentation?: CharacterPresentation;
};

export type StudySessionHomePageProps = {
  sessionDeskRef: RefObject<SessionDeskHandle>;
  deskAgainCount: number;
  deskRemainingCount: number;
  introductionGate: SessionIntroductionGate | null;
  sessionPrefetch: SessionPrefetchState;
  sessionStarted: boolean;
  sessionPhase: BucketSessionState['phase'] | null;
  sessionLoading: boolean;
  displayedSessionItemCount: number;
  reviewedCount: number;
  sessionSummary: SessionSummary | null;
  sessionFinalization: SessionFinalizationState;
  completionPanel?: Omit<SessionCompletionPanelProps, 'summary' | 'characterPresentation'>;
  activeItem: SessionStudyItem | null;
  activePureCue: PureCueSessionReviewItem | null;
  activeWord: Word | null;
  activeLearningProgress: LearningWordProgress | undefined;
  activeUnstudiedProgress: UnstudiedWordProgress | undefined;
  activeReviewProgress: ReviewActionProgress | undefined;
  activePureCueFailureCount: number;
  activePureCueReinforcementStreak: number;
  completedReinforcementStreak: number | null;
  hasUndo: boolean;
  submittingRating: ReviewRating | null;
  confirmingSessionAction: boolean;
  contentRatingSaving: boolean;
  personalNotesEditorOpen: boolean;
  personalNotesEditorSaving: boolean;
  studyManagementSubmitting: boolean;
  productionAwaitingNext: boolean;
  pureCueAwaitingNext: boolean;
  productionAwaitingSupplement: boolean;
  frozenProductionCard: FrozenProductionCard | null;
  frozenPureCueCard: FrozenPureCueCard | null;
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
  isProductionItem: boolean;
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
  onContinueAfterProductionSupplement: () => void;
  onContinueAfterAutoContrastForgot: () => void;
  onDismissCurrentWord: () => void;
  onManageStudyAction: () => void;
  onDismissFrozenProductionWord: () => void;
  onManageFrozenProductionAction: () => void;
  onOpenPersonalNotesEditor: () => void;
  onBeginUnstudiedDrill: (wordId: string) => void;
  onToggleMeaningVisibility: (meaning: WordMeaning) => void;
  onSubmitProductionHanzi: () => void;
  onNoClueProduction: () => void;
  onProductionHanziInputChange: (value: string) => void;
  onSelectContrastChoice: (wordId: string) => void;
  onRevealAnswer: () => void;
  onContentRatingSavingChange: (saving: boolean) => void;
  onContentRatingChange: (rating: 'up' | 'down' | null) => void;
  onFrozenProductionContentRatingChange: (rating: 'up' | 'down' | null) => void;
  onToggleLearnerRequestedReview: () => void;
  onToggleFrozenProductionLearnerRequestedReview: () => void;
  onSkipReinforcement: () => void;
  onRate: (rating: ReviewRating, options: { restoreUi: 'revealed' | 'production-input' }) => void;
  shortcutGuideOpen: boolean;
  onOpenShortcutGuide: () => void;
  onCloseShortcutGuide: () => void;
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
  sessionReflectionGenerating: boolean;
  prefetchSession: () => Promise<void>;
  refreshSessionPrefetch: () => Promise<void>;
  invalidateSessionPrefetch: () => void;
  finishCompletedSessionIfLeaving: () => Promise<boolean>;
  homePageProps: StudySessionHomePageProps;
  personalNotesEditor: PersonalNotesEditorController;
};

export function useStudySession({
  setError,
  onSessionEnded,
  onReflectionGenerated,
  sessionSurfaceVisible,
  studyNewWordsFirst = false,
  studyIntroductionOrder,
  studyIntroductionSpacing = DEFAULT_INTRODUCTION_SPACING,
  characterPresentation = DEFAULT_CHARACTER_PRESENTATION,
}: StudySessionControllerOptions): StudySessionController {
  const [sessionPrefetch, setSessionPrefetch] = useState<SessionPrefetchState>(() => getSessionPrefetchSnapshot());
  const sessionDeskRef = useRef<SessionDeskHandle>(null);
  const deskBusyRef = useRef(false);
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const [deskAgainKeys, setDeskAgainKeys] = useState<string[]>([]);
  const [deskRemainingOverride, setDeskRemainingOverride] = useState<number | null>(null);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [sessionState, setSessionState] = useState<BucketSessionState | null>(null);
  const [sessionSummary, setSessionSummary] = useState<SessionSummary | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [answerRevealed, setAnswerRevealed] = useState(false);
  const [submittingRating, setSubmittingRating] = useState<ReviewRating | null>(null);
  const [confirmingSessionAction, setConfirmingSessionAction] = useState(false);
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
  const [pureCueResponseResolution, setPureCueResponseResolution] = useState<Pick<PureCueAssessmentEvent, 'outcome' | 'submittedWordId'> | null>(null);
  const [productionUiPhase, setProductionUiPhase] = useState<ProductionUiPhase>('idle');
  const [contrastSelectedWordId, setContrastSelectedWordId] = useState<string | null>(null);
  const [frozenProductionCard, setFrozenProductionCard] = useState<FrozenProductionCard | null>(null);
  const [frozenPureCueCard, setFrozenPureCueCard] = useState<FrozenPureCueCard | null>(null);
  const [frozenContrastCard, setFrozenContrastCard] = useState<FrozenContrastCard | null>(null);
  const [completedReinforcementStreak, setCompletedReinforcementStreak] = useState<number | null>(null);
  const [shortcutGuideOpen, setShortcutGuideOpen] = useState(false);
  const personalNotesEditorInputRef = useRef<HTMLTextAreaElement | null>(null);
  const productionHanziInputRef = useRef<HTMLInputElement | null>(null);
  const activeSessionClockRef = useRef<ActiveSessionClock | null>(null);
  const reflectionEvidenceRef = useRef<SessionReflectionEvidenceAccumulator>(
    createSessionReflectionEvidenceAccumulator(),
  );
  const learnerRequestedReflectionRef = useRef<LearnerRequestedReflectionAccumulator>(
    createLearnerRequestedReflectionAccumulator(),
  );
  const contentRatingRequestedReflectionRef = useRef<LearnerRequestedReflectionAccumulator>(
    createLearnerRequestedReflectionAccumulator(),
  );
  const contentRatingSavingRef = useRef(false);
  const contentRatingSaveBarrierRef = useRef<Promise<void>>(Promise.resolve());
  const releaseContentRatingSaveRef = useRef<(() => void) | null>(null);
  const [contentRatingSaving, setContentRatingSaving] = useState(false);
  const hasCommittedPureCueReflectionRef = useRef(false);
  const [sessionFinalization, setSessionFinalization] = useState<SessionFinalizationState>(
    createSessionFinalizationState,
  );
  const sessionFinalizationRef = useRef<SessionFinalizationState>(sessionFinalization);
  const pendingSessionCommitRef = useRef<DeferredSessionCommit | null>(pendingSessionCommit);
  const sessionStateRef = useRef<BucketSessionState | null>(sessionState);
  pendingSessionCommitRef.current = pendingSessionCommit;
  sessionStateRef.current = sessionState;

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
    invalidateSessionPrefetch();
    await ensureSessionPrefetch(syncSessionPrefetchState);
  }

  function invalidateSessionPrefetch(): void {
    resetSessionPrefetchCache();
    syncSessionPrefetchState();
  }

  const displayedSessionItemCount = sessionStarted
    ? sessionState
      ? getBucketSessionTotalCount(sessionState)
      : 0
    : getSessionPayloadItemCount(sessionPrefetch.payload) ?? 0;
  const activeUnit = sessionStarted && sessionState ? getOptionalActiveSessionUnit(sessionState) : null;
  const activePureCue: PureCueSessionReviewItem | null = activeUnit?.type === 'study' && isPureCueSessionReviewItem(activeUnit.item)
    ? activeUnit.item
    : null;
  const activeItem: SessionStudyItem | null = activeUnit?.type === 'study' && !isPureCueSessionReviewItem(activeUnit.item)
    ? activeUnit.item
    : null;
  const activeWord = activeUnit?.type === 'unstudied_intro' ? activeUnit.word : activeItem?.word ?? null;
  const introductionController = useIntroductionGate({
    sessionId: sessionStarted ? sessionState?.sessionId ?? null : null,
    visible: sessionSurfaceVisible && frozenProductionCard === null
      && frozenPureCueCard === null && frozenContrastCard === null,
    profile: studyProfile.id, word: activeWord,
    completedSession: sessionState?.phase === 'completed',
    introductions: sessionState?.introductions,
  });
  const introductionGate = introductionController.gate;
  const currentIntroductionTargetRef = useRef({ state: sessionState, wordId: activeWord?.id, gateKey: introductionGate?.key });
  currentIntroductionTargetRef.current = { state: sessionState, wordId: activeWord?.id, gateKey: introductionGate?.key };
  const introductionBlocked = introductionGate !== null;
  const introductionBlockedRef = useRef(introductionBlocked);
  introductionBlockedRef.current = introductionBlocked;
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
  const activePureCueReviewProgress = activePureCue
    ? sessionState?.pureCueReviewProgress[activePureCue.sessionActionId]
    : undefined;
  const reviewedCount = sessionStarted ? sessionState?.answeredCount ?? 0 : 0;
  const activeReviewFailureCount = activePureCueReviewProgress?.failureCount ?? activeReviewProgress?.failureCount ?? 0;
  const activePureCueFailureCount = activePureCueReviewProgress?.failureCount ?? 0;
  const activeReviewReinforcementStreak = activePureCueReviewProgress?.reinforcementStreak ?? activeReviewProgress?.reinforcementStreak ?? 0;
  const reviewInReinforcement = activePureCue
    ? isPureCueReviewInReinforcement(activeReviewFailureCount)
    : isReviewInReinforcement({ word: activeWord, failureCount: activeReviewFailureCount });
  const activePrompt = getActivePrompt({
    item: activeItem,
    word: activeWord,
    promptDisplayedMeanings: activePromptDisplayedMeanings,
    allMeanings: activeAllMeanings,
    characterPresentation,
  });
  const activeAnswerText = getActiveAnswerText({
    item: activeItem,
    word: activeWord,
    allMeanings: activeAllMeanings,
    characterPresentation,
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
  const isProductionItem = isProductionSessionItem(activeItem) || activePureCue !== null;
  const contrastSelectionActive = activeItem?.actionKind === 'contrast_selection';
  const contrastAwaitingRating =
    contrastSelectionActive &&
    contrastSelectedWordId !== null &&
    contrastSelectedWordId === activeItem?.contrastSelection?.promptTargetWordId;
  const productionAwaitingRating = isProductionItem && productionUiPhase === 'await-rating';
  const productionAwaitingSupplement = isProductionItem && productionUiPhase === 'await-supplement';
  const productionAwaitingNext = productionUiPhase === 'await-next' && frozenProductionCard !== null;
  const pureCueAwaitingNext = productionUiPhase === 'await-next' && frozenPureCueCard !== null;
  const contrastAwaitingNext = frozenContrastCard !== null;
  const activeRatingOptions = getActiveRatingOptions({
    actionKind: activeItem?.actionKind,
    wordStatus: activePureCue ? 'review' : activeWord?.status,
    reviewInReinforcement,
  });
  const activeElapsedTime =
    sessionStarted && activeSessionClockRef.current
      ? formatElapsedTime(getActiveSessionDurationMs(activeSessionClockRef.current, new Date(sessionNow).getTime()))
      : '0:00';
  const personalNotesEditorOpen = personalNotesEditorTargetWordId !== null;
  const productionSubmissionInputActive =
    sessionStarted &&
    isProductionItem &&
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
    setPureCueResponseResolution(null);
    setProductionUiPhase('idle');
    setFrozenProductionCard(null);
    setFrozenPureCueCard(null);
  }

  function resetContrastUi() {
    setContrastSelectedWordId(null);
    setFrozenContrastCard(null);
  }

  function resetAnswerAndProductionUi() {
    setDeskRemainingOverride(null);
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
    setDeskAgainKeys([]);
    setDeskRemainingOverride(null);
    setAnswerRevealed(false);
    setSessionPersonalNotesOverridesByWordId({});
    setSessionMeaningRowsByWordId({});
    setMeaningVisibilitySavingKey(null);
    resetPersonalNotesEditorUi();
    resetProductionUi();
    resetContrastUi();
    setCompletedReinforcementStreak(null);
  }

  function createSessionUiSnapshot(): SessionUiSnapshot {
    return {
      deskAgainKeys: [...deskAgainKeys],
      answerRevealed,
      productionHanziInput,
      productionHanziError,
      productionSubmittedResponse,
      productionResponseResolution,
      pureCueResponseResolution,
      productionUiPhase,
      frozenProductionCard,
      frozenPureCueCard,
      contrastSelectedWordId,
      frozenContrastCard,
      completedReinforcementStreak,
    };
  }

  function restoreSessionUiSnapshot(snapshot: SessionUiSnapshot) {
    setDeskAgainKeys([...snapshot.deskAgainKeys]);
    setDeskRemainingOverride(null);
    setAnswerRevealed(snapshot.answerRevealed);
    setProductionHanziInput(snapshot.productionHanziInput);
    setProductionHanziError(snapshot.productionHanziError);
    setProductionSubmittedResponse(snapshot.productionSubmittedResponse);
    setProductionResponseResolution(snapshot.productionResponseResolution);
    setPureCueResponseResolution(snapshot.pureCueResponseResolution);
    setProductionUiPhase(snapshot.productionUiPhase);
    setFrozenProductionCard(snapshot.frozenProductionCard);
    setFrozenPureCueCard(snapshot.frozenPureCueCard);
    setContrastSelectedWordId(snapshot.contrastSelectedWordId);
    setFrozenContrastCard(snapshot.frozenContrastCard);
    setCompletedReinforcementStreak(snapshot.completedReinforcementStreak);
  }

  async function applyPendingUndoClosure(): Promise<SessionReflectionEvidenceAccumulator> {
    if (pendingSessionCommitRef.current) {
      const commit = pendingSessionCommitRef.current;
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
      const acceptedRatingRequests = commit.type === 'commit-review-action-session'
        ? appendAcceptedLearnerRequestedAttemptIds(contentRatingRequestedReflectionRef.current, {
            sessionActionId: commit.sessionActionId, acceptedAttempts: commit.events,
          })
        : contentRatingRequestedReflectionRef.current;
      await applySessionCommit(commit, sessionStateRef.current?.sessionId);
      if (commit.type === 'commit-pure-cue-production-session') {
        hasCommittedPureCueReflectionRef.current ||= hasPureCueReflectionEvidence({
          [commit.sessionActionId]: { events: commit.events },
        });
      }
      reflectionEvidenceRef.current = acceptedEvidence;
      learnerRequestedReflectionRef.current = acceptedRequests;
      contentRatingRequestedReflectionRef.current = acceptedRatingRequests;
      setPendingSessionCommit(null);
    }

    setLastUndoSnapshot(null);
    return reflectionEvidenceRef.current;
  }

  async function handleStartSession() {
    setSessionLoading(true);
    setError(null);

    try {
      // A previous tab/reload can leave a durable completion pending on Home.
      // Settle it before selecting another session against the old word state.
      const previousCompletion = await fetchCurrentSessionCompletion();
      if (previousCompletion && previousCompletion.status !== 'closed') {
        const closed = await closeSessionCompletion(previousCompletion.sessionId, previousCompletion.revisionId);
        if (closed.status !== 'closed') throw new Error('Finish saving your previous session before starting another.');
        resetSessionPrefetchCache();
      }
      const sessionPayload = await ensureSessionPrefetch(syncSessionPrefetchState);
      const sessionItemCount = getSessionPayloadItemCount(sessionPayload) ?? 0;
      if (sessionItemCount === 0) {
        setError(sessionPayload.preparation?.pending
          ? 'Your session is being prepared. Please try Start session again shortly.'
          : 'No session items are currently available.');
        return;
      }

      if (studyProfile.id === 'mandarin') {
        for (const word of sessionPayload.buckets.unstudied) {
          const library = sessionPayload.buckets.introductions?.[word.id];
          if (!library || library.wordId !== word.id || library.selectedPackageId === null
            || library.preparationUnavailable || !selectedIntroduction(library)) {
            throw new Error('This session is still preparing a new-word introduction. Please try again shortly.');
          }
        }
      }

      const startedAt = new Date().toISOString();
      const startedAtMs = new Date(startedAt).getTime();
      const sessionId = createFrontendSessionId();
      reflectionEvidenceRef.current = createSessionReflectionEvidenceAccumulator();
      hasCommittedPureCueReflectionRef.current = false;
      learnerRequestedReflectionRef.current = createLearnerRequestedReflectionAccumulator();
      contentRatingRequestedReflectionRef.current = createLearnerRequestedReflectionAccumulator();
      updateSessionFinalization(() => createSessionFinalizationState());
      setSessionNow(startedAt);
      activeSessionClockRef.current = createActiveSessionClock({
        nowMs: startedAtMs,
        visibilityState: typeof document === 'undefined' ? undefined : document.visibilityState,
        supportsVisibilityApi: typeof document !== 'undefined' && 'visibilityState' in document,
      });
      setSessionState(createBucketSessionState({ buckets: sessionPayload.buckets, sessionId, schedulerPolicy: { studyNewWordsFirst, studyIntroductionOrder, studyIntroductionSpacing } }));
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
    if (contentRatingSavingRef.current || deskBusyRef.current) return;
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
      await completionFlow.finish();
      return;
    }

  }

  async function finishCompletedSessionIfLeaving(): Promise<boolean> {
    await contentRatingSaveBarrierRef.current;
    if (sessionStateRef.current?.phase !== 'completed') return true;
    return completionFlow.finish();
  }

  function handleRetrySessionReflection() {
    void onReflectionGenerated?.();
  }

  async function closeCompletedSession() {
    setSessionStarted(false);
    setSessionState(null);
    setSessionSummary(null);
    updateSessionFinalization(() => createSessionFinalizationState());
    activeSessionClockRef.current = null;
    reflectionEvidenceRef.current = createSessionReflectionEvidenceAccumulator();
    hasCommittedPureCueReflectionRef.current = false;
    learnerRequestedReflectionRef.current = createLearnerRequestedReflectionAccumulator();
    contentRatingRequestedReflectionRef.current = createLearnerRequestedReflectionAccumulator();
    resetSessionScopedUi();
    setPendingSessionCommit(null);
    setLastUndoSnapshot(null);
    resetSessionPrefetchCache();
    setSessionPrefetch(getSessionPrefetchSnapshot());
    await onSessionEnded().catch((reason) => setError(reason instanceof Error ? reason.message : 'Could not refresh Home'));
    void ensureSessionPrefetch(syncSessionPrefetchState).catch(() => undefined);
  }

  function completedActiveDurationMs(): number {
    const completedAtMs = sessionSummary?.completedAt ? Date.parse(sessionSummary.completedAt) : Date.now();
    return activeSessionClockRef.current
      ? getActiveSessionDurationMs(activeSessionClockRef.current, completedAtMs)
      : sessionSummary?.activeDurationMs ?? 0;
  }
  function buildCompletionRequest(revisionId: string): StageSessionCompletionRequest {
    if (!sessionSummary || !sessionState || sessionState.phase !== 'completed') {
      throw new Error('Completion requires a completed session.');
    }
    const commit = pendingSessionCommitRef.current;
    const acceptedEvidence = commit?.type === 'commit-review-action-session'
      ? appendAcceptedProductionAttemptIds(reflectionEvidenceRef.current, { sessionActionId: commit.sessionActionId, acceptedAttempts: commit.events })
      : reflectionEvidenceRef.current;
    const acceptedRequests = commit?.type === 'commit-review-action-session'
      ? appendAcceptedLearnerRequestedAttemptIds(learnerRequestedReflectionRef.current, { sessionActionId: commit.sessionActionId, acceptedAttempts: commit.events })
      : learnerRequestedReflectionRef.current;
    const acceptedRatings = commit?.type === 'commit-review-action-session'
      ? appendAcceptedLearnerRequestedAttemptIds(contentRatingRequestedReflectionRef.current, { sessionActionId: commit.sessionActionId, acceptedAttempts: commit.events })
      : contentRatingRequestedReflectionRef.current;
    const pureEvidence = hasCommittedPureCueReflectionRef.current || (commit?.type === 'commit-pure-cue-production-session'
      && hasPureCueReflectionEvidence({ [commit.sessionActionId]: { events: commit.events } }));
    const qualifying = pureEvidence || acceptedEvidence.items.length > 0 || acceptedRequests.items.length > 0 || acceptedRatings.items.length > 0;
    const reflectionEvidence = !qualifying ? null : acceptedRequests.items.length > 0 || acceptedRatings.items.length > 0
      ? buildLearnerRequestedReflectionSupplement(acceptedEvidence, acceptedRequests, acceptedRatings)
      : buildSessionReflectionEvidenceSupplement(acceptedEvidence);
    const completedAt = sessionSummary.completedAt ?? new Date().toISOString();
    return { revisionId, startedAt: sessionSummary.startedAt, studyDayKey: completedAt.slice(0, 10),
      pendingCommit: commit, reflectionEvidence,
      summary: { completedAt, ...getCompletedExerciseCounts(sessionSummary),
        completedLearningWordCount: sessionSummary.correctDayLearningWords,
        activeDurationMs: completedActiveDurationMs(),
        ...(studyProfile.id === 'mandarin' ? { debriefInventory: sessionSummary.debriefInventory } : {}) } };
  }
  const completionFlow = useSessionCompletionFlow({
    sessionId: sessionState?.phase === 'completed' && sessionSummary ? sessionState.sessionId : null,
    surfaceVisible: sessionSurfaceVisible, buildRequest: buildCompletionRequest,
    onCancelled: restoreLastRating, onReturnHome: closeCompletedSession,
  });

  useEffect(() => {
    if (completionFlow.completion?.status === 'closed') {
      updateSessionFinalization(() => ({ kind: 'finalized', reflection: { kind: 'skipped' } }));
    }
  }, [completionFlow.completion?.status]);

  async function handleRate(
    rating: ReviewRating | null,
    options?: {
      restoreUi?: 'revealed' | 'production-input';
      confirmKeyboardRating?: boolean;
    },
  ) {
    if (contentRatingSavingRef.current || deskBusyRef.current || submittingRating !== null || !sessionState || (!activeItem && !activePureCue) || (!activeWord && !activePureCue)) {
      return;
    }

    if (activeItem?.actionKind === 'contrast_selection' && contrastSelectedWordId === null) {
      setError('Choose an answer before rating this contrast prompt.');
      return;
    }

    if (rating === null && (!reviewInReinforcement || productionAwaitingNext || pureCueAwaitingNext || contrastAwaitingNext)) return;
    deskBusyRef.current = true;
    setSubmittingRating(rating ?? 'forgot');
    setError(null);

    try {
      if (options?.confirmKeyboardRating) {
        // Let the chosen button paint before the desk starts moving the card.
        await new Promise<void>((resolve) => window.setTimeout(resolve, 240));
        if (!mountedRef.current) return;
      }
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
        rating === null ? skipActiveReviewReinforcement(sessionState) : activePureCue
          ? rateActivePureCueProductionUnit(sessionState, rating, {
              response: productionSubmittedResponse,
              outcome: pureCueResponseResolution?.outcome ?? 'rejected',
              submittedWordId: pureCueResponseResolution?.submittedWordId ?? null,
            })
          : activeItem?.actionKind === 'contrast_selection'
          ? rateActiveContrastSelectionUnit({
              state: sessionState,
              selectedWordId: contrastSelectedWordId ?? '',
              rating,
              practiceMore: false,
            })
          : rateActiveSessionUnit(sessionState, rating, {
              response:
                activeItem?.actionKind === 'production'
                  ? productionSubmittedResponse
                  : null,
              productionResponse:
                activeItem?.actionKind === 'production'
                  ? productionResponseResolution
                  : null,
            });
      setCompletedReinforcementStreak(getCompletedReinforcementStreak({
        sessionCompleted: transition.state.phase === 'completed',
        reviewInReinforcement,
        rating,
        reinforcementStreak: activePureCue
          ? activeReviewReinforcementStreak
          : activeReviewProgress?.reinforcementStreak ?? 0,
      }));
      const outcome = rating === null ? 'done' : getSessionDeskOutcome(rating, transition.commit);
      if (activeUnit?.type !== 'study') throw new Error('Session desk requires an active study unit.');
      const key = getSessionDeskUnitKey(activeUnit.bucket, activeUnit.item.sessionActionId, activeWord?.id);
      // Update metadata only once the learner chooses to leave this card.
      setDeskAgainKeys((keys) => updateSessionDeskAgainKeys(keys, key, outcome));
      const showNext = () => {
        setPendingSessionCommit(transition.commit.type === 'none' ? null : transition.commit);

        setSessionState(transition.state);
        setSessionSummary((current) => activePureCue
          ? updateSessionSummaryForPureCueRating({
              activePureCue, characterPresentation,
              summary: current,
              transition,
              previousPhase: sessionState.phase,
            })
          : updateSessionSummaryForRating({
            summary: current,
            transition,
            rating: rating ?? 'forgot',
            activeWord: activeWord!,
            activeItem: activeItem!,
            previousPhase: sessionState.phase,
            characterPresentation,
          }));
        resetAnswerAndProductionUi();
      };
      if (transition.state.phase !== 'completed' && sessionDeskRef.current) await sessionDeskRef.current.depart(outcome, showNext);
      else showNext();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      deskBusyRef.current = false;
      setSubmittingRating(null);
    }
  }

  async function handleSubmitProductionHanzi() {
    if (contentRatingSavingRef.current || deskBusyRef.current || submittingRating !== null) return;
    if (
      personalNotesEditorOpen ||
      !sessionState ||
      (!activeItem && !activePureCue) ||
      (activeItem !== null && activeItem.actionKind !== 'production')
    ) {
      return;
    }

    const typedResponse = productionHanziInputRef.current?.value ?? productionHanziInput;
    const submittedHanzi = normalizeProductionAnswer(
      typedResponse,
      studyProfile.defaultProductionMatchOptions,
    );
    if (submittedHanzi.length === 0) {
      setProductionHanziError(`Enter ${studyProfile.labels.target} before submitting.`);
      return;
    }

    deskBusyRef.current = true;
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

      if (activePureCue) {
        const resolution = resolvePureCueResponse(activePureCue.snapshot, typedResponse, studyProfile.id);
        if (resolution.outcome === 'accepted') {
          setProductionHanziError(null);
          setProductionSubmittedResponse(typedResponse);
          setPureCueResponseResolution(resolution);
          setProductionUiPhase('await-rating');
          setAnswerRevealed(true);
          return;
        }
        applyAutomaticPureCueForgot({ stateAtResponse: sessionState, item: activePureCue, response: typedResponse, resolution });
        return;
      }
      let resolution: ProductionResponseResolution;
      if (activeItem!.rehearsal) {
        const result = resolveContentExerciseResponse(activeItem!.rehearsal, typedResponse);
        resolution = { submittedText: typedResponse, result: result.outcome === 'accepted' ? 'accepted_anchor' : 'rejected' };
      } else if (activeWord!.status === 'review') {
        resolution = resolveSessionProductionResponse({
          submittedText: typedResponse,
          anchorWordId: activeWord!.id,
          production: activeItem!.production,
          profileId: studyProfile.id,
        });
      } else {
        const accepted = matchServedCueAnswer({
          acceptedAnswers: [{
            wordId: activeWord!.id,
            hanzi: activeWord!.hanzi,
            traditional: activeWord!.traditional,
          }],
        }, typedResponse, studyProfile.id) !== null;
        resolution = {
          submittedText: typedResponse,
          result: accepted ? 'accepted_anchor' : 'rejected',
        };
      }
      const isCorrect = resolution.result !== 'rejected';

      if (isCorrect) {
        setProductionHanziError(null);
        setProductionSubmittedResponse(typedResponse);
        setProductionResponseResolution(resolution);
        setProductionUiPhase(
          hasServedProductionReveal(activeItem!.production) ? 'await-supplement' : 'await-rating',
        );
        setAnswerRevealed(true);
        return;
      }
      applyAutomaticProductionForgot({
        stateAtResponse: sessionState,
        itemAtResponse: activeItem!,
        wordAtResponse: activeWord!,
        response: typedResponse,
        resolution: activeWord!.status === 'review' ? resolution : null,
        attemptedHanzi: submittedHanzi,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      deskBusyRef.current = false;
      setSubmittingRating(null);
    }
  }

  // These callbacks capture the rendered action. Saving fences departure until the
  // server confirms the rating, so its request is present before attempt commit.
  const ratingSessionId = sessionState?.sessionId;
  function handleContentRatingChange(rating: 'up' | 'down' | null, frozen = false) {
    if (ratingSessionId !== sessionStateRef.current?.sessionId
      || sessionFinalizationRef.current.kind !== 'unfinalized') return;
    const item = frozen && frozenProductionCard ? {
      sessionActionId: frozenProductionCard.sessionActionId,
      targetWordId: frozenProductionCard.targetWordId,
      actionKind: 'production' as const,
      production: frozenProductionCard.production ?? null,
      word: { status: frozenProductionCard.status },
    } : activeItem;
    if (!item) return;
    contentRatingRequestedReflectionRef.current = setContentRatingRequestedReview(
      contentRatingRequestedReflectionRef.current, item,
      frozen && frozenProductionCard ? frozenProductionCard.promptDisplayedMeanings : activePromptDisplayedMeanings,
      rating,
    );
  }

  function handleToggleLearnerRequestedReview() {
    if (!activeItem || activeItem.actionKind !== 'production') return;
    learnerRequestedReflectionRef.current = toggleLearnerRequestedReview(
      learnerRequestedReflectionRef.current,
      activeItem,
      activePromptDisplayedMeanings,
    );
    setSessionNow(new Date().toISOString());
  }

  function handleToggleFrozenProductionLearnerRequestedReview() {
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
  }

  async function handleNoClueProduction() {
    if (contentRatingSavingRef.current || deskBusyRef.current || submittingRating !== null) return;
    if (
      personalNotesEditorOpen ||
      !sessionState ||
      (!activeItem && !activePureCue) ||
      (activeItem !== null && activeItem.actionKind !== 'production') ||
      productionHanziInput.trim().length > 0
    ) {
      return;
    }

    deskBusyRef.current = true;
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
      if (activePureCue) {
        applyAutomaticPureCueForgot({
          stateAtResponse: sessionState,
          item: activePureCue,
          response: null,
          resolution: { outcome: 'rejected', submittedWordId: null },
        });
        return;
      }
      applyAutomaticProductionForgot({
        stateAtResponse: sessionState,
        itemAtResponse: activeItem!,
        wordAtResponse: activeWord!,
        response: null,
        resolution: activeWord!.status === 'review'
          ? {
              responseKind: 'no_clue',
              submittedText: null,
              result: 'rejected',
            }
          : null,
        attemptedHanzi: null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      deskBusyRef.current = false;
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
        characterPresentation,
      }),
    );
    setFrozenProductionCard({
      sessionActionId: itemAtResponse.sessionActionId,
      targetWordId: wordAtResponse.id,
      actionKind: 'production',
      sampledSkillIds: [...itemAtResponse.sampledSkillIds],
      contentRef: itemAtResponse.contentRef,
      production: itemAtResponse.production ?? null,
      rehearsal: itemAtResponse.rehearsal,
      wordContent: itemAtResponse.wordContent,
      attemptedHanzi,
      status: wordAtResponse.status,
      reviewedCount,
      queuedCount: getBucketSessionTotalCount(stateAtResponse),
      promptDisplayedMeanings: itemAtResponse.production || itemAtResponse.rehearsal ? [] : [...activePromptDisplayedMeanings],
      fallbackPrompt: activePrompt ?? wordAtResponse.meaning,
      answerPinyin: wordAtResponse.pinyin,
      answerText: formatCardCharacters(wordAtResponse, characterPresentation),
      answerForms: { hanzi: wordAtResponse.hanzi, traditional: wordAtResponse.traditional },
      allMeanings: [...activeAllMeanings],
      personalNotes: activeWordPersonalNotes,
      intervalHours: itemAtResponse.intervalHours,
      example: wordAtResponse.examples[0] ?? '',
    });
    const expectedCharacters = formatCardCharacters(wordAtResponse, characterPresentation);
    setProductionHanziError(
      attemptedHanzi === null
        ? `No clue recorded. Expected "${expectedCharacters}".`
        : itemAtResponse.rehearsal
          ? `This drill asks for the taught expression "${expectedCharacters}". Another expression may be natural here.`
          : `Incorrect ${studyProfile.labels.target}. Expected "${expectedCharacters}".`,
    );
    setProductionUiPhase('await-next');
    setAnswerRevealed(true);
  }

  function applyAutomaticPureCueForgot({
    stateAtResponse,
    item,
    response,
    resolution,
  }: {
    stateAtResponse: BucketSessionState;
    item: PureCueSessionReviewItem;
    response: string | null;
    resolution: Pick<PureCueAssessmentEvent, 'outcome' | 'submittedWordId'>;
  }) {
    const transition = rateActivePureCueProductionUnit(stateAtResponse, 'forgot', {
      response,
      outcome: resolution.outcome,
      submittedWordId: resolution.submittedWordId,
    });
    setPendingSessionCommit(transition.commit.type === 'none' ? null : transition.commit);
    setSessionState(transition.state);
    setSessionSummary((current) =>
      updateSessionSummaryForPureCueRating({
        activePureCue: item, characterPresentation,
        summary: current,
        transition,
        previousPhase: stateAtResponse.phase,
      }),
    );
    setFrozenPureCueCard({
      item,
      attemptedResponse: response,
      reviewedCount,
      queuedCount: getBucketSessionTotalCount(stateAtResponse),
    });
    setProductionHanziError(
      response === null
        ? 'No clue recorded. Review the accepted answers.'
        : 'That response is not in this cue\'s frozen accepted-answer set.',
    );
    setProductionUiPhase('await-next');
    setAnswerRevealed(true);
  }

  async function confirmSessionAction() {
    setConfirmingSessionAction(true);
    await new Promise<void>((resolve) => window.setTimeout(resolve, 240));
    return mountedRef.current;
  }

  async function handleRevealAnswer() {
    if (contentRatingSavingRef.current || deskBusyRef.current || answerRevealed || (!activeItem && !activePureCue)) return;
    deskBusyRef.current = true;
    try {
      if (!await confirmSessionAction()) return;
      setAnswerRevealed(true);
    } finally {
      deskBusyRef.current = false;
      setConfirmingSessionAction(false);
    }
  }

  async function handleContinueAfterAutoForgot() {
    if (contentRatingSavingRef.current || deskBusyRef.current || submittingRating !== null || (!frozenProductionCard && !frozenPureCueCard)) return;
    deskBusyRef.current = true;
    setSubmittingRating('forgot');
    try {
      if (!await confirmSessionAction()) return;
      const key = frozenPureCueCard
        ? getSessionDeskUnitKey('review', frozenPureCueCard.item.sessionActionId)
        : getSessionDeskUnitKey(frozenProductionCard!.status, frozenProductionCard!.sessionActionId, frozenProductionCard!.targetWordId);
      setDeskAgainKeys((keys) => updateSessionDeskAgainKeys(keys, key, 'wrong'));
      // Domain state already advanced; uncover it beneath the departing clone.
      if (sessionState?.phase !== 'completed' && sessionDeskRef.current) await sessionDeskRef.current.depart('wrong', resetAnswerAndProductionUi);
      else resetAnswerAndProductionUi();
    } finally {
      deskBusyRef.current = false;
      setSubmittingRating(null);
      setConfirmingSessionAction(false);
    }
  }

  async function handleContinueAfterProductionSupplement() {
    if (contentRatingSavingRef.current || deskBusyRef.current || !productionAwaitingSupplement) return;
    deskBusyRef.current = true;
    try {
      if (!await confirmSessionAction()) return;
      setProductionUiPhase('await-rating');
    } finally {
      deskBusyRef.current = false;
      setConfirmingSessionAction(false);
    }
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
    if (contentRatingSavingRef.current || deskBusyRef.current || submittingRating !== null) return;
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

    deskBusyRef.current = true;
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
      setDeskRemainingOverride(getBucketSessionTotalCount(sessionState));
      setSessionState(transition.state);
      setSessionSummary((current) =>
        updateSessionSummaryForRating({
          summary: current,
          transition,
          rating: 'forgot',
          activeWord,
          activeItem,
          previousPhase: sessionState.phase,
          characterPresentation,
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
      deskBusyRef.current = false;
      setSubmittingRating(null);
    }
  }

  async function handleContinueAfterAutoContrastForgot() {
    if (contentRatingSavingRef.current || deskBusyRef.current || submittingRating !== null || !frozenContrastCard) return;
    deskBusyRef.current = true;
    setSubmittingRating('forgot');
    try {
      if (!await confirmSessionAction()) return;
      // Contrast is completed on its first answer; it does not enter reinforcement.
      if (sessionState?.phase !== 'completed' && sessionDeskRef.current) await sessionDeskRef.current.depart('contrast-miss', resetAnswerAndProductionUi);
      else resetAnswerAndProductionUi();
    } finally {
      deskBusyRef.current = false;
      setSubmittingRating(null);
      setConfirmingSessionAction(false);
    }
  }

  function handleUndoLastRating() {
    if (sessionStateRef.current?.phase === 'completed') {
      void completionFlow.undo();
      return;
    }
    restoreLastRating();
  }

  function restoreLastRating() {
    if (contentRatingSavingRef.current || deskBusyRef.current || sessionFinalizationRef.current.kind !== 'unfinalized' || !lastUndoSnapshot || submittingRating !== null) {
      return;
    }

    if (lastUndoSnapshot.introductionWordId) {
      introductionController.reopen(lastUndoSnapshot.sessionState.sessionId, lastUndoSnapshot.introductionWordId);
    }
    setSessionState(cloneBucketSessionState(lastUndoSnapshot.sessionState));
    setSessionSummary(lastUndoSnapshot.sessionSummary);
    restoreSessionUiSnapshot(lastUndoSnapshot.ui);
    reflectionEvidenceRef.current = restoreSessionReflectionEvidence(
      lastUndoSnapshot.reflectionEvidence,
    );
    setPendingSessionCommit(null);
    setLastUndoSnapshot(null);
    if (activeSessionClockRef.current) {
      activeSessionClockRef.current = updateActiveSessionClockForVisibility({ clock: activeSessionClockRef.current, nowMs: Date.now(), visibilityState: document.visibilityState });
    }
    setError(null);
  }

  async function handleCompleteTeaching() {
    if (!sessionState || !activeWord || !introductionGate || submittingRating !== null) return;
    const sourceState = sessionState;
    const sourceWord = activeWord;
    const dismiss = introductionGate.dismiss;
    setSubmittingRating('good');
    setError(null);
    try {
      await applyPendingUndoClosure();
      const current = currentIntroductionTargetRef.current;
      if (!sameIntroductionCompletionTarget({
        state: sourceState, wordId: sourceWord.id, gateKey: introductionGate.key,
      }, current)) return;
      const transition = completeActiveUnstudiedTeaching(sourceState, sourceWord.id);
      setLastUndoSnapshot({
        introductionWordId: sourceWord.id,
        sessionState: cloneBucketSessionState(sourceState), sessionSummary,
        ui: createSessionUiSnapshot(),
        reflectionEvidence: snapshotSessionReflectionEvidence(reflectionEvidenceRef.current),
      });
      if (transition.commit.type !== 'none') throw new Error('Teaching alone must not commit its word unit.');
      setPendingSessionCommit(null);
      setSessionState(transition.state);
      dismiss();
      resetAnswerAndProductionUi();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not finish the introduction.');
    } finally { setSubmittingRating(null); }
  }

  function handleBeginUnstudiedDrill(wordId: string) {
    setSessionState((current) => (current ? completeActiveUnstudiedIntro(current).state : current));
  }

  async function handleDismissCurrentWord() {
    if (contentRatingSavingRef.current || deskBusyRef.current) return;
    if (!sessionState || !activeWord) {
      return;
    }

    deskBusyRef.current = true;
    setStudyManagementSubmitting(true);
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
        contentRatingRequestedReflectionRef.current = dropLearnerRequestedReflectionForAction(
          contentRatingRequestedReflectionRef.current,
          activeItem.sessionActionId,
        );
      }
      resetAnswerAndProductionUi();
      setLastUndoSnapshot(null);
      await dismissWordFromStudy(transition.dismiss.wordId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      deskBusyRef.current = false;
      setStudyManagementSubmitting(false);
    }
  }

  async function handleManageStudyAction() {
    if (contentRatingSavingRef.current || deskBusyRef.current) return;
    if (!sessionState || !activeItem || !activeWord) {
      return;
    }

    if (activeWord.status !== 'review') {
      setError('Study management actions are currently limited to review cards.');
      return;
    }

    if (activeItem.actionKind !== 'production') {
      setError('This card only supports dismiss from Manage Study right now.');
      return;
    }

    deskBusyRef.current = true;
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
        managementAction: 'suppress_skill',
      });

      if (studyManagementActionRemovesCurrentReviewAction('suppress_skill')) {
        reflectionEvidenceRef.current = dropSessionReflectionEvidenceForAction(
          reflectionEvidenceRef.current,
          activeItem.sessionActionId,
        );
        learnerRequestedReflectionRef.current = dropLearnerRequestedReflectionForAction(
          learnerRequestedReflectionRef.current,
          activeItem.sessionActionId,
        );
        contentRatingRequestedReflectionRef.current = dropLearnerRequestedReflectionForAction(
          contentRatingRequestedReflectionRef.current,
          activeItem.sessionActionId,
        );
        setSessionState(dropActiveReviewSessionAction(sessionState));
        resetAnswerAndProductionUi();
        setLastUndoSnapshot(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      deskBusyRef.current = false;
      setStudyManagementSubmitting(false);
    }
  }

  async function handleManageFrozenProductionAction() {
    if (contentRatingSavingRef.current || deskBusyRef.current) return;
    if (!sessionState || !frozenProductionCard) {
      return;
    }

    if (frozenProductionCard.status !== 'review') {
      setError('Study management actions are currently limited to review cards.');
      return;
    }

    deskBusyRef.current = true;
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
        managementAction: 'suppress_skill',
      });

      if (!studyManagementActionRemovesCurrentReviewAction('suppress_skill')) {
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
      contentRatingRequestedReflectionRef.current = dropLearnerRequestedReflectionForAction(
        contentRatingRequestedReflectionRef.current,
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
      deskBusyRef.current = false;
      setStudyManagementSubmitting(false);
    }
  }

  async function handleDismissFrozenProductionWord() {
    if (contentRatingSavingRef.current || deskBusyRef.current) return;
    if (!sessionState || !frozenProductionCard) {
      return;
    }

    deskBusyRef.current = true;
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
      contentRatingRequestedReflectionRef.current = dropLearnerRequestedReflectionForAction(
        contentRatingRequestedReflectionRef.current,
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
      deskBusyRef.current = false;
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
    if (!sessionStarted) {
      setShortcutGuideOpen(false);
    }
  }, [sessionStarted]);

  useEffect(() => {
    if (!personalNotesEditorOpen) {
      return;
    }

    personalNotesEditorInputRef.current?.focus();
  }, [personalNotesEditorOpen]);

  useEffect(() => {
    if (submittingRating !== null || introductionBlocked || !sessionStarted || !isProductionItem || answerRevealed || (productionAwaitingNext || pureCueAwaitingNext) || personalNotesEditorOpen) {
      return;
    }

    if (activeWord?.status === 'unstudied' && !activeUnstudiedProgress?.introComplete) {
      return;
    }

    productionHanziInputRef.current?.focus();
  }, [
    submittingRating,
    introductionBlocked,
    activeUnstudiedProgress?.introComplete,
    activeItem?.sessionActionId,
    activePureCue?.sessionActionId,
    answerRevealed,
    personalNotesEditorOpen,
    productionAwaitingNext,
    pureCueAwaitingNext,
    isProductionItem,
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
    if (introductionBlocked || !sessionStarted || !sessionState || !sessionSurfaceVisible) {
      return;
    }

    const completedSummary = sessionState.phase === 'completed';
    // The completion screen owns its shortcuts throughout saving, Undo, and closure.
    if (completedSummary) return;
    const summaryFinalizationKind = sessionFinalization.kind;

    function handleKeyDown(event: KeyboardEvent) {
      // Native disclosures (including the sidebar) retain their own activation keys.
      if ((event.key === ' ' || event.key === 'Enter' || event.code === 'Space')
        && event.target instanceof Element && event.target.closest('summary')) return;
      if (contentRatingSavingRef.current || deskBusyRef.current || event.repeat || introductionBlockedRef.current || event.defaultPrevented || shortcutGuideOpen || submittingRating !== null || personalNotesEditorOpen) {
        return;
      }

      if (!event.shiftKey && (event.key === ' ' || event.key === 'Enter')
        && event.target instanceof Element && event.target.closest('[data-session-skip-reinforcement]')) return;
      if (event.shiftKey && event.key === ' ' && (event.metaKey || event.ctrlKey || event.altKey)) return;

      const command = resolveSessionKey(
        {
          key: event.key,
          code: event.code,
          isComposing: event.isComposing,
          keyCode: event.keyCode,
          shiftKey: event.shiftKey,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          altKey: event.altKey,
        },
        {
          sessionStarted: true,
          isEditableTarget: isEditableKeyboardTarget(event.target),
          isNativeActionTarget: event.target instanceof Element && event.target.closest('button, a[href]') !== null,
          isQualityControlTarget: event.target instanceof Element
            && event.target.closest('[data-content-quality-controls]') !== null,
          productionInputActive: productionSubmissionInputActive,
          canNoClueProduction: productionHanziInput.trim().length === 0,
          canRequestReflectionReview: !completedSummary && (productionAwaitingNext
            ? frozenProductionCard?.status === 'review'
            : !pureCueAwaitingNext && !contrastAwaitingNext
              && activeItem?.actionKind === 'production' && activeWord?.status === 'review'),
          isProductionInputTarget: event.target === productionHanziInputRef.current,
          productionAwaitingNext,
          pureCueAwaitingNext,
          productionAwaitingSupplement,
          contrastAwaitingNext,
          unstudiedIntro: activeWord?.status === 'unstudied' && !activeUnstudiedProgress?.introComplete,
          isProductionItem,
          contrastSelectionActive,
          contrastHasSelection: contrastSelectedWordId !== null,
          answerRevealed,
          ratingAvailable: answerRevealed && !productionAwaitingNext && !pureCueAwaitingNext && !productionAwaitingSupplement && !contrastAwaitingNext,
          hasUndo: lastUndoSnapshot !== null,
          hasActiveWord: activeWord !== null,
          canSkipReinforcement: reviewInReinforcement && !productionAwaitingNext && !pureCueAwaitingNext && !contrastAwaitingNext,
          ratingOptions: activeRatingOptions,
          completedSummary,
          summaryFinalizationKind,
        },
      );

      if (!command) {
        return;
      }

      if (
        command.type === 'submit_production'
        && event.target === productionHanziInputRef.current
      ) {
        return;
      }

      event.preventDefault();

      switch (command.type) {
        case 'toggle_production_input_focus':
          if (document.activeElement === productionHanziInputRef.current) {
            productionHanziInputRef.current?.blur();
          } else {
            productionHanziInputRef.current?.focus();
          }
          return;
        case 'skip_reinforcement':
          void handleRate(null);
          return;
        case 'no_clue_production':
          void handleNoClueProduction();
          return;
        case 'submit_production':
          void handleSubmitProductionHanzi();
          return;
        case 'toggle_reflection_review':
          if (productionAwaitingNext) handleToggleFrozenProductionLearnerRequestedReview();
          else handleToggleLearnerRequestedReview();
          return;
        case 'open_notes':
          handleOpenPersonalNotesEditor();
          return;
        case 'reveal':
          void handleRevealAnswer();
          return;
        case 'begin_unstudied_drill':
          if (activeWord) {
            handleBeginUnstudiedDrill(activeWord.id);
          }
          return;
        case 'continue_after_auto_forgot':
          if (productionAwaitingNext || pureCueAwaitingNext) {
            handleContinueAfterAutoForgot();
          } else if (contrastAwaitingNext) {
            handleContinueAfterAutoContrastForgot();
          }
          return;
        case 'continue_after_supplement':
          handleContinueAfterProductionSupplement();
          return;
        case 'rate_default': {
          const defaultRating = getDefaultRating(activeRatingOptions);
          if (defaultRating && (activeWord || activePureCue)) {
            void handleRate(defaultRating, {
              confirmKeyboardRating: true,
              restoreUi: isProductionItem ? 'production-input' : 'revealed',
            });
          }
          return;
        }
        case 'preview_contrast': {
          const choiceWordId = activeItem?.contrastSelection?.choices[command.choiceIndex]?.word.id;
          if (choiceWordId) {
            handlePreviewContrastChoice(choiceWordId);
          }
          return;
        }
        case 'confirm_contrast':
          if (contrastSelectedWordId) {
            void handleSelectContrastChoice(contrastSelectedWordId);
          }
          return;
        case 'undo':
          handleUndoLastRating();
          return;
        case 'rate':
          void handleRate(command.rating, {
            confirmKeyboardRating: true,
            restoreUi: isProductionItem ? 'production-input' : 'revealed',
          });
          return;
        case 'finish_session':
        case 'close_summary':
          void handleEndSession();
          return;
        case 'toggle_shortcut_guide':
          if (!shortcutGuideOpen) {
            setShortcutGuideOpen(true);
          }
          return;
      }
    }

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [
    activeRatingOptions,
    reviewInReinforcement,
    activeItem,
    activePureCue,
    activeUnstudiedProgress?.introComplete,
    activeWord,
    activeWordPersonalNotes,
    activePromptDisplayedMeanings,
    answerRevealed,
    contrastAwaitingNext,
    contrastSelectionActive,
    contrastSelectedWordId,
    productionAwaitingNext,
    pureCueAwaitingNext,
    productionAwaitingSupplement,
    isProductionItem,
    productionSubmissionInputActive,
    productionHanziInput,
    frozenProductionCard,
    lastUndoSnapshot,
    personalNotesEditorOpen,
    sessionFinalization,
    sessionStarted,
    sessionState,
    sessionSurfaceVisible,
    introductionBlocked,
    shortcutGuideOpen,
    submittingRating,
  ]);

  return {
    sessionStarted,
    sessionReflectionGenerating: false,
    prefetchSession,
    refreshSessionPrefetch,
    invalidateSessionPrefetch,
    finishCompletedSessionIfLeaving,
    homePageProps: {
      sessionDeskRef,
      deskAgainCount: sessionState ? retainSessionDeskAgainKeys(deskAgainKeys, sessionState).length : 0,
      deskRemainingCount: deskRemainingOverride ?? displayedSessionItemCount,
      introductionGate: introductionGate ? { ...introductionGate, complete: () => { void handleCompleteTeaching(); } } : null,
      sessionPrefetch,
      sessionStarted,
      sessionPhase: sessionState?.phase ?? null,
      sessionLoading,
      displayedSessionItemCount,
      reviewedCount,
      sessionSummary,
      sessionFinalization,
      completionPanel: {
        completion: completionFlow.completion, saving: completionFlow.saving, busy: completionFlow.busy,
        error: completionFlow.error, hasUndo: lastUndoSnapshot !== null,
        onUndo: handleUndoLastRating, onReturnHome: () => void completionFlow.finish(),
        onKeepOpen: completionFlow.keepSummaryOpen, onRetry: () => void completionFlow.retry(),
        keepOpen: completionFlow.keepOpen, remainingSeconds: completionFlow.remainingSeconds,
      },
      activeItem,
      activePureCue,
      activeWord,
      activeLearningProgress,
      activeUnstudiedProgress,
      activeReviewProgress,
      activePureCueFailureCount,
      activePureCueReinforcementStreak: activePureCueReviewProgress?.reinforcementStreak ?? 0,
      completedReinforcementStreak,
      hasUndo: lastUndoSnapshot !== null,
      submittingRating,
      confirmingSessionAction,
      contentRatingSaving,
      personalNotesEditorOpen,
      personalNotesEditorSaving,
      studyManagementSubmitting,
      productionAwaitingNext,
      pureCueAwaitingNext,
      productionAwaitingSupplement,
      frozenProductionCard,
      frozenPureCueCard,
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
      isProductionItem,
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
      onContinueAfterProductionSupplement: handleContinueAfterProductionSupplement,
      onContinueAfterAutoContrastForgot: handleContinueAfterAutoContrastForgot,
      onDismissCurrentWord: () => void handleDismissCurrentWord(),
      onManageStudyAction: () => void handleManageStudyAction(),
      onDismissFrozenProductionWord: () => void handleDismissFrozenProductionWord(),
      onManageFrozenProductionAction: () => void handleManageFrozenProductionAction(),
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
      onRevealAnswer: () => void handleRevealAnswer(),
      onContentRatingSavingChange: (saving) => {
        if (saving) {
          contentRatingSaveBarrierRef.current = new Promise<void>((resolve) => {
            releaseContentRatingSaveRef.current = resolve;
          });
        } else {
          releaseContentRatingSaveRef.current?.();
          releaseContentRatingSaveRef.current = null;
        }
        contentRatingSavingRef.current = saving;
        setContentRatingSaving(saving);
      },
      onContentRatingChange: (rating) => handleContentRatingChange(rating),
      onFrozenProductionContentRatingChange: (rating) => handleContentRatingChange(rating, true),
      onToggleLearnerRequestedReview: handleToggleLearnerRequestedReview,
      onToggleFrozenProductionLearnerRequestedReview: handleToggleFrozenProductionLearnerRequestedReview,
      onSkipReinforcement: () => void handleRate(null),
      onRate: (rating, options) => void handleRate(rating, options),
      shortcutGuideOpen,
      onOpenShortcutGuide: () => setShortcutGuideOpen(true),
      onCloseShortcutGuide: () => setShortcutGuideOpen(false),
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
