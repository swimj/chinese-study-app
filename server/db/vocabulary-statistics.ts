import { getDb } from './connection.ts';
import { requireLearnerId } from './learner-context.ts';
import type { VocabularySessionProjection } from '../../src/domain/vocabulary-session.ts';
import type { VocabularyStatisticsDay,VocabularyStatistics } from '../../src/domain/vocabulary-statistics.ts';
export type { VocabularyStatisticsDay,VocabularyStatistics } from '../../src/domain/vocabulary-statistics.ts';
export type VocabularyUsageDay = VocabularyStatisticsDay & {learnerIds:string[];newWords:number;practiceCompleted:number};
function empty(dayKey:string):VocabularyUsageDay{return {dayKey,sessions:0,coveredWords:0,unknownCoverageSessions:0,acceptedResponses:0,rejectedResponses:0,activeDurationMs:0,unknownDurationSessions:0,learnerIds:[],newWords:0,practiceCompleted:0};}
/** Closed new completions only. Effective projection responses exclude Undo and undone presentations.
 * Duration is explicitly supplied active time; absent metadata remains unknown. No wall-time estimate. */
export function getVocabularyCompletionUsage(dayKey:string,learnerId?:string):VocabularyUsageDay {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(dayKey))throw new Error('Expected UTC day key');
  const result=empty(dayKey),learners=new Set<string>();
  const rows=getDb().prepare(`SELECT learner_id,completion_id,input_json,report_json FROM vocabulary_session_completions
    WHERE status='closed' AND substr(closed_at,1,10)=? ${learnerId===undefined?'':'AND learner_id=?'}`)
    .all(dayKey,...(learnerId===undefined?[]:[learnerId])) as {learner_id:string;completion_id:string;input_json:string;report_json:string}[];
  for(const row of rows){
    const report=JSON.parse(row.report_json) as VocabularySessionProjection;
    const input=JSON.parse(row.input_json) as {activeDurationMs?:number|null};
    learners.add(row.learner_id);result.sessions++;
    result.coveredWords+=report.coveredWordIds.length;
    result.practiceCompleted+=Object.values(report.words).filter(word=>word.covered&&!word.teachingCompleted).length;
    for(const encounter of report.encounters){
      if(encounter.presentationUndone)continue;
      for(const response of encounter.effectiveResponses){
        if(response.payload.outcome==='accepted')result.acceptedResponses++;else if(response.payload.outcome==='rejected')result.rejectedResponses++;
      }
    }
    const duration=input.activeDurationMs;
    if(typeof duration==='number'&&Number.isSafeInteger(duration)&&duration>=0)result.activeDurationMs+=duration;
    else result.unknownDurationSessions++;
    result.newWords+=Number((getDb().prepare("SELECT COUNT(*) n FROM teaching_completions WHERE completion_id=? AND learner_id=? AND source_kind='session'")
      .get(row.completion_id,row.learner_id) as {n:number}).n);
  }
  return {...result,learnerIds:[...learners]};
}
/** Learner-specific union. A legacy summary sharing a new closed session identity is counted once. */
export function getVocabularyStatistics(now=new Date()):VocabularyStatistics {
  const learnerId=requireLearnerId(),days:VocabularyStatisticsDay[]=[];
  for(let offset=13;offset>=0;offset--){
    const day=new Date(now);day.setUTCDate(day.getUTCDate()-offset);const key=day.toISOString().slice(0,10);
    const fresh=getVocabularyCompletionUsage(key,learnerId);
    const old=getDb().prepare(`SELECT COUNT(*) sessions,
      COALESCE(SUM(completed_count-failed_count),0) accepted,COALESCE(SUM(failed_count),0) rejected,
      COALESCE(SUM(active_duration_ms),0) duration,SUM(CASE WHEN active_duration_ms IS NULL THEN 1 ELSE 0 END) unknown
      FROM learner_owned_review_session_summaries s WHERE learner_id=? AND day_key=? AND NOT EXISTS
      (SELECT 1 FROM vocabulary_session_completions c WHERE c.learner_id=s.learner_id AND c.session_id=s.session_id AND c.status='closed')`)
      .get(learnerId,key) as {sessions:number;accepted:number;rejected:number;duration:number;unknown:number|null};
    days.push({dayKey:key,sessions:fresh.sessions+old.sessions,coveredWords:fresh.coveredWords,unknownCoverageSessions:old.sessions,
      acceptedResponses:fresh.acceptedResponses+old.accepted,rejectedResponses:fresh.rejectedResponses+old.rejected,
      activeDurationMs:fresh.activeDurationMs+old.duration,unknownDurationSessions:fresh.unknownDurationSessions+(old.unknown??0)});
  }
  const modes:VocabularyStatistics['modes']={unstudied:0,solidify:0,practice:0,maintain:0};
  for(const row of getDb().prepare('SELECT mode,COUNT(*) n FROM learner_words WHERE learner_id=? AND dismissed_at IS NULL GROUP BY mode').all(learnerId) as {mode:keyof typeof modes;n:number}[])modes[row.mode]=row.n;
  return {days,modes};
}
