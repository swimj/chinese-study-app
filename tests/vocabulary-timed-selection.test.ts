import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chooseTimedTarget, timedRestCards, type TimedCandidate } from '../server/vocabulary/timed-selection.ts';
import { PRESSING_TIER_SHARE, TIMED_REST_MAX_CARDS, TIMED_REST_MIN_CARDS } from '../src/domain/timed-session.ts';

const candidate = (id: string, patch: Partial<TimedCandidate> = {}): TimedCandidate => ({
  target: { kind: 'word', id }, pressing: false, lastPosition: -1, lastEncounterId: null, order: 0, ...patch,
});
/** Fixed draws: `tier` below the share tries pressing; `index` picks the first candidate. */
const sampler = (tier: number, index = 0) => (length: number, salt: string) => salt === 'tier' ? tier % length : index % length;
const choose = (candidates: TimedCandidate[], encounterCount: number, sample = sampler(0)) =>
  chooseTimedTarget({ sessionId: 's', candidates, encounterCount, sample }).id;

test('rest is a seeded 2-5 card gap that varies across appearances', () => {
  const values = new Set<number>();
  for (let index = 0; index < 200; index++) {
    const rest = timedRestCards('session', 'word:a', `encounter-${index}`);
    assert.ok(rest >= TIMED_REST_MIN_CARDS && rest <= TIMED_REST_MAX_CARDS);
    values.add(rest);
  }
  assert.deepEqual([...values].sort(), [2, 3, 4, 5]);
  assert.equal(timedRestCards('session', 'word:a', 'encounter-1'), timedRestCards('session', 'word:a', 'encounter-1'), 'stable for retries');
});

test('an item never returns before its rest while anything else is rested', () => {
  const seenAt = 9; const rest = timedRestCards('s', 'word:miss', 'e9');
  for (let encounterCount = seenAt + 1; encounterCount < seenAt + 1 + rest; encounterCount++) {
    const miss = candidate('miss', { pressing: true, lastPosition: seenAt, lastEncounterId: 'e9' });
    assert.equal(choose([miss, candidate('other')], encounterCount), 'other', `still resting after ${encounterCount - seenAt - 1} cards`);
  }
  const miss = candidate('miss', { pressing: true, lastPosition: seenAt, lastEncounterId: 'e9' });
  assert.equal(choose([miss, candidate('other')], seenAt + 1 + rest), 'miss', 'rested pressing work wins the pressing tier');
});

test('the tier sends seven picks in ten to rested pressing work and the rest to a draw over every rested item', () => {
  const both = [candidate('ordinary'), candidate('pressing', { pressing: true })];
  for (let tier = 0; tier < 100; tier++) {
    assert.equal(choose(both, 0, sampler(tier, 1)), 'pressing');
    assert.equal(choose(both, 0, sampler(tier, 0)), tier < PRESSING_TIER_SHARE ? 'pressing' : 'ordinary');
  }
});

test('a pressing item never has worse odds than an ordinary one, even when pressing items far outnumber ordinary ones', () => {
  const candidates = [...Array.from({ length: 40 }, (_, index) => candidate(`p${index}`, { pressing: true })),
    ...Array.from({ length: 5 }, (_, index) => candidate(`o${index}`))];
  // Every tier draw against every index draw (360 is a multiple of both pool sizes).
  const picks = new Map<string, number>();
  for (let tier = 0; tier < 100; tier++) for (let index = 0; index < 360; index++) {
    const id = choose(candidates, 0, sampler(tier, index)); picks.set(id, (picks.get(id) ?? 0) + 1);
  }
  const total = 100 * 360; const share = (id: string) => (picks.get(id) ?? 0) / total;
  // 0.7 / 40 + 0.3 / 45 for each pressing item; 0.3 / 45 for each ordinary item.
  assert.ok(Math.abs(share('p0') - (0.7 / 40 + 0.3 / 45)) < 1e-9);
  assert.ok(Math.abs(share('o0') - 0.3 / 45) < 1e-9);
});

test('the pressing branch falls back to ordinary work when no pressing item is rested', () => {
  const resting = candidate('pressing', { pressing: true, lastPosition: 4, lastEncounterId: 'e4' });
  assert.equal(choose([resting, candidate('ordinary')], 5, sampler(0)), 'ordinary');
});

test('the ordinary branch takes rested pressing work when no ordinary item is rested', () => {
  const tired = candidate('ordinary', { lastPosition: 4, lastEncounterId: 'e4' });
  assert.equal(choose([tired, candidate('pressing', { pressing: true })], 5, sampler(99)), 'pressing');
});

test('with nothing rested, whatever has waited longest comes next so a drain never stalls', () => {
  const recent = candidate('recent', { pressing: true, lastPosition: 6, lastEncounterId: 'e6' });
  const older = candidate('older', { pressing: true, lastPosition: 5, lastEncounterId: 'e5' });
  assert.equal(choose([recent, older], 7), 'older');
});

test('the ordinary draw is uniform over rested items of every kind, pressing included', () => {
  const ordinary = [candidate('review'), candidate('cue', { target: { kind: 'pure_cue', id: 'cue' } }), candidate('new'),
    candidate('overdue', { pressing: true }), candidate('resting', { lastPosition: 9, lastEncounterId: 'e9' })];
  const picks = new Map<string, number>();
  for (let draw = 0; draw < 400; draw++) {
    const id = chooseTimedTarget({ sessionId: 's', candidates: ordinary, encounterCount: 10,
      sample: (length, salt) => salt === 'tier' ? 99 : salt === 'ordinary' ? draw % length : 0 }).id;
    picks.set(id, (picks.get(id) ?? 0) + 1);
  }
  // No weighting by kind, no urgency order among rested items, and resting items wait.
  assert.deepEqual(Object.fromEntries(picks), { review: 100, cue: 100, new: 100, overdue: 100 });
});

test('random choice within the pressing tier spreads across rested items', () => {
  const pressing = ['p1', 'p2', 'p3'].map((id) => candidate(id, { pressing: true }));
  assert.deepEqual([0, 1, 2].map((index) => choose(pressing, 0, sampler(0, index))), ['p1', 'p2', 'p3']);
});
