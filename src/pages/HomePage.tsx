import type { RefObject } from 'react';
import { useEffect, useState } from 'react';
import type { BackendStatus, UnstudiedAdmissionSource, DietIntakeInput, DietSelfSelect } from '../services/api';
import {
  DEFAULT_CHARACTER_PRESENTATION,
  type CharacterPresentation,
} from '../domain/card-characters';
import { DietIntakePanel } from '../features/diet/DietIntakePanel';
import {
  isDietIntakeSubmitting,
  type DietIntakeSubmissionState,
} from '../features/diet/diet-intake-submission';
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
import { HomeOverviewPanel, SessionSettingsPanel } from './HomeOverviewPanel';

export function HomePage({
  backendStatus,
  onSaveSessionSettings,
  sessionPrefetch,
  sessionStarted,
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
  shortcutGuideOpen,
  onOpenShortcutGuide,
  onCloseShortcutGuide,
  dietIntakeSubmission,
  dietIntakeDrafts,
  dietIntakeSelfSelect,
  onDietIntakeDraftsChange,
  onDietIntakeSelfSelectChange,
  onSubmitDietIntakeAssessment,
  onSubmitManualDietIntake,
  onRetryDietIntakeRefresh,
  dietIntakeStartBlocked,
  onNudgeDiet,
}: {
  backendStatus: BackendStatus | null;
  onSaveSessionSettings: (settings: {
    dailyNewWordLimit?: number;
    unstudiedAdmissionSource?: UnstudiedAdmissionSource;
    characterPresentation?: CharacterPresentation;
  }) => Promise<void>;
  sessionPrefetch: SessionPrefetchState;
  sessionStarted: boolean;
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
  onRate: (rating: ReviewRating, options: { restoreUi: 'revealed' | 'production-input' }) => void;
  shortcutGuideOpen: boolean;
  onOpenShortcutGuide: () => void;
  onCloseShortcutGuide: () => void;
  dietIntakeSubmission: DietIntakeSubmissionState;
  dietIntakeDrafts: Record<string, string>;
  dietIntakeSelfSelect: DietSelfSelect | null;
  onDietIntakeDraftsChange: (drafts: Record<string, string>) => void;
  onDietIntakeSelfSelectChange: (value: DietSelfSelect | null) => void;
  onSubmitDietIntakeAssessment: (input: Pick<DietIntakeInput, 'answers'>) => Promise<void>;
  onSubmitManualDietIntake: (input: DietIntakeInput) => Promise<void>;
  onRetryDietIntakeRefresh: () => Promise<void>;
  dietIntakeStartBlocked: boolean;
  onNudgeDiet: (direction: 'easier' | 'harder') => Promise<void>;
}) {
  const [sessionSettingsOpen, setSessionSettingsOpen] = useState(false);
  const [sessionSettingsSaving, setSessionSettingsSaving] = useState(false);
  useEffect(() => {
    if (sessionStarted) {
      setSessionSettingsOpen(false);
    }
  }, [sessionStarted]);

  return (
    <div className={sessionStarted ? 'home-page home-session-active' : 'home-page'}>
      <div className="grid home-grid">
        {(backendStatus?.dietIntakeRequired || dietIntakeSubmission.phase === 'refreshing' || dietIntakeSubmission.phase === 'refresh-error') && !sessionStarted ? (
          <DietIntakePanel
            submitting={isDietIntakeSubmitting(dietIntakeSubmission)}
            submission={dietIntakeSubmission}
            drafts={dietIntakeDrafts}
            selfSelect={dietIntakeSelfSelect}
            onDraftsChange={onDietIntakeDraftsChange}
            onSelfSelectChange={onDietIntakeSelfSelectChange}
            onAssess={(input) => void onSubmitDietIntakeAssessment(input)}
            onSubmitManual={(input) => void onSubmitManualDietIntake(input)}
            onRetryRefresh={() => void onRetryDietIntakeRefresh()}
          />
        ) : null}
        <HomeOverviewPanel
          backendStatus={backendStatus}
          sessionPrefetch={sessionPrefetch}
          sessionStarted={sessionStarted}
          sessionPhase={sessionPhase}
          sessionFinalization={sessionFinalization}
          sessionLoading={sessionLoading}
          displayedSessionItemCount={displayedSessionItemCount}
          sessionSettingsOpen={sessionSettingsOpen}
          sessionSettingsSaving={sessionSettingsSaving}
          dietIntakeStartBlocked={dietIntakeStartBlocked}
          onToggleSessionSettings={() => {
            if (!sessionSettingsSaving) {
              setSessionSettingsOpen((open) => !open);
            }
          }}
          onStartSession={onStartSession}
          onEndSession={onEndSession}
          onNudgeDiet={onNudgeDiet}
        />

        {sessionSettingsOpen && !sessionStarted ? (
          <SessionSettingsPanel
            backendStatus={backendStatus}
            onSaveSessionSettings={onSaveSessionSettings}
            onSavingChange={setSessionSettingsSaving}
            onClose={() => setSessionSettingsOpen(false)}
          />
        ) : (
          <StudySessionPanel
            sessionStarted={sessionStarted}
            sessionPhase={sessionPhase}
            sessionSummary={sessionSummary}
            sessionFinalization={sessionFinalization}
            activeItem={activeItem}
            activePureCue={activePureCue}
            activeWord={activeWord}
            characterPresentation={backendStatus?.characterPresentation ?? DEFAULT_CHARACTER_PRESENTATION}
            activeLearningProgress={activeLearningProgress}
            activeUnstudiedProgress={activeUnstudiedProgress}
            activeReviewProgress={activeReviewProgress}
            activePureCueFailureCount={activePureCueFailureCount}
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
            shortcutGuideOpen={shortcutGuideOpen}
            onOpenShortcutGuide={onOpenShortcutGuide}
            onCloseShortcutGuide={onCloseShortcutGuide}
          />
        )}
      </div>
    </div>
  );
}
