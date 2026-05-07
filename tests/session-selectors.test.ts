import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { getPersonalNotesEditorTarget } from '../src/features/session/session-selectors.ts';
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
