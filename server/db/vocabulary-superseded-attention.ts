import type { VocabularyActor } from '../../src/domain/vocabulary-content.ts';
import { getDb } from './connection.ts';
import { emitBackendEvent } from './vocabulary-content.ts';

/** Called inside the application transaction, after the source revisions are written. */
export function resolveSupersededAttentionCases(sourceIds:string[], originatingCaseId:string|null, applicationId:string, actor:VocabularyActor, at:string):void {
  const db=getDb();
  if(!db.isTransaction)throw new Error('Superseded case resolution requires an application transaction');
  const ids=[...new Set(sourceIds)];
  if(!ids.length)return;
  // Match the case's actual source, not every case for the same word. Reviewable,
  // deferred, active and approval-pending cases have their own destinations.
  const cases=db.prepare(`SELECT r.case_id,c.content_id FROM vocabulary_case_reviews r
    JOIN reflection_cases c ON c.case_id=r.case_id
    WHERE r.state='open' AND c.kind='exercise_improvement' AND c.content_id IN (SELECT value FROM json_each(?))
      AND r.case_id IS NOT ? AND r.current_job_id IS NULL AND r.current_proposal_id IS NULL
      AND r.approval_state IS NULL AND r.deferred_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM vocabulary_reflection_jobs j WHERE (j.review_case_id=r.case_id OR j.case_id=r.case_id) AND j.status IN ('queued','running'))
      AND NOT EXISTS (SELECT 1 FROM content_proposals p JOIN vocabulary_case_lineage l ON l.member_case_id=p.case_id WHERE l.case_id=r.case_id AND p.status NOT IN ('closed','applied'))`).all(JSON.stringify(ids),originatingCaseId) as {case_id:string;content_id:string}[];
  for(const item of cases){
    db.prepare("UPDATE reflection_cases SET status='closed' WHERE case_id=?").run(item.case_id);
    db.prepare("UPDATE vocabulary_case_reviews SET state='resolved',resolved_at=?,version=version+1 WHERE case_id=?").run(at,item.case_id);
    emitBackendEvent({name:'vocabulary.reflection.case_source_superseded',entityKind:'reflection',entityId:item.case_id,
      actorKind:actor.kind,actorId:actor.id,occurredAt:at,data:{sourceContentId:item.content_id,applicationId,reason:'Source superseded by an applied proposal.'}});
  }
}
