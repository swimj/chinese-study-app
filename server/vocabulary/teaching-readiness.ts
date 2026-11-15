import { DEFAULT_TEACHING_SET } from '../db/teaching-sense-sets.ts';
import { getExactDefaultTeachingSource, resolveLearnerTeachingSetKey } from '../db/learner-teaching.ts';
import { isVocabularySessionWordEligible } from '../db/vocabulary-sense-eligibility.ts';
import { isSenseContentReconciliationPending } from '../db/sense-content-reconciliation-state.ts';
import { isCompatibleVocabularyIntroduction } from '../db/preparation-compatibility.ts';
import type { VocabularyContent } from '../../src/domain/vocabulary-content.ts';
import { getDb } from '../db/connection.ts';
import { requireLearnerId } from '../db/learner-context.ts';
import { getVocabularyContent, getVocabularyTeachingExercises } from '../db/vocabulary-content.ts';
import { canEnsureVocabularySensesFromBootstrap, VocabularySenseReadinessError } from './sense-readiness.ts';
import { getDictionaryBaseline } from './dictionary-baseline.ts';

export function skillEnabled(wordId:string,skill:'recognition'|'production'|'contextual_selection'):boolean {
  const disabled=getDb().prepare('SELECT enabled FROM learner_owned_word_skill_state WHERE learner_id=? AND word_id=? AND skill_id=?')
    .get(requireLearnerId(),wordId,skill) as {enabled:number}|undefined;
  const relevance=getDb().prepare('SELECT relevance_state FROM learner_owned_word_skill_relevance WHERE learner_id=? AND word_id=? AND skill_id=?')
    .get(requireLearnerId(),wordId,skill) as {relevance_state:string}|undefined;
  return disabled?.enabled!==0&&relevance?.relevance_state!=='suppressed';
}
export function eligible(content:VocabularyContent):boolean {
  return content.availability==='active'&&!content.words.some(word=>isSenseContentReconciliationPending(word.wordId))
    &&(content.accessScope==='shared'||content.ownerLearnerId===requireLearnerId())
    &&(content.kind!=='exercise'||content.answers.every(answer=>isVocabularySessionWordEligible(answer.wordId)&&!isSenseContentReconciliationPending(answer.wordId)))
    &&!getDb().prepare('SELECT 1 FROM learner_content_deactivations WHERE learner_id=? AND content_id=?').get(requireLearnerId(),content.contentId)
;
}
export function introductions(wordId:string,newest=false,teachingSetKey=resolveLearnerTeachingSetKey(wordId)):VocabularyContent[] {
  if (teachingSetKey === null) return [];
  const exactDefault = getExactDefaultTeachingSource(wordId,teachingSetKey);
  return (getDb().prepare(`SELECT c.content_id FROM content_items c JOIN content_words w USING(content_id)
    WHERE w.word_id=? AND w.relation='target' AND c.kind='introduction' ORDER BY ${newest?'c.updated_at DESC,c.content_id DESC':'c.created_at,c.content_id'}`).all(wordId) as {content_id:string}[])
    .map((row)=>getVocabularyContent(row.content_id)).filter((content):content is VocabularyContent=>content!==null&&eligible(content)&&introductionUsesTeachingSet(wordId,content.body,teachingSetKey,exactDefault));
}
function introductionUsesTeachingSet(wordId:string,body:unknown,teachingSetKey:string,exactDefault:ReturnType<typeof getExactDefaultTeachingSource>):boolean {
  if (!body || typeof body !== 'object' || Array.isArray(body) || !('sourcePackageId' in body)) return teachingSetKey === DEFAULT_TEACHING_SET;
  if (exactDefault?.packageId && body.sourcePackageId === exactDefault.packageId
    && 'bootstrapContentId' in body && body.bootstrapContentId === exactDefault.contentId) return true;
  return Boolean(getDb().prepare(`SELECT 1 FROM word_teaching_packages p JOIN word_content_documents d ON d.content_id=p.content_id
    WHERE p.word_id=? AND p.package_id=? AND d.teaching_set_key=?`).get(wordId,String(body.sourcePackageId),teachingSetKey));
}
export function compatibleIntroductions(wordId:string,newest=false,teachingSetKey=resolveLearnerTeachingSetKey(wordId)):VocabularyContent[] {
  if (teachingSetKey === null) return [];
  return introductions(wordId,newest,teachingSetKey).filter(content=>isCompatibleVocabularyIntroduction(wordId,content.body,teachingSetKey)
    || (teachingSetKey !== DEFAULT_TEACHING_SET && isCompatibleVocabularyIntroduction(wordId,content.body)));
}
export type ResolvedVocabularyTeaching = {intro:VocabularyContent;exercises:VocabularyContent[]};
/** Resolve current coherent material only; compatibility refresh and generation belong to maintenance. */
export function resolveVocabularyTeaching(wordId:string,teachingSetKey=resolveLearnerTeachingSetKey(wordId)):ResolvedVocabularyTeaching|null {
  if (teachingSetKey === null) return null;
  if(!isVocabularySessionWordEligible(wordId)||isSenseContentReconciliationPending(wordId))return null;
  try {if(!canEnsureVocabularySensesFromBootstrap(wordId))return null;}
  catch(error){if(error instanceof VocabularySenseReadinessError)return null;throw error;}
  const baselineRecognition=getDictionaryBaseline(wordId,'recognition','teaching');
  for(const intro of compatibleIntroductions(wordId,true,teachingSetKey)) {
    const exercises=getVocabularyTeachingExercises(intro.contentId).filter((entry)=>eligible(entry)&&entry.kind==='exercise'&&(entry.skill==='recognition'||entry.skill==='production'));
    if(exercises.some((entry)=>entry.kind==='exercise'&&entry.skill==='production')
      &&(exercises.some((entry)=>entry.kind==='exercise'&&entry.skill==='recognition')||baselineRecognition===null||eligible(baselineRecognition)))return {intro,exercises};
  }
  return null;
}
export function teachingReady(wordId:string,teachingSetKey=resolveLearnerTeachingSetKey(wordId)):boolean {return resolveVocabularyTeaching(wordId,teachingSetKey)!==null;}
