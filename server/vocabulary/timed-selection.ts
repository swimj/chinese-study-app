import { createHash } from 'node:crypto';
import { DEFAULT_SESSION_BUCKET_WEIGHTS } from '../../src/domain/session-limits.ts';
import { PRESSING_TIER_SHARE, TIMED_REST_MAX_CARDS, TIMED_REST_MIN_CARDS, timedTargetKey } from '../../src/domain/timed-session.ts';

export type TimedTarget = { kind: 'word' | 'pure_cue'; id: string };
export type TimedCandidate = {
  target: TimedTarget;
  pressing: boolean;
  bucket: keyof typeof DEFAULT_SESSION_BUCKET_WEIGHTS;
  /** Index of the item's latest effective presentation, or -1 when unseen. */
  lastPosition: number;
  lastEncounterId: string | null;
  /** Frozen review order, used only to break ties among review items. */
  order: number;
};

/** The rest drawn for one appearance; seeded so a retried request sees the same gap. */
export function timedRestCards(sessionId: string, key: string, encounterId: string): number {
  const span = TIMED_REST_MAX_CARDS - TIMED_REST_MIN_CARDS + 1;
  return TIMED_REST_MIN_CARDS + parseInt(createHash('sha256').update(`${sessionId}/rest/${key}/${encounterId}`).digest('hex').slice(0, 8), 16) % span;
}

/**
 * Timed selection over already-gated candidates. Rested pressing work wins seven
 * picks in ten; otherwise the ordinary bucket draw runs over rested non-pressing work.
 */
export function chooseTimedTarget(input: { sessionId: string; candidates: readonly TimedCandidate[]; encounterCount: number;
  sample: (length: number, salt: string) => number }): TimedTarget {
  const { candidates, encounterCount, sample } = input;
  if (!candidates.length) throw new Error('Timed selection requires a candidate');
  const rested = candidates.filter((entry) => entry.lastPosition < 0 || entry.lastEncounterId === null
    || encounterCount - 1 - entry.lastPosition >= timedRestCards(input.sessionId, timedTargetKey(entry.target.kind, entry.target.id), entry.lastEncounterId));
  const pressing = rested.filter((entry) => entry.pressing);
  const ordinary = rested.filter((entry) => !entry.pressing);
  if (pressing.length && (sample(100, 'tier') < PRESSING_TIER_SHARE || !ordinary.length)) return pressing[sample(pressing.length, 'pressing')].target;
  if (ordinary.length) return weighted(ordinary, sample);
  // Nothing has finished resting: the item that has waited longest keeps a drain moving.
  return [...candidates].sort((a, b) => a.lastPosition - b.lastPosition || a.order - b.order)[0].target;
}
function weighted(pool: readonly TimedCandidate[], sample: (length: number, salt: string) => number): TimedTarget {
  const buckets = (['review', 'learning', 'unstudied'] as const).map((name) => ({ name, entries: pool.filter((entry) => entry.bucket === name) }))
    .filter((entry) => entry.entries.length);
  let draw = sample(buckets.reduce((sum, entry) => sum + DEFAULT_SESSION_BUCKET_WEIGHTS[entry.name], 0), 'bucket');
  const chosen = buckets.find((entry) => (draw -= DEFAULT_SESSION_BUCKET_WEIGHTS[entry.name]) < 0)!;
  if (chosen.name === 'review') return [...chosen.entries].sort((a, b) => a.lastPosition - b.lastPosition || a.order - b.order)[0].target;
  return chosen.entries[sample(chosen.entries.length, 'word')].target;
}
