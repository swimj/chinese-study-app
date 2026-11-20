import { useEffect, useRef, type ReactNode } from 'react';
import type { VocabularyProposalRevision, VocabularyReassessmentEditorial } from '../../domain/vocabulary-reflection';

/** Keep mounted children so target loading and application guards remain active. */
export function ReassessmentDialog({open,onClose,busy,children,title='Reassess exercise'}:{open:boolean;onClose:()=>void;busy:boolean;children:ReactNode;title?:string}) {
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{
    const element=dialog.current;
    if(!element)return;
    if(open&&!element.open)element.showModal();
    if(!open&&element.open)element.close();
  },[open]);
  return <dialog ref={dialog} className="vocabulary-reassessment-dialog" aria-label={title} onKeyDown={event=>event.stopPropagation()} onCancel={event=>{event.preventDefault();if(!busy)onClose();}}>
    <header><h3>{title}</h3><button type="button" className="secondary-button" aria-label={`Cancel ${title.toLowerCase()}`} disabled={busy} onClick={onClose}>Cancel</button></header>
    {children}
  </dialog>;
}

export type ReassessmentDirection = {instructions:string;priorProposal:VocabularyProposalRevision|null};
export const emptyDirection:ReassessmentDirection = {instructions:'',priorProposal:null};

export function ReassessmentEditorialFields({proposal,retained,value,onChange,disabled}:{
  proposal:VocabularyProposalRevision|null;retained?:VocabularyReassessmentEditorial;value:ReassessmentDirection;
  onChange:(value:ReassessmentDirection)=>void;disabled:boolean;
}) {
  return <>
    {retained && <details><summary>Retained editorial direction</summary>
      {retained.instructions&&<p>{retained.instructions}</p>}
      {retained.priorProposal&&<p>Included proposal · v{retained.priorProposal.version}</p>}
      {retained.secondOpinion&&<p>Second opinion · {retained.secondOpinion.verdict} · {retained.secondOpinion.rationale}</p>}
    </details>}
    {proposal && !retained?.priorProposal && <label className="vocabulary-inclusion">
      <input type="checkbox" checked={value.priorProposal!==null} disabled={disabled} onChange={event=>onChange({...value,
        priorProposal:event.target.checked ? {proposalId:proposal.proposalId,version:proposal.version} : null})}/>
      Include displayed proposal (v{proposal.version}) for critique
    </label>}
    <label>{retained?'Additional editorial direction (optional)':'Editorial direction (optional)'}
      <textarea value={value.instructions} maxLength={10000} disabled={disabled} onChange={event=>onChange({...value,instructions:event.target.value})}/>
    </label>
  </>;
}
