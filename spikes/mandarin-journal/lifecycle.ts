// A newly taught word's bounded lifecycle: it settles on a short recall schedule,
// graduates, and gets one check-up. Graduation is an experiment: each newly taught
// word is randomly assigned one policy, recorded on its lesson event, and every
// policy can also be scored in shadow over the same evidence. Nothing here is
// stored; the state is derived from the record each time (MODEL.md principles 1, 9).
// Days are the learner's local days (day.ts), derived from the stored UTC instants.
import { addDays, learningDay } from './day.ts';

export const GRADUATION_VERSION = 'graduation-v1';
export type PolicyId = 'A' | 'B' | 'C';
export type Assignment = { policy: PolicyId; version: string };

/**
 * Recall intervals in the learner's days: the first counted from teaching, each later one from
 * the previous clean recall. A word graduates after one clean recall per interval.
 */
export const POLICIES: Record<PolicyId, { intervals: number[] }> = {
  A: { intervals: [1, 1] },
  B: { intervals: [1, 3] },
  C: { intervals: [1, 3, 7] },
};
export const POLICY_IDS = Object.keys(POLICIES) as PolicyId[];
/** Days after graduation when one typed recall checks the word, the same for every policy. */
export const CHECKUP_DAYS = 14;

export function assignPolicy(random = Math.random): Assignment {
  return { policy: POLICY_IDS[Math.min(POLICY_IDS.length - 1, Math.floor(random() * POLICY_IDS.length))], version: GRADUATION_VERSION };
}

/** A bounded exercise on the word after its teaching. typed: a typed recall, not a choice. */
export type Outcome = { at: string; correct: boolean; typed: boolean };

/**
 * first: taught, and no recall has followed yet; it is first in line.
 * settling: on the policy's recall schedule. graduated: waiting for its check-up.
 * checked: passed its check-up; the lifecycle is over.
 */
export type LifecycleState = 'first' | 'settling' | 'graduated' | 'checked';
export type Lifecycle = {
  policy: PolicyId;
  state: LifecycleState;
  /** Clean recalls toward graduation since teaching or the latest miss. */
  clean: number;
  needed: number;
  /** The learner's day the next recall or check-up is due; null once checked. */
  due: string | null;
  /** Typed recalls since teaching. */
  recalls: number;
  /** Typed recalls from teaching to the first graduation; null until it graduates. */
  recallsToGraduate: number | null;
  graduatedAt: string | null;
  checkups: { at: string; passed: boolean }[];
};


/**
 * Replays the evidence after teaching under one policy. A clean recall is a correct
 * typed recall on or after its due day; an earlier one counts for nothing. A miss
 * (typed or choice) resets the schedule from the day of the miss. A correct choice is
 * recognition and counts for nothing. After graduation, the first typed recall at
 * least CHECKUP_DAYS later is the check-up; a miss at any point reopens the word.
 * zone: the learner's IANA time zone; every day here is a local day in it.
 */
export function lifecycle(policy: PolicyId, taughtAt: string, outcomes: Outcome[], zone: string): Lifecycle {
  const dayOf = (at: string) => learningDay(at, zone);
  const { intervals } = POLICIES[policy];
  let state: LifecycleState = 'first';
  let clean = 0;
  let anchor = dayOf(taughtAt);
  let recalls = 0;
  let recallsToGraduate: number | null = null;
  let graduatedAt: string | null = null;
  const checkups: Lifecycle['checkups'] = [];
  const dueDay = () => addDays(anchor, intervals[Math.min(clean, intervals.length - 1)]);
  const reset = (at: string) => {
    state = 'settling';
    clean = 0;
    anchor = dayOf(at);
  };
  const ordered = outcomes.filter((o) => o.at >= taughtAt).sort((a, b) => a.at.localeCompare(b.at));
  for (const o of ordered) {
    if (o.typed) recalls++;
    if (state === 'first' || state === 'settling') {
      if (!o.correct) reset(o.at);
      else if (!o.typed) continue;
      else if (dayOf(o.at) >= dueDay()) {
        clean++;
        anchor = dayOf(o.at);
        state = 'settling';
        if (clean >= intervals.length) {
          state = 'graduated';
          graduatedAt = o.at;
          recallsToGraduate ??= recalls;
        }
      } else state = 'settling';
    } else if (state === 'graduated') {
      if (o.typed && dayOf(o.at) >= addDays(dayOf(graduatedAt!), CHECKUP_DAYS)) {
        checkups.push({ at: o.at, passed: o.correct });
        if (o.correct) state = 'checked';
        else reset(o.at);
      } else if (!o.correct) reset(o.at);
    } else if (!o.correct) reset(o.at);
  }
  const due =
    state === 'first' ? dayOf(taughtAt)
    : state === 'settling' ? dueDay()
    : state === 'graduated' ? addDays(dayOf(graduatedAt!), CHECKUP_DAYS)
    : null;
  return { policy, state, clean, needed: intervals.length, due, recalls, recallsToGraduate, graduatedAt, checkups };
}

/** Whether a lifecycle wants a recall on the given learner's day (from the same zone). */
export const isDue = (life: Lifecycle, today: string) => life.due !== null && life.due <= today;
