import { useRef, useState, type ReactNode, type RefObject } from 'react';
import { MeaningList } from '../../components/MeaningList';
import type {
  LearningWordProgress,
  ReviewActionProgress,
  BucketSessionState,
  UnstudiedWordProgress,
} from '../../lib/session-state';
import type { SessionStudyItem } from '../../domain/study-actions';
import type { ReviewRating, Word, WordMeaning } from '../../types';
import { studyProfile } from '../../study-profile';
import type { RatingOption } from './session-rating';
import type { SessionSummary } from './session-summary';
import type { SessionFinalizationState } from './session-finalization';
import { getStudySessionPanelView } from './session-selectors';
import {
  getSessionPrimaryAction,
  getSessionShortcutGuide,
  type SessionKeyboardContext,
  type SessionKeyCommand,
} from './session-keyboard';
import { useSessionDialogFocus } from './session-dialog-focus';
import { SessionSummaryPanel } from './SessionSummaryPanel';
import { formatIntervalHours } from '../../lib/format-interval';

export type FrozenProductionCard = {
  sessionActionId: string;
  targetWordId: string;
  actionKind: 'production';
  sampledSkillIds: SessionStudyItem['sampledSkillIds'];
  contentRef: SessionStudyItem['contentRef'];
  attemptedHanzi: string | null;
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
  production?: SessionStudyItem['production'];
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
  sessionFinalization,
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
  contrastSelectedWordId,
  contrastAwaitingRating,
  activeRatingOptions,
  learnerRequestedReview,
  frozenProductionLearnerRequestedReview,
  onUndoLastRating,
  onEndSession,
  onRetrySessionReflection,
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
  onToggleLearnerRequestedReview,
  onToggleFrozenProductionLearnerRequestedReview,
  onRate,
  shortcutGuideOpen,
  onOpenShortcutGuide,
  onCloseShortcutGuide,
}: {
  sessionStarted: boolean;
  sessionPhase: BucketSessionState['phase'] | null;
  sessionSummary: SessionSummary | null;
  sessionFinalization: SessionFinalizationState;
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
  contrastSelectedWordId: string | null;
  contrastAwaitingRating: boolean;
  activeRatingOptions: RatingOption[];
  learnerRequestedReview: boolean;
  frozenProductionLearnerRequestedReview: boolean;
  onUndoLastRating: () => void;
  onEndSession: () => void;
  onRetrySessionReflection: () => void;
  onContinueAfterAutoForgot: () => void;
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
  const sessionEndDisabled = sessionPhase === 'draining' || personalNotesEditorOpen;
  const sessionEndLabel = sessionPhase === 'draining' ? 'Session draining' : 'End session';
  const keyboardContext = createSessionKeyboardContext({
    sessionStarted,
    productionRequiresHanziInput,
    answerRevealed,
    productionAwaitingNext,
    personalNotesEditorOpen,
    contrastAwaitingNext,
    unstudiedIntro: activeWord?.status === 'unstudied' && !(activeUnstudiedProgress?.introComplete ?? false),
    contrastSelectionActive: activeItem?.actionKind === 'contrast_selection',
    contrastHasSelection: contrastSelectedWordId !== null,
    ratingAvailable: showRatingButtons,
    hasUndo,
    hasActiveWord: activeWord !== null,
    ratingOptions: activeRatingOptions,
  });
  const primaryAction = getSessionPrimaryAction(keyboardContext);
  const shortcutGuide = getSessionShortcutGuide(keyboardContext, { includeDialogClose: shortcutGuideOpen });

  return (
    <div className={sessionStarted ? 'panel study-session-panel session-panel-active' : 'panel study-session-panel'}>
      <h2>Study session</h2>
      <div className={shortcutGuideOpen ? 'session-interaction-surface is-paused' : 'session-interaction-surface'}>
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
            </div>
            <p className="notes">
              Answered {frozenProductionCard.reviewedCount} this session · {frozenProductionCard.queuedCount} still queued
            </p>
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
              {frozenProductionCard.production?.supplement ? (
                <div className="production-supplement">
                  <span className="prompt-label">In context</span>
                  <span className="prompt-meta">
                    {frozenProductionCard.production.supplement.englishFrame}
                  </span>
                  <span>{frozenProductionCard.production.supplement.exampleSentence}</span>
                  <span className="prompt-meta">
                    {frozenProductionCard.production.supplement.exampleTranslation}
                  </span>
                </div>
              ) : null}
              {frozenProductionCard.personalNotes.trim().length > 0 ? (
                <span className="prompt-meta">Notes: {frozenProductionCard.personalNotes}</span>
              ) : null}
              <span className="prompt-meta">
                Interval {formatIntervalHours(frozenProductionCard.intervalHours)}
              </span>
              <span className="prompt-meta">{frozenProductionCard.example}</span>
            </div>
            {frozenProductionCard.attemptedHanzi ? (
              <div className="answer-block">
                <span className="prompt-label">Your response</span>
                <strong className="answer-value">{frozenProductionCard.attemptedHanzi}</strong>
                <p className="notes">{studyProfile.labels.targetRecallIncorrect} This item was recorded as Forgot.</p>
              </div>
            ) : (
              <p className="notes">No clue. This item was recorded as Forgot.</p>
            )}
          </div>
          <div className="session-action-bar">
            <SessionActionSection>
              <button type="button" onClick={onContinueAfterAutoForgot} disabled={personalNotesEditorOpen}>
                Next
                <ShortcutHint shortcut={shortcutFor(primaryAction, 'continue_after_auto_forgot')} />
              </button>
              <UndoButton
                hasUndo={hasUndo}
                submittingRating={submittingRating}
                personalNotesEditorOpen={personalNotesEditorOpen}
                onUndoLastRating={onUndoLastRating}
              />
            </SessionActionSection>
            {frozenProductionCard.status === 'review' ? (
              <SessionActionSection>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={onToggleFrozenProductionLearnerRequestedReview}
                  disabled={personalNotesEditorOpen}
                >
                  {frozenProductionLearnerRequestedReview ? 'Remove reflection request' : 'Ask reflection to review'}
                </button>
                <FrozenProductionCardActions
                  isSubmitting={studyManagementSubmitting}
                  onDismissFrozenProductionWord={onDismissFrozenProductionWord}
                  onManageFrozenProductionAction={onManageFrozenProductionAction}
                />
              </SessionActionSection>
            ) : null}
            <SessionActionSection>
              <button type="button" className="secondary-button" onClick={onEndSession} disabled={sessionEndDisabled}>
                {sessionEndLabel}
              </button>
              <KeyboardGuideButton onClick={onOpenShortcutGuide} />
            </SessionActionSection>
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
            <div className="prompt-block">
              <span className="prompt-label">Prompt</span>
              <strong className="contrast-prompt-text">{frozenContrastCard.item.contrastSelection?.prompt.promptText}</strong>
            </div>
            <ContrastSelectionDrill
              item={frozenContrastCard.item}
              selectedWordId={frozenContrastCard.selectedWordId}
              answerRevealed={true}
              disabled={true}
              onSelectChoice={() => undefined}
            />
            <p className="notes">Incorrect contrast choice. This item was recorded as Forgot.</p>
          </div>
          <div className="session-action-bar">
            <SessionActionSection>
              <button type="button" onClick={onContinueAfterAutoContrastForgot} disabled={personalNotesEditorOpen}>
                Next
                <ShortcutHint shortcut={shortcutFor(primaryAction, 'continue_after_auto_forgot')} />
              </button>
              <UndoButton
                hasUndo={hasUndo}
                submittingRating={submittingRating}
                personalNotesEditorOpen={personalNotesEditorOpen}
                onUndoLastRating={onUndoLastRating}
              />
            </SessionActionSection>
            <SessionActionSection>
              <button type="button" className="secondary-button" onClick={onEndSession} disabled={sessionEndDisabled}>
                {sessionEndLabel}
              </button>
              <KeyboardGuideButton onClick={onOpenShortcutGuide} />
            </SessionActionSection>
          </div>
        </div>
      ) : panelView === 'completed' && sessionSummary ? (
        <div className="review-card session-card-shell">
          <div className="session-card-scroll">
            <SessionSummaryPanel
              summary={sessionSummary}
              finalization={sessionFinalization}
              onRetryReflection={onRetrySessionReflection}
            />
          </div>
          <div className="session-action-bar">
            <SessionActionSection>
              <button
                type="button"
                onClick={onEndSession}
                disabled={sessionFinalization.kind === 'finalizing'}
              >
                {sessionFinalization.kind === 'finalized'
                  ? 'Close summary'
                  : sessionFinalization.kind === 'finalizing'
                    ? 'Finishing...'
                    : 'Finish session'}
              </button>
              <KeyboardGuideButton onClick={onOpenShortcutGuide} />
              <UndoButton
                hasUndo={hasUndo && sessionFinalization.kind === 'unfinalized'}
                submittingRating={submittingRating}
                personalNotesEditorOpen={personalNotesEditorOpen}
                onUndoLastRating={onUndoLastRating}
              />
            </SessionActionSection>
          </div>
        </div>
      ) : panelView === 'unstudied_intro' && activeWord ? (
        <div className="review-card session-card-shell">
          <div className="session-card-scroll">
            <div className="review-card-header">
              <p className="badge">New word introduction</p>
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
            <SessionActionSection>
              <button
                type="button"
                onClick={() => onBeginUnstudiedDrill(activeWord.id)}
                disabled={personalNotesEditorOpen}
              >
                Begin recall drills
                <ShortcutHint shortcut={shortcutFor(primaryAction, 'begin_unstudied_drill')} />
              </button>
              <UndoButton
                hasUndo={hasUndo}
                submittingRating={submittingRating}
                personalNotesEditorOpen={personalNotesEditorOpen}
                onUndoLastRating={onUndoLastRating}
              />
            </SessionActionSection>
            <SessionActionSection>
              <CardActions
                activeItem={null}
                activeWord={activeWord}
                personalNotesEditorSaving={personalNotesEditorSaving}
                studyManagementSubmitting={studyManagementSubmitting}
                onDismissCurrentWord={onDismissCurrentWord}
                onManageStudyAction={onManageStudyAction}
                onOpenPersonalNotesEditor={onOpenPersonalNotesEditor}
              />
            </SessionActionSection>
            <SessionActionSection>
              <button type="button" className="secondary-button" onClick={onEndSession} disabled={sessionEndDisabled}>
                {sessionEndLabel}
              </button>
              <KeyboardGuideButton onClick={onOpenShortcutGuide} />
            </SessionActionSection>
          </div>
        </div>
      ) : panelView === 'empty' ? (
        <div className="review-card session-card-shell">
          <div className="session-card-scroll">
            <p className="notes">No session items remain in the active snapshot.</p>
          </div>
          <div className="session-action-bar">
            <SessionActionSection>
              <UndoButton
                hasUndo={hasUndo}
                submittingRating={submittingRating}
                personalNotesEditorOpen={personalNotesEditorOpen}
                onUndoLastRating={onUndoLastRating}
              />
              <button type="button" onClick={onEndSession}>
                Back to overview
              </button>
              <KeyboardGuideButton onClick={onOpenShortcutGuide} />
            </SessionActionSection>
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
            </div>
            <p className="notes">
              Answered {reviewedCount} this session · {queuedCount} still queued · Unique lapse items{' '}
              {sessionSummary?.lapsedReviewActionIds.length ?? 0} · Elapsed {activeElapsedTime}
            </p>
            <div className="prompt-block">
              <span className="prompt-label">Prompt</span>
              {activeItem.actionKind === 'contrast_selection' ? (
                <>
                  <strong className="contrast-prompt-text">{activePrompt}</strong>
                </>
              ) : activeItem.actionKind === 'recognition' ? (
                <strong className="prompt-value">{activePrompt}</strong>
              ) : activeItem.production ? (
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
                disabled={submittingRating !== null || personalNotesEditorOpen}
                onSelectChoice={onSelectContrastChoice}
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
                {activeItem.production?.supplement ? (
                  <div className="production-supplement">
                    <span className="prompt-label">In context</span>
                    <span className="prompt-meta">
                      {activeItem.production.supplement.englishFrame}
                    </span>
                    <span>{activeItem.production.supplement.exampleSentence}</span>
                    <span className="prompt-meta">
                      {activeItem.production.supplement.exampleTranslation}
                    </span>
                  </div>
                ) : null}
                {activeWordPersonalNotes.trim().length > 0 ? (
                  <span className="prompt-meta">Notes: {activeWordPersonalNotes}</span>
                ) : null}
                <span className="prompt-meta">
                  Interval {formatIntervalHours(activeItem.intervalHours)}
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
            <SessionActionSection>
              {activeItem.actionKind === 'contrast_selection' && !showRatingButtons ? (
                <div className="rating-grid">
                  <p className="prompt-meta session-action-hint">
                    {contrastSelectedWordId
                      ? 'Confirm the selected choice to continue.'
                      : 'Press 1 or 2 to preview a choice, then confirm. Clicking a choice confirms it immediately.'}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      if (contrastSelectedWordId) {
                        onSelectContrastChoice(contrastSelectedWordId);
                      }
                    }}
                    disabled={
                      contrastSelectedWordId === null
                      || submittingRating !== null
                      || personalNotesEditorOpen
                    }
                  >
                    Confirm selection
                    <ShortcutHint shortcut={shortcutFor(primaryAction, 'confirm_contrast')} />
                  </button>
                </div>
              ) : showRatingButtons ? (
                <div className="rating-grid">
                  {activeRatingOptions.map((option) => (
                    <button
                    key={option.value}
                    type="button"
                    className={option.isDefault ? 'rating-button is-default' : 'rating-button'}
                    title={option.note}
                    onClick={() =>
                        onRate(option.value, {
                          restoreUi: productionRequiresHanziInput ? 'production-input' : 'revealed',
                        })
                      }
                      disabled={submittingRating !== null || personalNotesEditorOpen}
                    >
                      <strong>
                        {option.label}
                        <ShortcutHint shortcuts={[option.shortcutKey, option.isDefault ? 'Space' : null]} />
                      </strong>
                      <span>{option.note}</span>
                    </button>
                  ))}
                </div>
              ) : productionRequiresHanziInput && !productionAwaitingRating ? (
                <div className="rating-grid">
                  <button
                    type="submit"
                    form={productionFormId}
                    disabled={submittingRating !== null || personalNotesEditorOpen}
                  >
                    {studyProfile.labels.submitProductionInput}
                    <ShortcutHint shortcut={shortcutFor(primaryAction, 'submit_production')} />
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={onNoClueProduction}
                    disabled={
                      submittingRating !== null
                      || personalNotesEditorOpen
                      || productionHanziInput.trim().length > 0
                    }
                  >
                    No clue
                  </button>
                </div>
              ) : (
                <button type="button" onClick={onRevealAnswer} disabled={personalNotesEditorOpen}>
                  Reveal answer
                  <ShortcutHint shortcut={shortcutFor(primaryAction, 'reveal')} />
                </button>
              )}
              <UndoButton
                hasUndo={hasUndo}
                submittingRating={submittingRating}
                personalNotesEditorOpen={personalNotesEditorOpen}
                onUndoLastRating={onUndoLastRating}
              />
            </SessionActionSection>
            <SessionActionSection>
              {activeItem.actionKind === 'production' && activeWord.status === 'review' ? (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={onToggleLearnerRequestedReview}
                  disabled={personalNotesEditorOpen}
                >
                  {learnerRequestedReview ? 'Remove reflection request' : 'Ask reflection to review'}
                </button>
              ) : null}
              <CardActions
                activeItem={activeItem}
                activeWord={activeWord}
                personalNotesEditorSaving={personalNotesEditorSaving}
                studyManagementSubmitting={studyManagementSubmitting}
                onDismissCurrentWord={onDismissCurrentWord}
                onManageStudyAction={onManageStudyAction}
                onOpenPersonalNotesEditor={onOpenPersonalNotesEditor}
              />
            </SessionActionSection>
            <SessionActionSection>
              <button type="button" className="secondary-button" onClick={onEndSession} disabled={sessionEndDisabled}>
                {sessionEndLabel}
              </button>
              <KeyboardGuideButton onClick={onOpenShortcutGuide} />
            </SessionActionSection>
          </div>
        </div>
        ) : null}
      </div>
      {shortcutGuideOpen ? (
        <KeyboardShortcutsOverlay
          sections={shortcutGuide}
          onClose={onCloseShortcutGuide}
        />
      ) : null}
    </div>
  );
}

function SessionActionSection({ children }: { children: ReactNode }) {
  return <div className="session-action-section">{children}</div>;
}

function KeyboardGuideButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="secondary-button keyboard-guide-button"
      onClick={onClick}
      aria-label="Show keyboard shortcuts"
      title="Show keyboard shortcuts"
    >
      <span aria-hidden="true">⌨</span>
      <span>Shortcuts</span>
      <ShortcutHint shortcut="?" />
    </button>
  );
}

function KeyboardShortcutsOverlay({
  sections,
  onClose,
}: {
  sections: ReturnType<typeof getSessionShortcutGuide>;
  onClose: () => void;
}) {
  const containerRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  useSessionDialogFocus({
    open: true,
    containerRef,
    initialFocusRef: closeButtonRef,
    onClose,
    isolateSessionKeys: true,
    alsoCloseOn: ['?'],
  });

  return (
    <div className="keyboard-shortcuts-backdrop" role="presentation" onClick={onClose}>
      <section
        ref={containerRef}
        className="keyboard-shortcuts-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="keyboard-shortcuts-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="keyboard-shortcuts-heading">
          <h3 id="keyboard-shortcuts-title">Keyboard shortcuts</h3>
          <button
            ref={closeButtonRef}
            type="button"
            className="secondary-button"
            onClick={onClose}
          >
            Close
            <ShortcutHint shortcut="Escape" persist />
          </button>
        </div>
        {sections.map((section) => (
          <section key={section.title} className="keyboard-shortcuts-section">
            <h4 className="keyboard-shortcuts-section-title">{section.title}</h4>
            <dl className="keyboard-shortcuts-list">
              {section.rows.map((row) => (
                <div
                  key={`${section.title}-${row.key}-${row.description}`}
                  className={row.available ? undefined : 'is-unavailable'}
                >
                  <dt>{row.key}</dt>
                  <dd>
                    {row.description}
                    {row.available ? null : ' (unavailable)'}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </section>
    </div>
  );
}

function ContrastSelectionDrill({
  item,
  selectedWordId,
  answerRevealed,
  disabled,
  onSelectChoice,
}: {
  item: SessionStudyItem;
  selectedWordId: string | null;
  answerRevealed: boolean;
  disabled: boolean;
  onSelectChoice: (wordId: string) => void;
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
        {contrastSelection.choices.map((choice, index) => {
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
              aria-pressed={isSelected}
              onClick={() => onSelectChoice(choice.word.id)}
              disabled={disabled || answerRevealed}
            >
              <span className="contrast-choice-index" aria-hidden="true">{index + 1}</span>
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
      aria-label="Undo last rating"
    >
      Undo
      <ShortcutHint shortcut="U" />
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
  onManageStudyAction: () => void;
  onOpenPersonalNotesEditor: () => void;
}) {
  const [manageOpen, setManageOpen] = useState(false);

  return (
    <div className="inline-actions">
      <button
        type="button"
        className="secondary-button"
        onClick={() => setManageOpen((open) => !open)}
        disabled={personalNotesEditorSaving || studyManagementSubmitting}
        aria-expanded={manageOpen}
      >
        <span>Manage Study</span>
        <span className="disclosure-caret" aria-hidden="true" />
      </button>
      {manageOpen ? (
        <ManageStudyPanel
          actionKind={activeItem?.actionKind ?? null}
          status={activeWord.status}
          isSubmitting={studyManagementSubmitting}
          onDismissWord={() => {
            setManageOpen(false);
            onDismissCurrentWord();
          }}
          onManageStudyAction={() => {
            setManageOpen(false);
            onManageStudyAction();
          }}
        />
      ) : null}
      <button
        type="button"
        className="secondary-button"
        onClick={onOpenPersonalNotesEditor}
        disabled={personalNotesEditorSaving}
      >
        Edit notes
        <ShortcutHint shortcut="E" />
      </button>
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
  onManageFrozenProductionAction: () => void;
}) {
  const [manageOpen, setManageOpen] = useState(false);

  return (
    <div className="inline-actions">
      <button
        type="button"
        className="secondary-button"
        onClick={() => setManageOpen((open) => !open)}
        disabled={isSubmitting}
        aria-expanded={manageOpen}
      >
        <span>Manage Study</span>
        <span className="disclosure-caret" aria-hidden="true" />
      </button>
      {manageOpen ? (
        <ManageStudyPanel
          actionKind="production"
          status="review"
          isSubmitting={isSubmitting}
          onDismissWord={() => {
            setManageOpen(false);
            onDismissFrozenProductionWord();
          }}
          onManageStudyAction={() => {
            setManageOpen(false);
            onManageFrozenProductionAction();
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
  onDismissWord,
  onManageStudyAction,
}: {
  actionKind: SessionStudyItem['actionKind'] | null;
  status: Word['status'];
  isSubmitting: boolean;
  onDismissWord: () => void;
  onManageStudyAction: () => void;
}) {
  const productionReview = status === 'review' && actionKind === 'production';

  return (
    <div className="manage-study-popover">
      <div className="manage-study-heading">
        <strong>Manage Study</strong>
      </div>
      <div className="manage-study-actions">
        <button type="button" className="secondary-button" onClick={onDismissWord} disabled={isSubmitting}>
          Dismiss word
        </button>
        {productionReview ? (
          <button
            type="button"
            className="secondary-button"
            onClick={onManageStudyAction}
            disabled={isSubmitting}
          >
            Suppress production
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ShortcutHint({
  shortcut,
  shortcuts,
  persist = false,
}: {
  shortcut?: string | null;
  shortcuts?: Array<string | null | undefined>;
  persist?: boolean;
}) {
  const keys = (shortcuts ?? [shortcut]).filter((key): key is string => Boolean(key));
  if (keys.length === 0) {
    return null;
  }

  if (persist) {
    return <kbd className="session-shortcut-hint is-persistent">{keys[0]}</kbd>;
  }

  return (
    <span className="session-shortcut-hints">
      {keys.map((key) => (
        <kbd key={key} className="session-shortcut-hint">{key}</kbd>
      ))}
    </span>
  );
}

function shortcutFor(
  primaryAction: ReturnType<typeof getSessionPrimaryAction>,
  command: SessionKeyCommand['type'],
) {
  return primaryAction?.command === command ? primaryAction.shortcut : null;
}

function createSessionKeyboardContext({
  sessionStarted,
  productionRequiresHanziInput,
  answerRevealed,
  productionAwaitingNext,
  personalNotesEditorOpen,
  contrastAwaitingNext,
  unstudiedIntro,
  contrastSelectionActive,
  contrastHasSelection,
  ratingAvailable,
  hasUndo,
  hasActiveWord,
  ratingOptions,
}: {
  sessionStarted: boolean;
  productionRequiresHanziInput: boolean;
  answerRevealed: boolean;
  productionAwaitingNext: boolean;
  personalNotesEditorOpen: boolean;
  contrastAwaitingNext: boolean;
  unstudiedIntro: boolean;
  contrastSelectionActive: boolean;
  contrastHasSelection: boolean;
  ratingAvailable: boolean;
  hasUndo: boolean;
  hasActiveWord: boolean;
  ratingOptions: RatingOption[];
}): SessionKeyboardContext {
  return {
    sessionStarted,
    isEditableTarget: false,
    productionInputActive:
      sessionStarted &&
      productionRequiresHanziInput &&
      !answerRevealed &&
      !productionAwaitingNext &&
      !personalNotesEditorOpen,
    productionAwaitingNext,
    contrastAwaitingNext,
    unstudiedIntro,
    productionRequiresHanziInput,
    contrastSelectionActive,
    contrastHasSelection,
    answerRevealed,
    ratingAvailable,
    hasUndo,
    hasActiveWord,
    ratingOptions,
  };
}
