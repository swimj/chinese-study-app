import assert from 'node:assert/strict';
import { createElement, createRef, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { test } from 'node:test';
import { StudySessionPanel } from '../src/features/session/StudySessionPanel.tsx';
import type { PureCueSessionReviewItem } from '../src/domain/study-actions.ts';

const cue: PureCueSessionReviewItem = {
  itemType: 'pure_cue_production', sessionActionId: 'pure-action', tier: 'fragile',
  snapshot: {
    snapshotId: 'served', pureCueId: 'pure', servedAt: '2026-09-26T00:00:00.000Z',
    stimulus: 'Describe unusual behavior', axisNote: 'Semantic classification for membership',
    teachingNote: 'Frozen teaching about the accepted words',
    acceptedAnswers: [{ wordId: 'word', hanzi: '古怪', traditional: null }],
  },
};

function props(): ComponentProps<typeof StudySessionPanel> {
  const noop = () => {};
  return {
    sessionStarted: true, sessionPhase: 'active', sessionSummary: null,
    sessionFinalization: { kind: 'unfinalized' }, activeItem: null, activePureCue: cue,
    activeWord: null, activeLearningProgress: undefined, activeUnstudiedProgress: undefined,
    activeReviewProgress: undefined, activePureCueFailureCount: 0, reviewedCount: 0, queuedCount: 1,
    hasUndo: false, submittingRating: null, personalNotesEditorOpen: false, personalNotesEditorSaving: false,
    studyManagementSubmitting: false, productionAwaitingNext: false, pureCueAwaitingNext: false,
    productionAwaitingSupplement: false, frozenProductionCard: null, frozenPureCueCard: null,
    contrastAwaitingNext: false, frozenContrastCard: null, activeAllMeanings: [], activeWordPersonalNotes: '',
    reviewInReinforcement: false, activeElapsedTime: '0:01', activePrompt: null,
    activePromptDisplayedMeanings: [], activeReviewState: 'Review', answerRevealed: false,
    activeAnswerPinyin: null, activeAnswerText: null, activeMeaningRows: [], meaningVisibilitySavingKey: null,
    isProductionItem: true, productionAwaitingRating: false, productionHanziInput: '', productionHanziError: null,
    productionHanziInputRef: createRef<HTMLInputElement>(), contrastSelectedWordId: null,
    contrastAwaitingRating: false, activeRatingOptions: [], learnerRequestedReview: false,
    frozenProductionLearnerRequestedReview: false, shortcutGuideOpen: false,
    onUndoLastRating: noop, onEndSession: noop, onRetrySessionReflection: noop,
    onContinueAfterAutoForgot: noop, onContinueAfterProductionSupplement: noop,
    onContinueAfterAutoContrastForgot: noop, onDismissCurrentWord: noop, onManageStudyAction: noop,
    onDismissFrozenProductionWord: noop, onManageFrozenProductionAction: noop, onOpenPersonalNotesEditor: noop,
    onBeginUnstudiedDrill: noop, onToggleMeaningVisibility: noop, onSubmitProductionHanzi: noop,
    onNoClueProduction: noop, onProductionHanziInputChange: noop, onSelectContrastChoice: noop,
    onRevealAnswer: noop, onToggleLearnerRequestedReview: noop, onToggleFrozenProductionLearnerRequestedReview: noop,
    onRate: noop, onOpenShortcutGuide: noop, onCloseShortcutGuide: noop,
  };
}

function render(overrides: Partial<ComponentProps<typeof StudySessionPanel>> = {}) {
  return renderToStaticMarkup(createElement(StudySessionPanel, { ...props(), ...overrides }));
}

test('pure-cue teaching stays hidden until reveal; semantic axis never becomes teaching', () => {
  const hidden = render();
  assert.match(hidden, /Describe unusual behavior/);
  assert.doesNotMatch(hidden, /Frozen teaching|Semantic classification|古怪/);
  const revealed = render({ answerRevealed: true });
  assert.match(revealed, /Frozen teaching about the accepted words/);
  assert.match(revealed, /古怪/);
  assert.doesNotMatch(revealed, /Semantic classification/);
  const noTeaching = render({ answerRevealed: true,
    activePureCue: { ...cue, snapshot: { ...cue.snapshot, teachingNote: '' } },
  });
  assert.doesNotMatch(noTeaching, /Frozen teaching|Semantic classification/);
});

test('auto-forgot reveal uses the frozen teaching snapshot even when another cue is active', () => {
  const markup = render({ pureCueAwaitingNext: true,
    frozenPureCueCard: { item: cue, attemptedResponse: '错', reviewedCount: 1, queuedCount: 1 },
    activePureCue: { ...cue, snapshot: { ...cue.snapshot, teachingNote: 'Newer active teaching' } },
  });
  assert.match(markup, /Frozen teaching about the accepted words/);
  assert.match(markup, /古怪/);
  assert.doesNotMatch(markup, /Newer active teaching|Semantic classification/);
});
