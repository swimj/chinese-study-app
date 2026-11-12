/**
 * Timed daily practice prototype. The learner states roughly how much a day can
 * hold; the session wraps up at a natural break once the day's active time
 * reaches that size. See notes/active/2026-11-11-timed-session-iterator-prototype.md.
 */
export const DAILY_STUDY_MINUTE_CHOICES = [10, 20, 30] as const;
export type DailyStudyMinutes = typeof DAILY_STUDY_MINUTE_CHOICES[number];
export const DEFAULT_DAILY_STUDY_MINUTES: DailyStudyMinutes = 20;
/** One "Study a little more", and the least a fresh entry into a spent day runs. */
export const TIMED_SESSION_EXTENSION_MS = 5 * 60_000;
/** Days a due held item can be passed over before it becomes pressing. A starting constant, not a tuned result. */
export const PRESSING_SKIP_DAYS = 3;
export const TIMED_SESSION_NOTE_MAX_LENGTH = 500;
/** Each appearance rests an item for a random gap in this range, so returns do not form a pattern. */
export const TIMED_REST_MIN_CARDS = 2;
export const TIMED_REST_MAX_CARDS = 5;
/** Share of picks (out of 100) that try rested pressing work before the ordinary weighted draw. */
export const PRESSING_TIER_SHARE = 70;

export function isDailyStudyMinutes(value: unknown): value is DailyStudyMinutes {
  return typeof value === 'number' && (DAILY_STUDY_MINUTE_CHOICES as readonly number[]).includes(value);
}

export type TimedTargetKind = 'word' | 'pure_cue';
export type TimedItemClass = 'runway' | 'held' | 'new';
export function timedTargetKey(kind: TimedTargetKind, id: string): string { return `${kind}:${id}`; }

/** Frozen at Start so replay and closure never depend on later clocks or settings. */
export type VocabularyTimedSessionContext = {
  version: 1;
  /** Local study day (04:00 boundary) the session belongs to. */
  dayKey: string;
  budgetMs: number;
  budgetSource: 'chosen' | 'default';
  /** Active time already spent in this study day's earlier sessions. */
  dayActiveMsAtStart: number;
  /** Day active time at which this session wraps up, before any extension. */
  untilDayActiveMs: number;
  /** Held items passed over on enough separate days to outrank new words. */
  pressingKeys: readonly string[];
  /** When the classic rule would have shown each admitted target, and whether its last outcome was a lapse. */
  facts: Readonly<Record<string, { classicDueAt: string | null; priorLapse: boolean | null }>>;
};

export function timedItemClass(kind: TimedTargetKind, mode: 'unstudied' | 'solidify' | 'practice' | 'maintain' | null): TimedItemClass {
  if (kind === 'pure_cue') return 'held';
  if (mode === 'unstudied') return 'new';
  if (mode === 'solidify') return 'runway';
  return 'held';
}

/** Learner-facing timed state. No remaining time, pace, or due counts. */
export type VocabularyTimedStudyState = {
  /** The day's allowance ended this session at a natural break. */
  budgetWrapped: boolean;
  canStudyMore: boolean;
  /** Last active time the server accepted for this session; resumes the client clock. */
  sessionActiveMs: number;
  note: string | null;
};
