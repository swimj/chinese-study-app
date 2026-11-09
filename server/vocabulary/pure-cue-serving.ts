import {vocabularyExerciseAnswersEligibleSql} from '../db/vocabulary-sense-eligibility.ts';
import {isSenseContentReconciliationPending} from '../db/sense-content-reconciliation-state.ts';
import {createHash} from 'node:crypto';
import {getDb} from '../db/connection.ts';
import {requireLearnerId} from '../db/learner-context.ts';
import {getVocabularyContent} from '../db/vocabulary-content.ts';
import type {VocabularyPureCueSchedulerState} from '../db/vocabulary-learners.ts';
import {dueAtWithResetDelay,selectPureCuesForSession,type PureCueSelectionCandidate} from '../../src/domain/pure-cues.ts';
import type {VocabularyContent} from '../../src/domain/vocabulary-content.ts';

const eligibleContent=`c.kind='exercise' AND c.exercise_type='pure_cue' AND c.exercise_role='general' AND c.availability='active'
  AND (c.access_scope='shared' OR c.owner_learner_id=:learner)
  AND ${vocabularyExerciseAnswersEligibleSql('c.content_id')}
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
type PureCueSelectionInput={ordinaryReviewCount:number;sessionSeed:string;now?:string;adopt?:boolean};
export function selectVocabularyPureCueCandidates(input:PureCueSelectionInput):VocabularyContent[] {
  const {rechecks,routine}=planVocabularyPureCues(input);
  return [...rechecks,...routine];
}
export function planVocabularyPureCues(input:PureCueSelectionInput):{rechecks:VocabularyContent[];routine:VocabularyContent[]} {
  const now=input.now??new Date().toISOString();if(input.adopt!==false)adoptVocabularyPureCues(now);
  const rows=getDb().prepare(`SELECT c.content_id,s.scheduler_state_json,s.last_practised_at,s.next_eligible_at
    FROM learner_pure_cue_schedules s JOIN content_items c USING(content_id)
    WHERE s.learner_id=:learner AND COALESCE(json_extract(s.scheduler_state_json,'$.enabled'),1)=1 AND ${eligibleContent}
    ORDER BY c.created_at,c.content_id`).all({learner:requireLearnerId()}) as {content_id:string;scheduler_state_json:string;last_practised_at:string|null;next_eligible_at:string|null}[];
  const cues=rows.filter(row=>{
    // Reconciliation gates need identities only; body, assessment and accepted forms
    // are loaded after scheduling chooses this cue.
    const words=getDb().prepare(`SELECT word_id FROM content_words WHERE content_id=?
      UNION SELECT word_id FROM exercise_answer_words WHERE exercise_id=?`)
      .all(row.content_id,row.content_id) as {word_id:string}[];
    return words.every(word=>!isSenseContentReconciliationPending(word.word_id));
  }).map((row):PureCueSelectionCandidate & {recheckAt:string|null}=>{
    const state=JSON.parse(row.scheduler_state_json) as VocabularyPureCueSchedulerState;
    const active=state.resetUntil==null||state.resetUntil<=now;
    return {id:row.content_id,maintenanceIdentity:state.maintenanceIdentity,active,
      lastStudiedAt:row.last_practised_at,nextDueAt:row.next_eligible_at??now,
      strongSince:state.strongSince??null,strongSuccesses:state.strongSuccesses??0,recheckAt:state.postCompensationRecheckAt??null};
  });
  let draw=0;const random=()=>parseInt(createHash('sha256').update(`${input.sessionSeed}/${draw++}`).digest('hex').slice(0,8),16)/0x100000000;
  const rechecks=cues.flatMap(cue=>cue.active&&cue.recheckAt!==null&&cue.recheckAt<=now
    ? [{id:cue.id,recheckAt:cue.recheckAt}] : []);
  const routine=selectPureCuesForSession({learnerId:requireLearnerId(),cues:cues.filter(cue=>cue.recheckAt===null),
    ordinaryReviewCount:input.ordinaryReviewCount,now,random}).selected;
  const hydrate=(id:string)=>{
    const content=getVocabularyContent(id);
    if(!content||content.kind!=='exercise')throw new Error('Selected pure cue disappeared');
    return content;
  };
  return {rechecks:rechecks.sort((a,b)=>a.recheckAt.localeCompare(b.recheckAt)||a.id.localeCompare(b.id))
    .map(cue=>hydrate(cue.id)),routine:routine.map(cue=>hydrate(cue.id))};
}
