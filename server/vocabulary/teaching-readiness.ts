import { isCompatibleVocabularyIntroduction } from '../db/preparation-compatibility.ts';
import type { VocabularyContent } from '../../src/domain/vocabulary-content.ts';
import { getDb } from '../db/connection.ts';
import { requireLearnerId } from '../db/learner-context.ts';
import { getVocabularyContent, getVocabularyTeachingExercises } from '../db/vocabulary-content.ts';
import { canEnsureVocabularySensesFromBootstrap } from './sense-readiness.ts';
import { getDictionaryBaseline } from './dictionary-baseline.ts';

export function skillEnabled(wordId:string,skill:'recognition'|'production'|'contextual_selection'):boolean {
  const disabled=getDb().prepare('SELECT enabled FROM learner_owned_word_skill_state WHERE learner_id=? AND word_id=? AND skill_id=?')
    .get(requireLearnerId(),wordId,skill) as {enabled:number}|undefined;
  const relevance=getDb().prepare('SELECT relevance_state FROM learner_owned_word_skill_relevance WHERE learner_id=? AND word_id=? AND skill_id=?')
    .get(requireLearnerId(),wordId,skill) as {relevance_state:string}|undefined;
  return disabled?.enabled!==0&&relevance?.relevance_state!=='suppressed';
}
function suppressed(wordId:string):boolean {return !skillEnabled(wordId,'production');}
export function eligible(content:VocabularyContent):boolean {
  return content.availability==='active'&&(content.accessScope==='shared'||content.ownerLearnerId===requireLearnerId())
    &&!getDb().prepare('SELECT 1 FROM learner_content_deactivations WHERE learner_id=? AND content_id=?').get(requireLearnerId(),content.contentId)
;
}
export function introductions(wordId:string):VocabularyContent[] {
  return (getDb().prepare(`SELECT c.content_id FROM content_items c JOIN content_words w USING(content_id)
    WHERE w.word_id=? AND w.relation='target' AND c.kind='introduction' ORDER BY c.created_at,c.content_id`).all(wordId) as {content_id:string}[])
    .map((row)=>getVocabularyContent(row.content_id)).filter((content):content is VocabularyContent=>content!==null&&eligible(content));
}
export function compatibleIntroductions(wordId:string):VocabularyContent[] {
  return introductions(wordId).filter(content=>isCompatibleVocabularyIntroduction(wordId,content.body));
}
export function teachingReady(wordId:string):boolean {
  if(!skillEnabled(wordId,'recognition')||suppressed(wordId))return false;
  const baselineRecognition=getDictionaryBaseline(wordId,'recognition','teaching');
  const contentReady=compatibleIntroductions(wordId).some((intro)=>{
    const exercises=getVocabularyTeachingExercises(intro.contentId).filter((entry)=>eligible(entry)&&entry.kind==='exercise'&&skillEnabled(wordId,entry.skill));
    return exercises.some((entry)=>entry.kind==='exercise'&&entry.skill==='production')
      &&(exercises.some((entry)=>entry.kind==='exercise'&&entry.skill==='recognition')||baselineRecognition===null||eligible(baselineRecognition));
  });
  return contentReady&&canEnsureVocabularySensesFromBootstrap(wordId);
}
