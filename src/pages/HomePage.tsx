import type { RefObject } from 'react';
import { useEffect, useState } from 'react';
import type { BackendStatus } from '../services/api';
import type {
  BucketSessionState,
  LearningWordProgress,
  ReviewActionProgress,
  UnstudiedWordProgress,
} from '../lib/session-state';
import type { SessionStudyItem, StudyManagementActionKind } from '../domain/study-actions';
import type { ReviewRating, Word, WordMeaning } from '../types';
import type { SessionPrefetchState } from '../features/session/session-prefetch';
import type { RatingOption } from '../features/session/session-rating';
import type { SessionSummary } from '../features/session/session-summary';
import type { SessionFinalizationState } from '../features/session/session-finalization';
import {
  StudySessionPanel,
  type FrozenContrastCard,
  type FrozenProductionCard,
} from '../features/session/StudySessionPanel';
import { HomeOverviewPanel, SessionSettingsPanel } from './HomeOverviewPanel';

export function HomePage({
  backendStatus,
  onSaveDailyNewWordLimit,
  sessionPrefetch,
  sessionStarted,
  sessionPhase,
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
  hasUndo,
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
  onStartSession,
  onEndSession,
  onRetrySessionReflection,
  onUndoLastRating,
  onContinueAfterAutoForgot,
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
  onRate,
}: {
  backendStatus: BackendStatus | null;
  onSaveDailyNewWordLimit: (dailyNewWordLimit: number) => Promise<void>;
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
  onRate: (rating: ReviewRating, options: { restoreUi: 'revealed' | 'production-input' }) => void;
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
      <header className="header">
        <div>
          <h1 className="title">法华挣路</h1>
        </div>
        <div>
          <p className="badge">
            Backend: {backendStatus ? `${backendStatus.mode} @ ${new Date(backendStatus.time).toLocaleTimeString()}` : 'Unknown'}
          </p>
          {backendStatus ? <p className="status-meta">{backendStatus.dbPath}</p> : null}
        </div>
      </header>

      <div className="grid home-grid">
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
          onToggleSessionSettings={() => {
            if (!sessionSettingsSaving) {
              setSessionSettingsOpen((open) => !open);
            }
          }}
          onStartSession={onStartSession}
          onEndSession={onEndSession}
        />

        {sessionSettingsOpen && !sessionStarted ? (
          <SessionSettingsPanel
            backendStatus={backendStatus}
            onSaveDailyNewWordLimit={onSaveDailyNewWordLimit}
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
            activeWord={activeWord}
            activeLearningProgress={activeLearningProgress}
            activeUnstudiedProgress={activeUnstudiedProgress}
            activeReviewProgress={activeReviewProgress}
            reviewedCount={reviewedCount}
            queuedCount={displayedSessionItemCount}
            hasUndo={hasUndo}
            submittingRating={submittingRating}
            personalNotesEditorOpen={personalNotesEditorOpen}
            personalNotesEditorSaving={personalNotesEditorSaving}
            studyManagementSubmitting={studyManagementSubmitting}
            productionAwaitingNext={productionAwaitingNext}
            frozenProductionCard={frozenProductionCard}
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
            productionRequiresHanziInput={productionRequiresHanziInput}
            productionAwaitingRating={productionAwaitingRating}
            productionHanziInput={productionHanziInput}
            productionHanziError={productionHanziError}
            productionHanziInputRef={productionHanziInputRef}
            contrastSelectedWordId={contrastSelectedWordId}
            contrastAwaitingRating={contrastAwaitingRating}
            activeRatingOptions={activeRatingOptions}
            onUndoLastRating={onUndoLastRating}
            onEndSession={onEndSession}
            onRetrySessionReflection={onRetrySessionReflection}
            onContinueAfterAutoForgot={onContinueAfterAutoForgot}
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
            onRate={onRate}
          />
        )}
      </div>
    </div>
  );
}
