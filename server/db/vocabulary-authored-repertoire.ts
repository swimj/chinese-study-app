import { getDb } from './connection.ts';
import { getVocabularyContentForMaintenance } from './vocabulary-content.ts';
import { isVocabularyDefinitionFallback } from '../../src/domain/vocabulary-production-coverage.ts';

/** Shared eligibility for interactive bootstrap and automatic preparation; teaching is a separate pool. */
export function authoredVocabularyRepertoire(wordId:string,options:{accessScope?:'shared'|'private';ownerLearnerId?:string|null;excludeContentId?:string}={}) {
  const rows = getDb().prepare(`SELECT DISTINCT c.content_id FROM content_items c
    JOIN exercise_answer_words a ON a.exercise_id=c.content_id AND a.word_id=?
    WHERE c.content_id!=? AND c.kind='exercise' AND c.exercise_role='general' AND c.skill='production'
    AND c.availability='active' AND c.access_scope=? AND c.owner_learner_id IS ?
    AND c.exercise_type!='contrast' AND COALESCE(json_extract(c.assessment_json,'$.responseMode'),'')!='word_choice'
    ORDER BY c.content_id`).all(wordId,options.excludeContentId??'',options.accessScope??'shared',options.ownerLearnerId??null) as {content_id:string}[];
  return rows.map(row => getVocabularyContentForMaintenance(row.content_id))
    .filter(content => content !== null && !isVocabularyDefinitionFallback(content));
}
