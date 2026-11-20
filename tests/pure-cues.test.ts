import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  dueAtWithResetDelay,
  schedulePureCueAssessment,
  selectPureCuesForSession,
  type PureCue,
} from '../src/domain/pure-cues.ts';

const now = '2026-09-18T00:00:00.000Z';

function cue(overrides: Partial<PureCue> = {}): PureCue {
  return {
    kind: 'pure',
    id: 'cue-a',
    stimulus: 'to tell an untruth',
    axisNote: 'ordinary speech',
    teachingNote: '',
    acceptedWordIds: ['word-a', 'word-b'],
    intervalHours: 24,
    easeFactor: 2.5,
    lastStudiedAt: null,
    nextDueAt: now,
    strongSince: null,
    strongSuccesses: 0,
    active: true,
    ...overrides,
  };
}

describe('pure cue domain policy', () => {
  test('uses fragile SRS to enter strong maintenance and returns to fragile SRS after a lapse', () => {
    const crossed = schedulePureCueAssessment(
      cue({ intervalHours: 300 }),
      { failureCount: 0, terminalRating: 'good' },
      now,
      () => 0.5,
    );
    assert.equal(crossed.intervalHours, 750);
    assert.equal(crossed.strongSince, now);
    assert.equal(crossed.strongSuccesses, 0);

    const assessedAt = '2026-09-19T00:00:00.000Z';
    const expectedStrong = { ...crossed, lastStudiedAt: assessedAt, strongSuccesses: 1 };
    for (const terminalRating of ['hard', 'good', 'easy'] as const) {
      assert.deepEqual(schedulePureCueAssessment(crossed, { failureCount: 0, terminalRating }, assessedAt,
        () => { throw new Error('Strong success must not consume interval-fuzz randomness'); }), expectedStrong);
    }

    const lapsed = schedulePureCueAssessment(
      expectedStrong,
      { failureCount: 2, terminalRating: null },
      '2026-09-20T00:00:00.000Z',
    );
    assert.equal(lapsed.intervalHours, 6);
    assert.equal(lapsed.easeFactor, 2.2);
    assert.equal(lapsed.nextDueAt, '2026-09-20T06:00:00.000Z');
    assert.equal(lapsed.strongSince, null);
    assert.equal(lapsed.strongSuccesses, 0);

    assert.equal(dueAtWithResetDelay(now), '2026-09-18T06:00:00.000Z');
    assert.equal(dueAtWithResetDelay(now, '2026-09-18T03:00:00.000Z'), '2026-09-18T06:00:00.000Z');
    assert.equal(dueAtWithResetDelay(now, '2026-09-19T00:00:00.000Z'), '2026-09-19T00:00:00.000Z');

    const reentered = schedulePureCueAssessment(
      lapsed,
      { failureCount: 0, terminalRating: 'easy' },
      '2026-09-21T00:00:00.000Z',
      () => 0.5,
    );
    assert.equal(reentered.intervalHours, 16, 'fragile recovery resumes ordinary rating growth');
    assert.equal(reentered.strongSince, null);
    assert.equal(reentered.strongSuccesses, 0);
  });

  const learnerId = 'maintenance-learner';
  const strongPool = Array.from({ length: 5_000 }, (_, index) => cue({
    id: `maintenance-${index}`, intervalHours: 720,
    strongSince: '2026-08-01T00:00:00.000Z',
    lastStudiedAt: '2026-09-10T00:00:00.000Z',
    nextDueAt: '2027-01-01T00:00:00.000Z',
  }));
  function selectStrong(cues: readonly PureCue[], overrides: Partial<Parameters<typeof selectPureCuesForSession<PureCue>>[0]> = {}) {
    return selectPureCuesForSession<PureCue>({
      learnerId, cues, ordinaryReviewCount: strongPool.length * 10, now, random: () => 0, ...overrides,
    }).strong;
  }
  const passingStrong = selectStrong(strongPool);
  const passingIds = new Set(passingStrong.map(item => item.id));

  test('admits due fragile cues independently and lets strong maintenance underfill its ceiling', () => {
    assert.ok(passingStrong.length >= 30 && passingStrong.length <= 90,
      'new strong cues have roughly a 1-in-90 daily chance across 5,000 independent cues');
    const failed = strongPool.find(item => !passingIds.has(item.id))!;
    assert.equal(selectStrong([failed]).length, 0, 'a large ceiling creates no entitlement');
    const selection = selectPureCuesForSession<PureCue>({
      learnerId,
      cues: [
        cue({ id: 'fragile-due' }),
        cue({ id: 'fragile-later', nextDueAt: '2026-09-19T00:00:00.000Z' }),
        cue({ id: 'fragile-inactive', active: false }),
        passingStrong[0]!, failed,
      ],
      ordinaryReviewCount: 99, now, random: () => 0,
    });
    assert.deepEqual(selection.fragile.map(item => item.id), ['fragile-due']);
    assert.deepEqual(selection.strong.map(item => item.id), [passingStrong[0]!.id]);
    assert.equal(selection.strong[0]!.nextDueAt, '2027-01-01T00:00:00.000Z', 'strong due dates do not gate maintenance');
  });

  test('daily qualification cannot be rerolled by preparing sessions, pool changes, or review capacity', () => {
    const expected = [...passingIds].sort();
    for (const random of [() => 0, () => 0.5, () => 0.999999]) {
      const selected = selectStrong([...strongPool].reverse(), {
        now: '2026-09-18T23:59:59.999Z', ordinaryReviewCount: 100_000, random,
      });
      assert.deepEqual(selected.map(item => item.id).sort(), expected);
    }
    const failed = strongPool.find(item => !passingIds.has(item.id))!;
    assert.deepEqual(selectStrong([failed], { ordinaryReviewCount: 100_000, random: () => 0 }).map(item => item.id), []);
    assert.deepEqual(selectStrong([passingStrong[0]!, failed]).map(item => item.id), [passingStrong[0]!.id]);
    assert.notDeepEqual(selectStrong(strongPool, { learnerId: 'another-learner' }).map(item => item.id).sort(), expected);
    assert.notDeepEqual(selectStrong(strongPool, { now: '2026-09-19T00:00:00.000Z' }).map(item => item.id).sort(), expected);
    assert.throws(() => selectStrong([], { learnerId: ' ' }), /learner id/);
  });

  test('success count alone quiets maintenance without rerolling daily qualification', () => {
    for (const strongSuccesses of [1, 9]) {
      const selected = selectStrong(strongPool.map(item => ({ ...item, strongSuccesses })));
      assert.ok(selected.length < passingStrong.length, 'a quieter state removes some qualifying cues');
      assert.ok(selected.every(item => passingIds.has(item.id)), 'a quieter state cannot introduce qualifying cues');
      if (strongSuccesses === 1) {
        assert.ok(selected.length >= 12 && selected.length <= 45,
          'one success gives roughly a 1-in-180 daily chance across 5,000 independent cues');
      }
    }
  });

  test('dormant interval, ease, and due date do not influence strong qualification or ceiling selection', () => {
    const changeLegacyFields = (item: PureCue, index: number): PureCue => ({
      ...item, intervalHours: index % 2 ? 720 : 720_000, easeFactor: index % 2 ? 1.8 : 9,
      nextDueAt: index % 2 ? '2027-01-01T00:00:00.000Z' : '2020-01-01T00:00:00.000Z',
    });
    assert.deepEqual(selectStrong(strongPool.map(changeLegacyFields)).map(item => item.id).sort(), [...passingIds].sort());
    const candidates = passingStrong.slice(0, 4);
    const options = { ordinaryReviewCount: 20, random: () => 0.5 };
    assert.deepEqual(selectStrong(candidates.map(changeLegacyFields), options).map(item => item.id),
      selectStrong(candidates, options).map(item => item.id));
  });

  test('strong assessments and tier entry have a seven-day quiet period', () => {
    const eligible = passingStrong[0]!;
    for (const recent of [
      { lastStudiedAt: '2026-09-17T00:00:00.000Z' },
      { lastStudiedAt: '2026-09-11T00:00:00.001Z' },
      { lastStudiedAt: null, strongSince: '2026-09-11T00:00:00.001Z' },
    ]) {
      assert.deepEqual(selectStrong([{ ...eligible, ...recent }]), []);
    }
    for (const boundary of [
      { lastStudiedAt: '2026-09-11T00:00:00.000Z' },
      { lastStudiedAt: null, strongSince: '2026-09-11T00:00:00.000Z' },
    ]) {
      assert.deepEqual(selectStrong([{ ...eligible, ...boundary }]).map(item => item.id), [eligible.id]);
    }
    assert.deepEqual(selectStrong([{ ...eligible, active: false }]), []);
  });

  test('rounds only the outer ceiling probabilistically and samples qualifying cues uniformly without replacement', () => {
    const strong = passingStrong.slice(0, 4);
    for (const [count, roll, expected] of [[0, 0, 0], [6, 0.59, 1], [6, 0.6, 0], [25, 0.49, 3], [25, 0.5, 2]]) {
      const selected = selectStrong(strong, { ordinaryReviewCount: count!, random: () => roll! });
      assert.equal(selected.length, expected);
      assert.equal(new Set(selected.map(item => item.id)).size, selected.length);
    }
    const stillPassing = selectStrong(strongPool.map(item => ({ ...item, strongSuccesses: 9 })));
    assert.ok(stillPassing.length >= 2, 'fixture pool supplies cues qualifying even after nine successes');
    const [first, second] = stillPassing.sort((a, b) => a.id.localeCompare(b.id));
    const mixedSuccesses = [first!, { ...second!, strongSuccesses: 0 }];
    assert.equal(selectStrong(mixedSuccesses, { ordinaryReviewCount: 10, random: () => 0.25 })[0]!.id, first!.id,
      'success affects qualification, not a second relative weight at the ceiling');
    assert.equal(selectStrong(mixedSuccesses, { ordinaryReviewCount: 10, random: () => 0.75 })[0]!.id, second!.id);
  });

  test('reentry resets strong success count', () => {
    const reentered = schedulePureCueAssessment(cue({ intervalHours: 300, strongSuccesses: 9 }),
      { failureCount: 0, terminalRating: 'good' }, now, () => 0.5);
    assert.equal(reentered.strongSince, now);
    assert.equal(reentered.strongSuccesses, 0);
  });

});
