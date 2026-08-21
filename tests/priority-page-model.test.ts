import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { sortStashManageWords } from '../src/features/priority/priority-page-model.ts';
import type { PriorityWord, Word } from '../src/types.ts';

describe('stash manage-list sort', () => {
  test('orders tops newest-first, then other stash by overlay updated_at', () => {
    const ordered = sortStashManageWords([
      stashWord('older-bump', false, '2026-01-01T00:00:00.000Z'),
      stashWord('newer-bump', false, '2026-01-04T00:00:00.000Z'),
      stashWord('older-top', true, '2026-01-02T00:00:00.000Z'),
      stashWord('newer-top', true, '2026-01-03T00:00:00.000Z'),
    ]).map((entry) => entry.word.id);

    assert.deepEqual(ordered, ['newer-top', 'older-top', 'newer-bump', 'older-bump']);
  });
});

function stashWord(id: string, forceTop: boolean, overlayUpdatedAt: string): PriorityWord {
  const word: Word = {
    id,
    hanzi: id,
    traditional: null,
    pinyin: id,
    meaning: id,
    meanings: [id],
    personalNotes: '',
    examples: [],
    status: 'unstudied',
    priority: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    learningStreak: 0,
    lastLearningSuccessOn: null,
    lastLearningCoveredOn: null,
  };

  return {
    word,
    bumpCount: forceTop ? 0 : 3,
    forceTop,
    requiredForNextSession: false,
    effectivePriority: 1,
    effectiveRank: 1,
    overlayUpdatedAt,
  };
}
