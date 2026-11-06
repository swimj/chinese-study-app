import type { VocabularyAttentionItem,VocabularyAttentionPage,VocabularyAttentionQuery } from '../../src/domain/vocabulary-attention.ts';
import type { VocabularyApprovalRequest,VocabularyReflectionCase } from '../../src/domain/vocabulary-reflection.ts';
import { isOperatorSubject,parseOperatorAllowlist } from '../operator-access.ts';
import { config,getDb } from './connection.ts';
import { getVocabularyDefaultSelectionFinding } from './vocabulary-sense-coverage.ts';
import { getVocabularyCaseCard,vocabularyReviewQueueEligibilitySql } from './vocabulary-case-queue.ts';

type PreparationFailure = {workId:string;wordId:string;sourceContentId:string;attemptCount:number;invocationId:string|null;lastError:string|null;retryable:boolean};
type Dependencies = {approvals:VocabularyApprovalRequest[];preparationFailure:(workId:string)=>PreparationFailure};
type Candidate = {id:string;kind:VocabularyAttentionItem['kind'];sourceId:string;title:string;createdAt:string;caseId:string|null};

/** Only identities and labels are scanned; authored content, encounters and job results are loaded on demand. */
export function listVocabularyAttention(actorId:string,input:VocabularyAttentionQuery,dependencies:Dependencies):VocabularyAttentionPage {
  if(!isOperatorSubject(actorId,parseOperatorAllowlist(),config.authMode))throw new Error('Operator access required');
  let offset=input.offset??0;
  const limit=input.limit??20;
  if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>50
    ||input.anchorId!==undefined&&(typeof input.anchorId!=='string'||!input.anchorId||input.anchorId.length>250)
    ||input.kind!==undefined&&!['defaults','approval','preparation','dispatch','case'].includes(input.kind))throw new TypeError('Invalid attention queue query');
  const db=getDb();
  // The approval journal is authoritative for requests; SQLite remains authoritative for their current proposal.
  const approvals=dependencies.approvals.filter(request=>request.status==='attention').map(({requestId,proposalId,expectedVersion,createdAt})=>({requestId,proposalId,expectedVersion,createdAt}));
  const candidates=`WITH attention AS (
    SELECT 'defaults:'||d.word_id AS id,'defaults' AS kind,d.word_id AS sourceId,w.hanzi AS title,d.created_at AS createdAt,coalesce(l.case_id,j.case_id) AS caseId
      FROM vocabulary_default_selection_readiness d JOIN lexical_words w ON w.id=d.word_id
      LEFT JOIN vocabulary_word_sense_coverage coverage ON coverage.word_id=d.word_id
      LEFT JOIN vocabulary_reflection_jobs j ON j.job_id=d.workflow_id LEFT JOIN vocabulary_case_lineage l ON l.member_case_id=j.case_id
      WHERE d.status='failed' AND coverage.default_useful_sense_ids_json IS NULL
    UNION ALL
    SELECT 'approval:'||json_extract(a.value,'$.requestId'),'approval',json_extract(a.value,'$.requestId'),coalesce(w.hanzi,'Content application'),json_extract(a.value,'$.createdAt'),coalesce(l.case_id,p.case_id)
      FROM json_each(?) a LEFT JOIN content_proposals p ON p.proposal_id=json_extract(a.value,'$.proposalId')
      LEFT JOIN vocabulary_case_lineage l ON l.member_case_id=p.case_id LEFT JOIN reflection_cases c ON c.case_id=coalesce(l.case_id,p.case_id)
      LEFT JOIN lexical_words w ON w.id=c.word_id
      WHERE p.proposal_id IS NULL OR (p.version<=json_extract(a.value,'$.expectedVersion') AND p.status NOT IN ('closed','applied'))
    UNION ALL
    SELECT 'preparation:'||p.work_id,'preparation',p.work_id,w.hanzi,p.created_at,NULL
      FROM vocabulary_practice_preparation p JOIN lexical_words w ON w.id=p.word_id WHERE p.status='failed'
    UNION ALL
    SELECT 'dispatch:'||d.dispatch_id,'dispatch',d.dispatch_id,'Session evidence',d.created_at,NULL
      FROM vocabulary_post_session_dispatches d WHERE d.status='failed'
    UNION ALL
    SELECT 'case:'||c.case_id,'case',c.case_id,coalesce(w.hanzi,CASE c.kind WHEN 'learner_feedback' THEN 'Learner feedback' ELSE 'Content review' END),c.created_at,c.case_id
      FROM reflection_cases c LEFT JOIN vocabulary_case_reviews r ON r.case_id=c.case_id LEFT JOIN lexical_words w ON w.id=c.word_id
      WHERE ((c.kind='learner_feedback' AND c.status='open') OR (c.kind!='learner_feedback' AND coalesce(r.state,c.status)='open'))
      AND NOT EXISTS (SELECT 1 FROM vocabulary_case_lineage child WHERE child.member_case_id=c.case_id AND child.case_id!=c.case_id)
      AND NOT coalesce((${vocabularyReviewQueueEligibilitySql}),0)
      AND coalesce(r.approval_state,'')!='pending'
      AND r.deferred_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM vocabulary_reflection_jobs active WHERE (active.review_case_id=c.case_id OR active.case_id=c.case_id) AND active.status IN ('queued','running'))
      AND NOT EXISTS (SELECT 1 FROM content_proposals cp JOIN json_each(?) a ON cp.proposal_id=json_extract(a.value,'$.proposalId')
        LEFT JOIN vocabulary_case_lineage lineage ON lineage.member_case_id=cp.case_id
        WHERE coalesce(lineage.case_id,cp.case_id)=c.case_id AND cp.version<=json_extract(a.value,'$.expectedVersion') AND cp.status NOT IN ('closed','applied'))
  )`;
  const args=[JSON.stringify(approvals),JSON.stringify(approvals),input.kind??null,input.kind??null];
  const filter='WHERE (? IS NULL OR kind=?)';
  const total=Number(db.prepare(`${candidates} SELECT count(*) AS total FROM attention ${filter}`).get(...args)!.total);
  if(input.anchorId){
    const anchor=db.prepare(`${candidates} SELECT position FROM (SELECT id,row_number() OVER (ORDER BY createdAt,id)-1 AS position FROM attention ${filter}) WHERE id=?`).get(...args,input.anchorId) as {position:number}|undefined;
    if(anchor)offset=Math.floor(anchor.position/limit)*limit;
  }
  const rows=db.prepare(`${candidates} SELECT * FROM attention ${filter} ORDER BY createdAt,id LIMIT ? OFFSET ?`).all(...args,limit,offset) as Candidate[];
  const items=rows.map((row):VocabularyAttentionItem=>{
    const base={id:row.id,title:row.title,createdAt:row.createdAt,caseId:row.caseId};
    switch(row.kind){
      case 'defaults': {
        const finding=getVocabularyDefaultSelectionFinding(row.sourceId);if(!finding)throw new Error('Attention finding changed during synchronous read');
        return {...base,kind:'defaults',wordId:row.sourceId,finding,reason:finding.reason};
      }
      case 'approval': {
        const request=dependencies.approvals.find(item=>item.requestId===row.sourceId);if(!request)throw new Error('Missing approval request');
        const proposal=db.prepare(`SELECT p.version,p.status,
          EXISTS(SELECT 1 FROM proposal_content_bases b LEFT JOIN content_items source ON source.content_id=b.content_id WHERE b.proposal_id=p.proposal_id AND (source.version IS NULL OR source.version!=b.expected_content_version)) AS stale,
          EXISTS(SELECT 1 FROM vocabulary_case_lineage l JOIN vocabulary_case_repair_targets target ON target.case_id=l.case_id WHERE l.member_case_id=p.case_id AND target.pending_sense_id IS NOT NULL) AS pendingTarget
          FROM content_proposals p WHERE p.proposal_id=?`).get(request.proposalId) as {version:number;status:string;stale:number;pendingTarget:number}|undefined;
        const review=row.caseId&&db.prepare('SELECT 1 FROM vocabulary_case_reviews WHERE case_id=?').get(row.caseId)?getVocabularyCaseCard(row.caseId,actorId,request.proposalId):null;
        const retryable=(!review||(review.state==='open'&&!review.activeJob&&!review.stale))&&!!proposal&&proposal.version===request.expectedVersion&&!['closed','applied'].includes(proposal.status)&&!proposal.stale&&!proposal.pendingTarget&&request.actorId===actorId;
        return {...base,kind:'approval',requestId:request.requestId,proposalId:request.proposalId,expectedVersion:request.expectedVersion,attempts:request.attempts,retryable,reason:request.error??'The approved revision could not be applied.'};
      }
      case 'preparation': {
        const failure=dependencies.preparationFailure(row.sourceId);
        return {...base,kind:'preparation',workId:failure.workId,wordId:failure.wordId,sourceContentId:failure.sourceContentId,attemptCount:failure.attemptCount,invocationId:failure.invocationId,retryable:failure.retryable,reason:failure.lastError??'Practice preparation failed.'};
      }
      case 'dispatch': {
        const dispatch=db.prepare('SELECT learner_id AS learnerId,session_id AS sessionId,last_error AS error FROM vocabulary_post_session_dispatches WHERE dispatch_id=?').get(row.sourceId) as {learnerId:string;sessionId:string;error:string|null};
        return {...base,kind:'dispatch',dispatchId:row.sourceId,learnerId:dispatch.learnerId,sessionId:dispatch.sessionId,reason:dispatch.error??'Session evidence could not be processed.'};
      }
      case 'case': {
        const record=db.prepare('SELECT kind FROM reflection_cases WHERE case_id=?').get(row.sourceId) as {kind:VocabularyReflectionCase['kind']};
        const job=db.prepare(`SELECT job_id AS jobId,status,last_error AS error FROM vocabulary_reflection_jobs WHERE review_case_id=? OR case_id=? ORDER BY case_sequence DESC,created_at DESC,job_id DESC LIMIT 1`).get(row.sourceId,row.sourceId) as {jobId:string;status:string;error:string|null}|undefined;
        return {...base,kind:'case',caseId:row.sourceId,caseKind:record.kind,jobId:job?.status==='failed'?job.jobId:null,retryable:job?.status==='failed'&&job.error!=='source_conflict',reason:job?.status==='failed'?job.error??'Processing failed.':'This case has no completed assessment or proposal.'};
      }
    }
  });
  return {items,total,offset};
}
