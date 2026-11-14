/** Learner-facing progress indicators read from closed vocabulary-runtime completions.
 * Units are items (a word skill or a shared cue) except active vocabulary and first productions. */

/** `void` and `pending` rejected production attempts are excluded from the rate and reported as counts.
 * `rate` is null until `success + failure` reaches {@link VOCABULARY_PROGRESS_MINIMUM_JUDGED}. */
export type VocabularyProgressRate = { rate: number | null; success: number; failure: number; void: number; pending: number };
export type VocabularyProgressDay = { dayKey: string; wordItems: number; cueItems: number; activeDurationMs: number };
export type VocabularyFirstProduction = { wordId: string; hanzi: string; pinyin: string; dayKey: string };
export type VocabularyEfficiencyMonth = { month: string; medianSessions: number | null; settled: number; settling: number };
export type VocabularyProgress = {
  /** Local study day (04:00 boundary) when a time zone is supplied, otherwise UTC. */
  today: string;
  /** 14 consecutive study days ending today, oldest first. */
  days: VocabularyProgressDay[];
  activeVocabulary: { total: number; addedLast30Days: number };
  /** Most recent first; productions within the learner's first 14 days are counted but not listed. */
  firstProductions: VocabularyFirstProduction[];
  recognition: VocabularyProgressRate;
  stickiness: VocabularyProgressRate & { wordAttempts: number; cueAttempts: number };
  transfer: VocabularyProgressRate;
  /** Oldest month first. */
  efficiency: VocabularyEfficiencyMonth[];
};

export const VOCABULARY_PROGRESS_MINIMUM_JUDGED = 10;
export const VOCABULARY_PROGRESS_MINIMUM_SETTLED = 5;
export const VOCABULARY_PROGRESS_STICKINESS_GAP_DAYS = 21;
