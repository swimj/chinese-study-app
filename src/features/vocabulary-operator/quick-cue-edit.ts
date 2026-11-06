import type { VocabularyCaseQueueItem } from '../../domain/vocabulary-case-queue';
import type { VocabularyContentProposal, VocabularyProposalDraft } from '../../domain/vocabulary-reflection';
import type { VocabularyOperatorApi } from './api';
import { editableCue, updateCue, type EditableCue } from './proposal-review';

export type CueEdit={proposal:VocabularyContentProposal|null;draft:VocabularyProposalDraft;operationKey:string;cue:EditableCue;originalCue:EditableCue|null};
export async function loadCueEdit(api:VocabularyOperatorApi,item:VocabularyCaseQueueItem,operationKey:string|null):Promise<CueEdit> {
  let originalCue:EditableCue|null=null;
  let proposal:VocabularyContentProposal|null=null,draft:VocabularyProposalDraft;
  if(operationKey!==null){
    if(!item.proposal)throw new Error('Proposed cue requires a proposal.');
    const [batch,original]=await Promise.all([api.reviewBatch(item.proposal.proposalId,1),api.originalModelProposal(item.proposal.proposalId)]);
    const snapshot=batch.items.find(entry=>entry.proposal.proposalId===item.proposal!.proposalId);
    if(!snapshot||snapshot.proposal.version!==item.proposal.version||snapshot.coverageChanged)throw new Error('This proposal changed. Refresh the case before editing.');
    proposal=snapshot.proposal;
    const originalOperation=original.proposal?.operations.find(operation=>operation.operationKey===operationKey);
    if(originalOperation&&originalOperation.strategy!=='retire'&&originalOperation.content.kind==='exercise')originalCue=editableCue(originalOperation.content);
    draft={...(proposal.caseId?{caseId:proposal.caseId}:{}),operations:proposal.operations,rationale:proposal.rationale,bases:proposal.bases};
  }else{
    if(item.proposal)throw new Error('Edit the proposed cue when a proposal exists.');
    const workspace=await api.workspace(item.caseId);
    const source=workspace.sources.find(source=>source.contentId===item.contentId);
    if(!source||source.kind!=='exercise'||source.availability!=='active')throw new Error('Current cue is unavailable for quick editing. Open the full workspace.');
    const {version,createdAt:_createdAt,updatedAt:_updatedAt,...content}=source;
    if(content.accessScope==='private'&&!content.ownerLearnerId)throw new Error('Private cue has no owner.');
    operationKey='operator-cue-edit';
    draft={caseId:item.caseId,rationale:'Operator cue wording correction.',operations:[{operationKey,strategy:'update_existing',learningRole:'source_repair',sourceContentId:source.contentId,expectedVersion:version,scope:content.accessScope==='shared'?{kind:'shared'}:{kind:'learner',learnerId:content.ownerLearnerId!},rationale:'Operator cue wording correction.',content}]};
  }
  const operation=draft.operations.find(operation=>operation.operationKey===operationKey);
  if(!operation||operation.strategy==='retire'||operation.content.kind!=='exercise')throw new Error('This operation does not have an editable cue.');
  const cue=editableCue(operation.content);
  if(!cue)throw new Error('This cue needs the full authored-content editor.');
  return {proposal,draft,operationKey,cue,originalCue:originalCue?.kind===cue.kind?originalCue:null};
}
export function cueEditDraft(edit:CueEdit,cue:EditableCue):VocabularyProposalDraft {
  return {...edit.draft,operations:edit.draft.operations.map(operation=>operation.operationKey===edit.operationKey?{...operation,content:updateCue(operation.content,cue)}:operation)};
}
