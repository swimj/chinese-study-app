import { getVocabularyWordSenseCoverage } from '../db/vocabulary-sense-coverage.ts';
import type { VocabularyJson } from '../../src/domain/vocabulary-content.ts';
import { getDb } from '../db/connection.ts';
import { requireLearnerId } from '../db/learner-context.ts';
import { listVocabularyExercises } from '../db/vocabulary-content.ts';
import { isVocabularyDefinitionFallback } from '../../src/domain/vocabulary-production-coverage.ts';
import { allowsProductionUnderProxyPolicy, isProductionProxied } from '../../src/domain/production-proxy.ts';

function object(value: VocabularyJson): Record<string, VocabularyJson> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

/** Shared repertoire property, independent of learner deactivation, adoption and cue scheduling. */
export function isVocabularyProductionProxied(wordId: string): boolean {
  const pure = getDb().prepare(`SELECT 1 FROM exercise_answer_words a
    JOIN content_items c ON c.content_id = a.exercise_id
    WHERE a.word_id = ? AND c.kind = 'exercise' AND c.exercise_type = 'pure_cue'
      AND c.exercise_role = 'general' AND c.access_scope = 'shared' AND c.availability = 'active'
    LIMIT 1`).get(wordId);
  const targeted = pure ? getDb().prepare(`SELECT c.body_json,w.sense_id FROM content_words w
    JOIN content_items c USING(content_id)
    WHERE w.word_id = ? AND w.relation = 'target' AND c.kind = 'exercise'
      AND c.exercise_role = 'general' AND c.skill = 'production'
      AND c.exercise_type NOT IN ('pure_cue', 'contrast')
      AND COALESCE(json_extract(c.assessment_json, '$.responseMode'), '') != 'word_choice'
      AND c.access_scope = 'shared' AND c.availability = 'active'`).all(wordId) as { body_json: string;sense_id:string|null }[] : [];
  const excluded=new Set(getVocabularyWordSenseCoverage(wordId).excludedSenseIds);
  return isProductionProxied({
    hasSharedPureCue: Boolean(pure),
    hasSharedTargetedCue: targeted.some((row) => (row.sense_id===null||!excluded.has(row.sense_id))&&!isVocabularyDefinitionFallback({ body: JSON.parse(row.body_json) as VocabularyJson })),
  });
}

/** A proxied review objective can still use an owned targeted cue, never dictionary fallback. */
export function canServeVocabularyReviewProduction(wordId: string, mode: 'practice' | 'maintain'): boolean {
  const proxied = isVocabularyProductionProxied(wordId);
  const hasUsableTargetedCue = proxied && listVocabularyExercises({ wordId, mode }).some((content) => content.kind === 'exercise'
    && content.skill === 'production' && content.exerciseType !== 'pure_cue' && content.exerciseType !== 'contrast'
    && object(content.assessment).responseMode !== 'word_choice'
    && !isVocabularyDefinitionFallback(content)
    && !getDb().prepare('SELECT 1 FROM learner_content_deactivations WHERE learner_id = ? AND content_id = ?')
      .get(requireLearnerId(), content.contentId));
  return allowsProductionUnderProxyPolicy({ proxied, hasUsableTargetedCue });
}
