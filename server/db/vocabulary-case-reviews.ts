import { getDb } from './connection.ts';
import type { VocabularyCaseReview } from '../../src/domain/vocabulary-reflection.ts';

export class VocabularyReflectionConflict extends Error {}
/** The exact assessment source is known to have been replaced or revised. */
export class VocabularyReflectionSourceConflict extends VocabularyReflectionConflict {}
export function canonicalVocabularyCaseId(caseId:string):string {
  return (getDb().prepare('SELECT case_id FROM vocabulary_case_lineage WHERE member_case_id=?').get(caseId) as {case_id:string}|undefined)?.case_id??caseId;
}
/** A reassessment remains pending until it succeeds or the operator abandons it. */
export const pendingReassessmentSql = (job:string) => `(${job}.reassessment_source_job_id IS NOT NULL AND ${job}.second_opinion_json IS NULL
  AND (${job}.status IN ('queued','running','failed') OR (${job}.status='succeeded' AND json_array_length(${job}.result_json,'$.input.responseIdentityOptions')>0))
  AND NOT EXISTS (SELECT 1 FROM backend_events abandoned WHERE abandoned.job_id=${job}.job_id AND abandoned.name='vocabulary.reflection.reassessment_abandoned'))`;
export function pendingVocabularyReassessment(caseId:string):{jobId:string;status:string;sourceJobId:string}|null {
  return (getDb().prepare(`SELECT j.job_id AS jobId,j.status,j.reassessment_source_job_id AS sourceJobId FROM vocabulary_reflection_jobs j
    WHERE j.job_id=(SELECT latest.job_id FROM vocabulary_reflection_jobs latest WHERE latest.review_case_id=? ORDER BY latest.case_sequence DESC,latest.created_at DESC,latest.job_id DESC LIMIT 1)
    AND ${pendingReassessmentSql('j')}`).get(canonicalVocabularyCaseId(caseId)) as {jobId:string;status:string;sourceJobId:string}|undefined)??null;
}
export function getVocabularyCaseReview(caseId:string):VocabularyCaseReview|null {
  const id=canonicalVocabularyCaseId(caseId);
  const row=getDb().prepare(`SELECT case_id AS caseId,state,version,current_job_id AS currentJobId,current_proposal_id AS currentProposalId,approval_request_id AS approvalRequestId,approval_state AS approvalState,created_at AS createdAt,resolved_at AS resolvedAt FROM vocabulary_case_reviews WHERE case_id=?`).get(id) as Omit<VocabularyCaseReview,'activeJob'|'frozen'>|undefined;
  if(!row)return null;
  const activeJob=getDb().prepare(`SELECT job_id AS jobId,case_sequence AS sequence,status,reassessment_source_job_id IS NOT NULL AND second_opinion_json IS NULL AS replacing FROM vocabulary_reflection_jobs WHERE review_case_id=? AND status IN ('queued','running')`).get(id) as {jobId:string;sequence:number;status:'queued'|'running';replacing:number}|undefined;
  return {...row,activeJob:activeJob?{jobId:activeJob.jobId,sequence:activeJob.sequence,status:activeJob.status}:null,frozen:!!pendingVocabularyReassessment(id)};
}
export function assertVocabularyCaseEditable(caseId:string|null,approval?:{requestId:string;proposalId:string}):void {
  const review=caseId?getVocabularyCaseReview(caseId):null;
  if(review?.frozen)throw new VocabularyReflectionConflict('This case is frozen until reassessment succeeds or is abandoned');
  if(review?.approvalState==='pending'&&(!approval||review.approvalRequestId!==approval.requestId||review.currentProposalId!==approval.proposalId))throw new VocabularyReflectionConflict('Case approval is queued or running');
}
export function assertVocabularyCaseCanQueue(caseId:string,continuePending=false):void {
  const review=getVocabularyCaseReview(caseId);
  if(!review)throw new Error('Unknown improvement review case');
  if(review.state==='resolved')throw new VocabularyReflectionConflict('This case is resolved');
  if(review.activeJob)throw new VocabularyReflectionConflict('A case job is already queued or running');
  if(review.frozen&&!continuePending)throw new VocabularyReflectionConflict('Finish or abandon the pending reassessment first');
  if(review.approvalState==='pending')throw new VocabularyReflectionConflict('Case approval is queued or running');
}
export function touchVocabularyCaseReview(caseId:string):void {
  const changed=getDb().prepare('UPDATE vocabulary_case_reviews SET version=version+1 WHERE case_id=?').run(canonicalVocabularyCaseId(caseId));
  if(changed.changes!==1)throw new Error('Missing review case');
}
/** Select retained unresolved alternatives before declaring a case resolved. */
export function resolveVocabularyCaseProposal(caseId:string,at:string,resolvedProposalId?:string):void {
  const id=canonicalVocabularyCaseId(caseId);
  const pending=getDb().prepare(`SELECT p.proposal_id FROM content_proposals p JOIN vocabulary_case_lineage l ON l.member_case_id=p.case_id WHERE l.case_id=? AND p.status NOT IN ('applied','closed') ORDER BY p.created_at,p.proposal_id LIMIT 1`).get(id) as {proposal_id:string}|undefined;
  const current=getVocabularyCaseReview(id);
  const identityPending=!!getDb().prepare(`SELECT 1 FROM vocabulary_case_reviews r JOIN reflection_cases c ON c.case_id=r.case_id JOIN vocabulary_reflection_jobs j ON j.job_id=r.current_job_id WHERE r.case_id=? AND c.status!='closed' AND json_array_length(j.result_json,'$.input.responseIdentityOptions')>0`).get(id);
  const open=!!pending||identityPending;
  getDb().prepare('UPDATE vocabulary_case_reviews SET current_proposal_id=?,state=?,resolved_at=?,approval_request_id=NULL,approval_state=NULL,version=version+1 WHERE case_id=?').run(pending?.proposal_id??(open?null:resolvedProposalId??current?.currentProposalId??null),open?'open':'resolved',open?null:at,id);
}
export function setVocabularyCaseApprovalPending(proposalId:string,requestId:string,pending:boolean):void {
  const row=getDb().prepare('SELECT case_id FROM content_proposals WHERE proposal_id=?').get(proposalId) as {case_id:string|null}|undefined;
  if(!row)throw new Error('Unknown vocabulary content proposal');
  if(!row.case_id)return;
  const id=canonicalVocabularyCaseId(row.case_id);
  if(pending){const review=getVocabularyCaseReview(id);if(review?.approvalRequestId===requestId&&review.approvalState==='pending')return;if(review?.approvalState==='pending')throw new VocabularyReflectionConflict('Another case approval is queued or running');assertVocabularyCaseEditable(id);getDb().prepare("UPDATE vocabulary_case_reviews SET approval_request_id=?,approval_state='pending',current_proposal_id=?,version=version+1 WHERE case_id=?").run(requestId,proposalId,id);}
  else getDb().prepare('UPDATE vocabulary_case_reviews SET approval_request_id=NULL,approval_state=NULL,version=version+1 WHERE case_id=? AND approval_request_id=?').run(id,requestId);
}

/** The single durable approval journal owns pending authority; discard orphan pre-append intents. */
export function reconcileVocabularyCaseApprovals(items:{proposalId:string;expectedVersion:number;requestId:string;status:string}[]):void {
  const active=items.filter(item=>item.status==='queued'||item.status==='running');
  const retained=new Set(active.map(item=>item.requestId));
  const locks=getDb().prepare('SELECT case_id,approval_request_id FROM vocabulary_case_reviews WHERE approval_request_id IS NOT NULL').all() as {case_id:string;approval_request_id:string}[];
  for(const lock of locks)if(!retained.has(lock.approval_request_id))getDb().prepare('UPDATE vocabulary_case_reviews SET approval_request_id=NULL,approval_state=NULL,version=version+1 WHERE case_id=?').run(lock.case_id);
  for(const item of active)setVocabularyCaseApprovalPending(item.proposalId,item.requestId,true);
  for(const item of items.filter(item=>item.status==='attention')){const proposal=getDb().prepare('SELECT case_id,version,status FROM content_proposals WHERE proposal_id=?').get(item.proposalId) as {case_id:string|null;version:number;status:string}|undefined;if(proposal?.case_id&&proposal.version===item.expectedVersion&&!['closed','applied'].includes(proposal.status)){const review=getVocabularyCaseReview(proposal.case_id);if(review?.approvalState!=='pending'&&review?.currentProposalId===item.proposalId)setVocabularyCaseApprovalAttention(item.proposalId,item.requestId);}}
}

export function setVocabularyCaseApprovalAttention(proposalId:string,requestId:string):void {
 const row=getDb().prepare('SELECT case_id FROM content_proposals WHERE proposal_id=?').get(proposalId) as {case_id:string|null}|undefined;if(!row)throw new Error('Unknown vocabulary content proposal');if(!row.case_id)return;
 getDb().prepare("UPDATE vocabulary_case_reviews SET approval_request_id=?,approval_state='attention',version=version+1 WHERE case_id=? AND (approval_state IS NULL OR approval_state='attention' OR approval_request_id=?)").run(requestId,canonicalVocabularyCaseId(row.case_id),requestId);
}
export function clearVocabularyCaseApprovalAttention(caseId:string):void {
 getDb().prepare("UPDATE vocabulary_case_reviews SET approval_request_id=NULL,approval_state=NULL,version=version+1 WHERE case_id=? AND approval_state='attention'").run(canonicalVocabularyCaseId(caseId));
}
