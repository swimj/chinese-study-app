import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildUnstudiedAdmissionSeedSource,
  selectAdmittedUnstudiedWordIds,
  splitRemainingUnstudiedQuota,
  type UnstudiedStashCandidate,
} from '../server/db/unstudied-admission.ts';

describe('experimental dual-pool unstudied admission', () => {
  test('splits remaining quota 50/50 and gives the odd leftover to diet', () => {
    assert.deepEqual(splitRemainingUnstudiedQuota(0), { stashSlots: 0, dietSlots: 0 });
    assert.deepEqual(splitRemainingUnstudiedQuota(1), { stashSlots: 0, dietSlots: 1 });
    assert.deepEqual(splitRemainingUnstudiedQuota(2), { stashSlots: 1, dietSlots: 1 });
    assert.deepEqual(splitRemainingUnstudiedQuota(5), { stashSlots: 2, dietSlots: 3 });
    assert.deepEqual(splitRemainingUnstudiedQuota(10), { stashSlots: 5, dietSlots: 5 });
  });

  test('rejects a non-integer remaining quota', () => {
    assert.throws(() => splitRemainingUnstudiedQuota(-1), /non-negative integer/);
    assert.throws(() => splitRemainingUnstudiedQuota(1.5), /non-negative integer/);
  });

  test('admits 50/50 from remaining quota', () => {
    const admitted = selectAdmittedUnstudiedWordIds({
      stash: stashWords(['freq-100', 'freq-90', 'freq-80', 'freq-70', 'freq-60', 'freq-50', 'freq-40', 'freq-30', 'freq-20', 'freq-10']),
      dietIds: ['diet-50', 'diet-49', 'diet-48', 'diet-47', 'diet-46', 'diet-45', 'diet-44', 'diet-43', 'diet-42', 'diet-41'],
      remainingQuota: 10,
      seedSource: buildUnstudiedAdmissionSeedSource('2026-01-10', 10),
    });

    assert.deepEqual(admitted, [
      'freq-60',
      'freq-40',
      'freq-70',
      'freq-80',
      'freq-10',
      'diet-50',
      'diet-49',
      'diet-48',
      'diet-47',
      'diet-46',
    ]);
  });

  test('odd remaining gives the extra slot to diet', () => {
    const admitted = selectAdmittedUnstudiedWordIds({
      stash: stashWords(['stash-a', 'stash-b', 'stash-c']),
      dietIds: ['diet-1', 'diet-2', 'diet-3', 'diet-4'],
      remainingQuota: 5,
      seedSource: 'odd-remaining',
    });

    const stashIds = new Set(['stash-a', 'stash-b', 'stash-c']);
    const selectedStash = admitted.filter((id) => stashIds.has(id));
    const selectedDiet = admitted.filter((id) => !stashIds.has(id));

    assert.equal(selectedStash.length, 2);
    assert.deepEqual(selectedDiet, ['diet-1', 'diet-2', 'diet-3']);
  });

  test('fills leftover stash slots from diet in frequency order', () => {
    const admitted = selectAdmittedUnstudiedWordIds({
      stash: stashWords(['stash-only']),
      dietIds: ['diet-1', 'diet-2', 'diet-3', 'diet-4', 'diet-5'],
      remainingQuota: 4,
      seedSource: 'stash-short',
    });

    assert.deepEqual(admitted, ['stash-only', 'diet-1', 'diet-2', 'diet-3']);
  });

  test('diet remains frequency-ranked when stash is empty', () => {
    const admitted = selectAdmittedUnstudiedWordIds({
      stash: [],
      dietIds: ['diet-1', 'diet-2', 'diet-3', 'diet-4', 'diet-5'],
      remainingQuota: 4,
      seedSource: 'diet-only',
    });

    assert.deepEqual(admitted, ['diet-1', 'diet-2', 'diet-3', 'diet-4']);
  });

  test('tops fill the stash half newest-first and extra tops wait', () => {
    const admitted = selectAdmittedUnstudiedWordIds({
      stash: [
        topWord('top-old', '2026-01-01T00:00:00.000Z'),
        topWord('top-mid', '2026-01-02T00:00:00.000Z'),
        topWord('top-new', '2026-01-03T00:00:00.000Z'),
      ],
      dietIds: ['diet-1', 'diet-2', 'diet-3'],
      remainingQuota: 4,
      seedSource: 'tops-capped',
    });

    assert.deepEqual(admitted, ['top-new', 'top-mid', 'diet-1', 'diet-2']);
    assert.equal(admitted.includes('top-old'), false);
  });

  test('random stash is not ordered by hardcoded priority', () => {
    const admitted = selectAdmittedUnstudiedWordIds({
      stash: stashWords(['stash-high', 'stash-low', 'stash-mid']),
      dietIds: ['diet-a'],
      remainingQuota: 2,
      seedSource: 'a',
    });

    assert.deepEqual(admitted, ['stash-low', 'diet-a']);
  });

  test('overlay bump does not beat a higher-frequency diet word across pools', () => {
    const admitted = selectAdmittedUnstudiedWordIds({
      stash: stashWords(['bumped-low', 'bumped-lower']),
      dietIds: ['diet-high', 'diet-mid'],
      remainingQuota: 2,
      seedSource: 'cross-pool-bump',
    });

    const selectedStash = admitted.filter((id) => id.startsWith('bumped-'));
    assert.equal(selectedStash.length, 1);
    assert.equal(admitted.includes('diet-high'), true);
    assert.equal(admitted.includes('diet-mid'), false);
    assert.equal(admitted.length, 2);
  });

  test('require bypasses the split without double-counting words already selected', () => {
    const overflow = selectAdmittedUnstudiedWordIds({
      stash: [
        topWord('top-fills-stash', '2026-01-03T00:00:00.000Z'),
        {
          id: 'required-extra',
          overlayUpdatedAt: '2026-01-01T00:00:00.000Z',
          isTop: false,
          isRequired: true,
        },
      ],
      dietIds: ['diet-1', 'diet-2'],
      remainingQuota: 2,
      seedSource: 'require-overflow',
    });

    assert.deepEqual(overflow, ['top-fills-stash', 'diet-1', 'required-extra']);

    const alreadySelected = selectAdmittedUnstudiedWordIds({
      stash: [{
        id: 'required-top',
        overlayUpdatedAt: '2026-01-03T00:00:00.000Z',
        isTop: true,
        isRequired: true,
      }],
      dietIds: ['diet-1', 'diet-2'],
      remainingQuota: 2,
      seedSource: 'require-no-dupe',
    });

    assert.deepEqual(alreadySelected, ['required-top', 'diet-1']);
    assert.equal(alreadySelected.filter((id) => id === 'required-top').length, 1);
  });

  test('remaining 0 admits nobody except require bypass', () => {
    const withoutRequire = selectAdmittedUnstudiedWordIds({
      stash: [topWord('top-waiting', '2026-01-03T00:00:00.000Z'), ...stashWords(['stash-waiting'])],
      dietIds: ['diet-1'],
      remainingQuota: 0,
      seedSource: 'empty-remaining',
    });
    assert.deepEqual(withoutRequire, []);

    const withRequire = selectAdmittedUnstudiedWordIds({
      stash: [{
        id: 'required-only',
        overlayUpdatedAt: '2026-01-01T00:00:00.000Z',
        isTop: false,
        isRequired: true,
      }],
      dietIds: ['diet-1'],
      remainingQuota: 0,
      seedSource: 'empty-remaining-require',
    });
    assert.deepEqual(withRequire, ['required-only']);
  });

  test('the same composition seed does not re-roll the stash lottery', () => {
    const input = {
      stash: stashWords(['stash-a', 'stash-b', 'stash-c', 'stash-d']),
      dietIds: ['diet-1', 'diet-2'],
      remainingQuota: 4,
      seedSource: buildUnstudiedAdmissionSeedSource('2026-01-10', 4),
    };

    assert.deepEqual(selectAdmittedUnstudiedWordIds(input), selectAdmittedUnstudiedWordIds(input));
  });
});

function stashWords(ids: string[]): UnstudiedStashCandidate[] {
  return ids.map((id) => ({
    id,
    overlayUpdatedAt: '2026-01-01T00:00:00.000Z',
    isTop: false,
    isRequired: false,
  }));
}

function topWord(id: string, overlayUpdatedAt: string): UnstudiedStashCandidate {
  return {
    id,
    overlayUpdatedAt,
    isTop: true,
    isRequired: false,
  };
}
