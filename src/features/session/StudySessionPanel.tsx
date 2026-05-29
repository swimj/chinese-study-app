import { useState, type RefObject } from 'react';
import { MeaningList } from '../../components/MeaningList';
import type {
  LearningWordProgress,
  ReviewActionProgress,
  BucketSessionState,
  UnstudiedWordProgress,
} from '../../lib/session-state';
import type { SessionStudyItem, StudyManagementActionKind } from '../../domain/study-actions';
import type { ReviewRating, Word, WordMeaning } from '../../types';
import { studyProfile } from '../../study-profile';
import type { RatingOption } from './session-rating';
import type { SessionSummary } from './session-summary';
import { getStudySessionPanelView } from './session-selectors';
import { SessionSummaryPanel } from './SessionSummaryPanel';

export type FrozenProductionCard = {
  sessionActionId: string;
  targetWordId: string;
  actionKind: 'production';
  sampledSkillIds: SessionStudyItem['sampledSkillIds'];
  contentRef: SessionStudyItem['contentRef'];
  attemptedHanzi: string;
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

export type FrozenContrastCard = {
  item: SessionStudyItem;
  selectedWordId: string;
  reviewedCount: number;
  queuedCount: number;
};

export function StudySessionPanel({
  sessionStarted,
  sessionPhase,
  sessionSummary,
  activeItem,
  activeWord,
  activeLearningProgress,
  activeUnstudiedProgress,
  activeReviewProgress,
  reviewedCount,
  queuedCount,
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
  onUndoLastRating,
  onEndSession,
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
  sessionStarted: boolean;
  sessionPhase: BucketSessionState['phase'] | null;
  sessionSummary: SessionSummary | null;
  activeItem: SessionStudyItem | null;
  activeWord: Word | null;
  activeLearningProgress: LearningWordProgress | undefined;
  activeUnstudiedProgress: UnstudiedWordProgress | undefined;
  activeReviewProgress: ReviewActionProgress | undefined;
  reviewedCount: number;
  queuedCount: number;
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
  onUndoLastRating: () => void;
  onEndSession: () => void;
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
  const productionFormId = 'production-hanzi-input-form';
  const panelView = getStudySessionPanelView({
    sessionStarted,
    sessionCompletedWithSummary: sessionPhase === 'completed' && sessionSummary !== null,
    productionAwaitingNext,
    frozenProductionCardPresent: frozenProductionCard !== null,
    contrastAwaitingNext,
    frozenContrastCardPresent: frozenContrastCard !== null,
    activeItemPresent: activeItem !== null,
    activeWordStatus: activeWord?.status ?? null,
    activeUnstudiedIntroComplete: activeUnstudiedProgress?.introComplete ?? false,
  });
  const showRatingButtons = answerRevealed && (
    (!productionRequiresHanziInput || productionAwaitingRating) &&
    (!activeItem || activeItem.actionKind !== 'contrast_selection' || contrastAwaitingRating)
  );

  return (
    <div className={sessionStarted ? 'panel study-session-panel session-panel-active' : 'panel study-session-panel'}>
      <h2>Study session</h2>
      {panelView === 'not_started' ? (
        <p className="notes">Start the session to freeze the current session snapshot into frontend state.</p>
      ) : panelView === 'frozen_production' && frozenProductionCard ? (
        <div className="review-card session-card-shell">
          <div className="session-card-scroll">
            <div className="review-card-header">
              <p className="badge">
                {frozenProductionCard.status === 'review'
                  ? 'Review'
                  : frozenProductionCard.status === 'learning'
                    ? 'Learning'
                    : 'New word'}
                {` · ${studyProfile.labels.productionDirection}`}
              </p>
              {frozenProductionCard.status === 'review' ? (
                <FrozenProductionCardActions
                  isSubmitting={studyManagementSubmitting}
                  onDismissFrozenProductionWord={onDismissFrozenProductionWord}
                  onManageFrozenProductionAction={onManageFrozenProductionAction}
                />
              ) : null}
            </div>
            <p className="notes">
              Answered {frozenProductionCard.reviewedCount} this session · {frozenProductionCard.queuedCount} still queued
            </p>
            <UndoButton
              hasUndo={hasUndo}
              submittingRating={submittingRating}
              personalNotesEditorOpen={personalNotesEditorOpen}
              onUndoLastRating={onUndoLastRating}
            />
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
            <p className="notes">{studyProfile.labels.targetRecallIncorrect} This item was recorded as Forgot.</p>
            <div className="contrast-candidate-controls">
              <span className="prompt-label">Contrast intake</span>
              <span className="prompt-meta">
                {frozenProductionCard.attemptedHanzi} {studyProfile.labels.targetContrastCandidate}
              </span>
              <textarea
                value={productionContrastIntakeNote}
                onChange={(event) => onProductionContrastIntakeNoteChange(event.target.value)}
                disabled={personalNotesEditorOpen || studyManagementSubmitting || productionContrastIntakeMarked}
                placeholder="Note"
                rows={3}
              />
              <button
                type="button"
                className="secondary-button"
                onClick={() => onManageFrozenProductionAction('add_contrast_candidate', productionContrastIntakeNote)}
                disabled={personalNotesEditorOpen || studyManagementSubmitting || productionContrastIntakeMarked}
              >
                {productionContrastIntakeMarked ? 'Marked for intake' : 'Mark for intake'}
              </button>
            </div>
          </div>
          <div className="session-action-bar">
            <button type="button" onClick={onContinueAfterAutoForgot} disabled={personalNotesEditorOpen}>
              Next
            </button>
          </div>
        </div>
      ) : panelView === 'frozen_contrast' && frozenContrastCard ? (
        <div className="review-card session-card-shell">
          <div className="session-card-scroll">
            <div className="review-card-header">
              <p className="badge">Review · Contrast selection</p>
            </div>
            <p className="notes">
              Answered {frozenContrastCard.reviewedCount} this session · {frozenContrastCard.queuedCount} still queued
            </p>
            <UndoButton
              hasUndo={hasUndo}
              submittingRating={submittingRating}
              personalNotesEditorOpen={personalNotesEditorOpen}
              onUndoLastRating={onUndoLastRating}
            />
            <div className="prompt-block">
              <span className="prompt-label">Prompt</span>
              <strong className="contrast-prompt-text">{frozenContrastCard.item.contrastSelection?.prompt.promptText}</strong>
            </div>
            <ContrastSelectionDrill
              item={frozenContrastCard.item}
              selectedWordId={frozenContrastCard.selectedWordId}
              answerRevealed={true}
              practiceMore={false}
              disabled={true}
              onSelectChoice={() => undefined}
              onPracticeMoreChange={() => undefined}
            />
            <p className="notes">Incorrect contrast choice. This item was recorded as Forgot.</p>
          </div>
          <div className="session-action-bar">
            <button type="button" onClick={onContinueAfterAutoContrastForgot} disabled={personalNotesEditorOpen}>
              Next
            </button>
          </div>
        </div>
      ) : panelView === 'completed' && sessionSummary ? (
        <div className="review-card session-card-shell">
          <div className="session-card-scroll">
            <SessionSummaryPanel summary={sessionSummary} />
          </div>
          <div className="session-action-bar">
            <UndoButton
              hasUndo={hasUndo}
              submittingRating={submittingRating}
              personalNotesEditorOpen={personalNotesEditorOpen}
              onUndoLastRating={onUndoLastRating}
            />
          </div>
        </div>
      ) : panelView === 'unstudied_intro' && activeWord ? (
        <div className="review-card session-card-shell">
          <div className="session-card-scroll">
            <div className="review-card-header">
              <p className="badge">New word introduction</p>
              <CardActions
                activeItem={null}
                activeWord={activeWord}
                personalNotesEditorSaving={personalNotesEditorSaving}
                studyManagementSubmitting={studyManagementSubmitting}
                onDismissCurrentWord={onDismissCurrentWord}
                onManageStudyAction={onManageStudyAction}
                onOpenPersonalNotesEditor={onOpenPersonalNotesEditor}
              />
            </div>
            <div className="prompt-block">
              <span className="prompt-label">{studyProfile.labels.target}</span>
              <strong className="prompt-value">{activeWord.hanzi}</strong>
              <span className="prompt-meta">{activeWord.pinyin}</span>
              <MeaningList meanings={activeAllMeanings} />
              <span className="prompt-meta">{activeWord.examples[0]}</span>
              {activeWordPersonalNotes.trim().length > 0 ? (
                <span className="prompt-meta">Notes: {activeWordPersonalNotes}</span>
              ) : null}
            </div>
          </div>
          <div className="session-action-bar">
            <button
              type="button"
              onClick={() => onBeginUnstudiedDrill(activeWord.id)}
              disabled={personalNotesEditorOpen}
            >
              Begin recall drills
            </button>
            <UndoButton
              hasUndo={hasUndo}
              submittingRating={submittingRating}
              personalNotesEditorOpen={personalNotesEditorOpen}
              onUndoLastRating={onUndoLastRating}
            />
          </div>
        </div>
      ) : panelView === 'empty' ? (
        <div className="review-card session-card-shell">
          <div className="session-card-scroll">
            <p className="notes">No session items remain in the active snapshot.</p>
          </div>
          <div className="session-action-bar">
            <UndoButton
              hasUndo={hasUndo}
              submittingRating={submittingRating}
              personalNotesEditorOpen={personalNotesEditorOpen}
              onUndoLastRating={onUndoLastRating}
            />
            <button type="button" onClick={onEndSession}>
              Back to overview
            </button>
          </div>
        </div>
      ) : activeItem && activeWord ? (
        <div className="review-card session-card-shell">
          <div className="session-card-scroll">
            <div className="review-card-header">
              <p className="badge">
                {sessionPhase === 'draining'
                  ? 'Draining'
                  : activeWord.status === 'review'
                    ? reviewInReinforcement
                      ? 'Review reinforcement'
                      : 'Review'
                    : activeWord.status === 'learning'
                      ? 'Learning'
                      : 'New word'}
                {' · '}
                {activeItem.actionKind === 'recognition'
                  ? studyProfile.labels.recognitionDirection
                  : activeItem.actionKind === 'contrast_selection'
                    ? 'Contrast selection'
                    : studyProfile.labels.productionDirection}
              </p>
              <CardActions
                activeItem={activeItem}
                activeWord={activeWord}
                personalNotesEditorSaving={personalNotesEditorSaving}
                studyManagementSubmitting={studyManagementSubmitting}
                onDismissCurrentWord={onDismissCurrentWord}
                onManageStudyAction={onManageStudyAction}
                onOpenPersonalNotesEditor={onOpenPersonalNotesEditor}
              />
            </div>
            <p className="notes">
              Answered {reviewedCount} this session · {queuedCount} still queued · Unique lapse items{' '}
              {sessionSummary?.lapsedReviewActionIds.length ?? 0} · Elapsed {activeElapsedTime}
            </p>
            <UndoButton
              hasUndo={hasUndo}
              submittingRating={submittingRating}
              personalNotesEditorOpen={personalNotesEditorOpen}
              onUndoLastRating={onUndoLastRating}
            />
            <div className="prompt-block">
              <span className="prompt-label">Prompt</span>
              {activeItem.actionKind === 'contrast_selection' ? (
                <>
                  <strong className="contrast-prompt-text">{activePrompt}</strong>
                </>
              ) : activeItem.actionKind === 'recognition' ? (
                <strong className="prompt-value">{activePrompt}</strong>
              ) : activePromptDisplayedMeanings.length > 0 ? (
                <MeaningList meanings={activePromptDisplayedMeanings} className="meaning-list-prompt" />
              ) : (
                <span className="prompt-meta meaning-list-prompt">No production meanings selected</span>
              )}
              <span className="prompt-meta">
                {activeWord.status === 'review'
                  ? `${activeReviewState} · Failures ${activeReviewProgress?.failureCount ?? 0}`
                  : activeWord.status === 'learning'
                    ? `Binary recall · Covered ${Number(activeLearningProgress?.coveredDirections.forward ?? false) + Number(activeLearningProgress?.coveredDirections.reverse ?? false)}/2 skills`
                    : `Binary recall · Consecutive successes ${activeUnstudiedProgress?.consecutiveSuccesses.forward ?? 0}/3 recognition · ${activeUnstudiedProgress?.consecutiveSuccesses.reverse ?? 0}/3 production`}
              </span>
            </div>
            {activeItem.actionKind === 'contrast_selection' ? (
              <ContrastSelectionDrill
                item={activeItem}
                selectedWordId={contrastSelectedWordId}
                answerRevealed={answerRevealed}
                practiceMore={contrastPracticeMore}
                disabled={submittingRating !== null || personalNotesEditorOpen}
                onSelectChoice={onSelectContrastChoice}
                onPracticeMoreChange={onContrastPracticeMoreChange}
              />
            ) : answerRevealed ? (
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
                            onClick={() => onToggleMeaningVisibility(meaning)}
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
                  Interval {activeItem.intervalHours} hour{activeItem.intervalHours === 1 ? '' : 's'}
                </span>
                <span className="prompt-meta">{activeWord.examples[0]}</span>
              </div>
            ) : productionRequiresHanziInput && !productionAwaitingRating ? (
              <form
                id={productionFormId}
                className="stack"
                onSubmit={(event) => {
                  event.preventDefault();
                  onSubmitProductionHanzi();
                }}
              >
                <label className="prompt-label" htmlFor="production-hanzi-input">
                  {studyProfile.labels.productionInput}
                </label>
                <input
                  ref={productionHanziInputRef}
                  id="production-hanzi-input"
                  type="text"
                  value={productionHanziInput}
                  onChange={(event) => onProductionHanziInputChange(event.target.value)}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  disabled={submittingRating !== null || personalNotesEditorOpen}
                />
                {productionHanziError ? <p className="notes">{productionHanziError}</p> : null}
              </form>
            ) : null}
          </div>
          <div className="session-action-bar">
            {activeItem.actionKind === 'contrast_selection' && !showRatingButtons ? (
              <span className="prompt-meta session-action-hint">Choose an option to continue.</span>
            ) : showRatingButtons ? (
              <div className="rating-grid">
                {activeRatingOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className="rating-button"
                    onClick={() =>
                      onRate(option.value, {
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
            ) : productionRequiresHanziInput && !productionAwaitingRating ? (
              <button
                type="submit"
                form={productionFormId}
                disabled={submittingRating !== null || personalNotesEditorOpen}
              >
                {studyProfile.labels.submitProductionInput}
              </button>
            ) : (
              <button type="button" onClick={onRevealAnswer} disabled={personalNotesEditorOpen}>
                Reveal answer
              </button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ContrastSelectionDrill({
  item,
  selectedWordId,
  answerRevealed,
  practiceMore,
  disabled,
  onSelectChoice,
  onPracticeMoreChange,
}: {
  item: SessionStudyItem;
  selectedWordId: string | null;
  answerRevealed: boolean;
  practiceMore: boolean;
  disabled: boolean;
  onSelectChoice: (wordId: string) => void;
  onPracticeMoreChange: (checked: boolean) => void;
}) {
  const contrastSelection = item.contrastSelection;
  if (!contrastSelection) {
    return <p className="notes">Contrast content is unavailable for this item.</p>;
  }

  const selectedChoice = contrastSelection.choices.find((choice) => choice.word.id === selectedWordId);
  const targetChoice = contrastSelection.choices.find((choice) => choice.word.id === contrastSelection.promptTargetWordId);
  const selectedCorrect = selectedWordId === contrastSelection.promptTargetWordId;

  return (
    <div className="stack">
      <div className="contrast-choice-grid">
        {contrastSelection.choices.map((choice) => {
          const isSelected = choice.word.id === selectedWordId;
          const isTarget = choice.word.id === contrastSelection.promptTargetWordId;
          const className = [
            'contrast-choice-button',
            isSelected ? 'selected' : '',
            answerRevealed && isTarget ? 'correct' : '',
            answerRevealed && isSelected && !isTarget ? 'incorrect' : '',
          ].filter(Boolean).join(' ');

          return (
            <button
              key={choice.word.id}
              type="button"
              className={className}
              onClick={() => onSelectChoice(choice.word.id)}
              disabled={disabled || answerRevealed}
            >
              <strong>{choice.word.hanzi}</strong>
            </button>
          );
        })}
      </div>
      {answerRevealed ? (
        <div className="answer-block">
          <span className="prompt-label">{selectedCorrect ? 'Correct' : 'Answer'}</span>
          {selectedChoice ? (
            <span className="prompt-meta">
              You chose {selectedChoice.word.hanzi}.
            </span>
          ) : null}
          {targetChoice ? (
            <>
              <span className="answer-pinyin">{targetChoice.word.pinyin}</span>
              <strong className="answer-value">{targetChoice.word.hanzi}</strong>
              <MeaningList meanings={targetChoice.word.meanings.length > 0 ? targetChoice.word.meanings : [targetChoice.word.meaning]} />
              {targetChoice.nuanceNote.trim().length > 0 ? (
                <span className="prompt-meta">Nuance: {targetChoice.nuanceNote}</span>
              ) : null}
            </>
          ) : null}
          {contrastSelection.prompt.explanation.trim().length > 0 ? (
            <span className="prompt-meta">{contrastSelection.prompt.explanation}</span>
          ) : null}
          {contrastSelection.clusterNote.trim().length > 0 ? (
            <span className="prompt-meta">{contrastSelection.clusterNote}</span>
          ) : null}
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={practiceMore}
              onChange={(event) => onPracticeMoreChange(event.target.checked)}
              disabled={disabled}
            />
            <span>Practice this contrast more</span>
          </label>
        </div>
      ) : null}
    </div>
  );
}

function UndoButton({
  hasUndo,
  submittingRating,
  personalNotesEditorOpen,
  onUndoLastRating,
}: {
  hasUndo: boolean;
  submittingRating: ReviewRating | null;
  personalNotesEditorOpen: boolean;
  onUndoLastRating: () => void;
}) {
  if (!hasUndo) {
    return null;
  }

  return (
    <button
      type="button"
      className="secondary-button"
      onClick={onUndoLastRating}
      disabled={submittingRating !== null || personalNotesEditorOpen}
    >
      Undo last rating
    </button>
  );
}

function CardActions({
  activeItem,
  activeWord,
  personalNotesEditorSaving,
  studyManagementSubmitting,
  onDismissCurrentWord,
  onManageStudyAction,
  onOpenPersonalNotesEditor,
}: {
  activeItem: SessionStudyItem | null;
  activeWord: Word;
  personalNotesEditorSaving: boolean;
  studyManagementSubmitting: boolean;
  onDismissCurrentWord: () => void;
  onManageStudyAction: (action: StudyManagementActionKind, note: string) => void;
  onOpenPersonalNotesEditor: () => void;
}) {
  const [manageOpen, setManageOpen] = useState(false);

  return (
    <div className="inline-actions">
      <button
        type="button"
        className="secondary-button"
        onClick={() => setManageOpen(true)}
        disabled={personalNotesEditorSaving || studyManagementSubmitting}
      >
        Manage Study
      </button>
      <button
        type="button"
        className="secondary-button"
        onClick={onOpenPersonalNotesEditor}
        disabled={personalNotesEditorSaving}
      >
        Edit notes
      </button>
      {manageOpen ? (
        <ManageStudyPanel
          actionKind={activeItem?.actionKind ?? null}
          status={activeWord.status}
          isSubmitting={studyManagementSubmitting}
          onClose={() => setManageOpen(false)}
          onDismissWord={() => {
            setManageOpen(false);
            onDismissCurrentWord();
          }}
          onManageStudyAction={(action, note) => {
            setManageOpen(false);
            onManageStudyAction(action, note);
          }}
        />
      ) : null}
    </div>
  );
}

function FrozenProductionCardActions({
  isSubmitting,
  onDismissFrozenProductionWord,
  onManageFrozenProductionAction,
}: {
  isSubmitting: boolean;
  onDismissFrozenProductionWord: () => void;
  onManageFrozenProductionAction: (action: StudyManagementActionKind, note: string) => void;
}) {
  const [manageOpen, setManageOpen] = useState(false);

  return (
    <div className="inline-actions">
      <button
        type="button"
        className="secondary-button"
        onClick={() => setManageOpen(true)}
        disabled={isSubmitting}
      >
        Manage Study
      </button>
      {manageOpen ? (
        <ManageStudyPanel
          actionKind="production"
          status="review"
          isSubmitting={isSubmitting}
          onClose={() => setManageOpen(false)}
          onDismissWord={() => {
            setManageOpen(false);
            onDismissFrozenProductionWord();
          }}
          onManageStudyAction={(action, note) => {
            setManageOpen(false);
            onManageFrozenProductionAction(action, note);
          }}
        />
      ) : null}
    </div>
  );
}

function ManageStudyPanel({
  actionKind,
  status,
  isSubmitting,
  onClose,
  onDismissWord,
  onManageStudyAction,
}: {
  actionKind: SessionStudyItem['actionKind'] | null;
  status: Word['status'];
  isSubmitting: boolean;
  onClose: () => void;
  onDismissWord: () => void;
  onManageStudyAction: (action: StudyManagementActionKind, note: string) => void;
}) {
  const [note, setNote] = useState('');
  const productionReview = status === 'review' && actionKind === 'production';
  const contrastReview = status === 'review' && actionKind === 'contrast_selection';

  return (
    <div className="manage-study-popover">
      <div className="manage-study-heading">
        <strong>Manage Study</strong>
        <button type="button" className="secondary-button" onClick={onClose} disabled={isSubmitting}>
          Close
        </button>
      </div>
      <div className="manage-study-actions">
        <button type="button" className="secondary-button" onClick={onDismissWord} disabled={isSubmitting}>
          Dismiss word
        </button>
        {productionReview ? (
          <>
            <button
              type="button"
              className="secondary-button"
              onClick={() => onManageStudyAction('suppress_skill', note)}
              disabled={isSubmitting}
            >
              Suppress production
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => onManageStudyAction('add_contrast_candidate', note)}
              disabled={isSubmitting}
            >
              Add contrast candidate
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => onManageStudyAction('suppress_skill_and_add_contrast_candidate', note)}
              disabled={isSubmitting}
            >
              Suppress + add contrast
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => onManageStudyAction('bad_prompt', note)}
              disabled={isSubmitting}
            >
              Bad prompt
            </button>
          </>
        ) : null}
        {contrastReview ? (
          <>
            <button
              type="button"
              className="secondary-button"
              onClick={() => onManageStudyAction('suppress_skill', note)}
              disabled={isSubmitting}
            >
              Suppress contrast
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => onManageStudyAction('bad_prompt', note)}
              disabled={isSubmitting}
            >
              Bad prompt
            </button>
          </>
        ) : null}
      </div>
      {productionReview || contrastReview ? (
        <label className="manage-study-note">
          <span>Note</span>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            disabled={isSubmitting}
            rows={3}
          />
        </label>
      ) : null}
    </div>
  );
}
