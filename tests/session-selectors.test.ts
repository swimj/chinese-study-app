import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  getPersonalNotesEditorTarget,
  getActivePrompt,
  getStudySessionPanelView,
} from '../src/features/session/session-selectors.ts';
import type { Word } from '../src/types.ts';

describe('session selectors', () => {
  test('targets the frozen production card for notes while awaiting next after a wrong answer', () => {
    const target = getPersonalNotesEditorTarget({
      word: createWord({ id: 'next-card', personalNotes: 'next card notes' }),
      activeWordPersonalNotes: 'next card notes',
      frozenProductionCard: {
        targetWordId: 'mistaken-card',
        personalNotes: 'mistaken card notes',
      },
      productionAwaitingNext: true,
      overridesByWordId: {},
    });

    assert.deepEqual(target, {
      wordId: 'mistaken-card',
      personalNotes: 'mistaken card notes',
    });
  });

  test('uses the latest session override for the frozen production card notes target', () => {
    const target = getPersonalNotesEditorTarget({
      word: createWord({ id: 'next-card', personalNotes: 'next card notes' }),
      activeWordPersonalNotes: 'next card notes',
      frozenProductionCard: {
        targetWordId: 'mistaken-card',
        personalNotes: 'old mistaken card notes',
      },
      productionAwaitingNext: true,
      overridesByWordId: {
        'mistaken-card': 'updated mistaken card notes',
      },
    });

    assert.deepEqual(target, {
      wordId: 'mistaken-card',
      personalNotes: 'updated mistaken card notes',
    });
  });

  test('targets the active word outside the frozen production card view', () => {
    const target = getPersonalNotesEditorTarget({
      word: createWord({ id: 'active-card', personalNotes: 'stored active notes' }),
      activeWordPersonalNotes: 'active notes override',
      frozenProductionCard: null,
      productionAwaitingNext: false,
      overridesByWordId: {},
    });

    assert.deepEqual(target, {
      wordId: 'active-card',
      personalNotes: 'active notes override',
    });
  });

  test('keeps frozen production card visible before the next new-word intro', () => {
    assert.equal(
      getStudySessionPanelView({
        sessionStarted: true,
        sessionCompletedWithSummary: false,
        productionAwaitingNext: true,
        frozenProductionCardPresent: true,
        activeItemPresent: false,
        activeWordStatus: 'unstudied',
        activeUnstudiedIntroComplete: false,
      }),
      'frozen_production',
    );
  });

  test('keeps frozen production card visible before completed session summary', () => {
    assert.equal(
      getStudySessionPanelView({
        sessionStarted: true,
        sessionCompletedWithSummary: true,
        productionAwaitingNext: true,
        frozenProductionCardPresent: true,
        activeItemPresent: false,
        activeWordStatus: null,
        activeUnstudiedIntroComplete: false,
      }),
      'frozen_production',
    );
  });

  test('shows normal new-word intro when no frozen production card is pending', () => {
    assert.equal(
      getStudySessionPanelView({
        sessionStarted: true,
        sessionCompletedWithSummary: false,
        productionAwaitingNext: false,
        frozenProductionCardPresent: false,
        activeItemPresent: false,
        activeWordStatus: 'unstudied',
        activeUnstudiedIntroComplete: false,
      }),
      'unstudied_intro',
    );
  });

  test('uses the frozen production cue instead of live word meanings', () => {
    const word = createWord({ id: 'cue-word', personalNotes: '' });
    assert.equal(getActivePrompt({
      item: {
        sessionActionId: 'review/cue-word/production',
        actionKind: 'production',
        targetWordId: word.id,
        sampledSkillIds: ['production'],
        contentRef: {
          type: 'production_cue',
          taskId: 'production-task:cue-word:default_production',
          cueId: 'cue-1',
        },
        intervalHours: 24,
        word,
        contrastSelection: null,
        production: {
          taskId: 'production-task:cue-word:default_production',
          cueId: 'cue-1',
          cueType: 'minimal_context',
          text: 'The exact served cue',
          acceptedWordIds: ['cue-word'],
          recheckDemandId: null,
        },
      },
      word,
      promptDisplayedMeanings: ['live changed meaning'],
      allMeanings: ['live changed meaning'],
    }), 'The exact served cue');
  });
});

function createWord(overrides: Pick<Word, 'id' | 'personalNotes'>): Word {
  return {
    id: overrides.id,
    hanzi: '字',
    traditional: null,
    pinyin: 'zi4',
    meaning: 'character',
    meanings: ['character'],
    personalNotes: overrides.personalNotes,
    examples: ['一个字。'],
    status: 'review',
    priority: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    learningStreak: 0,
    lastLearningSuccessOn: null,
    lastLearningCoveredOn: null,
  };
}
