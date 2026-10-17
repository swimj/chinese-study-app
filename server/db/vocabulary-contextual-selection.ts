import { getDb } from './connection.ts';
import { requireLearnerId } from './learner-context.ts';
import { applyIntervalHourFuzz } from './interval-schedule.ts';
type ContextualSchedule = {interval_hours:number;ease_factor:number;enabled:number;last_studied_at:string;next_due_at:string|null};
/** Context selection retains its independent six-hour lapse / ordinary successful-review policy. */
export function applyVocabularyContextualSelection(wordId:string,rejectedCount:number,now:string):{before:ContextualSchedule|null;after:ContextualSchedule} {
  if(!getDb().isTransaction)throw new Error('Contextual selection requires the session closure transaction');
  const learner=requireLearnerId();
  const before=getDb().prepare(`SELECT interval_hours,ease_factor,enabled,last_studied_at,next_due_at FROM learner_owned_word_skill_state
    WHERE learner_id=? AND word_id=? AND skill_id='contextual_selection'`).get(learner,wordId) as ContextualSchedule|undefined;
  const prior=before??{interval_hours:6,ease_factor:2.5,enabled:1,last_studied_at:now,next_due_at:null};
  const interval=rejectedCount>0?6:before?applyIntervalHourFuzz(Math.ceil(prior.interval_hours*prior.ease_factor)):6;
  const after={...prior,interval_hours:interval,ease_factor:rejectedCount>0?Math.max(1.8,Number((prior.ease_factor-0.15*rejectedCount).toFixed(2))):prior.ease_factor,
    last_studied_at:now,next_due_at:new Date(Date.parse(now)+interval*3_600_000).toISOString()};
  getDb().prepare(`INSERT INTO learner_owned_word_skill_state(learner_id,word_id,skill_id,enabled,interval_hours,last_studied_at,next_due_at,ease_factor)
    VALUES (?,?,'contextual_selection',?,?,?,?,?) ON CONFLICT(learner_id,word_id,skill_id) DO UPDATE SET interval_hours=excluded.interval_hours,
      last_studied_at=excluded.last_studied_at,next_due_at=excluded.next_due_at,ease_factor=excluded.ease_factor`)
    .run(learner,wordId,after.enabled,after.interval_hours,after.last_studied_at,after.next_due_at,after.ease_factor);
  return {before:before?{...before}:null,after};
}
