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

/** The server supplies consecutive UTC days, including zero-activity days. */
export function vocabularyActiveTimeMetrics(days:readonly VocabularyStatisticsDay[]) {
  const total=(count:number)=>days.slice(-count).reduce((sum,day)=>sum+day.activeDurationMs,0);
  return {today:days.at(-1)?.activeDurationMs??0,average3:total(3)/3,average7:total(7)/7,
    unknownDurationSessions:days.slice(-7).reduce((sum,day)=>sum+day.unknownDurationSessions,0)};
}
