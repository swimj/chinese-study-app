import { getDb } from '../db/connection.ts';
import { requireLearnerId } from '../db/learner-context.ts';
import { getDietProfile, getStashDietSplit, resolveEffectiveDietWeights } from '../db/diet-profile.ts';
import { getResolvedDeckWordIds } from '../db/deck-words.ts';
import { loadDeckManifest, getTailDeckId, type DeckManifest } from '../decks/manifest.ts';
import { buildUnstudiedAdmissionSeedSource, assertUnstudiedAdmissionSource, planUnstudiedStashAdmission,
  selectAdmittedUnstudiedWordIds, planDeckDietTargets, selectDeckDietWordIds, type UnstudiedStashCandidate } from '../db/unstudied-admission.ts';
import { DEFAULT_DAILY_NEW_WORD_LIMIT, PRIORITY_TIER_TOP } from '../db/types.ts';
import { isStudyIntroductionOrder, isStudyIntroductionSpacing, DEFAULT_INTRODUCTION_SPACING, type StudyIntroductionOrder } from '../../src/domain/introduction-order.ts';
import { allocateSessionBucketSlots, MAX_SESSION_ITEMS } from '../../src/domain/session-limits.ts';
import { selectVocabularyReviewSkills, type VocabularyReviewSelection, type VocabularyReviewSkill } from './review-selection.ts';

export const VOCABULARY_COMPOSITION_POLICY = { maxSessionWords: MAX_SESSION_ITEMS, maxPreparationDemand: 40 } as const;
export type VocabularyCompositionSettings = { introductionOrder: StudyIntroductionOrder; introductionSpacing: number };
export type VocabularyComposition = { newWordIds: string[]; dueWordIds: string[]; reviewSelections: VocabularyReviewSelection[]; settings: VocabularyCompositionSettings; requestedPreparationWordIds: string[]; remainingNewWordQuota: number };
function setting(name: string): unknown {
  const row = getDb().prepare('SELECT value_json FROM learner_settings WHERE learner_id=? AND setting_key=?').get(requireLearnerId(), name) as {value_json:string}|undefined;
  return row ? JSON.parse(row.value_json) as unknown : undefined;
}
export function vocabularyCompositionSettings(): VocabularyCompositionSettings {
  const configuredOrder=setting('study_introduction_order');const oldFirst=setting('study_new_words_first');
  if(oldFirst!==undefined&&typeof oldFirst!=='boolean')throw new Error('Invalid study_new_words_first setting');
  const introductionOrder=configuredOrder??(oldFirst===true?'first':'random');
  const introductionSpacing=setting('study_introduction_spacing')??DEFAULT_INTRODUCTION_SPACING;
  if(!isStudyIntroductionOrder(introductionOrder)||!isStudyIntroductionSpacing(introductionSpacing))throw new Error('Invalid introduction order/spacing setting');
  return {introductionOrder,introductionSpacing};
}
export function remainingVocabularyNewWordQuota(now=new Date().toISOString()):number {
  const configured=setting('daily_new_word_limit')??DEFAULT_DAILY_NEW_WORD_LIMIT;
  if(typeof configured!=='number'||!Number.isInteger(configured)||configured<0||configured>20)throw new Error('Invalid daily_new_word_limit setting');
  const learner=requireLearnerId(),day=now.slice(0,10);
  const legacy=getDb().prepare('SELECT new_study_count FROM learner_owned_daily_new_word_intake WHERE learner_id=? AND day_key=?').get(learner,day) as {new_study_count:number}|undefined;
  const fresh=getDb().prepare("SELECT count(*) AS n FROM teaching_completions WHERE learner_id=? AND source_kind='session' AND substr(completed_at,1,10)=?").get(learner,day) as {n:number};
  return Math.max(0,configured-(legacy?.new_study_count??0)-fresh.n);
}
/** New-model state is the only lifecycle predicate; source material and lexical deck identities can be shared. */
export function composeVocabularyStudy(options:{
  teachingReady:(wordId:string)=>boolean; requestTeaching:(wordId:string)=>void; now?:string; manifest?:DeckManifest|null;
  canUseSkill?: (wordId: string, skillId: VocabularyReviewSkill) => boolean;
}):VocabularyComposition {
  const now=options.now??new Date().toISOString(),learner=requireLearnerId();
  const settings=vocabularyCompositionSettings();const remaining=remainingVocabularyNewWordQuota(now);
  const source=setting('unstudied_admission_source')??'mixed';assertUnstudiedAdmissionSource(source);
  const stashRatio=getStashDietSplit();
  const stash=(getDb().prepare(`SELECT w.word_id AS id,COALESCE(p.updated_at,w.added_at) AS overlayUpdatedAt,
    CASE WHEN p.priority_tier=? THEN 1 ELSE 0 END AS isTop
    FROM learner_words w JOIN learner_word_schedules s USING(learner_id,word_id)
    LEFT JOIN learner_owned_user_word_priority p ON p.learner_id=w.learner_id AND p.word_id=w.word_id
    WHERE w.learner_id=? AND w.mode='unstudied' AND w.in_stash=1 AND w.dismissed_at IS NULL
      AND (s.next_eligible_at IS NULL OR s.next_eligible_at<=?)
      AND COALESCE(json_extract(s.scheduler_state_json,'$.enabled'),1)=1 ORDER BY w.word_id`).all(PRIORITY_TIER_TOP,learner,now) as {id:string;overlayUpdatedAt:string;isTop:number}[])
    .map((entry):UnstudiedStashCandidate=>({...entry,isTop:entry.isTop===1,isRequired:false}));
  const seed=buildUnstudiedAdmissionSeedSource(now.slice(0,10),remaining);
  const readyIds=new Set((remaining>0?getDb().prepare(`SELECT DISTINCT w.word_id FROM content_items c JOIN content_words w USING(content_id)
    WHERE c.kind='introduction' AND c.availability='active' AND w.relation='target'
      AND (c.access_scope='shared' OR c.owner_learner_id=?)`).all(learner) as {word_id:string}[]:[]).map((entry)=>entry.word_id).filter(options.teachingReady));
  const stashPlan=planUnstudiedStashAdmission({stash,remainingQuota:remaining,seedSource:seed,stashRatio,source,eligibleIds:readyIds});
  const candidateRows=source==='mixed'&&stashPlan.dietDemand>0?getDb().prepare(`SELECT l.id FROM lexical_words l
    LEFT JOIN learner_words w ON w.word_id=l.id AND w.learner_id=?
    LEFT JOIN learner_owned_user_word_priority p ON p.word_id=l.id AND p.learner_id=?
    LEFT JOIN learner_word_schedules s ON s.word_id=l.id AND s.learner_id=?
    WHERE (w.word_id IS NULL OR (w.mode='unstudied' AND w.in_stash=0 AND w.dismissed_at IS NULL))
      AND (p.word_id IS NULL OR p.priority_tier>=0)
      AND (s.next_eligible_at IS NULL OR s.next_eligible_at<=?)
      AND COALESCE(json_extract(s.scheduler_state_json,'$.enabled'),1)=1
    ORDER BY l.priority DESC,l.created_at,l.id`).all(learner,learner,learner,now) as {id:string}[]:[];
  const candidateIds=candidateRows.map((entry)=>entry.id);const candidateSet=new Set(candidateIds);
  const requested=new Set<string>();
  const pendingStash=planUnstudiedStashAdmission({stash,remainingQuota:remaining,seedSource:seed,stashRatio,source});
  pendingStash.selectedStashIds.forEach((id)=>{if(!readyIds.has(id))requested.add(id);});
  const manifest=options.manifest===undefined?loadDeckManifest():options.manifest;
  let dietIds:string[]=[];
  if(source==='mixed'&&stashPlan.dietDemand>0) {
    if(manifest) {
      const profile=getDietProfile(manifest);if(!profile)throw new Error('Manifest has no effective diet profile');
      const targets=planDeckDietTargets(stashPlan.dietDemand,resolveEffectiveDietWeights(profile,manifest),manifest.decks.map((deck)=>deck.id));
      const weightedOrders=manifest.decks.filter((deck)=>(targets.get(deck.id)??0)>0).map((deck)=>deck.order);
      const last=Math.max(-1,...weightedOrders);const byDeck=getResolvedDeckWordIds(manifest);let planned=0;let plannedIds:ReadonlySet<string>=new Set();
      dietIds=selectDeckDietWordIds({targets,spillDeckIds:manifest.decks.filter((deck)=>deck.order>last&&deck.id!==getTailDeckId(manifest)).map((deck)=>deck.id),
        loadCandidatesForDeck:(id)=>[...(byDeck.get(id)??[])].filter((wordId)=>candidateSet.has(wordId)),seedSource:seed,limit:stashPlan.dietDemand,eligibleIds:readyIds,
        onPlanned:(count,ids)=>{planned=count;plannedIds=ids;}});
      for(const id of plannedIds)if(!readyIds.has(id))requested.add(id);
      const fallback=candidateIds.filter((id)=>!plannedIds.has(id));
      const fill=Math.max(0,stashPlan.dietDemand-planned);
      dietIds.push(...fallback.filter((id)=>readyIds.has(id)).slice(0,fill));
      fallback.slice(0,fill).forEach((id)=>{if(!readyIds.has(id))requested.add(id);});
    } else {
      dietIds=candidateIds.filter((id)=>readyIds.has(id)).slice(0,stashPlan.dietDemand);
      candidateIds.slice(0,stashPlan.dietDemand).forEach((id)=>{if(!readyIds.has(id))requested.add(id);});
    }
  }
  const newIds=selectAdmittedUnstudiedWordIds({stash,dietIds,remainingQuota:remaining,seedSource:seed,stashRatio,source,eligibleIds:readyIds});
  const learningWordIds=(getDb().prepare(`SELECT w.word_id FROM learner_words w JOIN learner_word_schedules s USING(learner_id,word_id)
    WHERE w.learner_id=? AND w.mode='solidify' AND w.dismissed_at IS NULL
      AND (s.next_eligible_at IS NULL OR s.next_eligible_at<=?)
    ORDER BY w.added_at,w.word_id`).all(learner,now) as {word_id:string}[]).map((row)=>row.word_id)
    .filter((wordId)=>!options.canUseSkill||options.canUseSkill(wordId,'recognition')||options.canUseSkill(wordId,'production'));
  const reviewCandidates=selectVocabularyReviewSkills({now,canUseSkill:options.canUseSkill});
  const slots=allocateSessionBucketSlots({review:reviewCandidates.length,learning:learningWordIds.length,unstudied:newIds.length});
  const newWordIds=newIds.slice(0,slots.unstudied);
  const reviewSelections=reviewCandidates.slice(0,slots.review);
  const selectedDue=[...learningWordIds.slice(0,slots.learning),...reviewSelections.map((entry)=>entry.wordId)];
  const requestedPreparationWordIds=[...requested].slice(0,VOCABULARY_COMPOSITION_POLICY.maxPreparationDemand);
  for(const wordId of requestedPreparationWordIds)options.requestTeaching(wordId);
  return {newWordIds,dueWordIds:selectedDue,reviewSelections,settings,requestedPreparationWordIds,remainingNewWordQuota:remaining};
}
