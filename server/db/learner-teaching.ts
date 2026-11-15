import { getDb } from './connection.ts';
import { requireLearnerId } from './learner-context.ts';
import { resolveVocabularyLearnerSenseScope } from './vocabulary-learner-senses.ts';
import { assertTeachingSenseSet, DEFAULT_TEACHING_SET, teachingSenseSetKey } from './teaching-sense-sets.ts';
import { VOCABULARY_PREPARATION_EPOCH } from './preparation-compatibility.ts';

/** Unchosen defaults retain their historical lesson. An explicit choice must be taught exactly. */
export function resolveLearnerTeachingSetKey(wordId: string): string | null {
  const db = getDb();
  const hasChoice = db.prepare(`SELECT 1 FROM learner_senses choice JOIN senses s USING(sense_id,word_id)
    WHERE choice.learner_id=? AND choice.word_id=? AND s.status='active' LIMIT 1`).get(requireLearnerId(),wordId);
  if (!hasChoice) return DEFAULT_TEACHING_SET;
  const scope = resolveVocabularyLearnerSenseScope(wordId);
  if (!scope.inventoryEstablished || !scope.selectionEstablished || !scope.includedSenseIds.length) return null;
  return resolveExactTeachingSetKey(wordId,scope.includedSenseIds);
}

/** The identity of an explicit request is independent of how it can be fulfilled. */
export function resolveExactTeachingSetKey(wordId:string,senseIds:readonly string[]):string {
  const key = teachingSenseSetKey(senseIds);
  assertTeachingSenseSet(wordId,key);
  return key;
}

/** The current default source may fulfill a concrete request if its authored scope matches. */
export function getExactDefaultTeachingSource(wordId:string,key:string):{contentId:string;packageId:string|null}|null {
  if (key === DEFAULT_TEACHING_SET) return null;
  const db=getDb();
  // Reuse the ordinary lesson only when its actual immutable source proves the requested set.
  // Today's default selection alone cannot establish what an older lesson teaches.
  const source = db.prepare(`SELECT p.content_id,d.content_json,
      CASE WHEN lesson.publication_status IN ('shared_trial','available') AND replacement.source_id IS NULL
        THEN package.package_id ELSE NULL END AS package_id
    FROM word_introduction_preparation p
    JOIN word_content_documents d ON d.content_id=p.content_id
    JOIN shared_content_publications publication ON publication.publication_id=d.publication_id
    LEFT JOIN word_teaching_packages package ON package.package_id=p.package_id AND package.content_id=p.content_id
    LEFT JOIN shared_content_publications lesson ON lesson.publication_id=package.publication_id
    LEFT JOIN content_improvement_replacements replacement ON replacement.kind='teaching_package' AND replacement.source_id=package.package_id
    WHERE p.word_id=? AND p.teaching_set_key=? AND p.preparation_epoch>=?
      AND publication.publication_status IN ('shared_trial','available')`)
    .get(wordId,DEFAULT_TEACHING_SET,VOCABULARY_PREPARATION_EPOCH) as {content_id:string;content_json:string;package_id:string|null}|undefined;
  if (!source) return null;
  const mappings = db.prepare(`SELECT m.source_use_id,m.sense_id FROM legacy_sense_imports m
    JOIN senses s ON s.sense_id=m.sense_id
    WHERE m.source_content_id=? AND s.word_id=? AND s.status='active' AND s.version=m.imported_sense_version`)
    .all(source.content_id,wordId) as Array<{source_use_id:string;sense_id:string}>;
  const document = JSON.parse(source.content_json) as {uses:Array<{id:string}>};
  if (mappings.length !== document.uses.length || new Set(mappings.map(row=>row.sense_id)).size !== mappings.length
    || !document.uses.every(use=>mappings.some(row=>row.source_use_id===use.id))
    || !mappings.length || teachingSenseSetKey(mappings.map(row=>row.sense_id)) !== key) return null;
  return {contentId:source.content_id,packageId:source.package_id};
}
