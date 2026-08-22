import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  applyPriorityPatch,
  nextChipSelection,
  partitionPriorityBank,
  sortStashManageWords,
} from '../src/features/priority/priority-page-model.ts';
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

  test('partitions force-top chips from stash', () => {
    const partitioned = partitionPriorityBank([
      stashWord('stash-word', false, '2026-01-04T00:00:00.000Z'),
      stashWord('older-top', true, '2026-01-02T00:00:00.000Z'),
      stashWord('newer-top', true, '2026-01-03T00:00:00.000Z'),
    ]);

    assert.deepEqual(partitioned.top.map((entry) => entry.word.id), ['newer-top', 'older-top']);
    assert.deepEqual(partitioned.stash.map((entry) => entry.word.id), ['stash-word']);
  });

  test('demoting a top word to stash keeps overlay membership', () => {
    const updated = applyPriorityPatch(
      stashWord('top-word', true, '2026-01-01T00:00:00.000Z'),
      { forceTop: false, bumpDelta: 1 },
      '2026-01-05T00:00:00.000Z',
    );

    assert.equal(updated.forceTop, false);
    assert.equal(updated.bumpCount, 1);
    assert.equal(updated.overlayUpdatedAt, '2026-01-05T00:00:00.000Z');
  });
});

describe('priority chip selection', () => {
  const orderedIds = ['a', 'b', 'c', 'd'];

  test('replace selects only the target', () => {
    const next = nextChipSelection({
      selectedIds: ['a', 'c'],
      orderedIds,
      targetId: 'b',
      mode: 'replace',
      rangeAnchorId: 'a',
    });

    assert.deepEqual(next, { selectedIds: ['b'], rangeAnchorId: 'b' });
  });

  test('toggle adds and removes without dropping other selections', () => {
    const added = nextChipSelection({
      selectedIds: ['a'],
      orderedIds,
      targetId: 'c',
      mode: 'toggle',
      rangeAnchorId: 'a',
    });
    const removed = nextChipSelection({
      selectedIds: added.selectedIds,
      orderedIds,
      targetId: 'a',
      mode: 'toggle',
      rangeAnchorId: added.rangeAnchorId,
    });

    assert.deepEqual(added.selectedIds, ['a', 'c']);
    assert.deepEqual(removed.selectedIds, ['c']);
  });

  test('range fills inclusive ids from the anchor', () => {
    const next = nextChipSelection({
      selectedIds: ['a'],
      orderedIds,
      targetId: 'c',
      mode: 'range',
      rangeAnchorId: 'a',
    });

    assert.deepEqual(next.selectedIds, ['a', 'b', 'c']);
    assert.equal(next.rangeAnchorId, 'a');
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
    overlayUpdatedAt,
  };
}
