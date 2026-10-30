import React from 'react';
import {createRoot} from 'react-dom/client';
import {VocabularyOperatorPage} from '../../src/pages/VocabularyOperatorPage';
import type {VocabularyOperatorApi,VocabularyCaseWorkspace} from '../../src/features/vocabulary-operator/api';
import type {VocabularyContent} from '../../src/domain/vocabulary-content';
import type {VocabularyApprovalRequest,VocabularyContentProposal} from '../../src/domain/vocabulary-reflection';
import '../../src/styles.css';
type RecordPreview={proposal:VocabularyContentProposal;original:VocabularyContent;workspace:VocabularyCaseWorkspace;provenance:{artifactId:string;proposalId:string;generatedAt:string;model:string;review:{disposition:string;updated_at:string;acceptance_mode:string};application:unknown;mapping:string;originalOperation:unknown}};
async function main(){
  const response=await fetch('./.local/operator-production-preview.json');
  if(!response.ok)throw new Error('Local production excerpt is not installed. This preview requires a separately retrieved, sanitized record file.');
  const data=await response.json() as {records:RecordPreview[]};
  const records=new Map(data.records.map(record=>[record.proposal.proposalId,record]));
  const proposals=new Map(data.records.map(record=>[record.proposal.proposalId,structuredClone(record.proposal)]));
  function get(id:string){const item=proposals.get(id);if(!item)throw new Error('Unknown local proposal');return item;}
  function update(id:string,patch:Partial<VocabularyContentProposal>){const value={...get(id),...patch};proposals.set(id,value);return value;}
  const approvals:VocabularyApprovalRequest[]=[];
  const unavailableCoverage=async()=>{throw new Error('Historical export does not include editable canonical sense coverage.');};
  const api:VocabularyOperatorApi={
    wordSenseCoverage:unavailableCoverage,caseSenseCoverage:unavailableCoverage,saveDefaultUsefulSenses:unavailableCoverage,saveWordSenseCoverage:unavailableCoverage,saveCaseSenseCoverage:unavailableCoverage,
    approvalRequests:async()=>({items:approvals}),
    requestApproval:async(id,expectedVersion,requestId,notes)=>{const now=new Date().toISOString();const item:VocabularyApprovalRequest={requestId,proposalId:id,expectedVersion,actorId:'local-preview',notes,status:'queued',attempts:0,createdAt:now,updatedAt:now,error:null,application:null};approvals.push(item);setTimeout(()=>{const proposal=update(id,{status:'applied',resolvedAt:new Date().toISOString()});item.status='succeeded';item.updatedAt=new Date().toISOString();item.application={applicationId:'local-preview-only',proposalId:id,proposalVersion:proposal.version,reviewId:'local-preview',changes:[]};},100);return {...item};},
    retryApproval:async()=>{throw new Error('No failed approvals are included in this preview.');},
    cases:async()=>({items:[]}),proposals:async()=>({items:[...proposals.values()]}),proposal:async id=>get(id),
    workspace:async id=>{const record=data.records.find(item=>item.workspace.case.caseId===id);if(!record)throw new Error('Unknown local case');return record.workspace;},
    dispatches:async()=>({items:[]}),preparationFailures:async()=>({items:[]}),
    retryPreparation:async()=>{throw new Error('This historical preview does not run processing.');},retryDispatch:async()=>{throw new Error('This historical preview does not run processing.');},retryJob:async()=>{throw new Error('This historical preview does not run model calls.');},closeCase:async()=>({ok:true}),
    noProposalCases:async()=>({items:[]}),reassessCase:async()=>({caseId:'reassessment',jobId:'reassessment-job'}),requestCaseSecondOpinion:async()=>({ok:true as const}),
    secondOpinions:async()=>({items:[]}),requestSecondOpinion:async()=>{throw new Error('No second-opinion records are included in this export. Use the live operator inbox to request a new review.');},
    create:async()=>{throw new Error('Edit an existing example in this preview.');},
    save:async(id,version,draft)=>update(id,{...draft,caseId:draft.caseId??get(id).caseId,version:version+1,status:'awaiting_review'}),
    reviewBatch:async(start,limit=20)=>{const open=[...proposals.values()].filter(item=>!['closed','applied'].includes(item.status));const offset=open.findIndex(item=>item.proposalId===start);if(offset<0)return {items:[],nextProposalId:null};const items=open.slice(offset,offset+limit).map(proposal=>({proposal,case:records.get(proposal.proposalId)!.workspace.case,reassessment:null,previews:proposal.operations.map(operation=>({operationKey:operation.operationKey,source:operation.strategy==='create'?null:records.get(proposal.proposalId)!.original,result:operation.content}))}));return {items,nextProposalId:open[offset+items.length]?.proposalId??null};},
    preview:async id=>{const proposal=get(id),original=records.get(id)!.original;return {proposal,previews:proposal.operations.map(operation=>({operationKey:operation.operationKey,source:operation.strategy==='create'?null:original,result:{...original,...operation.content,version:2} as VocabularyContent})),operations:proposal.operations.map(operation=>({operationKey:operation.operationKey,strategy:operation.strategy,scope:operation.scope,schedulesRemainOnSource:0,deactivationsRemainOnSource:0,teachingBindingsRemainOnSource:0,sourceSenseMappings:0,sourceCurations:0,sourceIntroductionExercises:0,transfersRelationships:false}))};},
    approve:async id=>{update(id,{status:'approved'});return {reviewId:'local-preview'};},apply:async id=>{const proposal=update(id,{status:'applied'});return {applicationId:'local-preview-only',proposalId:id,proposalVersion:proposal.version,reviewId:'local-preview',changes:[]};},close:async id=>{update(id,{status:'closed'});return {ok:true};},
  };
  createRoot(document.getElementById('root')!).render(<><aside style={{padding:'.6rem 1.5rem',borderBottom:'1px solid var(--border)'}}>Production examples · historical replay. Actions affect this local preview only.</aside><VocabularyOperatorPage api={api} previewOnly proposalContext={proposal=>{
    const record=records.get(proposal.proposalId)!;const p=record.provenance;
    return <><p className="vocabulary-operator-meta">Accepted and applied in production · {p.review.updated_at.slice(0,10)}</p>
      <details><summary>Original record and adaptation</summary><p>{p.mapping}</p><p>Shared scope and proposal revision are local projections into the new model, not claims about the legacy records.</p><p>Generated {p.generatedAt} · {p.model}</p><p>Proposal: {p.proposalId}</p><p>Artifact: {p.artifactId}</p><p>Original acceptance: {p.review.disposition} ({p.review.acceptance_mode}). Before-content is the served snapshot at that time.</p><pre>{JSON.stringify(p.originalOperation,null,2)}</pre></details>
      {proposal.operations.every(operation=>operation.strategy==='create')&&<div><h3>Original prompt</h3><p>{(record.original.body as {prompt:string}).prompt}</p></div>}
    </>;
  }}/></>);
}
void main().catch(error=>{createRoot(document.getElementById('root')!).render(<p role="alert">{error instanceof Error?error.message:String(error)}</p>);});
