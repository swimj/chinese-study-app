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
/** Local study-day keys (the timed session's day, turning at 04:00) with a finished session. */
export type VocabularyStudyDays = {today:string;studied:string[]};
export type VocabularyStatistics = {
  days:VocabularyStatisticsDay[];
  studyDays:VocabularyStudyDays;
  modes:Record<'unstudied'|'solidify'|'practice'|'maintain',number>;
};

/** The server supplies consecutive UTC days, including zero-activity days. */
export function vocabularyActiveTimeMetrics(days:readonly VocabularyStatisticsDay[]) {
  const total=(count:number)=>days.slice(-count).reduce((sum,day)=>sum+day.activeDurationMs,0);
  return {today:days.at(-1)?.activeDurationMs??0,average3:total(3)/3,average7:total(7)/7,
    unknownDurationSessions:days.slice(-7).reduce((sum,day)=>sum+day.unknownDurationSessions,0)};
}

export type VocabularyWeekDay = {dayKey:string;label:string;name:string;state:'studied'|'open'|'upcoming'};
const WEEKDAYS=[['M','Monday'],['T','Tuesday'],['W','Wednesday'],['T','Thursday'],['F','Friday'],['S','Saturday'],['S','Sunday']] as const;
/** The Monday-to-Sunday week containing today. Unstudied past days and today are simply open. */
export function vocabularyStudyWeek(studyDays:VocabularyStudyDays):VocabularyWeekDay[] {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(studyDays.today))throw new Error('Expected study day key');
  const today=new Date(`${studyDays.today}T00:00:00.000Z`),studied=new Set(studyDays.studied);
  const monday=new Date(today);monday.setUTCDate(today.getUTCDate()-((today.getUTCDay()+6)%7));
  return WEEKDAYS.map(([label,name],offset)=>{
    const day=new Date(monday);day.setUTCDate(monday.getUTCDate()+offset);const dayKey=day.toISOString().slice(0,10);
    return {dayKey,label,name,state:studied.has(dayKey)?'studied':dayKey>studyDays.today?'upcoming':'open'};
  });
}
export const studiedToday=(studyDays:VocabularyStudyDays|undefined)=>studyDays?.studied.includes(studyDays.today)===true;
