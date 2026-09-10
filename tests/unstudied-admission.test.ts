import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildUnstudiedAdmissionSeedSource,
  planUnstudiedStashAdmission,
  planDeckDietTargets,
  selectAdmittedUnstudiedWordIds,
  selectDeckDietWordIds,
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

  test('uses actual stash selection to calculate diet demand', () => {
    const fullStash = planUnstudiedStashAdmission({
      stash: stashWords(['stash-1', 'stash-2', 'stash-3', 'stash-4', 'stash-5']),
      remainingQuota: 10,
      seedSource: 'full-stash',
    });
    assert.equal(fullStash.selectedStashIds.length, 5);
    assert.equal(fullStash.dietDemand, 5);

    const underfilledStash = planUnstudiedStashAdmission({
      stash: stashWords(['stash-1', 'stash-2']),
      remainingQuota: 10,
      stashRatio: 0.7,
      seedSource: 'underfilled-stash',
    });
    assert.equal(underfilledStash.selectedStashIds.length, 2);
    assert.equal(underfilledStash.dietDemand, 8);
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

describe('stash ratio setting', () => {
  test('a stored ratio shifts the split', () => {
    assert.deepEqual(splitRemainingUnstudiedQuota(10, 0.5), { stashSlots: 5, dietSlots: 5 });
    assert.deepEqual(splitRemainingUnstudiedQuota(10, 0.8), { stashSlots: 8, dietSlots: 2 });
    assert.deepEqual(splitRemainingUnstudiedQuota(10, 0), { stashSlots: 0, dietSlots: 10 });
    assert.deepEqual(splitRemainingUnstudiedQuota(10, 1), { stashSlots: 10, dietSlots: 0 });
    assert.deepEqual(splitRemainingUnstudiedQuota(5, 0.5), { stashSlots: 2, dietSlots: 3 });
  });

  test('rejects out-of-range ratios', () => {
    assert.throws(() => splitRemainingUnstudiedQuota(10, 1.5), /\[0, 1\]/);
    assert.throws(() => splitRemainingUnstudiedQuota(10, Number.NaN), /\[0, 1\]/);
  });

  test('the ratio flows through selection', () => {
    const input = {
      stash: stashWords(['s-1', 's-2', 's-3', 's-4']),
      dietIds: ['d-1', 'd-2', 'd-3', 'd-4'],
      remainingQuota: 4,
      seedSource: buildUnstudiedAdmissionSeedSource('2026-01-10', 4),
      stashRatio: 1,
    };
    // All four slots go to stash (non-top stash order is a seeded sample).
    assert.deepEqual(
      [...selectAdmittedUnstudiedWordIds(input)].sort(),
      ['s-1', 's-2', 's-3', 's-4'],
    );
  });
});

describe('deck-based diet sampling', () => {
  test('planDeckDietTargets splits demand by weight with largest-remainder rounding', () => {
    const targets = planDeckDietTargets(5, { 'deck-a': 0.5, 'deck-b': 0.5 }, ['deck-a', 'deck-b', 'deck-c']);
    assert.equal((targets.get('deck-a') ?? 0) + (targets.get('deck-b') ?? 0), 5);
    assert.equal(targets.has('deck-c'), false);

    const skewed = planDeckDietTargets(10, { 'deck-a': 0.9, 'deck-b': 0.1 }, ['deck-a', 'deck-b']);
    assert.deepEqual(skewed.get('deck-a'), 9);
    assert.deepEqual(skewed.get('deck-b'), 1);
  });

  test('planDeckDietTargets returns no targets without weights and rejects bad demand', () => {
    assert.equal(planDeckDietTargets(5, {}, ['deck-a']).size, 0);
    assert.throws(() => planDeckDietTargets(-1, { 'deck-a': 1 }, ['deck-a']), /non-negative integer/);
  });

  test('selectDeckDietWordIds samples within decks and spills to successors', () => {
    const candidatesByDeck = new Map([
      ['deck-a', ['a-1', 'a-2']],
      ['deck-b', ['b-1', 'b-2']],
      ['deck-c', ['c-1', 'c-2']],
    ]);
    const seedSource = buildUnstudiedAdmissionSeedSource('2026-01-10', 6);

    // Weighted decks under-fill (2+2 available against targets 3+3): spill
    // reaches deck-c for the remaining two.
    const selected = selectDeckDietWordIds({
      targets: new Map([['deck-a', 3], ['deck-b', 3]]),
      spillDeckIds: ['deck-c'],
      seedSource,
      limit: 6,
      loadCandidatesForDeck: (deckId) => candidatesByDeck.get(deckId) ?? [],
    });
    assert.equal(selected.length, 6);
    assert.ok(selected.includes('c-1') && selected.includes('c-2'));
    assert.equal(new Set(selected).size, selected.length);
  });

  test('selectDeckDietWordIds never spills past the limit and is deterministic', () => {
    const candidatesByDeck = new Map([
      ['deck-a', ['a-1', 'a-2', 'a-3']],
      ['deck-b', ['b-1', 'b-2', 'b-3']],
    ]);
    const input = {
      targets: new Map([['deck-a', 2]]),
      spillDeckIds: ['deck-b'],
      seedSource: buildUnstudiedAdmissionSeedSource('2026-01-10', 2),
      limit: 2,
      loadCandidatesForDeck: (deckId: string) => candidatesByDeck.get(deckId) ?? [],
    };
    const first = selectDeckDietWordIds(input);
    const second = selectDeckDietWordIds(input);
    assert.deepEqual(first, second);
    assert.equal(first.length, 2);
    assert.ok(first.every((id) => id.startsWith('a-')));
  });

  test('the deck draw seed extends the admission seed source', () => {
    const candidatesByDeck = new Map([['deck-a', ['a-1', 'a-2', 'a-3', 'a-4']]]);
    const base = {
      targets: new Map([['deck-a', 2]]),
      spillDeckIds: [],
      limit: 2,
      loadCandidatesForDeck: (deckId: string) => candidatesByDeck.get(deckId) ?? [],
    };
    const dayOne = selectDeckDietWordIds({ ...base, seedSource: buildUnstudiedAdmissionSeedSource('2026-01-10', 2) });
    const dayTwo = selectDeckDietWordIds({ ...base, seedSource: buildUnstudiedAdmissionSeedSource('2026-01-11', 2) });
    // Not a guarantee per se, but a seeded redraw across days should differ for this fixture.
    assert.notDeepEqual(dayOne, dayTwo);
  });

  test('loads successor candidates only after active decks underfill', () => {
    const candidatesByDeck = new Map([
      ['deck-a', ['a-1', 'a-2']],
      ['deck-b', ['b-1', 'b-2']],
      ['deck-c', ['c-1', 'c-2']],
    ]);
    const loadCalls: string[] = [];
    const loadCandidatesForDeck = (deckId: string): string[] => {
      loadCalls.push(deckId);
      return candidatesByDeck.get(deckId) ?? [];
    };

    const fullActiveDraw = selectDeckDietWordIds({
      targets: new Map([['deck-a', 2], ['deck-b', 2]]),
      spillDeckIds: ['deck-c'],
      seedSource: 'active-full',
      limit: 4,
      loadCandidatesForDeck,
    });
    assert.equal(fullActiveDraw.length, 4);
    assert.deepEqual(loadCalls, ['deck-a', 'deck-b']);

    loadCalls.length = 0;
    const exhaustedActiveDraw = selectDeckDietWordIds({
      targets: new Map([['deck-a', 3]]),
      spillDeckIds: ['deck-b', 'deck-c'],
      seedSource: 'active-underfill',
      limit: 4,
      loadCandidatesForDeck,
    });
    assert.equal(exhaustedActiveDraw.length, 4);
    assert.deepEqual(loadCalls, ['deck-a', 'deck-b']);
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
