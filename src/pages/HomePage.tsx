import type { RefObject } from 'react';
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
import type { ProductionMatchOptions } from '../study-profile';
import {
  StudySessionPanel,
  type FrozenProductionCard,
} from '../features/session/StudySessionPanel';
import { HomeOverviewPanel } from './HomeOverviewPanel';

export function HomePage({
  backendStatus,
  sessionPrefetch,
  sessionStarted,
  sessionPhase,
  sessionLoading,
  displayedSessionItemCount,
  reviewedCount,
  sessionSummary,
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
  productionMatchOptions,
  onStartSession,
  onEndSession,
  onUndoLastRating,
  onContinueAfterAutoForgot,
  onProductionContrastCandidateCheckedChange,
  onProductionContrastCandidateNoteChange,
  onDismissCurrentWord,
  onManageStudyAction,
  onDismissFrozenProductionWord,
  onManageFrozenProductionAction,
  onOpenPersonalNotesEditor,
  onBeginUnstudiedDrill,
  onToggleMeaningVisibility,
  onSubmitProductionHanzi,
  onProductionHanziInputChange,
  onProductionMatchOptionChange,
  onResetProductionMatchOptions,
  onRevealAnswer,
  onRate,
}: {
  backendStatus: BackendStatus | null;
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
  studyManagementSubmitting: boolean;
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
  productionMatchOptions: ProductionMatchOptions;
  onStartSession: () => void;
  onEndSession: () => void;
  onUndoLastRating: () => void;
  onContinueAfterAutoForgot: () => void;
  onProductionContrastCandidateCheckedChange: (checked: boolean) => void;
  onProductionContrastCandidateNoteChange: (value: string) => void;
  onDismissCurrentWord: () => void;
  onManageStudyAction: (action: StudyManagementActionKind, note: string) => void;
  onDismissFrozenProductionWord: () => void;
  onManageFrozenProductionAction: (action: StudyManagementActionKind, note: string) => void;
  onOpenPersonalNotesEditor: () => void;
  onBeginUnstudiedDrill: (wordId: string) => void;
  onToggleMeaningVisibility: (meaning: WordMeaning) => void;
  onSubmitProductionHanzi: () => void;
  onProductionHanziInputChange: (value: string) => void;
  onProductionMatchOptionChange: (option: keyof ProductionMatchOptions, value: boolean) => void;
  onResetProductionMatchOptions: () => void;
  onRevealAnswer: () => void;
  onRate: (rating: ReviewRating, options: { restoreUi: 'revealed' | 'production-input' }) => void;
}) {
  return (
    <>
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

      <div className="grid">
        <HomeOverviewPanel
          backendStatus={backendStatus}
          sessionPrefetch={sessionPrefetch}
          sessionStarted={sessionStarted}
          sessionPhase={sessionPhase}
          sessionLoading={sessionLoading}
          displayedSessionItemCount={displayedSessionItemCount}
          productionMatchOptions={productionMatchOptions}
          onStartSession={onStartSession}
          onEndSession={onEndSession}
          onProductionMatchOptionChange={onProductionMatchOptionChange}
          onResetProductionMatchOptions={onResetProductionMatchOptions}
        />

        <StudySessionPanel
          sessionStarted={sessionStarted}
          sessionPhase={sessionPhase}
          sessionSummary={sessionSummary}
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
          productionContrastCandidateChecked={productionContrastCandidateChecked}
          productionContrastCandidateNote={productionContrastCandidateNote}
          activeRatingOptions={activeRatingOptions}
          onUndoLastRating={onUndoLastRating}
          onEndSession={onEndSession}
          onContinueAfterAutoForgot={onContinueAfterAutoForgot}
          onProductionContrastCandidateCheckedChange={onProductionContrastCandidateCheckedChange}
          onProductionContrastCandidateNoteChange={onProductionContrastCandidateNoteChange}
          onDismissCurrentWord={onDismissCurrentWord}
          onManageStudyAction={onManageStudyAction}
          onDismissFrozenProductionWord={onDismissFrozenProductionWord}
          onManageFrozenProductionAction={onManageFrozenProductionAction}
          onOpenPersonalNotesEditor={onOpenPersonalNotesEditor}
          onBeginUnstudiedDrill={onBeginUnstudiedDrill}
          onToggleMeaningVisibility={onToggleMeaningVisibility}
          onSubmitProductionHanzi={onSubmitProductionHanzi}
          onProductionHanziInputChange={onProductionHanziInputChange}
          onRevealAnswer={onRevealAnswer}
          onRate={onRate}
        />
      </div>
    </>
  );
}
