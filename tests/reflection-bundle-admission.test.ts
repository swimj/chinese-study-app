import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { selectNonOverlappingReflectionItems } from '../server/reflection/bundle-admission.ts';

type Item = {
  id: string;
  targetWord: { wordId: string };
  submittedWord: { wordId: string } | null;
};

function item(id: string, targetWordId: string, submittedWordId: string | null): Item {
  return {
    id,
    targetWord: { wordId: targetWordId },
    submittedWord: submittedWordId === null ? null : { wordId: submittedWordId },
  };
}

describe('reflection bundle overlap admission', () => {
  test('keeps the first orientation of a pair and omits its reverse', () => {
    const selected = selectNonOverlappingReflectionItems([
      item('A-to-B', 'A', 'B'),
      item('B-to-A', 'B', 'A'),
    ]);

    assert.deepEqual(selected.items.map((entry) => entry.id), ['A-to-B']);
    assert.equal(selected.overlapOmittedItemCount, 1);
  });

  test('omits repeated targets, treats no-response items as one-word reservations, and retains disjoint items', () => {
    const selected = selectNonOverlappingReflectionItems([
      item('A-to-B', 'A', 'B'),
      item('A-to-C', 'A', 'C'),
      item('D-no-response', 'D', null),
      item('E-to-D', 'E', 'D'),
      item('F-to-G', 'F', 'G'),
    ]);

    assert.deepEqual(selected.items.map((entry) => entry.id), [
      'A-to-B',
      'D-no-response',
      'F-to-G',
    ]);
    assert.equal(selected.overlapOmittedItemCount, 2);
  });

  test('preserves supplied order for every admitted item', () => {
    const selected = selectNonOverlappingReflectionItems([
      item('third-supplied', 'E', 'F'),
      item('first-supplied', 'A', 'B'),
      item('second-supplied', 'C', 'D'),
    ]);

    assert.deepEqual(selected.items.map((entry) => entry.id), [
      'third-supplied',
      'first-supplied',
      'second-supplied',
    ]);
    assert.equal(selected.overlapOmittedItemCount, 0);
  });
});
