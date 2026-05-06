import type { RefObject } from 'react';
import { MeaningList } from '../../components/MeaningList';
import type {
  LearningWordProgress,
  ReviewItemProgress,
  SessionState,
  UnstudiedWordProgress,
} from '../../lib/session-state';
import type { ReviewRating, SessionItemWithWord, Word, WordMeaning } from '../../types';
import type { RatingOption } from './session-rating';
import type { SessionSummary } from './session-summary';
import { SessionSummaryPanel } from './SessionSummaryPanel';

export type FrozenProductionCard = {
  targetWordId: string;
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
  onUndoLastRating,
  onEndSession,
  onContinueAfterAutoForgot,
  onProductionContrastCandidateCheckedChange,
  onProductionContrastCandidateNoteChange,
  onDismissCurrentWord,
  onOpenPersonalNotesEditor,
  onBeginUnstudiedDrill,
  onToggleMeaningVisibility,
  onSubmitProductionHanzi,
  onProductionHanziInputChange,
  onRevealAnswer,
  onRate,
}: {
  sessionStarted: boolean;
  sessionPhase: SessionState['phase'] | null;
  sessionSummary: SessionSummary | null;
  activeItem: SessionItemWithWord | null;
  activeWord: Word | null;
  activeLearningProgress: LearningWordProgress | undefined;
  activeUnstudiedProgress: UnstudiedWordProgress | undefined;
  activeReviewProgress: ReviewItemProgress | undefined;
  reviewedCount: number;
  queuedCount: number;
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
  onUndoLastRating: () => void;
  onEndSession: () => void;
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
}) {
  return (
    <div className="panel">
      <h2>Study session</h2>
      {!sessionStarted ? (
        <p className="notes">Start the session to freeze the current session snapshot into frontend state.</p>
      ) : sessionPhase === 'completed' && sessionSummary ? (
        <div className="stack">
          <SessionSummaryPanel summary={sessionSummary} />
          <UndoButton
            hasUndo={hasUndo}
            submittingRating={submittingRating}
            personalNotesEditorOpen={personalNotesEditorOpen}
            onUndoLastRating={onUndoLastRating}
          />
        </div>
      ) : !activeItem || !activeWord ? (
        <div className="stack">
          <p className="notes">No session items remain in the active snapshot.</p>
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
      ) : productionAwaitingNext && frozenProductionCard ? (
        <div className="review-card">
          <div className="review-card-header">
            <p className="badge">
              {frozenProductionCard.status === 'review'
                ? 'Review'
                : frozenProductionCard.status === 'learning'
                  ? 'Learning'
                  : 'New word'}
              {' · Meaning → Hanzi'}
            </p>
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
          <p className="notes">Hanzi recall was incorrect. This item was recorded as Forgot.</p>
          <button type="button" onClick={onContinueAfterAutoForgot} disabled={personalNotesEditorOpen}>
            Next
          </button>
          <div className="contrast-candidate-controls">
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={productionContrastCandidateChecked}
                onChange={(event) => onProductionContrastCandidateCheckedChange(event.target.checked)}
                disabled={personalNotesEditorOpen}
              />
              <span>{frozenProductionCard.attemptedHanzi} contrast candidate?</span>
            </label>
            <textarea
              value={productionContrastCandidateNote}
              onChange={(event) => onProductionContrastCandidateNoteChange(event.target.value)}
              disabled={!productionContrastCandidateChecked || personalNotesEditorOpen}
              placeholder="Note"
              rows={3}
            />
          </div>
        </div>
      ) : activeWord.status === 'unstudied' && !activeUnstudiedProgress?.introComplete ? (
        <div className="review-card">
          <div className="review-card-header">
            <p className="badge">New word introduction</p>
            <CardActions
              personalNotesEditorSaving={personalNotesEditorSaving}
              onDismissCurrentWord={onDismissCurrentWord}
              onOpenPersonalNotesEditor={onOpenPersonalNotesEditor}
            />
          </div>
          <div className="prompt-block">
            <span className="prompt-label">Hanzi</span>
            <strong className="prompt-value">{activeWord.hanzi}</strong>
            <span className="prompt-meta">{activeWord.pinyin}</span>
            <MeaningList meanings={activeAllMeanings} />
            <span className="prompt-meta">{activeWord.examples[0]}</span>
            {activeItem.reviewItem.direction === 'forward' && activeWordPersonalNotes.trim().length > 0 ? (
              <span className="prompt-meta">Notes: {activeWordPersonalNotes}</span>
            ) : null}
          </div>
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
      ) : (
        <div className="review-card">
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
              {activeItem.reviewItem.direction === 'forward' ? 'Hanzi → Meaning' : 'Meaning → Hanzi'}
            </p>
            <CardActions
              personalNotesEditorSaving={personalNotesEditorSaving}
              onDismissCurrentWord={onDismissCurrentWord}
              onOpenPersonalNotesEditor={onOpenPersonalNotesEditor}
            />
          </div>
          <p className="notes">
            Answered {reviewedCount} this session · {queuedCount} still queued · Unique lapse items{' '}
            {sessionSummary?.lapsedReviewItemIds.length ?? 0} · Elapsed {activeElapsedTime}
          </p>
          <UndoButton
            hasUndo={hasUndo}
            submittingRating={submittingRating}
            personalNotesEditorOpen={personalNotesEditorOpen}
            onUndoLastRating={onUndoLastRating}
          />
          <div className="prompt-block">
            <span className="prompt-label">Prompt</span>
            {activeItem.reviewItem.direction === 'forward' ? (
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
                  ? `Binary recall · Covered ${Number(activeLearningProgress?.coveredDirections.forward ?? false) + Number(activeLearningProgress?.coveredDirections.reverse ?? false)}/2 directions`
                  : `Binary recall · Consecutive successes ${activeUnstudiedProgress?.consecutiveSuccesses.forward ?? 0}/3 forward · ${activeUnstudiedProgress?.consecutiveSuccesses.reverse ?? 0}/3 reverse`}
            </span>
          </div>
          {answerRevealed ? (
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
                Interval {activeItem.reviewItem.intervalHours} hour{activeItem.reviewItem.intervalHours === 1 ? '' : 's'}
              </span>
              <span className="prompt-meta">{activeWord.examples[0]}</span>
            </div>
          ) : productionRequiresHanziInput && !productionAwaitingRating ? (
            <form
              className="stack"
              onSubmit={(event) => {
                event.preventDefault();
                onSubmitProductionHanzi();
              }}
            >
              <label className="prompt-label" htmlFor="production-hanzi-input">
                Type Hanzi
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
              <button type="submit" disabled={submittingRating !== null || personalNotesEditorOpen}>
                Submit Hanzi
              </button>
            </form>
          ) : (
            <button type="button" onClick={onRevealAnswer} disabled={personalNotesEditorOpen}>
              Reveal answer
            </button>
          )}

          {answerRevealed && (!productionRequiresHanziInput || productionAwaitingRating) ? (
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
          ) : null}
        </div>
      )}
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
  personalNotesEditorSaving,
  onDismissCurrentWord,
  onOpenPersonalNotesEditor,
}: {
  personalNotesEditorSaving: boolean;
  onDismissCurrentWord: () => void;
  onOpenPersonalNotesEditor: () => void;
}) {
  return (
    <div className="inline-actions">
      <button
        type="button"
        className="secondary-button"
        onClick={onDismissCurrentWord}
        disabled={personalNotesEditorSaving}
      >
        Dismiss
      </button>
      <button
        type="button"
        className="secondary-button"
        onClick={onOpenPersonalNotesEditor}
        disabled={personalNotesEditorSaving}
      >
        Edit notes
      </button>
    </div>
  );
}
