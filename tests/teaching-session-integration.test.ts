import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectSequentialBootstrapReveal } from '../src/domain/word-content/reveal';
import { wordContentFixtures } from './fixtures/word-content.ts';
import { materializeTeachingPackage, resolveContentExerciseResponse } from '../src/domain/word-content/materialize.ts';

const fixture = wordContentFixtures[0]!;
const rehearsal = { ...materializeTeachingPackage(fixture.teaching, [fixture.content]).rehearsals[0]!,
  packageId: fixture.teaching.id, wordContentId: fixture.content.id };

test('frozen target exercise accepts only the target response', () => {
  assert.equal(rehearsal.contract.kind, 'target_rehearsal');
  assert.equal(resolveContentExerciseResponse(rehearsal, '通知').outcome, 'rejected');
  assert.equal(resolveContentExerciseResponse(rehearsal, '報備').outcome, 'accepted');
});

function sequentialContent(useCount: number) {
  return { ...fixture.content, uses: Array.from({ length: useCount }, (_, index) => ({
    ...fixture.content.uses[0]!, id: `use-${index}`, label: `Use ${index + 1}`,
  })) };
}

for (const useCount of [1, 2, 5]) {
  test(`new-word recognition traverses ${useCount} source uses in order`, () => {
    const content = sequentialContent(useCount);
    const seen = Array.from({ length: 3 }, (_, attempts) => selectSequentialBootstrapReveal(content, attempts).useId);
    assert.deepEqual(seen, Array.from({ length: 3 }, (_, index) => `use-${index % useCount}`));
  });
}

test('new-word recognition advances the use by completed attempts, independently of recall success', () => {
  const content = sequentialContent(2);
  assert.deepEqual(Array.from({ length: 5 }, (_, attempts) => selectSequentialBootstrapReveal(content, attempts).useId),
    ['use-0', 'use-1', 'use-0', 'use-1', 'use-0']);
});
