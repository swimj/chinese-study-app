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
import {
  StudySessionPanel,
  type FrozenContrastCard,
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
  productionContrastIntakeNote,
  productionContrastIntakeMarked,
  contrastSelectedWordId,
  contrastPracticeMore,
  contrastAwaitingRating,
  activeRatingOptions,
  onStartSession,
  onEndSession,
  onUndoLastRating,
  onContinueAfterAutoForgot,
  onContinueAfterAutoContrastForgot,
  onProductionContrastIntakeNoteChange,
  onDismissCurrentWord,
  onManageStudyAction,
  onDismissFrozenProductionWord,
  onManageFrozenProductionAction,
  onOpenPersonalNotesEditor,
  onBeginUnstudiedDrill,
  onToggleMeaningVisibility,
  onSubmitProductionHanzi,
  onProductionHanziInputChange,
  onSelectContrastChoice,
  onContrastPracticeMoreChange,
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
  productionContrastIntakeNote: string;
  productionContrastIntakeMarked: boolean;
  contrastSelectedWordId: string | null;
  contrastPracticeMore: boolean;
  contrastAwaitingRating: boolean;
  activeRatingOptions: RatingOption[];
  onStartSession: () => void;
  onEndSession: () => void;
  onUndoLastRating: () => void;
  onContinueAfterAutoForgot: () => void;
  onContinueAfterAutoContrastForgot: () => void;
  onProductionContrastIntakeNoteChange: (value: string) => void;
  onDismissCurrentWord: () => void;
  onManageStudyAction: (action: StudyManagementActionKind, note: string) => void;
  onDismissFrozenProductionWord: () => void;
  onManageFrozenProductionAction: (action: StudyManagementActionKind, note: string) => void;
  onOpenPersonalNotesEditor: () => void;
  onBeginUnstudiedDrill: (wordId: string) => void;
  onToggleMeaningVisibility: (meaning: WordMeaning) => void;
  onSubmitProductionHanzi: () => void;
  onProductionHanziInputChange: (value: string) => void;
  onSelectContrastChoice: (wordId: string) => void;
  onContrastPracticeMoreChange: (checked: boolean) => void;
  onRevealAnswer: () => void;
  onRate: (rating: ReviewRating, options: { restoreUi: 'revealed' | 'production-input' }) => void;
}) {
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
          sessionLoading={sessionLoading}
          displayedSessionItemCount={displayedSessionItemCount}
          onStartSession={onStartSession}
          onEndSession={onEndSession}
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
          productionContrastIntakeNote={productionContrastIntakeNote}
          productionContrastIntakeMarked={productionContrastIntakeMarked}
          contrastSelectedWordId={contrastSelectedWordId}
          contrastPracticeMore={contrastPracticeMore}
          contrastAwaitingRating={contrastAwaitingRating}
          activeRatingOptions={activeRatingOptions}
          onUndoLastRating={onUndoLastRating}
          onEndSession={onEndSession}
          onContinueAfterAutoForgot={onContinueAfterAutoForgot}
          onContinueAfterAutoContrastForgot={onContinueAfterAutoContrastForgot}
          onProductionContrastIntakeNoteChange={onProductionContrastIntakeNoteChange}
          onDismissCurrentWord={onDismissCurrentWord}
          onManageStudyAction={onManageStudyAction}
          onDismissFrozenProductionWord={onDismissFrozenProductionWord}
          onManageFrozenProductionAction={onManageFrozenProductionAction}
          onOpenPersonalNotesEditor={onOpenPersonalNotesEditor}
          onBeginUnstudiedDrill={onBeginUnstudiedDrill}
          onToggleMeaningVisibility={onToggleMeaningVisibility}
          onSubmitProductionHanzi={onSubmitProductionHanzi}
          onProductionHanziInputChange={onProductionHanziInputChange}
          onSelectContrastChoice={onSelectContrastChoice}
          onContrastPracticeMoreChange={onContrastPracticeMoreChange}
          onRevealAnswer={onRevealAnswer}
          onRate={onRate}
        />
      </div>
    </div>
  );
}
