import type { VocabularyContent } from '../../src/domain/vocabulary-content.ts';
import type { VocabularyEncounterEvidence } from '../../src/domain/vocabulary-session.ts';
import { getDb } from './connection.ts';
import { canonicalVocabularyCaseId } from './vocabulary-case-reviews.ts';
import { resolveSharedDictionaryBaselineRevision } from './dictionary-baseline-sharing.ts';

/** A missing source or missing evidence is unknown, not proof of supersession. */
export function isVocabularyCaseSourceSuperseded(caseId:string, jobId?:string):boolean {
  const db=getDb(), id=canonicalVocabularyCaseId(caseId);
  const row=db.prepare(`SELECT c.kind,c.evidence_snapshot_json,j.reassessment_source_json
    FROM reflection_cases c LEFT JOIN vocabulary_reflection_jobs j ON j.job_id=coalesce(?,
      (SELECT job_id FROM vocabulary_reflection_jobs WHERE review_case_id=? ORDER BY case_sequence DESC LIMIT 1))
    WHERE c.case_id=?`).get(jobId??null,id,id) as {kind:string;evidence_snapshot_json:string;reassessment_source_json:string|null}|undefined;
  if(!row||row.kind!=='exercise_improvement')return false;
  let source:VocabularyContent;
  if(row.reassessment_source_json)source=JSON.parse(row.reassessment_source_json) as VocabularyContent;
  else {
    const encounter=(JSON.parse(row.evidence_snapshot_json) as VocabularyEncounterEvidence[])[0];
    if(!encounter)return false;
    const historical=db.prepare('SELECT snapshot_json FROM content_revision_history WHERE content_id=? AND version=?')
      .get(encounter.snapshot.contentId,encounter.snapshot.contentVersion) as {snapshot_json:string}|undefined;
    if(!historical)return false;
    source=resolveSharedDictionaryBaselineRevision(db,JSON.parse(historical.snapshot_json) as VocabularyContent);
  }
  const current=db.prepare('SELECT version,availability FROM content_items WHERE content_id=?').get(source.contentId) as {version:number;availability:string}|undefined;
  return !!current&&(current.version>source.version||current.availability==='retired');
}
