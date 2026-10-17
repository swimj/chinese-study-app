/** UTC daily totals across retained legacy summaries and closed vocabulary completions.
 * Covered words are known only for vocabulary completions; legacy summary sessions
 * contribute to unknownCoverageSessions rather than converting exercises into words. */
export type VocabularyStatisticsDay = {
  dayKey:string;
  sessions:number;
  coveredWords:number;
  unknownCoverageSessions:number;
  acceptedResponses:number;
  rejectedResponses:number;
  /** Sum of known active durations; unknown sessions never infer elapsed wall time. */
  activeDurationMs:number;
  unknownDurationSessions:number;
};
export type VocabularyStatistics = {
  days:VocabularyStatisticsDay[];
  modes:Record<'unstudied'|'solidify'|'practice'|'maintain',number>;
};
