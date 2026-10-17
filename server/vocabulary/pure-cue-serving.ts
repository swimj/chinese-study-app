import {createHash} from 'node:crypto';
import {getDb} from '../db/connection.ts';
import {requireLearnerId} from '../db/learner-context.ts';
import {getVocabularyContent} from '../db/vocabulary-content.ts';
import {dueAtWithResetDelay,selectPureCuesForSession,type PureCue} from '../../src/domain/pure-cues.ts';
import type {VocabularyContent} from '../../src/domain/vocabulary-content.ts';

const eligibleContent=`c.kind='exercise' AND c.exercise_type='pure_cue' AND c.exercise_role='general' AND c.availability='active'
  AND (c.access_scope='shared' OR c.owner_learner_id=:learner)
  AND NOT EXISTS(SELECT 1 FROM learner_content_deactivations d WHERE d.learner_id=:learner AND d.content_id=c.content_id)
  AND EXISTS(SELECT 1 FROM exercise_answer_words a JOIN learner_words w ON w.word_id=a.word_id AND w.learner_id=:learner
    LEFT JOIN learner_owned_word_skill_state s ON s.learner_id=w.learner_id AND s.word_id=w.word_id AND s.skill_id='production'
    LEFT JOIN learner_owned_word_skill_relevance r ON r.learner_id=w.learner_id AND r.word_id=w.word_id AND r.skill_id='production'
    WHERE a.exercise_id=c.content_id AND w.mode IN ('practice','maintain') AND w.dismissed_at IS NULL
      AND COALESCE(s.enabled,1)=1 AND COALESCE(r.relevance_state,'normal')!='suppressed')`;
/** Adoption is per content identity. Replacement never copies a predecessor's state or activation. */
export function adoptVocabularyPureCues(now=new Date().toISOString()):void {
  getDb().prepare(`INSERT INTO learner_pure_cue_schedules(learner_id,content_id,next_eligible_at,policy_version,scheduler_state_json)
    SELECT :learner,c.content_id,:due,'vocabulary-pure-adoption-v1',:state FROM content_items c WHERE ${eligibleContent}
    ON CONFLICT(learner_id,content_id) DO NOTHING`).run({learner:requireLearnerId(),due:dueAtWithResetDelay(now),
      state:JSON.stringify({intervalHours:24,easeFactor:2.5,enabled:1,cleanCoveredSessions:0,strongSince:null,strongSuccesses:0,adoptedAt:now})});
}
export function selectVocabularyPureCueCandidates(input:{ordinaryReviewCount:number;sessionSeed:string;now?:string}):VocabularyContent[] {
  const now=input.now??new Date().toISOString();adoptVocabularyPureCues(now);
  const rows=getDb().prepare(`SELECT c.content_id,s.scheduler_state_json,s.last_practised_at,s.next_eligible_at
    FROM learner_pure_cue_schedules s JOIN content_items c USING(content_id)
    WHERE s.learner_id=:learner AND COALESCE(json_extract(s.scheduler_state_json,'$.enabled'),1)=1 AND ${eligibleContent}
    ORDER BY c.created_at,c.content_id`).all({learner:requireLearnerId()}) as {content_id:string;scheduler_state_json:string;last_practised_at:string|null;next_eligible_at:string|null}[];
  const contents=new Map<string,VocabularyContent>();
  const cues=rows.map((row):PureCue=>{
    const content=getVocabularyContent(row.content_id);if(!content||content.kind!=='exercise')throw new Error('Eligible pure cue disappeared');contents.set(content.contentId,content);
    const state=JSON.parse(row.scheduler_state_json) as {intervalHours:number;easeFactor:number;strongSince?:string|null;strongSuccesses?:number;resetUntil?:string|null};
    const active=state.resetUntil==null||state.resetUntil<=now;
    return {id:content.contentId,kind:'pure',stimulus:'',axisNote:'',teachingNote:'',acceptedWordIds:content.answers.map((answer)=>answer.wordId),active,
      intervalHours:state.intervalHours,easeFactor:state.easeFactor,lastStudiedAt:row.last_practised_at,nextDueAt:row.next_eligible_at??now,
      strongSince:state.strongSince??null,strongSuccesses:state.strongSuccesses??0};
  });
  let draw=0;const random=()=>parseInt(createHash('sha256').update(`${input.sessionSeed}/${draw++}`).digest('hex').slice(0,8),16)/0x100000000;
  return selectPureCuesForSession({cues,ordinaryReviewCount:input.ordinaryReviewCount,now,random}).selected.slice(0,4).map((cue)=>contents.get(cue.id)!);
}
