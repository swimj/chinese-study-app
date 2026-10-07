import type { SessionDeskHandle } from '../features/session/SessionDesk';
import { SessionIntroductionGatePanel } from '../features/session/SessionIntroductionGatePanel';
import type { SessionIntroductionGate } from '../features/session/useIntroductionGate';
import type { RefObject } from 'react';
import { useEffect, useState } from 'react';
import type { BackendStatus, UnstudiedAdmissionSource } from '../services/api';
import {
  DEFAULT_CHARACTER_PRESENTATION,
  type CharacterPresentation,
  type SentenceCharacterPresentation,
} from '../domain/card-characters';
import type {
  BucketSessionState,
  LearningWordProgress,
  ReviewActionProgress,
  UnstudiedWordProgress,
} from '../lib/session-state';
import type { PureCueSessionReviewItem, SessionStudyItem } from '../domain/study-actions';
import type { ReviewRating, Word, WordMeaning } from '../types';
import type { SessionPrefetchState } from '../features/session/session-prefetch';
import type { RatingOption } from '../features/session/session-rating';
import type { SessionSummary } from '../features/session/session-summary';
import type { SessionFinalizationState } from '../features/session/session-finalization';
import {
  StudySessionPanel,
  type FrozenContrastCard,
  type FrozenProductionCard,
  type FrozenPureCueCard,
} from '../features/session/StudySessionPanel';
import { useSessionDebrief } from '../features/session/useSessionDebrief';
import { HomeConnections } from '../features/session/HomeConnections';
import { ConnectionSignals } from '../features/session/ConnectionSignals';
import { useHomeConnectionsView } from '../features/session/useHomeConnectionsView';
import { HomeOverviewPanel, SessionSettingsPanel } from './HomeOverviewPanel';
import { HomeUpdates } from './HomeUpdates';

export function HomePage({
  onOpenUpdate,
  onViewAllUpdates,
  introductionGate,
  backendStatus,
  onSaveSessionSettings,
  sessionPrefetch,
  sessionStarted,
  sessionDeskRef,
  deskAgainCount,
  deskRemainingCount,
  sessionPhase,
  sessionLoading,
  displayedSessionItemCount,
  reviewedCount,
  sessionSummary,
  sessionFinalization,
  activeItem,
  activePureCue,
  activeWord,
  activeLearningProgress,
  activeUnstudiedProgress,
  activeReviewProgress,
  activePureCueFailureCount,
  activePureCueReinforcementStreak,
  hasUndo,
  submittingRating,
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
  onStartSession,
  onEndSession,
  onRetrySessionReflection,
  onUndoLastRating,
  onContinueAfterAutoForgot,
  onContinueAfterProductionSupplement,
  onContinueAfterAutoContrastForgot,
  onDismissCurrentWord,
  onManageStudyAction,
  onDismissFrozenProductionWord,
  onManageFrozenProductionAction,
  onOpenPersonalNotesEditor,
  onBeginUnstudiedDrill,
  onToggleMeaningVisibility,
  onSubmitProductionHanzi,
  onNoClueProduction,
  onProductionHanziInputChange,
  onSelectContrastChoice,
  onRevealAnswer,
  onToggleLearnerRequestedReview,
  onToggleFrozenProductionLearnerRequestedReview,
  onRate,
  onSkipReinforcement,
  shortcutGuideOpen,
  onOpenShortcutGuide,
  onCloseShortcutGuide,
  onNudgeDiet,
}: {
  onOpenUpdate?: (id: string) => void;
  onViewAllUpdates?: () => void;
  introductionGate?: SessionIntroductionGate | null;
  backendStatus: BackendStatus | null;
  onSaveSessionSettings: (settings: {
    dailyNewWordLimit?: number;
    studyNewWordsFirst?: boolean;
    unstudiedAdmissionSource?: UnstudiedAdmissionSource;
    characterPresentation?: CharacterPresentation;
    sentenceCharacterPresentation?: SentenceCharacterPresentation;
    debriefInterests?: string;
  }) => Promise<void>;
  sessionPrefetch: SessionPrefetchState;
  sessionStarted: boolean;
  sessionDeskRef: RefObject<SessionDeskHandle>;
  deskAgainCount: number;
  deskRemainingCount: number;
  sessionPhase: BucketSessionState['phase'] | null;
  sessionLoading: boolean;
  displayedSessionItemCount: number;
  reviewedCount: number;
  sessionSummary: SessionSummary | null;
  sessionFinalization: SessionFinalizationState;
  activeItem: SessionStudyItem | null;
  activePureCue: PureCueSessionReviewItem | null;
  activeWord: Word | null;
  activeLearningProgress: LearningWordProgress | undefined;
  activeUnstudiedProgress: UnstudiedWordProgress | undefined;
  activeReviewProgress: ReviewActionProgress | undefined;
  activePureCueFailureCount: number;
  activePureCueReinforcementStreak: number;
  hasUndo: boolean;
  submittingRating: ReviewRating | null;
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
  onToggleLearnerRequestedReview: () => void;
  onToggleFrozenProductionLearnerRequestedReview: () => void;
  onSkipReinforcement: () => void;
  onRate: (rating: ReviewRating, options: { restoreUi: 'revealed' | 'production-input' }) => void;
  shortcutGuideOpen: boolean;
  onOpenShortcutGuide: () => void;
  onCloseShortcutGuide: () => void;
  onNudgeDiet: (direction: 'easier' | 'harder') => Promise<void>;
}) {
  const recent = useSessionDebrief(undefined, !sessionStarted && backendStatus?.studyProfile === 'mandarin');
  const [sessionSettingsOpen, setSessionSettingsOpen] = useState(false);
  const [sessionSettingsSaving, setSessionSettingsSaving] = useState(false);
  const connectionsVisible = !sessionStarted && !sessionSettingsOpen;
  const connections = useHomeConnectionsView(recent.debrief, connectionsVisible);
  const connectionsExpanded = connectionsVisible && connections.expanded;
  useEffect(() => {
    if (sessionStarted) {
      setSessionSettingsOpen(false);
    }
  }, [sessionStarted]);

  return (
    <div className={sessionStarted ? 'home-page home-session-active' : `home-page${connectionsExpanded ? ' home-connections-expanded' : ''}`}>
      {connectionsExpanded ? <ConnectionSignals /> : null}
      <div className={`grid home-grid${!sessionStarted && !connectionsExpanded && !sessionSettingsOpen && onOpenUpdate && onViewAllUpdates ? ' home-with-updates' : ''}`}>
        <HomeOverviewPanel
          backendStatus={backendStatus}
          compact={connectionsExpanded}
          sessionPrefetch={sessionPrefetch}
          sessionStarted={sessionStarted}
          sessionPhase={sessionPhase}
          sessionFinalization={sessionFinalization}
          sessionLoading={sessionLoading}
          displayedSessionItemCount={displayedSessionItemCount}
          sessionSettingsOpen={sessionSettingsOpen}
          sessionSettingsSaving={sessionSettingsSaving}
          onToggleSessionSettings={() => {
            if (!sessionSettingsSaving) {
              setSessionSettingsOpen((open) => !open);
            }
          }}
          onStartSession={onStartSession}
          onEndSession={onEndSession}
          onNudgeDiet={onNudgeDiet}
        />

        {!sessionStarted && !sessionSettingsOpen && recent.debrief ? (
          <HomeConnections key={recent.debrief.sessionId} debrief={recent.debrief} expanded={connections.expanded}
            error={recent.error} retrying={recent.retrying} onToggle={connections.toggle}
            onRetry={recent.retry} onReload={recent.reload} />
        ) : !sessionStarted && recent.error && backendStatus?.studyProfile === 'mandarin' ? (
          <p className="notes" role="status">Couldn’t load the recent session. <button type="button" className="secondary-button" onClick={recent.reload}>Try again</button></p>
        ) : null}

        {!sessionStarted && !connectionsExpanded && !sessionSettingsOpen && onOpenUpdate && onViewAllUpdates
          ? <HomeUpdates onOpenPost={onOpenUpdate} onViewAll={onViewAllUpdates} /> : null}

        {sessionSettingsOpen && !sessionStarted ? (
          <SessionSettingsPanel
            backendStatus={backendStatus}
            onSaveSessionSettings={onSaveSessionSettings}
            onSavingChange={setSessionSettingsSaving}
            onClose={() => setSessionSettingsOpen(false)}
          />
        ) : introductionGate ? (
          <SessionIntroductionGatePanel gate={introductionGate}
            characterPresentation={backendStatus?.characterPresentation ?? DEFAULT_CHARACTER_PRESENTATION}
            sentenceCharacterPresentation={backendStatus?.sentenceCharacterPresentation ?? 'simplified'}
            onUndo={hasUndo && submittingRating === null ? onUndoLastRating : undefined} />
        ) : sessionStarted ? (
          <StudySessionPanel
            sessionDeskRef={sessionDeskRef}
            deskAgainCount={deskAgainCount}
            deskRemainingCount={deskRemainingCount}
            sessionStarted={sessionStarted}
            sessionPhase={sessionPhase}
            sessionSummary={sessionSummary}
            sessionFinalization={sessionFinalization}
            activeItem={activeItem}
            activePureCue={activePureCue}
            activeWord={activeWord}
            characterPresentation={backendStatus?.characterPresentation ?? DEFAULT_CHARACTER_PRESENTATION}
            sentenceCharacterPresentation={backendStatus?.sentenceCharacterPresentation ?? 'simplified'}
            activeLearningProgress={activeLearningProgress}
            activeUnstudiedProgress={activeUnstudiedProgress}
            activeReviewProgress={activeReviewProgress}
            activePureCueFailureCount={activePureCueFailureCount}
            activePureCueReinforcementStreak={activePureCueReinforcementStreak}
            reviewedCount={reviewedCount}
            queuedCount={displayedSessionItemCount}
            hasUndo={hasUndo}
            submittingRating={submittingRating}
            personalNotesEditorOpen={personalNotesEditorOpen}
            personalNotesEditorSaving={personalNotesEditorSaving}
            studyManagementSubmitting={studyManagementSubmitting}
            productionAwaitingNext={productionAwaitingNext}
            pureCueAwaitingNext={pureCueAwaitingNext}
            productionAwaitingSupplement={productionAwaitingSupplement}
            frozenProductionCard={frozenProductionCard}
            frozenPureCueCard={frozenPureCueCard}
            contrastAwaitingNext={contrastAwaitingNext}
            frozenContrastCard={frozenContrastCard}
            activeAllMeanings={activeAllMeanings}
            activeWordPersonalNotes={activeWordPersonalNotes}
            reviewInReinforcement={reviewInReinforcement}
            activeElapsedTime={activeElapsedTime}
            activePrompt={activePrompt}
            activePromptDisplayedMeanings={activePromptDisplayedMeanings}
            activeReviewState={activeReviewState}
            answerRevealed={answerRevealed}
            activeAnswerPinyin={activeAnswerPinyin}
            activeAnswerText={activeAnswerText}
            activeMeaningRows={activeMeaningRows}
            meaningVisibilitySavingKey={meaningVisibilitySavingKey}
            isProductionItem={isProductionItem}
            productionAwaitingRating={productionAwaitingRating}
            productionHanziInput={productionHanziInput}
            productionHanziError={productionHanziError}
            productionHanziInputRef={productionHanziInputRef}
            contrastSelectedWordId={contrastSelectedWordId}
            contrastAwaitingRating={contrastAwaitingRating}
            activeRatingOptions={activeRatingOptions}
            learnerRequestedReview={learnerRequestedReview}
            frozenProductionLearnerRequestedReview={frozenProductionLearnerRequestedReview}
            onUndoLastRating={onUndoLastRating}
            onEndSession={onEndSession}
            onRetrySessionReflection={onRetrySessionReflection}
            onContinueAfterAutoForgot={onContinueAfterAutoForgot}
            onContinueAfterProductionSupplement={onContinueAfterProductionSupplement}
            onContinueAfterAutoContrastForgot={onContinueAfterAutoContrastForgot}
            onDismissCurrentWord={onDismissCurrentWord}
            onManageStudyAction={onManageStudyAction}
            onDismissFrozenProductionWord={onDismissFrozenProductionWord}
            onManageFrozenProductionAction={onManageFrozenProductionAction}
            onOpenPersonalNotesEditor={onOpenPersonalNotesEditor}
            onBeginUnstudiedDrill={onBeginUnstudiedDrill}
            onToggleMeaningVisibility={onToggleMeaningVisibility}
            onSubmitProductionHanzi={onSubmitProductionHanzi}
            onNoClueProduction={onNoClueProduction}
            onProductionHanziInputChange={onProductionHanziInputChange}
            onSelectContrastChoice={onSelectContrastChoice}
            onRevealAnswer={onRevealAnswer}
            onToggleLearnerRequestedReview={onToggleLearnerRequestedReview}
            onToggleFrozenProductionLearnerRequestedReview={onToggleFrozenProductionLearnerRequestedReview}
            onRate={onRate}
            onSkipReinforcement={onSkipReinforcement}
            shortcutGuideOpen={shortcutGuideOpen}
            onOpenShortcutGuide={onOpenShortcutGuide}
            onCloseShortcutGuide={onCloseShortcutGuide}
          />
        ) : null}
      </div>
    </div>
  );
}
