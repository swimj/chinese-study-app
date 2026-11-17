import {vocabularyExerciseAnswersEligibleSql} from '../db/vocabulary-sense-eligibility.ts';
import {isSenseContentReconciliationPending} from '../db/sense-content-reconciliation-state.ts';
import {createHash} from 'node:crypto';
import {getDb} from '../db/connection.ts';
import {requireLearnerId} from '../db/learner-context.ts';
import {getVocabularyContent} from '../db/vocabulary-content.ts';
import {dueAtWithResetDelay,pureCueSelectionRole,selectPureCuesForSession,type PureCueSelectionCandidate} from '../../src/domain/pure-cues.ts';
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
  getDb().prepare(`INSERT INTO learner_pure_cue_schedules(learner_id,content_id,next_eligible_at,policy_version,scheduler_state_json,interval_hours,enabled)
    SELECT :learner,c.content_id,:due,'vocabulary-pure-adoption-v1',:state,24,1 FROM content_items c WHERE ${eligibleContent}
    ON CONFLICT(learner_id,content_id) DO NOTHING`).run({learner:requireLearnerId(),due:dueAtWithResetDelay(now),
      state:JSON.stringify({easeFactor:2.5,cleanCoveredSessions:0,adoptedAt:now})});
}
type PureCueSelectionInput={ordinaryReviewCount:number;sessionSeed:string;now?:string;adopt?:boolean};
export function selectVocabularyPureCueCandidates(input:PureCueSelectionInput):VocabularyContent[] {
  const {rechecks,routine}=planVocabularyPureCues(input);
  return [...rechecks,...routine];
}
/** A due recheck or a cue with a routine role; content checks have not run yet. */
export type VocabularyPureCueCandidate = PureCueSelectionCandidate & { recheckAt: string | null };
/**
 * The learner's pure-cue streams before content checks: due rechecks in recheck
 * order, due fragile cues in due order, and strong cues that won today's roll.
 * Its first read is one covering index range over scheduling columns.
 */
export function readVocabularyPureCueStreams(now:string):{rechecks:VocabularyPureCueCandidate[];fragile:VocabularyPureCueCandidate[];strong:VocabularyPureCueCandidate[]} {
  const learner=requireLearnerId();
  const rows=getDb().prepare(`SELECT content_id,next_eligible_at,last_practised_at,strong_since,strong_successes,maintenance_identity,reset_until,recheck_at
    FROM learner_pure_cue_schedules WHERE learner_id=? AND enabled=1`).all(learner) as {content_id:string;next_eligible_at:string|null;last_practised_at:string|null;
      strong_since:string|null;strong_successes:number;maintenance_identity:string|null;reset_until:string|null;recheck_at:string|null}[];
  const cues=rows.map((row):VocabularyPureCueCandidate=>({id:row.content_id,maintenanceIdentity:row.maintenance_identity??undefined,
    active:row.reset_until===null||row.reset_until<=now,lastStudiedAt:row.last_practised_at,nextDueAt:row.next_eligible_at??now,
    strongSince:row.strong_since,strongSuccesses:Number(row.strong_successes),recheckAt:row.recheck_at}));
  const role=(cue:VocabularyPureCueCandidate)=>cue.recheckAt===null?pureCueSelectionRole(learner,cue,now):null;
  return {rechecks:cues.filter(cue=>cue.active&&cue.recheckAt!==null&&cue.recheckAt<=now)
      .sort((a,b)=>a.recheckAt!.localeCompare(b.recheckAt!)||a.id.localeCompare(b.id)),
    fragile:cues.filter(cue=>role(cue)==='fragile').sort((a,b)=>a.nextDueAt.localeCompare(b.nextDueAt)||a.id.localeCompare(b.id)),
    strong:cues.filter(cue=>role(cue)==='strong').sort((a,b)=>a.id.localeCompare(b.id))};
}
/** Per-cue content checks, run only for cues a stream reaches. */
export function vocabularyPureCueUsability():(contentId:string)=>boolean {
  const learner=requireLearnerId();
  const eligible=getDb().prepare(`SELECT 1 FROM content_items c WHERE c.content_id=:id AND ${eligibleContent}`);
  // Reconciliation gates need identities only; body, assessment and accepted forms
  // are loaded after scheduling chooses this cue.
  const related=getDb().prepare(`SELECT word_id FROM content_words WHERE content_id=? UNION SELECT word_id FROM exercise_answer_words WHERE exercise_id=?`);
  return contentId=>eligible.get({id:contentId,learner})!==undefined
    &&(related.all(contentId,contentId) as {word_id:string}[]).every(word=>!isSenseContentReconciliationPending(word.word_id));
}
/** Seeded draw shared by every pure-cue sampling step of one session. */
export function vocabularyPureCueRandom(sessionSeed:string):()=>number {
  let draw=0;return ()=>parseInt(createHash('sha256').update(`${sessionSeed}/${draw++}`).digest('hex').slice(0,8),16)/0x100000000;
}
export function hydrateVocabularyPureCue(id:string):VocabularyContent {
  const content=getVocabularyContent(id);
  if(!content||content.kind!=='exercise')throw new Error('Selected pure cue disappeared');
  return content;
}
/** Untimed planning: every due fragile cue, strong slots scaled to all due review. */
export function planVocabularyPureCues(input:PureCueSelectionInput):{rechecks:VocabularyContent[];routine:VocabularyContent[]} {
  const now=input.now??new Date().toISOString();if(input.adopt!==false)adoptVocabularyPureCues(now);
  const streams=readVocabularyPureCueStreams(now);const usable=vocabularyPureCueUsability();
  const routine=selectPureCuesForSession({learnerId:requireLearnerId(),cues:[...streams.fragile,...streams.strong].filter(cue=>usable(cue.id)),
    ordinaryReviewCount:input.ordinaryReviewCount,now,random:vocabularyPureCueRandom(input.sessionSeed)}).selected;
  return {rechecks:streams.rechecks.filter(cue=>usable(cue.id)).map(cue=>hydrateVocabularyPureCue(cue.id)),
    routine:routine.map(cue=>hydrateVocabularyPureCue(cue.id))};
}
