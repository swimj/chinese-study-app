import type { StudyProfileId } from '../study-profile';
import {
  matchServedCueAnswer,
  type AcceptedCueAnswer,
  type PureCueContent,
} from './cues';

export type { PureCueContent } from './cues';

export const PURE_CUE_INITIAL_INTERVAL_HOURS = 24;
export const PURE_CUE_INITIAL_EASE_FACTOR = 2.5;
export const PURE_CUE_MINIMUM_EASE_FACTOR = 1.8;
export const PURE_CUE_LAPSE_INTERVAL_HOURS = 6;
/** Same length as a lapse reset: new adoptions and compensated production due dates. */
export const PURE_CUE_DUE_DELAY_HOURS = PURE_CUE_LAPSE_INTERVAL_HOURS;
export const PURE_CUE_STRONG_INTERVAL_HOURS = 720;
export const PURE_CUE_STRONG_RECENCY_HOURS = 6;

export type PureCueRating = 'forgot' | 'hard' | 'good' | 'easy';
export type PureCueAttemptOutcome = 'accepted' | 'rejected';

export type PureCueStudyState = {
  intervalHours: number;
  easeFactor: number;
  lastStudiedAt: string | null;
  nextDueAt: string;
  strongSince: string | null;
  strongSuccesses: number;
};

export type PureCue = PureCueContent & PureCueStudyState;

export type PureCueAcceptedAnswer = AcceptedCueAnswer;

export type PureCueServedSnapshot = {
  snapshotId: string;
  pureCueId: string;
  servedAt: string;
  stimulus: string;
  axisNote: string;
  teachingNote: string;
  acceptedAnswers: PureCueAcceptedAnswer[];
};

export type PureCueAssessmentEvent = {
  eventId: string;
  occurredAt: string;
  response: string | null;
  outcome: PureCueAttemptOutcome;
  submittedWordId: string | null;
  rating: PureCueRating;
};

export type PureCueAssessmentSummary = {
  failureCount: number;
  terminalRating: Exclude<PureCueRating, 'forgot'> | null;
};

export type PureCueSelection = {
  fragile: PureCue[];
  strong: PureCue[];
  selected: PureCue[];
};

export function dueAtWithResetDelay(from: string, existingDueAt: string | null = null): string {
  assertCanonicalIsoTimestamp(from, 'Due-delay origin');
  if (existingDueAt !== null) assertCanonicalIsoTimestamp(existingDueAt, 'Existing due at');
  const delayed = addHours(from, PURE_CUE_DUE_DELAY_HOURS);
  return existingDueAt !== null && existingDueAt > delayed ? existingDueAt : delayed;
}

export function schedulePureCueAssessment(
  cue: PureCue,
  assessment: PureCueAssessmentSummary,
  assessedAt: string,
  random: () => number = Math.random,
): PureCue {
  assertCanonicalIsoTimestamp(assessedAt, 'Pure cue assessedAt');
  assertNonNegativeInteger(assessment.failureCount, 'Pure cue failureCount');

  if (assessment.failureCount > 0) {
    if (assessment.terminalRating !== null) {
      throw new Error('Lapsed pure cue assessment cannot have a terminal rating.');
    }
    return {
      ...cue,
      intervalHours: PURE_CUE_LAPSE_INTERVAL_HOURS,
      easeFactor: Math.max(
        PURE_CUE_MINIMUM_EASE_FACTOR,
        roundEase(cue.easeFactor - 0.15 * assessment.failureCount),
      ),
      lastStudiedAt: assessedAt,
      nextDueAt: addHours(assessedAt, PURE_CUE_LAPSE_INTERVAL_HOURS),
      strongSince: null,
      strongSuccesses: 0,
    };
  }

  const rating = assessment.terminalRating;
  if (rating === null) {
    throw new Error('Clean pure cue assessment requires a terminal rating.');
  }

  const multiplier = rating === 'hard'
    ? 1.5
    : rating === 'good'
      ? cue.easeFactor
      : cue.easeFactor + 0.35;
  const nextInterval = applyIntervalHourFuzz(
    Math.max(PURE_CUE_LAPSE_INTERVAL_HOURS, Math.ceil(cue.intervalHours * multiplier)),
    random,
  );
  const nextEase = rating === 'hard'
    ? Math.max(PURE_CUE_MINIMUM_EASE_FACTOR, roundEase(cue.easeFactor - 0.15))
    : rating === 'easy'
      ? roundEase(cue.easeFactor + 0.15)
      : roundEase(cue.easeFactor);
  const wasStrong = cue.strongSince !== null;
  const isStrong = nextInterval >= PURE_CUE_STRONG_INTERVAL_HOURS;

  return {
    ...cue,
    intervalHours: nextInterval,
    easeFactor: nextEase,
    lastStudiedAt: assessedAt,
    nextDueAt: addHours(assessedAt, nextInterval),
    strongSince: isStrong ? (wasStrong ? cue.strongSince : assessedAt) : null,
    strongSuccesses: isStrong ? (wasStrong ? cue.strongSuccesses + 1 : 0) : 0,
  };
}

export function selectPureCuesForSession({
  cues,
  ordinaryReviewCount,
  now,
  random = Math.random,
}: {
  cues: readonly PureCue[];
  ordinaryReviewCount: number;
  now: string;
  random?: () => number;
}): PureCueSelection {
  assertNonNegativeInteger(ordinaryReviewCount, 'Ordinary review count');
  assertCanonicalIsoTimestamp(now, 'Pure cue selection clock');

  const fragile = cues
    .filter((cue) => cue.active && cue.strongSince === null && cue.nextDueAt <= now)
    .sort(comparePureCues);
  const strongCandidates = cues
    .filter((cue) => cue.active && cue.strongSince !== null && isOutsideStrongRecency(cue, now))
    .sort(comparePureCues);
  const rawStrongSlots = (ordinaryReviewCount + fragile.length) / 10;
  let strongSlots = Math.floor(rawStrongSlots);
  const fractionalSlot = rawStrongSlots - strongSlots;
  if (fractionalSlot > 0 && sampleUnitInterval(random) < fractionalSlot) {
    strongSlots += 1;
  }
  const strong = sampleStrongCuesWithoutReplacement(
    strongCandidates,
    Math.min(strongSlots, strongCandidates.length),
    random,
  );

  return { fragile, strong, selected: [...fragile, ...strong] };
}

export function resolvePureCueResponse(
  snapshot: Pick<PureCueServedSnapshot, 'acceptedAnswers'>,
  response: string | null,
  profileId: StudyProfileId = 'mandarin',
): Pick<PureCueAssessmentEvent, 'outcome' | 'submittedWordId'> {
  const match = matchServedCueAnswer(snapshot, response, profileId);
  return match
    ? { outcome: 'accepted', submittedWordId: match.wordId }
    : { outcome: 'rejected', submittedWordId: null };
}

export function derivePureCueAssessment(
  snapshot: PureCueServedSnapshot,
  events: readonly PureCueAssessmentEvent[],
  profileId: StudyProfileId = 'mandarin',
): PureCueAssessmentSummary {
  if (events.length === 0) throw new Error('Pure cue assessment requires at least one event.');

  let failureCount = 0;
  let reinforcementStreak = 0;
  let covered: PureCueAssessmentSummary | null = null;
  const eventIds = new Set<string>();

  for (const event of events) {
    if (covered !== null) throw new Error('Pure cue assessment includes events after coverage.');
    if (typeof event.eventId !== 'string' || event.eventId.trim().length === 0) {
      throw new Error('Pure cue event id must be non-empty.');
    }
    if (eventIds.has(event.eventId)) throw new Error(`Duplicate pure cue event id ${event.eventId}.`);
    eventIds.add(event.eventId);
    assertCanonicalIsoTimestamp(event.occurredAt, 'Pure cue event occurredAt');
    if (!isPureCueRating(event.rating)) {
      throw new Error(`Invalid pure cue rating "${String(event.rating)}".`);
    }

    const resolved = resolvePureCueResponse(snapshot, event.response, profileId);
    if (resolved.outcome !== event.outcome || resolved.submittedWordId !== event.submittedWordId) {
      throw new Error('Pure cue event outcome does not match the frozen accepted-answer forms.');
    }
    if (event.outcome === 'rejected' && event.rating !== 'forgot') {
      throw new Error('Rejected pure cue response must be rated forgot.');
    }

    if (failureCount === 0 && event.outcome === 'accepted' && event.rating !== 'forgot') {
      covered = { failureCount: 0, terminalRating: event.rating };
      continue;
    }

    if (event.outcome === 'rejected' || event.rating === 'forgot') {
      failureCount += 1;
      reinforcementStreak = 0;
    } else {
      reinforcementStreak += 1;
    }
    if (reinforcementStreak >= 3) {
      covered = { failureCount, terminalRating: null };
    }
  }

  if (covered === null) throw new Error('Pure cue events do not represent a covered assessment.');
  return covered;
}

function sampleStrongCuesWithoutReplacement(
  candidates: readonly PureCue[],
  count: number,
  random: () => number,
): PureCue[] {
  const remaining = [...candidates];
  const selected: PureCue[] = [];
  while (selected.length < count) {
    const totalWeight = remaining.reduce((total, cue) => total + 1 / (1 + cue.strongSuccesses), 0);
    let cursor = sampleUnitInterval(random) * totalWeight;
    let selectedIndex = remaining.length - 1;
    for (const [index, cue] of remaining.entries()) {
      cursor -= 1 / (1 + cue.strongSuccesses);
      if (cursor < 0) {
        selectedIndex = index;
        break;
      }
    }
    selected.push(remaining.splice(selectedIndex, 1)[0]!);
  }
  return selected;
}

function isOutsideStrongRecency(cue: PureCue, now: string): boolean {
  if (cue.lastStudiedAt === null) return true;
  return Date.parse(now) - Date.parse(cue.lastStudiedAt)
    >= PURE_CUE_STRONG_RECENCY_HOURS * 60 * 60 * 1_000;
}

function comparePureCues(left: PureCue, right: PureCue): number {
  return left.nextDueAt.localeCompare(right.nextDueAt) || left.id.localeCompare(right.id);
}

function applyIntervalHourFuzz(intervalHours: number, random: () => number): number {
  const roll = sampleUnitInterval(random);
  const offset = roll < 0.3 ? -1 : roll < 0.7 ? 0 : 1;
  return Math.max(1, intervalHours + offset);
}

function sampleUnitInterval(random: () => number): number {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new Error('Pure cue random source must return a value in [0, 1).');
  }
  return value;
}

function addHours(value: string, hours: number): string {
  return new Date(Date.parse(value) + hours * 60 * 60 * 1_000).toISOString();
}

function roundEase(value: number): number {
  return Number(value.toFixed(2));
}

function assertCanonicalIsoTimestamp(value: string, label: string): void {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    throw new Error(`${label} must be a canonical ISO timestamp.`);
  }
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer.`);
}

function isPureCueRating(value: unknown): value is PureCueRating {
  return value === 'forgot' || value === 'hard' || value === 'good' || value === 'easy';
}
